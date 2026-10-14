const $ = id => document.getElementById(id);
let adminToken = "";
const statuses = ["Shipment registered","Picked up","In transit","Arrived at local facility","Out for delivery","Delivered","Exception"];
$("year").textContent = new Date().getFullYear();
function escapeHtml(value="") { return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function dateText(value) { if(!value) return "Not provided"; const d=new Date(value); return isNaN(d) ? escapeHtml(value) : d.toLocaleString([], {dateStyle:"medium",timeStyle:"short"}); }
function message(id,text,error=false){const el=$(id);el.textContent=text;el.style.color=error?"#b42318":"";}
$("trackForm").addEventListener("submit", async e=>{
 e.preventDefault(); const id=$("trackingId").value.trim().toUpperCase(); message("trackMessage","Looking up shipment…"); $("result").classList.add("hidden");
 try{
  const r=await fetch("/api/track/"+encodeURIComponent(id)); const data=await r.json();
  if(!r.ok) throw new Error(data.error||"Could not find shipment.");
  renderTrackingResult(data);
  $("result").classList.remove("hidden"); startCustomerRefresh(id); message("trackMessage","");
 }catch(err){message("trackMessage",err.message,true);}
});
function renderTrackingResult(data) {
 const p=data.currentLocation;
 const map=p && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))
 ? `<div class="live-map"><div class="map-heading"><div><h3>Live shipment location</h3><p class="hint">${data.gpsSharing?"GPS sharing is on":"Last GPS point recorded"} · Updated ${dateText(p.timestamp)}</p></div><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(p.latitude)}&mlon=${encodeURIComponent(p.longitude)}#map=15/${encodeURIComponent(p.latitude)}/${encodeURIComponent(p.longitude)}">Open map ↗</a></div><iframe title="Shipment GPS map" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(Number(p.longitude)-0.015)}%2C${encodeURIComponent(Number(p.latitude)-0.01)}%2C${encodeURIComponent(Number(p.longitude)+0.015)}%2C${encodeURIComponent(Number(p.latitude)+0.01)}&layer=mapnik&marker=${encodeURIComponent(p.latitude)}%2C${encodeURIComponent(p.longitude)}"></iframe><small>GPS accuracy: ${p.accuracy==null?"not reported":escapeHtml(p.accuracy+" m")}. Location may be delayed by device signal or permissions.</small></div>`
 : `<div class="live-map map-empty"><h3>Live shipment location</h3><p class="hint">No GPS point has been shared yet. Checkpoint updates remain available below.</p></div>`;
 const gpsPoints=[...(data.locationHistory||[])].slice(-8).reverse();
 const gpsTrail=gpsPoints.length?`<div class="gps-trail"><h3>Recent GPS points</h3><p class="hint">Recorded device positions, newest first. These are GPS readings, not verified street addresses.</p>${gpsPoints.map((point,index)=>`<div class="gps-point"><b>${index===0?"Latest point":"GPS point"}</b><small>${dateText(point.timestamp)} · ${Number(point.latitude).toFixed(5)}, ${Number(point.longitude).toFixed(5)}${point.accuracy==null?"":" · ±"+escapeHtml(point.accuracy)+" m"}</small></div>`).join("")}</div>`:"";
 const events=[...(data.history||[])].reverse();
 $("result").innerHTML=`<div class="result-card"><div class="result-top"><div><div class="eyebrow" style="color:#1769aa">SHIPMENT DETAILS</div><h2>Tracking <span class="tracking">${escapeHtml(data.trackingId)}</span></h2><div class="hint">Recipient: ${escapeHtml(data.recipient)}</div></div><span class="status">${escapeHtml(data.status)}</span></div><div class="meta"><div><span>ORIGIN</span><b>${escapeHtml(data.origin)}</b></div><div><span>DESTINATION</span><b>${escapeHtml(data.destination)}</b></div><div><span>ESTIMATED DELIVERY</span><b>${escapeHtml(data.estimatedDelivery||"Not available")}</b></div></div>${map}${gpsTrail}<div class="timeline"><h3>Checkpoint history</h3>${events.map(ev=>`<div class="event"><div><b>${escapeHtml(ev.status)}</b><small>${escapeHtml(ev.location||"Location not provided")} · ${dateText(ev.timestamp)}</small><small>${escapeHtml(ev.note||"")}</small></div></div>`).join("")}</div></div>`;
}
let customerRefreshTimer=null;
function startCustomerRefresh(id){if(customerRefreshTimer)clearInterval(customerRefreshTimer);customerRefreshTimer=setInterval(async()=>{if($("result").classList.contains("hidden"))return;try{const r=await fetch("/api/track/"+encodeURIComponent(id));if(r.ok)renderTrackingResult(await r.json())}catch{}},15000)}
async function api(url, options={}) {
 const r=await fetch(url,{...options,headers:{"Content-Type":"application/json","x-admin-token":adminToken,...(options.headers||{})}});
 const data=await r.json().catch(()=>({}));
 if(!r.ok) throw new Error(data.error||"Request failed.");
 return data;
}
$("loginForm").addEventListener("submit",async e=>{
 e.preventDefault(); message("adminMessage","Signing in…");
 try{
  const r=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:$("adminPassword").value})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||"Sign-in failed.");
  adminToken=data.token;$("adminPassword").value="";$("loginPanel").classList.add("hidden");$("dashboard").classList.remove("hidden");message("adminMessage","Signed in. Remember to sign out on shared devices.");await loadShipments();
 }catch(err){message("adminMessage",err.message,true);}
});
$("createForm").addEventListener("submit",async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;message("created","Creating shipment…");
 try{
  const data=await api("/api/admin/shipments",{method:"POST",body:JSON.stringify({recipient:$("recipient").value,origin:$("origin").value,destination:$("destination").value,estimatedDelivery:$("eta").value,notes:$("notes").value})});
  message("created","Created tracking ID: "+data.trackingId+" — copy it and share it with the customer.");$("createForm").reset();await loadShipments();
 }catch(err){message("created",err.message,true);}finally{btn.disabled=false;}
});
async function loadShipments(){
 try{
  const items=await api("/api/admin/shipments");
  if(!items.length){$("shipmentList").innerHTML='<p class="hint">No shipments yet. Create your first shipment above.</p>';return;}
  $("shipmentList").innerHTML=items.map(s=>`<article class="shipment" data-id="${escapeHtml(s.trackingId)}"><div class="shipment-line"><div><h4>${escapeHtml(s.trackingId)}</h4><p>${escapeHtml(s.recipient)} · ${escapeHtml(s.origin)} → ${escapeHtml(s.destination)}</p><p>Current status: <b>${escapeHtml(s.status)}</b></p></div><button class="secondary copy-id" type="button">Copy ID</button></div><div class="shipment-controls"><div><label>Status</label><select class="new-status">${statuses.map(st=>`<option ${st===s.status?"selected":""}>${escapeHtml(st)}</option>`).join("")}</select></div><div><label>Checkpoint location</label><input class="new-location" placeholder="City, State / facility" value="${escapeHtml(s.history.at(-1)?.location||"")}"></div><div><label>Checkpoint event</label><select class="checkpoint-action"><option value="update">Status update</option><option value="arrival">Arrived at stop</option><option value="departure">Departed stop</option><option value="delay">Delay / stopped</option></select></div><div><label>Update note</label><input class="new-note" placeholder="Optional note"></div><button class="save-update" type="button">Save checkpoint</button></div><div class="gps-controls"><span class="gps-label">${s.gpsSharing?"GPS: sharing":"GPS: not sharing"}${s.currentLocation?" · Last point "+dateText(s.currentLocation.timestamp):""}</span><button class="start-gps" type="button">Start simulated route</button><button class="stop-gps secondary" type="button">Stop / pause route</button></div></article>`).join("");
  $("shipmentList").querySelectorAll(".copy-id").forEach(b=>b.addEventListener("click",async()=>{const id=b.closest(".shipment").dataset.id;try{await navigator.clipboard.writeText(id);b.textContent="Copied";setTimeout(()=>b.textContent="Copy ID",1200)}catch{prompt("Copy tracking ID:",id)}}));
  $("shipmentList").querySelectorAll(".save-update").forEach(b=>b.addEventListener("click",async()=>{const el=b.closest(".shipment");b.disabled=true;try{await api("/api/admin/shipments/"+encodeURIComponent(el.dataset.id),{method:"PATCH",body:JSON.stringify({status:el.querySelector(".new-status").value,location:el.querySelector(".new-location").value,checkpointAction:el.querySelector(".checkpoint-action").value,eventNote:el.querySelector(".new-note").value})});message("adminMessage","Shipment updated.");await loadShipments()}catch(err){message("adminMessage",err.message,true)}finally{b.disabled=false}}));
  $("shipmentList").querySelectorAll(".start-gps").forEach(b=>b.addEventListener("click",()=>startGpsSharing(b.closest(".shipment").dataset.id,b)));
  $("shipmentList").querySelectorAll(".stop-gps").forEach(b=>b.addEventListener("click",()=>stopGpsSharing(b.closest(".shipment").dataset.id,b)));
 }catch(err){message("adminMessage",err.message,true);}
}
$("refresh").addEventListener("click",loadShipments);
const simulatedRoutes=new Map();
const gpsLastSent=new Map();
async function startGpsSharing(id,button){
 if(simulatedRoutes.has(id)){message("adminMessage","A simulated route is already running for "+id);return}
 const card=button.closest(".shipment");
 const origin=card?.querySelector("p")?.textContent||"";
 const fields=origin.split("→");
 const startText=prompt("Enter START latitude,longitude for this simulated route (example: 40.7128,-74.0060). This is demo data, not phone GPS.");
 if(!startText)return;
 const endText=prompt("Enter DESTINATION latitude,longitude for this simulated route.");
 if(!endText)return;
 const parse=v=>{const p=v.split(",").map(Number);return p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180?{latitude:p[0],longitude:p[1]}:null};
 const start=parse(startText),end=parse(endText);
 if(!start||!end){message("adminMessage","Coordinates must be latitude,longitude with valid numeric values.",true);return}
 let step=0;
 const tick=async()=>{
  const t=Math.min(step/120,1);
  const point={latitude:start.latitude+(end.latitude-start.latitude)*t,longitude:start.longitude+(end.longitude-start.longitude)*t,accuracy:null,mode:"simulated"};
  try{
   await api("/api/admin/shipments/"+encodeURIComponent(id)+"/location",{method:"POST",body:JSON.stringify(point)});
   const label=card?.querySelector(".gps-label");if(label)label.textContent="SIMULATION · "+Math.round(t*100)+"% along demo route";
   message("adminMessage","Simulated route updated for "+id+". This is not real GPS.");
   step++;
  }catch(err){message("adminMessage",err.message,true);pauseSimulatedRoute(id);return}
  if(t>=1){pauseSimulatedRoute(id);message("adminMessage","Simulated route reached its demo destination. Restart to replay.");}
 };
 await tick();
 if(step<=120){const timer=setInterval(tick,10000);simulatedRoutes.set(id,timer);button.textContent="Simulating demo route";message("adminMessage","Demo route started. Use Stop / pause route any time. Customer map is labeled simulated.");}
}
function pauseSimulatedRoute(id){if(simulatedRoutes.has(id)){clearInterval(simulatedRoutes.get(id));simulatedRoutes.delete(id)}}
async function stopGpsSharing(id,button){
 pauseSimulatedRoute(id);button.disabled=true;
 try{await api("/api/admin/shipments/"+encodeURIComponent(id)+"/location/stop",{method:"POST"});message("adminMessage","Simulated route stopped for "+id+".");await loadShipments()}catch(err){message("adminMessage",err.message,true)}finally{button.disabled=false}
}
$("logout").addEventListener("click",async()=>{try{await api("/api/admin/logout",{method:"POST"})}catch{}adminToken="";$("dashboard").classList.add("hidden");$("loginPanel").classList.remove("hidden");message("adminMessage","You have signed out.");});