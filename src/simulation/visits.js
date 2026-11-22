// Distances are in map cells. Each track starts at the mouth of a natural
// passage and ends on the open paving, where a keeper can meet the visitors.
export const entrances = {
  moss: {
    name: "Moosstollen", key: "-4,1", sign: "Leuchtsporen",
    track: [[-3.44,1.04],[-3.20,.55],[-2.63,.43],[-1.42,.51],[-.83,.77],[-.40,1.15]]
  },
  copper: {
    name: "Kupferstollen", key: "4,-2", sign: "Goldader",
    track: [[3.48,-2.05],[3.18,-1.62],[3.08,-.92],[2.43,-.76],[1.10,-.72],[.87,-.37],[.83,.60],[.52,1.12]]
  }
};

const spacing = .71;
const beetleSpeed = .62;
const keeperSpeed = 1.65;
export const sporeCell = "-5,1";

export function nextEntrance(game) {
  if (game.trails.last) return game.trails.last === "moss" ? "copper" : "moss";
  for (const key of Object.keys(game.tiles)) {
    if (key === entrances.copper.key) return "copper";
    if (key === entrances.moss.key) return "moss";
  }
  return "moss";
}

export function wardBonus(key,gate) {
  const [gx,gz] = entrances[gate].key.split(",").map(Number);
  const [x,z] = key.split(",").map(Number);
  return Math.abs(x-gx) + Math.abs(z-gz) <= 2 ? 3 : 1;
}
export function guardStrength(game, gate) {
  let total = game.people.reduce((sum,p) => sum + (p.job === "ward" ? (p.type === "guard" ? 2 : 1) : 0), 0);
  for (const [key,room] of Object.entries(game.tiles)) {
    if (room === "ward") total+=wardBonus(key,gate);
  }
  return total;
}

export function foodPrice(game) {
  return Math.max(2, 5 + Math.min(20,game.visits*2) - (game.tiles[sporeCell] ? 3 : 0));
}

export function newTrails() {
  return {last:null, safe:[], welcomed:0, bait:{moss:false,copper:false}};
}

export function readTrails(raw) {
  const trails = newTrails();
  if (!raw) return trails;
  trails.last = Object.hasOwn(entrances,raw.last) ? raw.last : null;
  trails.safe = Object.keys(entrances).filter(key => Array.isArray(raw.safe) && raw.safe.includes(key));
  trails.welcomed = Number.isSafeInteger(raw.welcomed) ? Math.max(0,raw.welcomed) : 0;
  for (const gate of Object.keys(entrances)) trails.bait[gate] = raw.bait?.[gate] === true;
  return trails;
}

export function lengthOf(path) {
  let length = 0;
  for (let i=1;i<path.length;i++) length += Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]);
  return length;
}

function along(path, distance) {
  let x=path[0][0], z=path[0][1], yaw=0;
  for (let i=1;i<path.length;i++) {
    const dx=path[i][0]-x, dz=path[i][1]-z, length=Math.hypot(dx,dz);
    if (!length) continue;
    yaw=Math.atan2(dx,dz);
    if (distance<=length) {
      const ratio=Math.max(0,distance)/length;
      return {x:x+ratio*dx, z:z+ratio*dz, yaw};
    }
    x=path[i][0];z=path[i][1];distance-=length;
  }
  return {x,z,yaw};
}

export function makeVisit(game) {
  const gate=nextEntrance(game);
  return {gate,phase:"arriving",distance:0,choice:game.trails.bait[gate]?"bait":"",
    keeper:-1,approach:[],approached:0,count:game.trails.welcomed>=2?5:3};
}

export function readVisit(raw,game) {
  if (!raw) return null;
  if (raw===true) return makeVisit(game); // A party waiting in an older save.
  if (!Object.hasOwn(entrances,raw.gate) || !["arriving","waiting","leaving"].includes(raw.phase)) return null;
  const visit=makeVisit(game);
  Object.assign(visit,{gate:raw.gate,phase:raw.phase,count:raw.count===5?5:3,
    distance:Number.isFinite(raw.distance)?Math.max(0,raw.distance):0,
    choice:["guard","bait","pass"].includes(raw.choice)?raw.choice:""});
  if (visit.choice==="guard") {
    if (game.people[raw.keeper]?.job!=="ward" || !Array.isArray(raw.approach) || !raw.approach.length ||
        !raw.approach.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<9))) {
      visit.choice="";visit.phase="waiting";visit.distance=0;
    } else {
      visit.keeper=raw.keeper;visit.approach=raw.approach;
      if(["farm","ward","shop"].includes(raw.afterJob)) visit.afterJob=raw.afterJob;
      visit.approached=Number.isFinite(raw.approached)?Math.max(0,raw.approached):0;
    }
  }
  if(visit.phase==="leaving" && !visit.choice) visit.phase="waiting";
  return visit;
}

export function tickVisit(visit,ms) {
  const track=entrances[visit.gate].track, length=lengthOf(track);
  if (visit.choice==="guard") visit.approached=Math.min(lengthOf(visit.approach),visit.approached+ms*keeperSpeed/1000);
  if (visit.phase==="leaving") {
    visit.distance+=ms*beetleSpeed/1000;
    return visit.distance>=length+spacing*(visit.count+.6);
  }
  if (visit.phase==="arriving") {
    visit.distance+=ms*beetleSpeed/1000;
    if (visit.distance>=length+spacing*(visit.count-1)) visit.phase="waiting";
  }
  if (visit.phase==="waiting" && visit.choice &&
      (visit.choice!=="guard" || visit.approached>=lengthOf(visit.approach))) {
    visit.phase="leaving";visit.distance=0;
  }
  return false;
}

export function keeperPose(visit) {
  if (visit.phase!=="leaving") return along(visit.approach,visit.approached);
  const track=entrances[visit.gate].track, pose=along(track,lengthOf(track)-visit.distance);
  pose.yaw+=Math.PI;return pose;
}

export function beetlePose(visit,index,lead=0) {
  const track=entrances[visit.gate].track,length=lengthOf(track);
  const distance=visit.distance+lead*beetleSpeed/1000;
  const outbound=visit.phase==="leaving";
  const offset=index*spacing;
  const progress=outbound?length-Math.max(0,distance-(index+1)*spacing):Math.min(length,distance-offset);
  if (progress<-.04 && visit.phase!=="waiting") return null;
  const pose=along(track,visit.phase==="waiting"?length:progress);
  const personalSpace=Math.max(0,Math.min(1,(progress-length+1.1)/1.1));
  const lane=(index-(visit.count-1)/2)*.40*personalSpace+(index%2?-.08:.08)*(1-personalSpace);
  pose.x+=Math.cos(pose.yaw)*lane;
  pose.z-=Math.sin(pose.yaw)*lane;
  if(outbound) pose.yaw+=Math.PI;
  return pose;
}

export function recordDeparture(game,visit) {
  game.trails.last=visit.gate;
  if (visit.choice==="pass") game.stock.gold=Math.max(0,game.stock.gold-8);
  else {
    game.trails.welcomed++;
    if (!game.trails.safe.includes(visit.gate)) game.trails.safe.push(visit.gate);
  }
  game.visits++;game.nextVisit=game.day+3;game.visit=null;
}
