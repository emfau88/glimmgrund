import { entrances, foodPrice, guardStrength, keeperPose, makeVisit, newTrails, nextEntrance, readTrails, readVisit, recordDeparture, sporeCell, tickVisit } from "./visits.js";

const OLD_STORE = "glimmgrund.mooswiege.v1";
const PREVIOUS_STORE = "glimmgrund.mooswiege.v3";
const STORE = "glimmgrund.mooswiege.v4";
const DIG_MS=2300;
const DAY_MS = 90000;
const MINUTE = 60000;
const MEALS_PER_MINUTE = 5;
const LIMIT = 7;
const resources = { gold: "Gold", food: "Nahrung", crystal: "Kristalle" };
const directions = [[1,0],[-1,0],[0,1],[0,-1]];
const gates = {
  "1,4": { name: "Laternenstollen" },
  "4,-2": { name: "Kupferstollen" },
  "-4,1": { name: "Moosstollen" }
};
const homes = {
  heart: { name: "Herzkammer", icon: "home", art: "house", copy: "Hier teilen die Bewohner das erste Licht des Tages. Fünf Schlafplätze gehören von Anfang an zur Herzkammer." },
  farm: { name:"Pilzgarten", icon:"sprout", art:"farm", stock:"food", amount:5, unitMs:4000, room:"farm", action:"Pilze pflücken",
    copy:"Deine Gartenmannschaft pflückt Pilze und trägt sie zum Sammelkorb. Reife Pilze aus allen Beeten kannst du hier zusätzlich selbst pflücken." },
  mine: { name:"Kristallader", icon:"gem", art:"crystal", stock:"crystal", amount:2, unitMs:9000, room:"grotto", action:"Splitter sammeln",
    copy:"Die Ader und jede entdeckte Glimmgrotte liefern Kristalle. Lose Splitter kannst du hier zusätzlich einsammeln." },
  shop: { name:"Werkstatt", icon:"pick", art:"gold", stock:"gold", amount:5, unitMs:6000, action:"Erz auslesen",
    copy:"Das Team bringt Gold aus dem Erzabbau ins Lager. Aus dem Gestein am Sortiertisch kannst du weitere Goldstücke lesen." }
};
const workplaces = {farm:"Garten",shop:"Erzabbau",ward:"Wache"};
const stockHome = {food:"farm",gold:"shop",crystal:"mine"};
const peopleKinds = {
  miner: { role:"Stollengräber", job:"shop", icon:"pick", names:["Pip","Kiesel","Flint","Tuck","Muck","Nuri"], cost:{gold:12,food:3}, effect:"Gräbt markierte Felder. Im Erzabbau +15 Gold/min und +1 Gold je Grabung.", note:"Kennt den Klang von Gold im Gestein." },
  gardener: { role:"Pilzgärtnerin", job:"farm", icon:"sprout", names:["Luma","Mora","Alma","Fenna","Tilda","Runa"], cost:{gold:14,food:3}, effect:"Bringt im Garten alle drei Sekunden einen Pilz zum Sammelkorb (+20 Nahrung/min).", note:"Findet für jeden Pilz ein Plätzchen im Moos." },
  guard: { role:"Steinwache", job:"ward", icon:"shield", names:["Brumm","Bork","Klint","Moro","Torv","Kern"], cost:{gold:16,crystal:3}, effect:"Auf Wache +2 Wachstärke gegen Höhlenkäfer.", note:"Begleitet verirrte Käfer zurück in den Berg." }
};
const buildings = {
  farm: { name:"Pilzgarten", icon:"sprout", cost:{gold:14,crystal:2}, effect:"+15 Nahrung/min und fünf weitere Plätze für reife Pilze.", unlock:0 },
  bed: { name: "Schlafkammer", icon: "home", cost: {gold:18,crystal:2}, effect: "Drei zusätzliche Schlafplätze.", unlock: 0 },
  ward: { name: "Wachstube", icon: "shield", cost: {gold:20,crystal:3}, effect: "+3 Stärke am Zugang bis zwei Felder Entfernung, sonst +1.", unlock: 3 }
};
const knownRooms = {
  floor: {name:"Freier Stollen",icon:"pick",effect:"Hier ist Platz für einen neuen Raum."},
  grotto: {name:"Glimmgrotte",icon:"gem",effect:"Liefert +5 Kristalle/min. Lose Splitter kannst du hier einsammeln."},
  spores: {name:"Sporenkammer",icon:"sprout",effect:"Die leuchtenden Sporen machen jeden Käferköder um drei Pilze günstiger."},
  ...buildings
};
const questList = [
  { title:"Der erste Stollen", text:"Grabe drei Felder am Rand deines Reichs frei.", goal:3, score:() => tileCount(), art:"pick", reward:{gold:15} },
  { title:"Pilze für alle", text:"Lege einen Pilzgarten in einem freien Stollen an.", goal:1, score:() => countRoom("farm"), art:"food", reward:{crystal:4} },
  { title:"Gute Gesellschaft", text:"Wirb einen neuen Bewohner für die Mooswiege an.", goal:1, score:() => state.people.length-3, art:"miner", reward:{food:8} },
  { title:"Ein Licht im Stein", text:"Folge den Leuchtsporen ein Feld hinter den Moosstollen.", goal:1, score:() => Number(!!state.tiles[sporeCell]), art:"food", reward:{gold:18} },
  { title:"Leise Gäste", text:"Begleite den ersten Käferbesuch bis zum Abschied.", goal:1, score:() => state.visits, art:"guard", reward:{food:10} },
  { title:"Ein Dorf im Berg", text:"Schaffe Schlafplätze und beherberge sechs Bewohner.", goal:6, score:() => state.people.length, art:"house", reward:{crystal:8} },
  { title:"Die große Käferwanderung", text:"Empfange an beiden Zugängen Käfer mit Wache oder Köder und geleite auch die große dritte Gruppe heim.", goal:3,
    score:() => state.trails.safe.length+Number(state.trails.welcomed>=3), art:"guard", reward:{crystal:12} }
];
const keyOf = (q,r) => q+","+r;
const parseKey = key => key.split(",").map(Number);
const inRock = (q,r) => Math.abs(q)<=LIMIT && Math.abs(r)<=LIMIT && (Math.abs(q)>3 || Math.abs(r)>3);
const labelsFor = amounts => Object.entries(amounts).map(([s,n])=>n+" "+resources[s]).join(" und ");
function sourceCount(key,tiles=state.tiles) {
  const room=homes[key].room;
  return room ? 1+Object.values(tiles).filter(t=>t===room).length : 1;
}
function makeWork(tiles,saved) {
  const carry={}, crop={};
  for (const resource of Object.keys(resources)) {
    const points=saved?.carry?.[resource];
    carry[resource]=Number.isFinite(points) && Math.abs(points)<MINUTE ? points : 0;
    const key=stockHome[resource], site=homes[key];
    const full=site.amount*site.unitMs*sourceCount(key,tiles), stored=saved?.crop?.[key];
    crop[key]=Number.isFinite(stored) ? Math.min(full,Math.max(0,stored)) : full;
  }
  return {carry,crop,at:Number.isFinite(saved?.at)?saved.at:0};
}
function initialState() {
  return {
    version:4, day:1, elapsed:0, paused:false, sound:false, work:makeWork({}), shift:{orders:[],crew:[]},trails:newTrails(),guided:false,
    stock:{gold:80,food:24,crystal:8}, tiles:{}, people:[
      {type:"miner",name:"Pip",job:"shop"},{type:"gardener",name:"Luma",job:"farm"},{type:"guard",name:"Brumm",job:"ward"}
    ], quest:0, visits:0, nextVisit:4, visit:null,
    log:[{day:1,icon:"home",text:"Pip, Luma und Brumm haben die Mooswiege bezogen."}],
    unread:false
  };
}
function loadState(raw) {
  if (!raw) return null;
  try {
    const s=JSON.parse(raw);
    if (![1,2,3,4].includes(s.version) || !Number.isInteger(s.day) || s.day<1 || !s.stock || !s.tiles ||
        !Array.isArray(s.people) || !s.people.length || !Array.isArray(s.log)) return null;
    if (Object.keys(resources).some(k => !Number.isFinite(s.stock[k]) || s.stock[k]<0)) return null;
    if (s.people.some(p => !p || !Object.hasOwn(peopleKinds,p.type) || typeof p.name!=="string")) return null;
    if (Object.entries(s.tiles).some(([k,t]) => !/^-?\d+,-?\d+$/.test(k) || !inRock(...parseKey(k)) || !Object.hasOwn(knownRooms,t))) return null;
    if (!Number.isInteger(s.quest) || s.quest<0 || s.quest>questList.length ||
        !Number.isInteger(s.nextVisit) || !Number.isInteger(s.visits) || !Number.isFinite(s.elapsed)) return null;
    s.elapsed=Math.max(0,Math.min(DAY_MS,s.elapsed));
    s.work=makeWork(s.tiles,s.version>=2?s.work:null);
    for (const p of s.people) if (!Object.hasOwn(workplaces,p.job)) p.job=peopleKinds[p.type].job;
    s.shift=readShift(s);
    s.trails=readTrails(s.trails);
    s.visit=readVisit(s.visit,s);
    s.guided=!!s.guided || Object.keys(s.tiles).length+s.shift.orders.length>=2;
    s.version=4;
    delete s.gathered;
    delete s.started;
    s.log=s.log.filter(e => e && Number.isInteger(e.day) && typeof e.text==="string").slice(0,80);
    return s;
  } catch { return null; }
}
const tileCount = () => Object.keys(state.tiles).length;
const countRoom = type => Object.values(state.tiles).filter(t=>t===type).length;
const countPeople = type => state.people.filter(p=>p.type===type).length;
const beds = () => 5+3*countRoom("bed");
function jobOutput(person,job=person.job) {
  const specialist=peopleKinds[person.type].job===job;
  if (job==="farm") return specialist?20:10;
  if (job==="shop") return specialist?15:10;
  return specialist?2:1;
}
const power = () => guardStrength(state,state.visit?.gate || nextEntrance(state));
const demand = () => 2+Math.min(14,state.visits*2);
const offering = () => foodPrice(state);
const canPay = cost => Object.entries(cost).every(([k,n])=>state.stock[k]>=n);
function transfer(amounts, sign=1) {
  for (const [k,n] of Object.entries(amounts)) state.stock[k]=Math.max(0,state.stock[k]+n*sign);
}
export function tickSupplies(delta) {
  const rates=production();
  for (const p of state.people) if (p.job==="farm") rates.food-=jobOutput(p);
  for (const resource of Object.keys(resources)) {
    const earned=state.work.carry[resource]+rates[resource]*delta, units=Math.trunc(earned/MINUTE);
    state.stock[resource]=Math.max(0,state.stock[resource]+units);
    const rest=earned-units*MINUTE;
    state.work.carry[resource]=state.stock[resource]===0?Math.max(0,rest):rest;
    const key=stockHome[resource], site=homes[key], sources=sourceCount(key);
    state.work.crop[key]=Math.min(site.unitMs*site.amount*sources,state.work.crop[key]+delta*sources);
  }
  state.elapsed+=delta;
  if(state.elapsed>=DAY_MS) {state.elapsed-=DAY_MS;state.day++;}
}
function production() {
  const rates={gold:5,food:15*sourceCount("farm")-MEALS_PER_MINUTE*state.people.length,crystal:5*sourceCount("mine")};
  for (const p of state.people) {
    if (p.job==="farm") rates.food+=jobOutput(p);
    if (p.job==="shop") rates.gold+=jobOutput(p);
  }
  return rates;
}
function harvestState(key) {
  const site=homes[key], beds=sourceCount(key), progress=state.work.crop[key];
  const ready=Math.floor(progress/site.unitMs);
  return {ready,capacity:site.amount*beds,seconds:Math.ceil((site.unitMs-progress%site.unitMs)/(1000*beds))};
}
function frontier() {
  const available=new Set(Object.keys(gates).filter(k=>!state.tiles[k]));
  for (const k of Object.keys(state.tiles)) {
    const [q,r]=parseKey(k);
    for (const [dq,dr] of directions) {
      const x=q+dq,y=r+dr,key=keyOf(x,y);
      if (inRock(x,y) && !state.tiles[key]) available.add(key);
    }
  }
  return available;
}
function deposit(q,r) {
  if (q===4 && r===-2) return "motherlode";
  if (q===-5 && r===1) return "sporerock";
  const roll=((q*37+r*71+q*r*13)%11+11)%11;
  if (q===-4 && r===1) return "mossrock";
  return roll<2?"crystalrock":roll<6?"goldrock":roll<9?"mossrock":"rock";
}
const FIELD = LIMIT+3, FIELD_W=FIELD*2+1;
const cellId=(q,r)=>1+(r+FIELD)*FIELD_W+q+FIELD;
const HOME_BASE=FIELD_W*FIELD_W+1;
const homeSpots={
  heart:{id:HOME_BASE,x:-.49,z:-.62,y:1.04},
  farm:{id:HOME_BASE+1,x:-2.09,z:1.77,y:.71},
  mine:{id:HOME_BASE+2,x:1.82,z:-2.08,y:1.13},
  shop:{id:HOME_BASE+3,x:2.16,z:1.28,y:.70}
};
const PERSON_BASE=HOME_BASE+4;
const WALK_SPEED=2.15, NAV_SUB=5, NAV_HALF=LIMIT*NAV_SUB+2, NAV_WIDTH=2*NAV_HALF+1;
const hubBlocks=[[-1.58,.60,-1.80,.44],[-3.04,-1.04,.71,2.77],[1.44,2.91,.54,1.93],[.72,2.90,-2.98,-1.15]];
let navigation=null;
function readShift(s) {
  const raw=s.version>=3?s.shift:null, seen=new Set(), orders=[];
  for (const o of Array.isArray(raw?.orders)?raw.orders:[]) {
    if (!o || typeof o.key!=="string" || !/^-?\d+,-?\d+$/.test(o.key) || !inRock(...parseKey(o.key)) || s.tiles[o.key] || seen.has(o.key)) continue;
    seen.add(o.key);orders.push({key:o.key,work:Math.max(0,Math.min(DIG_MS-.001,Number(o.work)||0))});
  }
  const point=p=>Array.isArray(p) && p.length===2 && p.every(v=>Number.isFinite(v) && Math.abs(v)<=LIMIT+.5);
  const crew=s.people.map((p,i)=>{
    const a=raw?.crew?.[i];
    if (!a || !point([a.x,a.z]) || !Number.isFinite(a.yaw) || !Number.isFinite(a.phase) || !Object.hasOwn(workplaces,a.job)) return null;
    const path=Array.isArray(a.path) && a.path.length<600 && a.path.every(point)?a.path:[];
    return {x:a.x,z:a.z,yaw:a.yaw,job:a.job,mode:["idle","walk","dig","farm","shop","ward"].includes(a.mode)?a.mode:"idle",
      phase:Math.max(0,a.phase)%1,field:seen.has(a.field)?a.field:"",site:a.site&&s.tiles[a.site]==="farm"?a.site:"",path};
  });
  return {orders,crew};
}
function plannedEdges() {
  const result=frontier();
  for (const order of state.shift.orders) {
    result.add(order.key);
    const [x,z]=parseKey(order.key);
    for (const [dx,dz] of directions) {
      const key=keyOf(x+dx,z+dz);
      if (inRock(x+dx,z+dz) && !state.tiles[key]) result.add(key);
    }
  }
  return result;
}
export function queueDig(key) {
  if(state.tiles[key] || state.shift.orders.some(o=>o.key===key) || !plannedEdges().has(key)) return false;
  state.shift.orders.push({key,work:0});
  if(tileCount()+state.shift.orders.length>=2) state.guided=true;
  return true;
}
function openRock(key) {
  const [x,z]=parseKey(key), seam=deposit(x,z), n=tileCount()+1;
  const spore=key===sporeCell;
  const grotto=!spore && seam!=="motherlode" && (n>=5 && !countRoom("grotto") || n>5 && (n-5)%13===0);
  const miners=state.people.filter(p=>p.type==="miner" && p.job==="shop").length;
  const gains={gold:2+miners+(seam==="motherlode"?12:seam==="goldrock"?4:0)};
  if(spore || seam==="mossrock") gains.food=spore?5:3;
  if(seam==="crystalrock" || grotto) gains.crystal=(seam==="crystalrock"?2:0)+(grotto?5:0);
  transfer(gains);state.tiles[key]=spore?"spores":grotto?"grotto":"floor";invalidateNavigation();
  const message=spore?"Sporenkammer entdeckt":grotto?"Glimmgrotte entdeckt":gates[key]?gates[key].name+" geöffnet":"Stollen gegraben";
  return {gains,message,n,discovery:spore||grotto};
}
function cancelDig(key) {
  const remaining=state.shift.orders.filter(o=>o.key!==key);
  const keys=new Set(remaining.map(o=>o.key)), reached=frontier(), visit=[...reached];
  for (let i=0;i<visit.length;i++) {
    if (!keys.has(visit[i])) continue;
    const [x,z]=parseKey(visit[i]);
    for (const [dx,dz] of directions) {
      const k=keyOf(x+dx,z+dz);
      if (keys.has(k) && !reached.has(k)) {reached.add(k);visit.push(k);}
    }
  }
  const before=state.shift.orders.length;
  state.shift.orders=remaining.filter(o=>reached.has(o.key));
  const kept=new Set(state.shift.orders.map(o=>o.key));
  for (const a of state.shift.crew) if(a?.field && !kept.has(a.field)){a.field="";a.path=[];a.mode="idle";}
  return before-state.shift.orders.length;
}
const navIndex=(x,z)=>(Math.round(z*NAV_SUB)+NAV_HALF)*NAV_WIDTH+Math.round(x*NAV_SUB)+NAV_HALF;
const navPoint=id=>[((id%NAV_WIDTH)-NAV_HALF)/NAV_SUB,(Math.floor(id/NAV_WIDTH)-NAV_HALF)/NAV_SUB];
function walkGrid() {
  if (navigation?.tiles===state.tiles) return navigation.mask;
  const mask=new Uint8Array(NAV_WIDTH*NAV_WIDTH);
  for (let id=0;id<mask.length;id++) {
    const [x,z]=navPoint(id),q=Math.round(x),r=Math.round(z),tile=state.tiles[keyOf(q,r)];
    const home=Math.abs(q)<=3 && Math.abs(r)<=3;
    if (!home && !tile) continue;
    if (home && hubBlocks.some(([l,h,f,b])=>x>l && x<h && z>f && z<b)) continue;
    if (tile && tile!=="floor" && Math.abs(x-q)<.34 && Math.abs(z-r)<.34) continue;
    mask[id]=1;
  }
  navigation={tiles:state.tiles,mask};return mask;
}
function nearestNode(mask,x,z) {
  const base=navIndex(x,z);
  if (mask[base]) return base;
  let best=-1, distance=Infinity;
  for (let dz=-4;dz<=4;dz++) for (let dx=-4;dx<=4;dx++) {
    const id=base+dz*NAV_WIDTH+dx;if (!mask[id]) continue;
    const [nx,nz]=navPoint(id),d=(nx-x)**2+(nz-z)**2;
    if (d<distance) {distance=d;best=id;}
  }
  return best;
}
function routeTo(actor,goals) {
  const mask=walkGrid(),start=nearestNode(mask,actor.x,actor.z);
  const ends=new Set(goals.map(([x,z])=>navIndex(x,z)).filter(id=>mask[id]));
  if (start<0 || !ends.size) return null;
  const parent=new Int16Array(mask.length).fill(-1), pending=new Int16Array(mask.length);
  let head=0,tail=1,found=-1;pending[0]=start;parent[start]=start;
  while (head<tail) {
    const id=pending[head++];if(ends.has(id)){found=id;break;}
    for (const d of [-NAV_WIDTH,1,NAV_WIDTH,-1]) {
      const next=id+d;
      if (!mask[next] || parent[next]!==-1 || (d===1 && next%NAV_WIDTH===0) || (d===-1 && id%NAV_WIDTH===0)) continue;
      parent[next]=id;pending[tail++]=next;
    }
  }
  if(found<0)return null;
  const nodes=[found];for (let id=found;id!==start;) {id=parent[id];nodes.push(id);}
  nodes.reverse();
  return nodes.filter((id,i)=>!i || i===nodes.length-1 || id-nodes[i-1]!==nodes[i+1]-id).map(navPoint);
}
function faceRoute(a,key) {
  const [x,z]=parseKey(key),goals=[];
  for (const [dx,dz] of directions) {
    if (!floorAt(x+dx,z+dz)) continue;
    if (!state.tiles[keyOf(x+dx,z+dz)] && !gates[key]) continue;
    for (const side of [0,-.2,.2,-.4,.4]) goals.push([x+dx*.6+dz*side,z+dz*.6+dx*side]);
  }
  return routeTo(a,goals);
}
function farmPoints(site,index) {
  if (site) {
    const [x,z]=parseKey(site);
    return {basket:[x+.4,z+.4],bed:[x-.2,z+.4],face:Math.PI};
  }
  const lane=(index%3)*.10;
  return {basket:[-.40+lane,2.38+lane],bed:[-.93,1.74+lane],face:-Math.PI*.52};
}
function dutyPoint(a,i) {
  if(a.job==="farm") return farmPoints(a.site,i).basket;
  const slot=state.people.slice(0,i).filter(p=>p.job===a.job).length;
  const stations=a.job==="ward"?[[.16,2.82],[1.82,3.09],[-1.28,.53],[2.59,-.76]] :
    [[1.48,2.22],[2.42,2.45],[.78,1.71],[2.94,.18],[-.32,1.55],[1.76,-.44]];
  const point=stations[slot%stations.length];
  return [point[0]+Math.min(2,Math.floor(slot/stations.length))*.23,point[1]];
}
function chooseGarden(i) {
  const sites=["",...Object.keys(state.tiles).filter(k=>state.tiles[k]==="farm")];
  const slot=state.people.slice(0,i).filter(p=>p.job==="farm").length;
  return sites[slot%sites.length];
}
function ensureCrew() {
  for (let i=0;i<state.people.length;i++) {
    const p=state.people[i];let a=state.shift.crew[i];
    if (!a) {
      a={x:.4,z:1.55,yaw:0,job:p.job,mode:p.job,phase:p.job==="farm"?0:(i*.31)%1,field:"",site:p.job==="farm"?chooseGarden(i):"",path:[]};
      [a.x,a.z]=dutyPoint(a,i);state.shift.crew[i]=a;
    } else if (p.job!==a.job) {
      a.job=p.job;a.field="";a.path=[];a.mode="idle";a.phase=0;a.site=p.job==="farm"?chooseGarden(i):"";
    }
  }
}
function farmPose(a,i,phase) {
  const {basket,bed,face}=farmPoints(a.site,i),dx=bed[0]-basket[0],dz=bed[1]-basket[1];
  let mix,act,yaw=Math.atan2(dx,dz),beat;
  if(phase<.26){mix=phase/.26;act="walk";beat=phase/.26;}
  else if(phase<.52){mix=1;act="pluck";beat=(phase-.26)/.26;yaw=face;}
  else if(phase<.82){mix=1-(phase-.52)/.30;act="carry";beat=(phase-.52)/.30;yaw+=Math.PI;}
  else{mix=0;act="unload";beat=(phase-.82)/.18;yaw+=Math.PI;}
  return {x:basket[0]+dx*mix,z:basket[1]+dz*mix,yaw,act,beat};
}
function startDuty(a,i) {
  const at=dutyPoint(a,i);
  if(Math.hypot(a.x-at[0],a.z-at[1])<.24){a.mode=a.job;[a.x,a.z]=at;return;}
  const goal=nearestNode(walkGrid(),...at),path=goal<0?null:routeTo(a,[navPoint(goal)]);
  if (path) {a.path=path;a.mode="walk";}
}
function walkStep(a,ms) {
  while (a.path.length) {
    const [x,z]=a.path[0],dx=x-a.x,dz=z-a.z,d=Math.hypot(dx,dz);
    if(d>.001)a.yaw=Math.atan2(dx,dz);
    const time=d*1000/WALK_SPEED;
    if(time>ms){a.x+=dx*ms/time;a.z+=dz*ms/time;return 0;}
    a.x=x;a.z=z;ms-=time;a.path.shift();
  }
  return ms;
}
function advanceWorkers(delta,onDig=()=>{},onDelivery=()=>{}) {
  ensureCrew();
  const orders=state.shift.orders, byKey=new Map(orders.map(o=>[o.key,o]));
  const assigned=new Set(state.shift.crew.map(a=>a.field).filter(Boolean));
  const completed=[];
  for (let i=0;i<state.people.length;i++) {
    const a=state.shift.crew[i],person=state.people[i];let left=delta;
    if (state.visit?.keeper===i) continue;
    for(let transitions=0;left>.001 && transitions<8;transitions++){
      if (a.job==="shop" && !a.field) {
        for (const o of orders) {
          if(assigned.has(o.key))continue;
          const path=faceRoute(a,o.key);if(!path)continue;
          a.field=o.key;a.path=path;a.mode="walk";assigned.add(o.key);break;
        }
      }
      if(a.mode==="idle"){startDuty(a,i);if(a.mode==="idle")break;}
      if(a.mode==="walk"){
        left=walkStep(a,left);if(a.path.length)break;
        a.mode=a.field?"dig":a.job;
        if(a.field){const [x,z]=parseKey(a.field);a.yaw=Math.atan2(x-a.x,z-a.z);}
        continue;
      }
      if(a.mode==="dig"){
        const order=byKey.get(a.field);
        if(!order){a.field="";a.mode="idle";continue;}
        const speed=person.type==="miner"?1:.74,spent=Math.min(left,(DIG_MS-order.work)/speed);
        order.work+=spent*speed;left-=spent;
        if(order.work<DIG_MS-.001)break;
        orders.splice(orders.indexOf(order),1);byKey.delete(order.key);
          const result=openRock(order.key);
          onDig(order.key,person.name,result);completed.push(order.key);
        a.field="";a.mode="idle";continue;
      }
      if(a.mode==="farm"){
        const phase=a.phase+left*jobOutput(person)/MINUTE, delivered=Math.floor(phase+1e-10);
        a.phase=Math.max(0,phase-delivered);state.stock.food+=delivered;
        if(delivered) onDelivery(a,i,delivered);
        const pose=farmPose(a,i,a.phase);a.x=pose.x;a.z=pose.z;a.yaw=pose.yaw;
      }else {
        a.phase=(a.phase+left/(a.mode==="ward"?6200:1850))%1;
        const [x,z]=dutyPoint(a,i);
        if(a.mode==="ward"){const t=1-Math.abs(2*a.phase-1);a.x=x+t*.69;a.z=z+t*.18;a.yaw=a.phase<.5?1.31:-1.83;}
        else{a.x=x;a.z=z;a.yaw=2.70;}
      }
      left=0;
    }
  }
  return completed;
}
const floorAt=(q,r)=>(Math.abs(q)<=3 && Math.abs(r)<=3) || !!state.tiles[keyOf(q,r)];

let state;
function setState(next) { state=next;navigation=null; }
function invalidateNavigation() {navigation=null;}

export function arriveParty() {
  if (state.visit) return false;
  state.visit=makeVisit(state);
  state.trails.bait[state.visit.gate]=false;
  return true;
}

export function availableKeeper() {
  const specialist=state.people.findIndex(p=>p.job==="ward" && p.type==="guard");
  return specialist>=0?specialist:state.people.findIndex(p=>p.job==="ward");
}

export function prepareBait(gate) {
  if (!Object.hasOwn(entrances,gate) || state.trails.bait[gate] || state.visit?.gate===gate || state.stock.food<offering()) return false;
  state.stock.food-=offering();state.trails.bait[gate]=true;return true;
}

export function respondToParty(choice) {
  const visit=state.visit;
  if (!visit || visit.choice) return false;
  if (choice==="guard") {
    const index=availableKeeper();
    if (index<0 || power()<demand()) return false;
    ensureCrew();
    const actor=state.shift.crew[index], meeting=entrances[visit.gate].track.at(-1);
    const goal=nearestNode(walkGrid(),...meeting), path=goal<0?null:routeTo(actor,[navPoint(goal)]);
    if (!path) return false;
    visit.keeper=index;visit.approach=[[actor.x,actor.z],...path,meeting];visit.approached=0;
  } else if (choice==="bait") {
    if (state.stock.food<offering()) return false;
    state.stock.food-=offering();
  } else if (choice!=="pass") return false;
  visit.choice=choice;return true;
}

export function advanceParty(ms) {
  const visit=state.visit;
  if (!visit) return null;
  const finished=tickVisit(visit,ms);
  if (visit.keeper>=0) {
    const actor=state.shift.crew[visit.keeper];
    Object.assign(actor,keeperPose(visit));
    if (finished) {
      actor.mode="idle";actor.path=[];
      if (visit.afterJob) state.people[visit.keeper].job=visit.afterJob;
    }
  }
  if (!finished) return null;
  recordDeparture(state,visit);
  return visit;
}

export { DAY_MS, DIG_MS, FIELD, FIELD_W, LIMIT, MEALS_PER_MINUTE, MINUTE, OLD_STORE, PERSON_BASE, PREVIOUS_STORE, STORE, WALK_SPEED, advanceWorkers, beds, buildings, canPay, cancelDig, cellId, countPeople, countRoom, demand, deposit, directions, dutyPoint, ensureCrew, farmPose, floorAt, frontier, gates, harvestState, homeSpots, homes, initialState, invalidateNavigation, jobOutput, keyOf, knownRooms, labelsFor, loadState, navPoint, nearestNode, offering, parseKey, peopleKinds, plannedEdges, power, production, questList, readShift, resources, routeTo, setState, sourceCount, state, stockHome, tileCount, transfer, walkGrid, workplaces };
