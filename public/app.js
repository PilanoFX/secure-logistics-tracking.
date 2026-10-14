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
 const events=[...(data.history||[])].reverse();
 const eta=data.estimatedDelivery ? dateText(data.estimatedDelivery) : "Not yet provided";
 const delivered=data.status==="Delivered";
 const progress=["Shipment registered","Picked up","In transit","Arrived at local facility","Out for delivery","Delivered"];
 const currentIndex=progress.indexOf(data.status);
 const progressHtml=currentIndex>=0 ? `<div class="shipment-progress"><div class="progress-head"><h3>Delivery progress</h3><span>${Math.round((currentIndex/(progress.length-1))*100)}% complete</span></div><div class="progress-track"><span style="width:${Math.round((currentIndex/(progress.length-1))*100)}%"></span></div><div class="progress-labels"><span>Registered</span><span>In transit</span><span>Delivered</span></div></div>` : "";
 $("result").innerHTML=`<div class="result-card"><div class="result-top"><div><div class="eyebrow" style="color:#1769aa">SHIPMENT DETAILS</div><h2>Tracking <span class="tracking">${escapeHtml(data.trackingId)}</span></h2><div class="hint">Recipient: ${escapeHtml(data.recipient)}</div></div><span class="status ${delivered?"status-delivered":""}">${escapeHtml(data.status)}</span></div><div class="meta"><div><span>ORIGIN</span><b>${escapeHtml(data.origin)}</b></div><div><span>DESTINATION</span><b>${escapeHtml(data.destination)}</b></div><div><span>ESTIMATED DELIVERY</span><b>${eta}</b></div></div>${progressHtml}<div class="timeline"><h3>Shipment updates</h3>${events.length?events.map(ev=>`<div class="event"><div><b>${escapeHtml(ev.status)}</b><small>${escapeHtml(ev.location||"Location not provided")} · ${dateText(ev.timestamp)}</small><small>${escapeHtml(ev.note||"")}</small></div></div>`).join(""):'<p class="hint">No updates have been recorded yet.</p>'}</div><p class="tracking-footnote">Delivery estimates may change as the shipment progresses. This page displays updates recorded by Secure Logistics staff.</p></div>`;
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
  $("shipmentList").innerHTML=items.map(s=>`<article class="shipment" data-id="${escapeHtml(s.trackingId)}"><div class="shipment-line"><div><h4>${escapeHtml(s.trackingId)}</h4><p>${escapeHtml(s.recipient)} · ${escapeHtml(s.origin)} → ${escapeHtml(s.destination)}</p><p>Current status: <b>${escapeHtml(s.status)}</b></p></div><button class="secondary copy-id" type="button">Copy ID</button></div><div class="shipment-controls"><div><label>Status</label><select class="new-status">${statuses.map(st=>`<option ${st===s.status?"selected":""}>${escapeHtml(st)}</option>`).join("")}</select></div><div><label>Estimated delivery</label><input class="shipment-eta" type="date" value="${escapeHtml(s.estimatedDelivery||"")}"></div><div><label>Checkpoint location</label><input class="new-location" placeholder="City, State / facility" value="${escapeHtml(s.history.at(-1)?.location||"")}"></div><div><label>Checkpoint event</label><select class="checkpoint-action"><option value="update">Status update</option><option value="arrival">Arrived at stop</option><option value="departure">Departed stop</option><option value="delay">Delay / stopped</option></select></div><div><label>Update note</label><input class="new-note" placeholder="Optional note"></div><button class="save-update" type="button">Save checkpoint</button></div></article>`).join("");
  $("shipmentList").querySelectorAll(".copy-id").forEach(b=>b.addEventListener("click",async()=>{const id=b.closest(".shipment").dataset.id;try{await navigator.clipboard.writeText(id);b.textContent="Copied";setTimeout(()=>b.textContent="Copy ID",1200)}catch{prompt("Copy tracking ID:",id)}}));
  $("shipmentList").querySelectorAll(".save-update").forEach(b=>b.addEventListener("click",async()=>{const el=b.closest(".shipment");b.disabled=true;try{await api("/api/admin/shipments/"+encodeURIComponent(el.dataset.id),{method:"PATCH",body:JSON.stringify({status:el.querySelector(".new-status").value,estimatedDelivery:el.querySelector(".shipment-eta").value,location:el.querySelector(".new-location").value,checkpointAction:el.querySelector(".checkpoint-action").value,eventNote:el.querySelector(".new-note").value})});message("adminMessage","Shipment updated.");await loadShipments()}catch(err){message("adminMessage",err.message,true)}finally{b.disabled=false}}));
 }catch(err){message("adminMessage",err.message,true);}
}
$("refresh").addEventListener("click",loadShipments);
$("logout").addEventListener("click",async()=>{try{await api("/api/admin/logout",{method:"POST"})}catch{}adminToken="";$("dashboard").classList.add("hidden");$("loginPanel").classList.remove("hidden");message("adminMessage","You have signed out.");});