import { $, art, icon, img, escape, costHTML, signed, fact, primary, secondary, glyphs } from "./ui/elements.js";
import { visitPanel, visitStatus } from "./ui/encounter.js";
import { createFigureLayer, PARTY_ID } from "./render/figures.js";
import { TAU, clamp } from "./render/models.js";
import {
  DAY_MS, DIG_MS, LIMIT, MEALS_PER_MINUTE, OLD_STORE, PERSON_BASE, PREVIOUS_STORE, STORE,
  advanceParty, advanceWorkers, arriveParty, availableKeeper, beds, buildings, canPay, cancelDig, cellId, countPeople,
  countRoom, demand, deposit, ensureCrew, farmPose, frontier, gates, harvestState, homeSpots, homes, initialState,
  invalidateNavigation, jobOutput, knownRooms, labelsFor, loadState, offering, parseKey, peopleKinds, plannedEdges, power,
  prepareBait, production, questList, queueDig, resources, respondToParty, setState, state, stockHome, tickSupplies, tileCount, transfer, workplaces
} from "./simulation/colony.js";
import { entrances, nextEntrance, sporeCell, wardBonus } from "./simulation/visits.js";
import { caveScene } from "./render/scene.js";
import { project, makeSoftware, makeWebGL } from "./render/terrain.js";

let canSave=true, lastStored=null;
try {
  lastStored=localStorage.getItem(STORE);setState(loadState(lastStored));
  if (!state) {lastStored=null;setState(loadState(localStorage.getItem(PREVIOUS_STORE)) || loadState(localStorage.getItem("glimmgrund.mooswiege.v2")) || loadState(localStorage.getItem(OLD_STORE)) || initialState());}
}
catch { setState(initialState()); canSave=false; }
let mode="dig", plan=null, activeTab="overview", sheet="", recentTile="", audio=null, toastTimer=0;
let harvestSite=null, focusedCell=null, focusedPerson=0, buildHere=null;
let lastTick=performance.now(), lastSave=lastTick, visibleFrom=lastTick, clockVisible=!document.hidden;
const dialog=$("dialog"), viewport=$("map-window");
function persist() {
  if (!state.paused || !state.work.at) state.work.at=performance.timeOrigin+lastTick;
  try { const raw=JSON.stringify(state);localStorage.setItem(STORE,raw);lastStored=raw;canSave=true; }
  catch { canSave=false; }
}
function pullWorld() {
  let raw;
  try { raw=localStorage.getItem(STORE); } catch { return; }
  if (!raw || raw===lastStored) return;
  const updated=loadState(raw);if (!updated) return;
  const changed=worldSignature(state)!==worldSignature(updated);
  const plansChanged=state.shift.orders.map(o=>o.key).join("|")!==updated.shift.orders.map(o=>o.key).join("|");
  const dayChanged=state.day!==updated.day, visitChanged=visitSignature(state)!==visitSignature(updated);
  const settingsChanged=state.paused!==updated.paused || state.sound!==updated.sound;
  setState(updated);lastStored=raw;
  const now=performance.now();
  lastTick=Math.max(visibleFrom,Math.min(now,updated.work.at-performance.timeOrigin));
  if (changed || plansChanged || visitChanged) render();else {renderHeader();if (bookDialog.open) renderBook();}
  if (!dialog.open) return;
  if (sheet==="crew" && changed) openCrew();
  else if (sheet==="person" && changed) {if (state.people[focusedPerson]) openPerson(focusedPerson);else closeSheet();}
  else if (sheet==="cell" && changed) {if (state.tiles[focusedCell]) openCell(focusedCell);else closeSheet();}
  else if (sheet==="visit" && (changed || visitChanged || dayChanged)) openVisit();
  else if (sheet==="calendar" && (dayChanged || visitChanged)) openCalendar();
  else if (sheet==="settings" && settingsChanged) openSettings();
  else refreshLivePanel();
}
// Two visible tabs may harvest or save during the same frame.
function worldOrder(action) {
  const apply=()=>{pullWorld();action();};
  let locks;
  try {locks=navigator.locks;}catch { /* Some local-file browsers disable shared locks. */ }
  if (!locks) {apply();return;}
  locks.request(STORE,apply).catch(error=>{
    if (error.name==="SecurityError" || error.name==="NotSupportedError") apply();
    else throw error;
  });
}
function saveBeforeLeaving() {
  try {if (localStorage.getItem(STORE)!==lastStored) return;}catch {return;}
  advanceClock();persist();
}
// Carry fractional work across orders, day changes and saves. Only whole units enter the stores.
function advanceClock(now=performance.now()) {
  const delta=Math.min(2500,Math.max(0,now-lastTick));
  lastTick=now;
  if (!clockVisible || state.paused || !delta) return;
  tickSupplies(delta);
  if (!state.visit && state.day>=state.nextVisit) arriveBeetles();
  const completed=advanceWorkers(delta,completeDig,showDelivery);
  const departing=advanceParty(delta);
  if(departing) {
    const who=departing.keeper>=0?state.people[departing.keeper].name:"";
    const ending=who?who+" hat die Käfer hinausbegleitet.":departing.choice==="bait"?"Die satten Käfer sind heimgekehrt.":"Die Käfer sind mit etwas Gold weitergezogen.";
    logEvent(entrances[departing.gate].name+" · "+ending,"beetle");toast(ending);
  }
  if(completed.length || departing) {
    const reward=advanceQuests();
    persist();render();refreshLivePanel();chime(departing?"guest":"dig");
    if(reward) toast(reward);
  }
  if(departing) restoreVillageView();
  refreshQueue();
}
function arriveBeetles() {
  if(!arriveParty()) return;
  const message="Käfer kommen aus dem "+entrances[state.visit.gate].name+".";
  logEvent(message,"beetle");toast(message);render();
  if(!dialog.open && !bookDialog.open && !pointers.size) frameParty();
}
function logEvent(text,mark="gem") {
  state.log.unshift({day:state.day,icon:mark,text});
  state.log.length=Math.min(80,state.log.length);
  state.unread=activeTab!=="journal";
}
function advanceQuests() {
  const rewards=[];
  let task=questList[state.quest];
  while (task && task.score()>=task.goal) {
    transfer(task.reward);
    rewards.push("+"+labelsFor(task.reward));
    logEvent("Auftrag „"+task.title+"“ erfüllt. Dafür gibt es "+labelsFor(task.reward)+".","flag");
    state.quest++;
    task=questList[state.quest];
  }
  if (!task && rewards.length) logEvent("Die große Wanderung ist geschafft. Beide Käferpfade sind sicher.","beetle");
  return rewards.length ? "Auftrag erfüllt · "+rewards.join(", ") : "";
}
function finishAction(message, note="", tone="dig") {
  const reward=advanceQuests();
  persist();
  render();
  chime(tone);
  toast([message,reward || note].filter(Boolean).join(" · "));
}
function toast(text) {
  const el=$("notice");
  clearTimeout(toastTimer);
  el.textContent=text;
  el.classList.toggle("show",!!text);
  if (text) toastTimer=setTimeout(()=>el.classList.remove("show"),3300);
}
function chime(kind) {
  if (!state.sound) return;
  try {
    const AudioType=window.AudioContext || window.webkitAudioContext;
    if (!AudioType) return;
    audio=audio || new AudioType();
    if (audio.state==="suspended") audio.resume().catch(()=>{});
    const tones={dig:[170,265],build:[261.63,392],gem:[523.25,783.99],guest:[293.66,369.99,440],day:[329.63,493.88]};
    (tones[kind] || tones.gem).forEach((hz,i)=>{
      const osc=audio.createOscillator(), gain=audio.createGain(), start=audio.currentTime+i*.085;
      osc.type=kind==="dig"?"triangle":"sine"; osc.frequency.value=hz;
      gain.gain.setValueAtTime(.0001,start);
      gain.gain.exponentialRampToValueAtTime(.045,start+.013);
      gain.gain.exponentialRampToValueAtTime(.0001,start+.25);
      osc.connect(gain); gain.connect(audio.destination); osc.start(start); osc.stop(start+.27);
      osc.onended=()=>{osc.disconnect();gain.disconnect();};
    });
  } catch { /* Audio availability is independent of play. */ }
}

function switchTab(tab, focus=false) {
  activeTab=tab;
  if (tab==="journal" && state.unread) { state.unread=false; persist(); }
  for (const name of ["overview","journal"]) {
    const selected=name===tab, button=$("tab-"+name);
    button.setAttribute("aria-selected",String(selected)); button.tabIndex=selected?0:-1;
    $(name).hidden=!selected;
    if (selected && focus) button.focus();
  }
  renderBook();
}
function renderBook() {
  const task=questList[state.quest];
  if (task) {
    const score=Math.min(task.goal,Math.max(0,task.score())), [reward,n]=Object.entries(task.reward)[0];
    $("quest").innerHTML=img(task.art,"quest-art")+'<div class="eyebrow">'+icon("flag")+'Aktueller Auftrag</div><h3>'+task.title+'</h3><p>'+task.text+'</p><div class="progress-line"><div class="progress-track" role="progressbar" aria-label="Auftragsfortschritt" aria-valuenow="'+score+'" aria-valuemin="0" aria-valuemax="'+task.goal+'"><i style="width:'+100*score/task.goal+'%"></i></div><strong>'+score+' / '+task.goal+'</strong></div><div class="reward">Belohnung<span class="yield">'+img(reward)+'+'+n+' '+resources[reward]+'</span></div>';
  } else {
    $("quest").innerHTML=img("guard","quest-art")+'<div class="eyebrow">'+icon("check")+'Wanderung geschafft</div><h3>Zwei sichere Käferpfade</h3><p>Vom Moosstollen bis zum Kupferstollen kennen die Käfer den Heimweg. Du kannst dein Dorf weiter ausbauen.</p>';
  }
  $("capacity").innerHTML=icon("people")+state.people.length+" / "+beds();
  $("capacity").setAttribute("aria-label",state.people.length+" von "+beds()+" Schlafplätzen belegt");
  $("residents").innerHTML=state.people.map((p,i)=>'<button class="resident" data-person="'+i+'"><span class="portrait '+p.type+'">'+img(p.type)+'</span><span class="person-name"><b>'+escape(p.name)+'</b><small>'+peopleKinds[p.type].role+' · '+workplaces[p.job]+'</small></span><span class="role-mark">'+icon(peopleKinds[p.type].icon)+'</span></button>').join("");
  $("encounter").innerHTML='<span class="encounter-sign">'+icon("beetle")+'</span><span><small>'+(state.visit?"Besuch in der Höhle":"Nächste Käferspuren")+'</small><b>'+entrances[state.visit?.gate||nextEntrance(state)].name+'</b></span><span class="date-pill">'+(state.visit?"Jetzt":"Tag "+state.nextVisit)+'</span>';
  document.querySelector(".unread").hidden=!state.unread;
  if (activeTab==="journal") {
    let day=null;
    $("journal-entries").innerHTML=state.log.map(e=>{
      const title=day===e.day?"":'<h3 class="journal-day">Tag '+e.day+'</h3>';
      day=e.day;
      return title+'<div class="journal-entry">'+icon(Object.hasOwn(glyphs,e.icon)?e.icon:"gem")+'<span>'+escape(e.text)+'</span></div>';
    }).join("");
  }
}
function renderToolbar() {
  const active=dialog.open && (sheet==="recruit" || sheet==="build") ? sheet : mode;
  document.querySelectorAll(".tool").forEach(b=>{
    const on=b.dataset.tool===active;
    b.classList.toggle("active",on); b.setAttribute("aria-pressed",String(on));
  });
  let hint=state.shift.orders.length?"Weitere Felder antippen · Erneut tippen zum Abwählen.":"Fels antippen, um Grabaufträge zu markieren.";
  if (mode==="build" && plan) hint=buildings[plan].name+" · Grün markierten Boden antippen.";
  if (mode==="build" && plan==="ward") hint="Wachstube setzen · Bonus für den "+entrances[state.visit?.gate||nextEntrance(state)].name;
  if (mode==="look") hint="Tippe auf einen Raum, um ihn zu erkunden.";
  if (mode==="dig" && !frontier().size) hint="Alle Stollen sind erschlossen. In freien Feldern kannst du bauen.";
  $("tool-hint").textContent=hint;
}
function writeText(el,text) {
  const value=String(text);
  if (el.textContent!==value) el.textContent=value;
}
function renderSupplies() {
  const rates=production();
  for (const k of Object.keys(resources)) {
    writeText($(k),state.stock[k]);
    const rate=$("rate-"+k);
    writeText(rate,signed(rates[k])+"/min");
    rate.classList.toggle("negative",rates[k]<0);
    const b=$(k).closest("button");
    const label=state.stock[k]+" "+resources[k]+" · "+signed(rates[k])+" pro Minute. "+homes[stockHome[k]].name+" öffnen.";
    if (b.title!==label) { b.title=label;b.setAttribute("aria-label",label); }
  }
  const low=state.stock.food<=3;
  $("quick-harvest").hidden=!low;
  if (low) {
    const {ready}=harvestState("farm");
    writeText($("quick-label"),ready?"Pilze pflücken · +"+ready:"Pilzgarten öffnen");
  }
}
function renderHeader() {
  renderSupplies();
  $("day-text").textContent="Tag "+state.day;
  $("pause").innerHTML=icon(state.paused?"play":"pause");
  const label=state.paused?"Spielzeit fortsetzen":"Spielzeit anhalten";
  $("pause").title=label; $("pause").setAttribute("aria-label",label); $("pause").setAttribute("aria-pressed",String(state.paused));
  document.body.classList.toggle("paused",state.paused);
  $("peace").classList.toggle("visiting",!!state.visit);
  $("peace").lastElementChild.textContent=state.visit?visitStatus():"Käferpfade";
  const keeper=availableKeeper(), direct=$("escort-now");
  direct.hidden=!state.visit || !!state.visit.choice || keeper<0 || power()<demand();
  if(!direct.hidden) writeText(direct,state.people[keeper].name+" rufen");
  renderGoal();
}
function visitSignature(game) {
  const v=game.visit;
  return [v?.gate,v?.phase,v?.choice,v?.keeper,game.trails.bait.moss,game.trails.bait.copper].join("|");
}
function renderGoal() {
  const made=tileCount(), marked=Math.min(2,made+state.shift.orders.length);
  const task=questList[state.quest], chip=$("map-goal");
  chip.hidden=!!state.visit;
  const prompts=["Drei Stollen öffnen","Einen Pilzgarten bauen","Einen Bewohner anwerben","Den Leuchtsporen folgen",
    "Käfer nach Hause begleiten","Sechs Bewohner beherbergen","Beide Käferwege sichern"];
  writeText($("goal-label"),state.guided?(prompts[state.quest] || "Käferpfade gesichert"):"Markiere zwei Felsen für Pip");
  writeText($("goal-count"),state.guided?(task?Math.min(task.goal,task.score())+"/"+task.goal:"✓"):marked+"/2");
}
function render() { renderHeader(); renderBook(); renderToolbar(); renderWorld();refreshQueue(); }

function markDig(key) {
  const wasQueued=state.shift.orders.some(o=>o.key===key);
  advanceClock();
  if (wasQueued && !state.shift.orders.some(o=>o.key===key)) return;
  if (!plannedEdges().has(key) || state.tiles[key]) return;
  if (wasQueued) {
    const removed=cancelDig(key);toast(removed>1?removed+" verbundene Felder abgewählt":"Markierung entfernt");
  } else {
    if(!queueDig(key)) return;
    const [x,z]=parseKey(key);
    reveal(x,worldScene.heights.get(cellId(x,z)),z);
  }
  persist();renderWorld();renderToolbar();refreshQueue();renderGoal();
}
const bookDialog=$("book-dialog"), mapButtons=$("map-pins"), viewKey=OLD_STORE+".kamera2";
const view={q:0,r:.15,zoom:1,angle:.70};
let visitCamera=null;
const ochre=[.99,.74,.34],mint=[.51,.91,.72];
const homeCenter = Object.values(homeSpots);
let worldScene=null,sceneKey="",renderer=null,atlasImage=null,screen=null,targets=new Map();
let marks=new Uint8Array(32*32*4),hoverId=0,frame=0,stillTimer=0,viewTimer=0,turnAnimation=0;
const glCanvas=$("cave-gl"),cpuCanvas=$("cave-cpu"),ambientCanvas=$("cave-air");
function startRenderer() {
  try {renderer=makeWebGL(glCanvas);} catch {renderer=null;}
  if(renderer) {glCanvas.hidden=false;cpuCanvas.hidden=true;}
  else {renderer=makeSoftware(cpuCanvas);glCanvas.hidden=true;cpuCanvas.hidden=false;}
  if(atlasImage) renderer.setAtlas(atlasImage);
  if(worldScene) {renderer.setScene(worldScene);renderer.setMarks(marks);layoutWorld();}
}
startRenderer();
glCanvas.addEventListener("webglcontextlost",e=>{
  e.preventDefault();renderer=makeSoftware(cpuCanvas);glCanvas.hidden=true;cpuCanvas.hidden=false;
  if(atlasImage) renderer.setAtlas(atlasImage);
  if(worldScene){renderer.setScene(worldScene);renderer.setMarks(marks);layoutWorld();}
});
glCanvas.addEventListener("webglcontextrestored",startRenderer);
const atlasLoader=new Image();
atlasLoader.onload=()=>{atlasImage=atlasLoader;renderer.setAtlas(atlasImage);layoutWorld();};
atlasLoader.src=art.materials;
try {
  const saved=JSON.parse(localStorage.getItem(viewKey));
  if(saved && ["q","r","angle","zoom"].every(k=>Number.isFinite(saved[k]))) {
    view.q=clamp(saved.q,-LIMIT-1,LIMIT+1);view.r=clamp(saved.r,-LIMIT-1,LIMIT+1);
    view.angle=saved.angle%TAU;view.zoom=clamp(saved.zoom,.28,3.2);
  }
  if(state.visit) {
    const visitView=JSON.parse(sessionStorage.getItem(viewKey+".visit"));
    if(visitView && ["before","framed"].every(part=>["q","r","angle","zoom"].every(k=>Number.isFinite(visitView[part]?.[k])))) visitCamera=visitView;
  }
} catch { /* The map also works in a private, memory-only session. */ }
function saveView() {try {localStorage.setItem(viewKey,JSON.stringify(view));}catch {}}
function rememberView() {clearTimeout(viewTimer);viewTimer=setTimeout(saveView,240);}
window.addEventListener("pagehide",saveView);
function viewMetrics() {
  const w=viewport.clientWidth,h=viewport.clientHeight;
  const base=w<680?clamp(Math.min((w-26)/9.05,h/8.15),27,79):clamp(Math.min(w/12.0,h/7.85),42,140);
  const k=base*view.zoom,a=view.angle,s=Math.sin(a),c=Math.cos(a),e=.665;
  const se=Math.sin(e),ce=Math.cos(e);
  const right=[c,0,-s],up=[-s*se,ce,-c*se],eye=[s*ce,se,c*ce];
  const bottom=w<801?103:115,top=w<801?49:72;
  const cx=w*.5,cy=(top+h-bottom)*.5+k*.48;
  return {w,h,base,k,cx,cy,right,up,eye,se,
    ox:cx-k*(view.q*right[0]+view.r*right[2]),oy:cy+k*(view.q*up[0]+view.r*up[2])};
}
function panPixels(dx,dy,v=screen) {
  if(!v || !v.k) return;
  const s=Math.sin(view.angle),c=Math.cos(view.angle);
  view.q=clamp(view.q-dx*c/v.k-dy*s/(v.k*v.se),-LIMIT-1,LIMIT+1);
  view.r=clamp(view.r+dx*s/v.k-dy*c/(v.k*v.se),-LIMIT-1,LIMIT+1);
}
function groundAt(v,x,y) {
  const side=(x-v.ox)/v.k,forward=(y-v.oy)/(v.k*v.se);
  return {q:side*v.right[0]-forward*v.right[2],r:side*v.right[2]+forward*v.right[0]};
}
function keepGroundAt(point,x,y) {
  const after=groundAt(viewMetrics(),x,y);
  view.q=clamp(view.q+point.q-after.q,-LIMIT-1,LIMIT+1);
  view.r=clamp(view.r+point.r-after.r,-LIMIT-1,LIMIT+1);
}
function layoutWorld(moving=false) {
  if(!worldScene || !viewport.clientWidth || !viewport.clientHeight) return;
  screen=viewMetrics();
  renderer.draw(screen,mode==="build"?mint:ochre,hoverId,moving===true);
  for(const t of targets.values()) {
    const p=project(screen,t.x,t.y,t.z);t.p=p;
    t.el.style.left=p.x+"px";t.el.style.top=p.y+"px";
    t.el.tabIndex=(p.x>3 && p.y>3 && p.x<screen.w-3 && p.y<screen.h-3)?0:-1;
  }
  const tip=$("map-label"),active=targets.get(hoverId);
  if(active && tip.textContent && !viewport.classList.contains("dragging")) {
    tip.hidden=false;
    tip.style.left=clamp(active.p.x,72,Math.max(72,screen.w-72))+"px";
    tip.style.top=clamp(active.p.y-24,28,screen.h-20)+"px";
  } else tip.hidden=true;
  document.querySelector(".compass-rose").style.transform="rotate("+((view.angle-.70)*180/Math.PI)+"deg)";
  document.querySelector('[data-action="zoom-out"]').disabled=view.zoom<=.281;
  document.querySelector('[data-action="zoom-in"]').disabled=view.zoom>=3.199;
  paintCrew(performance.now());drawAir(performance.now());placeOrderMarks();positionEntranceSigns();
}
function scheduleView(moving=false) {
  if(!frame) frame=requestAnimationFrame(()=>{frame=0;layoutWorld(moving);});
  if(moving){clearTimeout(stillTimer);stillTimer=setTimeout(()=>scheduleView(),110);}
}
function reveal(x,y,z,center=false) {
  const v=viewMetrics(),p=project(v,x,y,z),margin=Math.min(61,v.w*.15);
  const left=margin,right=v.w-margin,top=Math.min(94,v.h*.18),bottom=v.h-Math.min(128,v.h*.23);
  const dx=center?v.cx-p.x:clamp(p.x,left,right)-p.x;
  const dy=center?(top+bottom)*.5-p.y:clamp(p.y,top,bottom)-p.y;
  if(Math.abs(dx)+Math.abs(dy)>.5){panPixels(dx,dy,v);rememberView();}
}
function zoomBy(factor,x=screen?.cx,y=screen?.cy) {
  const pivot=groundAt(viewMetrics(),x,y);
  view.zoom=clamp(view.zoom*factor,.28,3.2);
  keepGroundAt(pivot,x,y);
  scheduleView(true);rememberView();
}
function rotateMap(direction=1) {
  cancelAnimationFrame(turnAnimation);clearHover();
  const from=view.angle,to=from+direction*Math.PI/2,start=performance.now();
  const duration=matchMedia("(prefers-reduced-motion: reduce)").matches?0:260;
  function tick(time) {
    const f=duration?clamp((time-start)/duration,0,1):1;
    view.angle=from+(to-from)*(f*f*(3-2*f));layoutWorld(f<1);
    if(f<1) turnAnimation=requestAnimationFrame(tick);
    else {view.angle%=TAU;rememberView();}
  }
  turnAnimation=requestAnimationFrame(tick);
}
function fit() {
  const v=viewMetrics(),list=[[0,0]];
  for(const q of [-3.6,3.6]) for(const r of [-3.6,3.6]) list.push([q,r]);
  for(const k of [...Object.keys(state.tiles),...frontier()]) list.push(parseKey(k));
  let l=Infinity,r=-Infinity,t=Infinity,b=-Infinity;
  for(const [x,z] of list) {
    const u=x*v.right[0]+z*v.right[2],d=-x*v.up[0]-z*v.up[2];
    l=Math.min(l,u-.72);r=Math.max(r,u+.72);t=Math.min(t,d-1.08);b=Math.max(b,d+.57);
  }
  for(const p of homeCenter){const pos=project({...v,ox:0,oy:0,k:1},p.x,p.y+1.0,p.z);t=Math.min(t,pos.y);}
  const controlsHeight=v.h<440?88:(v.w<801?159:194);
  view.zoom=clamp(Math.min((v.w-30)/(r-l),(v.h-controlsHeight)/(b-t))/v.base,.28,3.2);
  view.q=0;view.r=0;
  const next=viewMetrics(),mid=(l+r)/2,down=(t+b)/2;
  panPixels(-mid*next.k,-(down+.48)*next.k,next);
  clearHover();layoutWorld();rememberView();
}
function floatGain(key,text) {
  if(!screen) return;
  const [q,r]=parseKey(key),p=project(screen,q,.25,r),el=document.createElement("span");
  el.className="float-gain";el.textContent=text;el.style.left=clamp(p.x,50,screen.w-50)+"px";
  el.style.top=clamp(p.y,34,screen.h-40)+"px";$("map-fx").append(el);setTimeout(()=>el.remove(),1250);
}
function clearHover() {
  if(!hoverId && !$("map-label").textContent) return;
  hoverId=0;$("map-label").textContent="";$("map-label").hidden=true;viewport.classList.remove("actionable");
}
function setHover(id,showName) {
  const target=targets.get(id),next=target?id:0,tip=$("map-label");
  const text=showName && target?target.label:"";
  if(next===hoverId && tip.textContent===text) return;
  hoverId=next;tip.textContent=text;viewport.classList.toggle("actionable",!!target);
  scheduleView();
}
function activateTarget(kind,key) {
  clearHover();
  if(kind==="visit") openVisit();
  else if(kind==="dig") markDig(key);
  else if(kind==="home") openHome(key);
  else if(kind==="person") openPerson(Number(key));
  else if(kind==="cell" && mode==="build" && plan && state.tiles[key]==="floor") buildAt(key);
  else if(kind==="cell") openCell(key);
}
function worldSignature(s) {
  return JSON.stringify(s.tiles)+"|"+JSON.stringify(s.people);
}
function renderWorld() {
  const signature=JSON.stringify(state.tiles);
  if(signature!==sceneKey) {
    worldScene=caveScene();renderer.setScene(worldScene);sceneKey=signature;
  }
  const previous=document.activeElement?.dataset?.mapId;
  const frag=document.createDocumentFragment();targets=new Map();marks=new Uint8Array(32*32*4);
  function add(id,kind,key,x,y,z,label,marked=false) {
    const el=document.createElement("button");el.type="button";el.className="world-target";
    el.dataset.targetKind=kind;el.dataset.key=key;el.dataset.mapId=String(id);el.setAttribute("aria-label",label);
    targets.set(id,{el,id,kind,key,x,y,z,label});
    if(marked) marks[id*4]=255;
    frag.append(el);
  }
  for(const [key,p] of Object.entries(homeSpots)) add(p.id,"home",key,p.x,p.y,p.z,homes[key].name);
  if(state.visit) {
    const [x,z]=entrances[state.visit.gate].track[0];
    add(PARTY_ID,"visit",state.visit.gate,x,.22,z,"Käferbesuch ansehen");
  }
  ensureCrew();
  state.shift.crew.forEach((a,i)=>add(PERSON_BASE+i,"person",i,a.x,.40,a.z,state.people[i].name));
  if(mode==="dig") for(const key of plannedEdges()) {
    const [x,z]=parseKey(key),id=cellId(x,z),seam=deposit(x,z);
    const name=seam==="sporerock"?"Sporenkammer freilegen":seam==="motherlode"?"Goldader im Kupferstollen · 12 Bonusgold":seam==="mossrock"?"Pilzfeld freilegen · 3 Nahrung":gates[key]?gates[key].name+" graben":seam==="goldrock"?"Goldader abbauen":seam==="crystalrock"?"Kristallader abbauen":"Stollen graben";
    const place=state.shift.orders.findIndex(o=>o.key===key);
    add(id,"dig",key,x,worldScene.heights.get(id),z,place<0?name+" vormerken":"Auftrag "+(place+1)+" abwählen",true);
  }
  for(const [key,room] of Object.entries(state.tiles)) {
    const [x,z]=parseKey(key),id=cellId(x,z),slot=mode==="build" && room==="floor" && !!plan;
    const bonus=slot && plan==="ward"?" · +"+wardBonus(key,state.visit?.gate||nextEntrance(state))+" am nächsten Zugang":"";
    add(id,"cell",key,x,worldScene.heights.get(id),z,slot?buildings[plan].name+" bauen"+bonus:knownRooms[room].name,slot);
  }
  for (const order of state.shift.orders) {
    const id=cellId(...parseKey(order.key));
    marks[id*4]=255;marks[id*4+1]=255;
  }
  mapButtons.replaceChildren(frag);renderer.setMarks(marks);clearHover();
  if(recentTile) {const [x,z]=parseKey(recentTile);reveal(x,.19,z);recentTile="";}
  layoutWorld();
  if(previous && !dialog.open && !bookDialog.open) {
    const next=targets.get(+previous)?.el || viewport;next.focus({preventScroll:true});
  }
}
function showBuildPlots() {
  if(!plan || !screen) return;
  const floors=[...targets.values()].filter(t=>t.kind==="cell" && state.tiles[t.key]==="floor");
  const safe=t=>t.p.x>35 && t.p.x<screen.w-35 && t.p.y>75 && t.p.y<screen.h-115;
  if(floors.some(safe) || !floors.length) return;
  const distance=t=>(t.x-view.q)**2+(t.z-view.r)**2;
  const nearest=floors.reduce((a,b)=>distance(a)<distance(b)?a:b);
  reveal(nearest.x,0,nearest.z,true);layoutWorld();
}
function orderStatus(order) {
  const i=state.shift.crew.findIndex(a=>a?.field===order.key);
  if(i<0) return state.people.some(p=>p.job==="shop")?"Vorgemerkt":"Erzabbau unbesetzt";
  const name=state.people[i].name;
  return state.shift.crew[i].mode==="dig"?name+" gräbt · "+Math.floor(order.work*100/DIG_MS)+" %":name+" ist unterwegs";
}
function placeOrderMarks() {
  if(!screen || !worldScene) return;
  for (const mark of $("order-marks").children) {
    const [x,z]=parseKey(mark.dataset.key),height=worldScene.heights.get(cellId(x,z));
    const p=project(screen,x,height+.13,z);
    mark.style.left=p.x+"px";mark.style.top=p.y+"px";
  }
  const host=$("ward-marks"), forGate=state.visit?.gate||nextEntrance(state);
  const plots=mode==="build" && plan==="ward"?Object.keys(state.tiles).filter(k=>state.tiles[k]==="floor"):[];
  const signature=forGate+"|"+plots.join("|");
  if(host.dataset.keys!==signature) {
    host.dataset.keys=signature;
    host.replaceChildren(...plots.map(key=>{
      const el=document.createElement("span");el.className="order-mark";el.dataset.key=key;el.textContent="+"+wardBonus(key,forGate);return el;
    }));
  }
  for(const mark of host.children) {
    const [x,z]=parseKey(mark.dataset.key),p=project(screen,x,.23,z);mark.style.left=p.x+"px";mark.style.top=p.y+"px";
  }
}
function signField(gate) {
  const entry=entrances[gate];
  if(!state.tiles[entry.key]) return entry.key;
  return gate==="moss" && !state.tiles[sporeCell]?sporeCell:null;
}
function positionEntranceSigns() {
  if(!screen || !worldScene) return;
  for(const button of $("entry-signs").querySelectorAll("[data-sign]")) {
    const gate=button.dataset.sign, entry=entrances[gate], active=state.visit?.gate===gate;
    const field=signField(gate), key=active?entry.key:(field || entry.key);
    const [x,z]=parseKey(key), top=worldScene.heights.get(cellId(x,z));
    const p=project(screen,x,top+.19,z), visible=p.x>=-6 && p.x<=screen.w+6 && p.y>42 && p.y<screen.h-69;
    button.hidden=!visible || (state.visit?!active:mode!=="dig" || (!field && !state.trails.bait[gate]));
    if(button.hidden) continue;
    const selected=state.shift.orders.some(o=>o.key===key);
    const label=active?entry.name:state.trails.bait[gate]?"Pilzköder":key===sporeCell?"Sporenkammer":entry.sign;
    writeText(button.lastElementChild,label);
    button.setAttribute("aria-label",active?entry.name+" · Käferbesuch":!field?entry.name+" ansehen":
      label+(selected?" · Grabauftrag abwählen":" · Grabauftrag markieren"));
    button.classList.toggle("arrival",active);
    const half=button.offsetWidth/2, bx=clamp(p.x,half+5,screen.w-half-5);
    button.style.left=bx+"px";button.style.top=p.y-8+"px";
    button.style.setProperty("--stem",clamp(p.x-bx+half,6,2*half-6)+"px");
  }
  const glow=$("first-seam");
  glow.hidden=state.guided || tileCount()>0 || !!state.shift.orders.length || mode!=="dig" || !!state.visit;
  if(!glow.hidden) {
    const [x,z]=parseKey(entrances.copper.key),p=project(screen,x,worldScene.heights.get(cellId(x,z))+.06,z);
    glow.style.left=p.x+"px";glow.style.top=p.y+"px";
  }
}
function selectEntrance(gate) {
  const field=signField(gate);
  if(state.visit || !field || mode!=="dig") openVisit();
  else markDig(field);
}
function refreshQueue() {
  const orders=state.shift.orders,toggle=$("orders-toggle"),host=$("order-marks");
  toggle.hidden=!orders.length;
  const signature=orders.map(o=>o.key).join("|");
  if(host.dataset.keys!==signature){
    host.dataset.keys=signature;
    const nodes=orders.map((o,i)=>{const span=document.createElement("span");span.className="order-mark";span.dataset.key=o.key;span.textContent=i+1;return span;});
    host.replaceChildren(...nodes);placeOrderMarks();
  }
  if(orders.length){
    const actor=state.shift.crew.find(a=>a?.field),i=state.shift.crew.indexOf(actor);
    const status=state.paused?"pausiert":actor?state.people[i].name+(actor.mode==="dig"?" gräbt":" unterwegs"):state.people.some(p=>p.job==="shop")?"vorgemerkt":"Erzabbau unbesetzt";
    writeText($("orders-count"),orders.length+(orders.length===1?" Auftrag":" Aufträge")+" · "+status);
    for(let j=0;j<orders.length;j++){
      const el=host.children[j];el.classList.toggle("working",orders[j].work>0);
      if(orders[j].work)el.style.setProperty("--done",Math.round(orders[j].work*100/DIG_MS)+"%");
    }
  }
  if(dialog.open && sheet==="orders"){
    const list=$("dig-order-list");
    if(list.dataset.keys!==signature){
      list.dataset.keys=signature;
      list.innerHTML=orders.map((o,i)=>'<li><span>'+(i+1)+'</span><span class="order-text"><b>'+escape(gates[o.key]?.name || "Fels "+o.key)+'</b><small></small></span><button class="icon-button" data-cancel-dig="'+o.key+'" aria-label="Grabauftrag '+(i+1)+' abwählen">'+icon("close")+'</button></li>').join("") || '<li>Alle Grabaufträge sind erledigt.</li>';
    }
    orders.forEach((o,j)=>writeText(list.children[j].querySelector("small"),orderStatus(o)));
  }
}
function openOrders(){
  openSheet("orders","Grabaufträge","Stollen",'<p class="intro">Die Mannschaft im Erzabbau übernimmt die erreichbaren Felder der Reihe nach. Entfernst du eine Markierung, werden davon abgeschnittene Felder ebenfalls abgewählt.</p><ol class="dig-list" id="dig-order-list"></ol>'+secondary("crew","Bewohner einteilen")+secondary("to-map","Zur Karte"));
  refreshQueue();
}
const activityNames={walk:"unterwegs",dig:"gräbt",pluck:"pflückt Pilze",carry:"trägt Pilze",unload:"liefert Pilze ab",ore:"sortiert Erz",patrol:"patrouilliert",meet:"holt die Käfer ab",escort:"begleitet die Käfer"};
const figureLayer=createFigureLayer($("cave-crew"));
const workerAt=figureLayer.pick;
function paintCrew(now) {
  if(!screen || !worldScene) return;
  const v=screen,lead=state.paused || !clockVisible?0:Math.min(170,Math.max(0,now-lastTick));
  const guideName=$("keeper-tag");guideName.hidden=true;
  figureLayer.paint(v,renderer,hoverId,lead,({id,name,pose},chest)=>{
    if(pose.act==="escort" || pose.act==="meet") {
      const top=project(v,pose.x,1.04,pose.z);
      if(top.x>16 && top.x<v.w-16 && top.y>36 && top.y<v.h-65) {
        guideName.hidden=false;writeText(guideName,name);guideName.style.left=top.x+"px";guideName.style.top=top.y+"px";
      }
    }
    const t=name && targets.get(id);
    if(t){
      t.x=pose.x;t.z=pose.z;t.p=chest;t.el.style.left=chest.x+"px";t.el.style.top=chest.y+"px";
      t.el.dataset.activity=pose.act;
      const label=activityNames[pose.act]?name+" · "+activityNames[pose.act]:name;
      if(t.label!==label){t.label=label;t.el.setAttribute("aria-label",label);}
      t.el.tabIndex=chest.x>2 && chest.x<v.w-2 && chest.y>2 && chest.y<v.h-2?0:-1;
    }
  });
}
const air=ambientCanvas.getContext("2d");
function drawAir(now) {
  if(!screen || !worldScene) return;
  const {w,h,k}=screen,ratio=Math.min(devicePixelRatio||1,1.3);
  if(ambientCanvas.width!==Math.round(w*ratio) || ambientCanvas.height!==Math.round(h*ratio)) {
    ambientCanvas.width=Math.round(w*ratio);ambientCanvas.height=Math.round(h*ratio);
  }
  air.setTransform(ratio,0,0,ratio,0,0);air.clearRect(0,0,w,h);
  if(state.visit) {
    const track=entrances[state.visit.gate].track;
    air.fillStyle="#ffdda5";air.globalAlpha=.60;
    for(let i=1;i<track.length;i++) {
      const [x,z]=track[i-1],[dx,dz]=[track[i][0]-x,track[i][1]-z];
      const steps=Math.ceil(Math.hypot(dx,dz)/.35);
      for(let j=0;j<steps;j++) {
        const q=x+dx*j/steps,r=z+dz*j/steps,p=project(screen,q,.025,r);
        if(renderer.depthAt(p.x,p.y)>q*screen.eye[0]+r*screen.eye[2]+.12 || workerAt(p.x,p.y)) continue;
        air.beginPath();air.ellipse(p.x,p.y,Math.max(1.5,k*.04),Math.max(1,k*.022),0,0,TAU);air.fill();
      }
    }
    air.globalAlpha=1;
  }
  for(const item of worldScene.glows) {
    const p=project(screen,...item.p);if(p.x< -40 || p.x>w+40 || p.y< -50 || p.y>h+50) continue;
    const radius=k*item.r;
    if(item.smoke) {
      for(let i=0;i<4;i++) {
        const age=((now*.00018+i/4)%1),x=p.x+Math.sin(age*3.1)*radius*.34,y=p.y-age*k*.66;
        const rad=radius*(.12+.31*age),gradient=air.createRadialGradient(x,y,0,x,y,rad);
        gradient.addColorStop(0,"rgba(218,203,201,"+(.16*Math.sin(age*Math.PI))+")");gradient.addColorStop(1,"rgba(218,203,201,0)");
        air.fillStyle=gradient;air.fillRect(x-rad,y-rad,rad*2,rad*2);
      }
    } else {
      const colors=item.color==="violet"?"189,139,255":"255,183,78";
      const rad=Math.max(2,radius),gradient=air.createRadialGradient(p.x,p.y,0,p.x,p.y,rad);
      gradient.addColorStop(0,"rgba("+colors+",.22)");gradient.addColorStop(.31,"rgba("+colors+",.10)");gradient.addColorStop(1,"rgba("+colors+",0)");
      air.fillStyle=gradient;air.fillRect(p.x-rad,p.y-rad,rad*2,rad*2);
    }
  }
}
let lastPaint=0;
function animateCrew(now){
  if(clockVisible && !state.paused && !dialog.open && !bookDialog.open && now-lastPaint>=(matchMedia("(prefers-reduced-motion: reduce)").matches?160:60)){
    paintCrew(now);drawAir(now);lastPaint=now;
  }
  requestAnimationFrame(animateCrew);
}
requestAnimationFrame(animateCrew);
function completeDig(key,workerName,{message,gains,discovery,n}) {
  logEvent(workerName+" · "+message+" · "+labelsFor(gains)+" gefunden.",discovery?"gem":"pick");
  if (n===3) logEvent("Die Wachstube ist jetzt im Baumenü verfügbar.","shield");
  if (discovery) toast(message+"!");
  floatGain(key,"+"+labelsFor(gains));
}
function buildAt(key) {
  if (!plan || !Object.hasOwn(buildings,plan) || state.tiles[key]!=="floor") return;
  advanceClock();
  const def=buildings[plan];
  if (tileCount()<def.unlock || !canPay(def.cost)) { openBuild(); return; }
  transfer(def.cost,-1); state.tiles[key]=plan;invalidateNavigation();recentTile=key;
  for (const a of state.shift.crew) if(a?.mode==="walk") {a.mode="idle";a.path=[];a.field="";}
  const message=def.name+" fertiggestellt"; logEvent(message+". "+def.effect,"hammer");
  mode="dig"; plan=null;
  finishAction(message,"","build"); floatGain(key,def.name);
}
function nextName(type) {
  const names=peopleKinds[type].names, free=names.find(n=>!state.people.some(p=>p.name===n));
  return free || names[countPeople(type)%names.length]+" "+(countPeople(type)+1);
}
function hire(type) {
  advanceClock();
  const def=peopleKinds[type];
  if (!def || state.people.length>=beds() || !canPay(def.cost)) { openRecruit(); return; }
  const name=nextName(type);
  transfer(def.cost,-1); state.people.push({type,name,job:def.job});
  logEvent(name+" zieht als "+def.role+" in die Mooswiege.","people");
  closeSheet(); finishAction(name+" ist eingezogen","","guest");
}
function inviteBeetles() {
  advanceClock();
  if (!state.visit && tileCount()>=3) {
    arriveBeetles();persist();
  }
  if(state.visit) showVisitOnMap();else openVisit();
}
function resolveVisit(how) {
  advanceClock();
  if (!respondToParty(how==="feed"?"bait":how)) {openVisit();return;}
  persist();render();showVisitOnMap();
}
function showVisitOnMap() {
  closeSheet();showMap();
  if(!state.visit) return;
  frameParty();
}
function frameParty() {
  const track=entrances[state.visit.gate].track;
  // Look down the lane between the buildings, with the entrance in the same shot.
  const [sx,sz]=track[0],[ex,ez]=track.at(-1);
  if(!visitCamera) visitCamera={before:{...view}};
  if(turnAnimation) cancelAnimationFrame(turnAnimation);
  view.q=(sx+ex)/2;view.r=(sz+ez)/2;view.zoom=viewport.clientWidth<680?1.60:1.04;
  view.angle=state.visit.gate==="moss"?1.32:-.30;
  visitCamera.framed={...view};
  try {sessionStorage.setItem(viewKey+".visit",JSON.stringify(visitCamera));}catch {}
  clearHover();layoutWorld();rememberView();
}
function restoreVillageView() {
  const saved=visitCamera;
  visitCamera=null;
  try {sessionStorage.removeItem(viewKey+".visit");}catch {}
  if(!saved || !["q","r","angle","zoom"].every(k=>Math.abs(view[k]-saved.framed[k])<.001)) return;
  Object.assign(view,saved.before);layoutWorld();rememberView();
}
function layBait(gate) {
  advanceClock();
  if(prepareBait(gate)) {
    logEvent("Ein Pilzköder liegt am "+entrances[gate].name+".","sprout");persist();render();
  }
  openVisit();
}

function openSheet(kind,title,top,content) {
  if (kind!=="home" && kind!=="cell") harvestSite=null;
  sheet=kind; $("dialog-title").textContent=title; $("dialog-kicker").textContent=top;
  $("dialog-content").innerHTML=content;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop=0; renderToolbar();refreshLivePanel();
}
function closeSheet() { if (dialog.open) dialog.close(); }
function showMap() {
  if(bookDialog.open) bookDialog.close();
}
function choice(action,key,image,name,description,cost,block) {
  return '<button class="choice" data-'+action+'="'+key+'"'+(block?' disabled':'')+'>'+img(image)+'<span class="details"><strong>'+name+'</strong><small>'+description+'</small>'+costHTML(cost)+'<small class="order-block"'+(block?'':' hidden')+'>'+block+'</small></span></button>';
}
function orderBlock(action,key) {
  if (action==="blueprint") {
    if (tileCount()<buildings[key].unlock) return "Ab "+buildings[key].unlock+" gegrabenen Feldern";
    if (!countRoom("floor")) return "Freier Stollen benötigt";
  } else if (state.people.length>=beds()) return "Schlafkammer benötigt";
  const cost=action==="blueprint"?buildings[key].cost:peopleKinds[key].cost;
  const missing=Object.entries(cost).filter(([k,n])=>n>state.stock[k]).map(([k,n])=>(n-state.stock[k])+" "+resources[k]);
  return missing.length?"Fehlen noch · "+missing.join(" und "):"";
}
function openBuild(target=null) {
  buildHere=target && state.tiles[target]==="floor"?target:null;
  const empty=countRoom("floor");
  let desc="Grabe zuerst einen Stollen frei. Auf seinem Boden kannst du einen dieser Räume bauen.";
  if (empty) desc="Wähle einen Raum und setze ihn auf der Karte ein. "+(empty===1?"Ein Bauplatz ist frei.":empty+" Bauplätze sind frei.");
  if (buildHere) desc="Wähle den Raum, den du an dieser Stelle bauen möchtest.";
  const list=Object.entries(buildings).map(([key,b])=>{
    const reason=orderBlock("blueprint",key);
    return choice("blueprint",key,key,b.name,b.effect,b.cost,reason);
  }).join("");
  openSheet("build","Räume bauen","Baumeisterei",'<p class="intro">'+desc+'</p><div class="choice-list">'+list+'</div>'+(!empty?primary("go-dig","Stollen graben"):""));
}
function openRecruit() {
  const full=state.people.length>=beds();
  const list=Object.entries(peopleKinds).map(([key,p])=>choice("hire",key,key,escape(nextName(key))+" · "+p.role,p.effect,p.cost,orderBlock("hire",key))).join("");
  openSheet("recruit","Bewohner anwerben","Am Höhlentor",'<p class="intro">'+(full?"Alle Schlafplätze sind belegt. Eine Schlafkammer bietet Platz für drei weitere Bewohner.":"Jeder neue Bewohner braucht einen Schlafplatz und verbraucht 5 Nahrung pro Minute.")+'</p><div class="choice-list">'+list+'</div>'+(full?primary("build","Schlafkammer planen"):"")+secondary("crew","Bewohner einteilen"));
}
function jobControls(p,index) {
  const buttons=Object.entries(workplaces).map(([key,label])=>{
    const amount=jobOutput(p,key), unit=key==="ward"?" Stärke":"/min";
    const detail=key==="ward"?"Wachstärke":key==="farm"?"Nahrung pro Minute":"Gold pro Minute";
    return '<button class="job-choice" data-worker="'+index+'" data-job="'+key+'" aria-pressed="'+(p.job===key)+'" aria-label="'+escape(p.name)+' · '+label+' · '+amount+' '+detail+'">'+label+'<small>+'+amount+unit+'</small></button>';
  }).join("");
  return '<div class="job-options" role="group" aria-label="Arbeitsplatz für '+escape(p.name)+'">'+buttons+'</div>';
}
function crewSummary() {
  return '<div class="crew-summary" aria-label="Ertrag nach Verpflegung und Wachstärke"><span>'+img("food")+'<b data-crew-rate="food"></b></span><span>'+img("gold")+'<b data-crew-rate="gold"></b></span><span>'+icon("shield")+'<b id="crew-power"></b></span></div>';
}
function updateCrew() {
  const rates=production();
  for (const el of dialog.querySelectorAll("[data-crew-rate]")) writeText(el,signed(rates[el.dataset.crewRate])+"/min");
  const guard=$("crew-power");if (guard) writeText(guard,power()+" Stärke");
  for (const b of dialog.querySelectorAll("[data-worker]")) {
    const index=Number(b.dataset.worker);
    const next=state.visit?.keeper===index?state.visit.afterJob:null;
    b.setAttribute("aria-pressed",String((next || state.people[index]?.job)===b.dataset.job));
  }
}
function assignJob(index,job) {
  const p=state.people[index];
  if (!p || !Object.hasOwn(workplaces,job)) return;
  advanceClock();
  if(state.visit?.keeper===index) {
    state.visit.afterJob=job;persist();updateCrew();toast(p.name+" übernimmt nach der Rückkehr "+workplaces[job]+".");return;
  }
  if(p.job===job) return;
  p.job=job;
  logEvent(p.name+" übernimmt "+(job==="ward"?"die Wache":job==="farm"?"die Gartenarbeit":"den Erzabbau")+".","people");
  persist();render();updateCrew();chime("build");
}
function openCrew() {
  const list=state.people.map((p,i)=>'<div class="crew-member"><div class="crew-heading">'+img(p.type)+'<div><strong>'+escape(p.name)+'</strong><small>'+peopleKinds[p.type].role+'</small></div></div>'+jobControls(p,i)+'</div>').join("");
  openSheet("crew","Bewohner einteilen","Mooswiege",crewSummary()+'<p class="soft" style="margin-top:8px">Jeder übernimmt eine Aufgabe. Die Verpflegung ist im Ertrag schon eingerechnet.</p><div class="crew-list">'+list+'</div>'+secondary("to-map","Zur Karte"));
  updateCrew();
}
function openPerson(index) {
  const p=state.people[index]; if (!p) return;
  focusedPerson=index;
  const def=peopleKinds[p.type];
  openSheet("person",p.name,def.role,'<div class="dialog-portrait">'+img(p.type)+'<p class="intro">'+def.note+'</p></div><div class="facts">'+fact("Spezialität",def.effect)+fact("Verpflegung",MEALS_PER_MINUTE+" Nahrung/min")+'</div>'+jobControls(p,index)+'<div style="margin-top:14px">'+crewSummary()+'</div>'+secondary("crew","Alle Bewohner einteilen"));
  updateCrew();
}
function harvestControls(key) {
  const r=homes[key];
  const pool=key==="farm"?"Reife Pilze · alle Beete":key==="mine"?"Lose Kristallsplitter":"Auslese am Sortiertisch";
  return '<div class="facts">'+fact(img(r.stock)+"Im Lager",'<span id="harvest-stock"></span>')+'</div><div class="harvest-line"><strong>'+pool+'</strong><small id="harvest-ready"></small></div><div class="harvest-track" aria-hidden="true"><span id="harvest-fill"></span></div><p class="harvest-time" id="harvest-time"></p>'+primary("gather",r.action)+secondary("crew","Bewohner einteilen");
}
function openHome(key) {
  const r=homes[key]; if (!r) return;
  harvestSite=r.stock?key:null;
  const extra=r.stock?harvestControls(key):'<div class="facts">'+fact("Belegte Schlafplätze",state.people.length+" / "+beds())+fact("Wachstärke",power())+fact("Gegrabene Felder",tileCount())+'</div>'+primary("crew","Bewohner einteilen")+secondary("recruit","Bewohner anwerben");
  openSheet("home",r.name,"Die Mooswiege",'<div class="dialog-portrait">'+img(r.art)+'<p class="intro">'+r.copy+'</p></div>'+extra);
}
function gather(key=harvestSite) {
  const r=homes[key];if (!r?.stock) return;
  advanceClock();
  const {ready}=harvestState(key);
  if (!ready) {refreshLivePanel();return;}
  state.work.crop[key]-=ready*r.unitMs;
  state.stock[r.stock]+=ready;
  const message="+"+ready+" "+resources[r.stock]+" eingesammelt";
  logEvent(r.name+" · "+message+".",r.icon);
  persist();renderHeader();if (bookDialog.open) renderBook();refreshLivePanel();chime("gem");toast(message);
}
function openCell(key) {
  const type=state.tiles[key],room=knownRooms[type]; if (!room) return;
  focusedCell=key;
  harvestSite=type==="farm"?"farm":type==="grotto"?"mine":null;
  const controls=harvestSite?harvestControls(harvestSite):type==="floor"?primary("build-this","Hier einen Raum planen"):secondary("close","Zur Karte");
  openSheet("cell",room.name,"Im Stollen",'<div class="dialog-portrait">'+img(type==="spores"?"food":type)+'<p class="intro">'+room.effect+'</p></div>'+controls);
}
function openCalendar() {
  openSheet("calendar","Tag "+state.day,"Tagesübersicht",'<p class="intro">Im Berg dauert ein Tag 90 Sekunden Spielzeit. Die Bewohner arbeiten und essen während des ganzen Tages.</p><div class="facts">'+fact("Nächster Morgen",'<span id="next-dawn"></span>')+fact("Höhlenkäfer",state.visit?"Am Tor":"An Tag "+state.nextVisit)+'</div>'+primary("visit",state.visit?"Zum Käferbesuch":"Käferbesuch ansehen"));
}
function openVisit() {openSheet("visit",...visitPanel());}
function refreshLivePanel() {
  if (!dialog.open) return;
  if (harvestSite && (sheet==="home" || sheet==="cell")) {
    const key=harvestSite, site=homes[key], {ready,capacity,seconds}=harvestState(key);
    writeText($("harvest-stock"),state.stock[site.stock]+" · "+signed(production()[site.stock])+"/min");
    writeText($("harvest-ready"),ready+" / "+capacity);
    $("harvest-fill").style.transform="scaleX("+state.work.crop[key]/(site.unitMs*capacity)+")";
    const next=key==="farm"?"Nächster Pilz":key==="mine"?"Nächster Splitter":"Nächstes Goldstück";
    writeText($("harvest-time"),ready===capacity?"Alles bereit zum Einsammeln.":state.paused?"Spielzeit pausiert.":next+" in "+seconds+" s");
    const button=dialog.querySelector('[data-action="gather"]');
    button.disabled=ready<1;writeText(button,site.action+(ready?" · +"+ready:""));
  } else if (sheet==="build" || sheet==="recruit") {
    const action=sheet==="build"?"blueprint":"hire";
    for (const b of dialog.querySelectorAll("[data-"+action+"]")) {
      const reason=orderBlock(action,b.dataset[action]), info=b.querySelector(".order-block");
      b.disabled=!!reason;info.hidden=!reason;writeText(info,reason);
    }
  } else if (sheet==="calendar") {
    writeText($("next-dawn"),state.paused?"Pausiert":"In "+Math.ceil((DAY_MS-state.elapsed)/1000)+" s");
  } else if (sheet==="visit") {
    const feed=dialog.querySelector('[data-action="visit-feed"]');
    if (feed) feed.disabled=state.stock.food<offering();
    for (const b of dialog.querySelectorAll("[data-bait]")) b.disabled=state.trails.bait[b.dataset.bait] || state.stock.food<offering();
    if($("visit-countdown")) writeText($("visit-countdown"),Math.max(0,Math.ceil(((state.nextVisit-state.day)*DAY_MS-state.elapsed)/1000)));
    const invite=dialog.querySelector('[data-action="invite"]');
    if(invite && tileCount()>=3) {invite.disabled=false;writeText(invite,"Käfer jetzt anlocken");}
  }
}
function openSettings() {
  openSheet("settings","Einstellungen","Glimmgrund",'<div class="facts">'+fact("Spielklänge",state.sound?"Ein":"Aus")+fact("Spielzeit",state.paused?"Pausiert":"Aktiv")+fact("Spielstand",canSave?"Lokal gespeichert":"Nur in dieser Sitzung")+'</div>'+secondary("sound",state.sound?"Spielklänge ausschalten":"Spielklänge einschalten")+secondary("settings-pause",state.paused?"Spielzeit fortsetzen":"Spielzeit anhalten")+secondary("help","Spielhilfe")+secondary("reset-prompt","Neues Reich beginnen"));
}
function openHelp() {
  const topics=[
    ["Grabaufträge","Tippe gold umrandete Felsen oder ein Wegschild an. Pip erledigt die nummerierten Aufträge. Ein zweites Antippen nimmt eine Markierung zurück. Graben ist kostenlos."],
    ["Zwei Wege","Die Goldader im Kupferstollen bringt zwölf Bonusgold. Gräbst du hinter den Leuchtsporen im Moosstollen weiter, findest du eine Sporenkammer und sparst drei Nahrung pro Köder."],
    ["Käferpfade","Nach drei Grabungen kannst du die erste Gruppe anlocken. Der zuerst geöffnete Zugang bestimmt ihren Weg. Rufe Brumm auf der Karte, sobald du die Käfer siehst. Eine Wachstube in bis zu zwei Feldern Entfernung stärkt diesen Zugang um drei Punkte. Auch ein rechtzeitig ausgelegter Pilzköder führt die Käfer heim."],
    ["Pilze und Bewohner","Luma liefert alle drei Sekunden einen Pilz. Tippe oben auf Nahrung, um zusätzlich zu pflücken. Tippe einen Bewohner an, um ihn für Garten, Erzabbau oder Wache einzuteilen."],
    ["Ausbauen","Baue auf freigegrabenen Stollen Gärten, Schlafkammern und Wachstuben. Das aktuelle Ziel auf der Karte öffnet das Höhlenbuch."],
    ["Spielzeit und Karte","Die Arbeit läuft in den Menüs weiter. Pause und ein Wechsel in den Hintergrund halten die Zeit an. Ziehe die Karte mit einem Finger, zoome und drehe sie mit zwei Fingern. Am Computer wählen 1 bis 4 ein Werkzeug. Q und E drehen die Karte, die Leertaste pausiert."]
  ];
  openSheet("help","So wächst dein Reich","Spielhilfe",'<div class="help-copy">'+topics.map(([title,copy])=>'<p><b>'+title+'</b>'+copy+'</p>').join("")+'</div>'+primary("close","Zur Karte"));
}

function chooseTool(next) {
  if (next==="build") return openBuild();
  if (next==="recruit") return openRecruit();
  if (next!=="dig" && next!=="look") return;
  mode=next; plan=null; closeSheet(); renderToolbar(); renderWorld(); showMap();
}
function chooseBlueprint(key) {
  const b=buildings[key];
  if (!b || !countRoom("floor") || !canPay(b.cost) || tileCount()<b.unlock) { openBuild(); return; }
  plan=key; mode="build";
  const target=buildHere; buildHere=null;
  closeSheet(); showMap();
  if (target && state.tiles[target]==="floor") { buildAt(target); return; }
  renderToolbar(); renderWorld(); showBuildPlots();
}
function togglePause(fromSettings=false) {
  advanceClock();
  state.paused=!state.paused; persist(); renderHeader();refreshQueue();paintCrew(performance.now());
  if (fromSettings) openSettings();
  else toast(state.paused?"Spielzeit angehalten":"Spielzeit läuft");
}
function resetPrompt() {
  openSheet("reset","Neu beginnen?","Spielstand",'<p class="intro">Dein bisheriges Reich und seine Chronik werden durch eine frische Mooswiege ersetzt.</p>'+primary("close","Mein Reich behalten")+secondary("reset","Neues Reich beginnen"));
}
function resetGame() {
  if (sheet!=="reset") return;
  restoreVillageView();
  const sound=state.sound;
  setState(initialState()); state.sound=sound;lastTick=performance.now();
  mode="dig"; plan=null; buildHere=null; focusedCell=null; harvestSite=null; recentTile="";
  $("map-fx").replaceChildren(); activeTab="overview"; closeSheet();
  Object.assign(view,{q:0,r:.15,zoom:1,angle:.70});saveView();
  switchTab("overview");persist();render();showMap();toast("Ein neuer Morgen in der Mooswiege.");
}
const actions={
  book:openBook, "close-book":()=>bookDialog.close(), rotate:()=>rotateMap(),
  close:closeSheet, "to-map":()=>{closeSheet();showMap();}, settings:openSettings, help:openHelp, crew:openCrew, calendar:openCalendar,
  visit:openVisit, "watch-visit":showVisitOnMap, recruit:openRecruit, build:()=>openBuild(), pause:()=>togglePause(),
  "settings-pause":()=>togglePause(true), invite:inviteBeetles, "visit-guard":()=>resolveVisit("guard"),
  "visit-feed":()=>resolveVisit("feed"), "visit-pass":()=>resolveVisit("pass"), gather,
  "go-dig":()=>chooseTool("dig"), "quick-harvest":()=>{if (harvestState("farm").ready) gather("farm");else openHome("farm");}, "build-this":()=>openBuild(focusedCell),
  "zoom-in":()=>zoomBy(1.25), "zoom-out":()=>zoomBy(1/1.25), fit:()=>{fit();toast("Karte eingepasst");},
  sound:()=>{state.sound=!state.sound;persist();chime("gem");openSettings();},
  "reset-prompt":resetPrompt, reset:resetGame
};
function applyButton(d) {
  if(d.sign) selectEntrance(d.sign);
  else if(d.bait) layBait(d.bait);
  else if (d.cancelDig) {if(state.shift.orders.some(o=>o.key===d.cancelDig)) markDig(d.cancelDig);}
  else if (d.action==="orders") openOrders();
  else if (d.job) assignJob(Number(d.worker),d.job);
  else if (d.stock) openHome(stockHome[d.stock]);
  else if (d.targetKind) activateTarget(d.targetKind,d.key);
  else if (d.tool) chooseTool(d.tool);
  else if (d.tab) switchTab(d.tab);
  else if (d.person!==undefined) openPerson(Number(d.person));
  else if (d.hire) hire(d.hire);
  else if (d.blueprint) chooseBlueprint(d.blueprint);
  else if (d.action && Object.hasOwn(actions,d.action)) actions[d.action]();
}
document.addEventListener("click",event=>{
  const b=event.target.closest("button"); if (!b || b.disabled) return;
  const d={...b.dataset}, action=d.action;
  const order=d.job || d.hire || d.blueprint || d.targetKind || d.cancelDig || d.bait || d.sign || d.tab==="journal" ||
    ["gather","quick-harvest","invite","visit-guard","visit-feed","visit-pass","pause","settings-pause","sound","reset"].includes(action);
  if (order) worldOrder(()=>applyButton(d));else applyButton(d);
});
dialog.addEventListener("close",()=>{if(!dialog.open){sheet="";harvestSite=null;}renderToolbar();});
dialog.addEventListener("click",event=>{
  if (event.target!==dialog) return;
  const r=dialog.getBoundingClientRect();
  if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) closeSheet();
});
const pointers=new Map();
let dragged=false,wasPinch=false,pinchDistance=0,pinchMiddle=null,lastHover=0;
const localPoint=e=>{const r=viewport.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
function fingerPair() {
  const [a,b]=Array.from(pointers.values());
  return {d:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),a:Math.atan2(b.y-a.y,b.x-a.x),x:(a.x+b.x)*.5,y:(a.y+b.y)*.5};
}
viewport.addEventListener("pointerdown",e=>{
  if((e.pointerType==="mouse" && e.button!==0) || e.target.closest("button")) return;
  const p=localPoint(e);
  if(!pointers.size){dragged=false;wasPinch=false;}
  pointers.set(e.pointerId,{...p,initialX:p.x,initialY:p.y});
  viewport.setPointerCapture(e.pointerId);
  if(pointers.size===2) {
    cancelAnimationFrame(turnAnimation);
    const pair=fingerPair();pinchDistance=pair.d;pinchMiddle=pair;wasPinch=true;clearHover();
  }
});
viewport.addEventListener("pointermove",e=>{
  const p=localPoint(e),old=pointers.get(e.pointerId);
  if(!old) {
    if(e.pointerType==="mouse" && performance.now()-lastHover>36) {
      lastHover=performance.now();setHover(workerAt(p.x,p.y) || renderer.pick(p.x,p.y),true);
    }
    return;
  }
  pointers.set(e.pointerId,{...old,...p});
  if(pointers.size===2) {
    const pair=fingerPair();
    const pivot=groundAt(viewMetrics(),pinchMiddle.x,pinchMiddle.y),delta=pair.a-pinchMiddle.a;
    view.angle=(view.angle+Math.atan2(Math.sin(delta),Math.cos(delta)))%TAU;
    view.zoom=clamp(view.zoom*pair.d/pinchDistance,.28,3.2);
    keepGroundAt(pivot,pair.x,pair.y);scheduleView(true);rememberView();
    pinchDistance=pair.d;pinchMiddle=pair;
    return;
  }
  if(wasPinch) return;
  if(!dragged && Math.hypot(p.x-old.initialX,p.y-old.initialY)<6) return;
  const dx=p.x-(dragged?old.x:old.initialX),dy=p.y-(dragged?old.y:old.initialY);
  dragged=true;clearHover();viewport.classList.add("dragging");
  panPixels(dx,dy,viewMetrics());scheduleView(true);rememberView();
});
function releasePointer(e) {
  if(!pointers.has(e.pointerId)) return;
  const p=localPoint(e),tap=e.type==="pointerup" && !dragged && !wasPinch;
  pointers.delete(e.pointerId);
  if(viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
  if(!pointers.size) viewport.classList.remove("dragging");
  if(!tap) {scheduleView();return;}
  const id=workerAt(p.x,p.y) || renderer.pick(p.x,p.y),target=targets.get(id);
  if(target) worldOrder(()=>activateTarget(target.kind,target.key));
}
viewport.addEventListener("pointerup",releasePointer);
viewport.addEventListener("pointercancel",releasePointer);
viewport.addEventListener("pointerleave",()=>{if(!pointers.size && hoverId){clearHover();scheduleView();}});
viewport.addEventListener("wheel",e=>{
  e.preventDefault();const p=localPoint(e);
  zoomBy(Math.exp(clamp(-e.deltaY*.0019,-.35,.35)),p.x,p.y);
},{passive:false});
mapButtons.addEventListener("focusin",e=>{
  const t=targets.get(Number(e.target.dataset.mapId));
  if(t){reveal(t.x,t.y,t.z);setHover(t.id,true);scheduleView();}
});
mapButtons.addEventListener("focusout",()=>{clearHover();scheduleView();});
function openBook() {
  bookDialog.showModal();$("book-toggle").setAttribute("aria-expanded","true");
  renderBook();
}
bookDialog.addEventListener("close",()=>{$("book-toggle").setAttribute("aria-expanded","false");});
bookDialog.addEventListener("click",e=>{
  if(e.target!==bookDialog) return;
  const r=bookDialog.getBoundingClientRect();
  if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) bookDialog.close();
});
document.addEventListener("keydown",e=>{
  if(dialog.open || e.ctrlKey || e.metaKey || e.altKey || (e.repeat && e.key===" ")) return;
  const target=e.target;
  if(target.getAttribute("role")==="tab" && ["ArrowRight","ArrowLeft","Home","End"].includes(e.key)) {
    e.preventDefault();worldOrder(()=>switchTab(e.key==="Home"?"overview":e.key==="End"?"journal":activeTab==="overview"?"journal":"overview",true));return;
  }
  if(bookDialog.open) return;
  const tool={"1":"dig","2":"build","3":"recruit","4":"look"}[e.key];
  if(tool){e.preventDefault();chooseTool(tool);return;}
  if(e.key.toLowerCase()==="b"){e.preventDefault();openBook();return;}
  if(["q","e"].includes(e.key.toLowerCase()) && !e.repeat){e.preventDefault();rotateMap(e.key.toLowerCase()==="q"?-1:1);return;}
  if(e.key===" " && !target.closest("button")){e.preventDefault();worldOrder(()=>togglePause());return;}
  if(target===viewport || viewport.contains(target)) {
    if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){
      e.preventDefault();panPixels(({ArrowLeft:58,ArrowRight:-58}[e.key]||0),({ArrowUp:58,ArrowDown:-58}[e.key]||0));
      scheduleView(true);rememberView();
    } else if(["+","=","-","Home"].includes(e.key)){
      e.preventDefault();if(e.key==="Home") fit();else zoomBy(e.key==="-" ? .80 : 1.25);
    }
  }
});

setInterval(()=>{
  if (!clockVisible || state.paused) return;
  const now=performance.now(), day=state.day, visiting=visitSignature(state);
  advanceClock(now);
  if (day!==state.day || visiting!==visitSignature(state)) {
    renderHeader();renderBook();
    if (dialog.open && sheet==="calendar") openCalendar();
    if (dialog.open && sheet==="visit") openVisit();
  } else renderSupplies();
  refreshLivePanel();
  if (now-lastSave>=3000 || day!==state.day) {
    lastSave=now;
    worldOrder(()=>{if (clockVisible && !state.paused) {advanceClock();persist();}});
  }
},150);
document.addEventListener("visibilitychange",()=>{
  if (document.hidden) {saveBeforeLeaving();clockVisible=false;}
  else {clockVisible=true;visibleFrom=lastTick=performance.now();pullWorld();}
});
window.addEventListener("pagehide",()=>{if (clockVisible) saveBeforeLeaving();});
window.addEventListener("pageshow",()=>{clockVisible=!document.hidden;visibleFrom=lastTick=performance.now();pullWorld();});
window.addEventListener("storage",e=>{
  if (e.key===STORE && clockVisible) pullWorld();
});
document.querySelectorAll("[data-art]").forEach(el=>{el.src=art[el.dataset.art];});
document.querySelectorAll("[data-icon]").forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
new ResizeObserver(()=>scheduleView()).observe(viewport);
render(); if (!lastStored) persist();

function showDelivery(actor,index,units) {
  if(!screen || dialog.open || bookDialog.open) return;
  const pose=farmPose(actor,index,0),p=project(screen,pose.x,.89,pose.z);
  if(p.x<12 || p.x>screen.w-12 || p.y<35 || p.y>screen.h-70) return;
  const el=document.createElement("span");el.className="float-gain harvest-gain";el.setAttribute("aria-hidden","true");
  el.innerHTML=img("food")+"+"+units;el.style.left=p.x+"px";el.style.top=p.y+"px";
  $("map-fx").append(el);setTimeout(()=>el.remove(),1050);
}
