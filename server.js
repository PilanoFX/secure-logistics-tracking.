const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Prefer the configured persistent-disk directory. Remove a trailing dot if the
// Render environment variable was accidentally saved as "/var/data.".
let DATA_DIR = (process.env.DATA_DIR || path.join(__dirname, "data")).replace(/\\.$/, "");
let DB_FILE = path.join(DATA_DIR, "shipments.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PORT = process.env.PORT || 3000;

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 16) {
  console.error("Set ADMIN_PASSWORD to a long, unique password (at least 16 characters).");
  process.exit(1);
}
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  // Render only permits writes to mounted disks and the service directory.
  // Keep the service bootable if DATA_DIR points to an unavailable disk, but
  // warn that local fallback storage is temporary until a persistent disk is configured.
  if (err.code !== "EACCES" && err.code !== "EPERM" && err.code !== "ENOENT") throw err;
  const fallbackDir = path.join(__dirname, "data");
  console.warn(`Cannot access DATA_DIR "${DATA_DIR}" (${err.code}); using "${fallbackDir}". Configure a Render persistent disk mounted at /var/data for durable shipment records.`);
  DATA_DIR = fallbackDir;
  DB_FILE = path.join(DATA_DIR, "shipments.json");
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", { mode: 0o600 });

function readShipments() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return []; }
}
function writeShipments(items) {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}
function clean(v, max = 160) {
  return String(v ?? "").trim().slice(0, max);
}
function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}
const sessions = new Map();
function requireAdmin(req, res, next) {
  const token = req.get("x-admin-token");
  const expires = token && sessions.get(token);
  if (!expires || expires < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: "Please sign in again." });
  }
  next();
}
const allowedStatuses = [
  "Shipment registered", "Picked up", "In transit",
  "Arrived at local facility", "Out for delivery", "Delivered", "Exception"
];

app.post("/api/admin/login", (req, res) => {
  const password = String(req.body?.password || "");
  const a = Buffer.from(password);
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  const token = makeToken();
  sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
  res.json({ token, expiresIn: 28800 });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  sessions.delete(req.get("x-admin-token"));
  res.json({ ok: true });
});

app.get("/api/track/:id", (req, res) => {
  const id = clean(req.params.id, 80).toUpperCase();
  const shipment = readShipments().find(s => s.trackingId === id);
  if (!shipment) return res.status(404).json({ error: "No shipment was found for that tracking ID. Check the number and try again." });
  const { trackingId, recipient, origin, destination, status, estimatedDelivery, history, createdAt, currentLocation, gpsSharing, locationHistory } = shipment;
  res.json({ trackingId, recipient, origin, destination, status, estimatedDelivery, history, createdAt, currentLocation: currentLocation || null, gpsSharing: Boolean(gpsSharing), locationHistory: Array.isArray(locationHistory) ? locationHistory.slice(-100) : [] });
});

app.get("/api/admin/shipments", requireAdmin, (req, res) => {
  res.json(readShipments().sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
});

app.post("/api/admin/shipments", requireAdmin, (req, res) => {
  const body = req.body || {};
  const recipient = clean(body.recipient);
  const origin = clean(body.origin);
  const destination = clean(body.destination);
  if (!recipient || !origin || !destination) {
    return res.status(400).json({ error: "Recipient, origin, and destination are required." });
  }
  const items = readShipments();
  const date = new Date();
  const ymd = date.toISOString().slice(2,10).replace(/-/g, "");
  let trackingId;
  do {
    trackingId = `SLD-US-${ymd}-${crypto.randomInt(100000, 999999)}`;
  } while (items.some(s => s.trackingId === trackingId));
  const status = "Shipment registered";
  const shipment = {
    trackingId, recipient, origin, destination,
    status,
    estimatedDelivery: clean(body.estimatedDelivery, 40),
    notes: clean(body.notes, 500),
    createdAt: date.toISOString(),
    updatedAt: date.toISOString(),
    gpsSharing: false,
    currentLocation: null,
    locationHistory: [],
    history: [{ status, location: origin, timestamp: date.toISOString(), note: "Shipment record created." }]
  };
  items.push(shipment);
  writeShipments(items);
  res.status(201).json(shipment);
});

app.patch("/api/admin/shipments/:id", requireAdmin, (req, res) => {
  const id = clean(req.params.id, 80).toUpperCase();
  const items = readShipments();
  const shipment = items.find(s => s.trackingId === id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const body = req.body || {};
  if (body.status && !allowedStatuses.includes(body.status)) {
    return res.status(400).json({ error: "Invalid shipment status." });
  }
  if (body.status) shipment.status = body.status;
  if (body.destination !== undefined) shipment.destination = clean(body.destination);
  if (body.estimatedDelivery !== undefined) shipment.estimatedDelivery = clean(body.estimatedDelivery, 40);
  if (body.notes !== undefined) shipment.notes = clean(body.notes, 500);
  const now = new Date().toISOString();
  shipment.updatedAt = now;
  const checkpointAction = ["arrival", "departure", "delay"].includes(body.checkpointAction) ? body.checkpointAction : "update";
  const checkpointPrefix = checkpointAction === "arrival" ? "Arrived at checkpoint. " :
    checkpointAction === "departure" ? "Departed checkpoint. " :
    checkpointAction === "delay" ? "Delay / stopped. " : "";
  shipment.history.push({
    status: shipment.status,
    location: clean(body.location || shipment.destination),
    timestamp: now,
    note: clean(checkpointPrefix + (body.eventNote || body.notes || (checkpointAction === "update" ? "Shipment status updated." : "")), 300)
  });
  writeShipments(items);
  res.json(shipment);
});

// Driver/staff phone location updates. Browser permission is required; sharing only runs while the staff page is open.
app.post("/api/admin/shipments/:id/location", requireAdmin, (req, res) => {
  const id = clean(req.params.id, 80).toUpperCase();
  const items = readShipments();
  const shipment = items.find(s => s.trackingId === id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  const accuracy = Number(req.body?.accuracy);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: "Valid GPS coordinates are required." });
  }
  const point = {
    latitude, longitude,
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null,
    timestamp: new Date().toISOString()
  };
  shipment.currentLocation = point;
  shipment.gpsSharing = true;
  shipment.updatedAt = point.timestamp;
  shipment.locationHistory = Array.isArray(shipment.locationHistory) ? shipment.locationHistory : [];
  const last = shipment.locationHistory[shipment.locationHistory.length - 1];
  // Store a breadcrumb only after a meaningful move (about 100m) or 2 minutes.
  const moved = !last || Math.abs(last.latitude - latitude) > 0.0008 || Math.abs(last.longitude - longitude) > 0.0008;
  const aged = !last || Date.now() - new Date(last.timestamp).getTime() >= 120000;
  if (moved || aged) {
    shipment.locationHistory.push(point);
    if (shipment.locationHistory.length > 100) shipment.locationHistory = shipment.locationHistory.slice(-100);
  }
  writeShipments(items);
  res.json({ ok: true, currentLocation: shipment.currentLocation, gpsSharing: true });
});

app.post("/api/admin/shipments/:id/location/stop", requireAdmin, (req, res) => {
  const id = clean(req.params.id, 80).toUpperCase();
  const items = readShipments();
  const shipment = items.find(s => s.trackingId === id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  shipment.gpsSharing = false;
  shipment.updatedAt = new Date().toISOString();
  writeShipments(items);
  res.json({ ok: true, gpsSharing: false });
});

app.delete("/api/admin/shipments/:id", requireAdmin, (req, res) => {
  const id = clean(req.params.id, 80).toUpperCase();
  const items = readShipments();
  const next = items.filter(s => s.trackingId !== id);
  if (next.length === items.length) return res.status(404).json({ error: "Shipment not found." });
  writeShipments(next);
  res.json({ ok: true });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Secure Logistics tracking server listening on ${PORT}`));