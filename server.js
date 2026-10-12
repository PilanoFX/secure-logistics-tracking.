const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "shipments.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PORT = process.env.PORT || 3000;

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 16) {
  console.error("Set ADMIN_PASSWORD to a long, unique password (at least 16 characters).");
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
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
  const { trackingId, recipient, origin, destination, status, estimatedDelivery, history, createdAt } = shipment;
  res.json({ trackingId, recipient, origin, destination, status, estimatedDelivery, history, createdAt });
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
  shipment.history.push({
    status: shipment.status,
    location: clean(body.location || shipment.destination),
    timestamp: now,
    note: clean(body.eventNote || body.notes || "Shipment status updated.", 300)
  });
  writeShipments(items);
  res.json(shipment);
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