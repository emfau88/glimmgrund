import test from "node:test";
import assert from "node:assert/strict";
import {
  STORE, advanceParty, advanceWorkers, arriveParty, cancelDig, ensureCrew,
  initialState, loadState, prepareBait, queueDig, respondToParty, setState, state, tickSupplies
} from "../src/simulation/colony.js";
import { beetlePose, entrances, foodPrice, guardStrength, keeperPose, nextEntrance, sporeCell } from "../src/simulation/visits.js";

function fresh() {setState(initialState());ensureCrew();}
function run(ms) {
  for(let t=0;t<ms;t+=100) {
    const dt=Math.min(100,ms-t);
    tickSupplies(dt);advanceWorkers(dt);advanceParty(dt);
  }
}
function reload() {setState(loadState(JSON.stringify(state)));ensureCrew();}

test("Pip saves and resumes a connected queue while Luma harvests at zero food",()=>{
  fresh();state.stock.food=0;
  assert.ok(queueDig("1,4"));assert.ok(queueDig("1,5"));assert.ok(queueDig("1,6"));
  assert.equal(cancelDig("1,5"),2);assert.ok(queueDig("1,5"));assert.ok(queueDig("1,6"));
  assert.equal(queueDig("1,6"),false);assert.equal(queueDig("7,7"),false);
  run(1800);const partial=state.shift.orders[0].work;
  assert.ok(partial>0 && partial<2300);assert.deepEqual(state.tiles,{});
  reload();assert.equal(state.shift.orders[0].work,partial);
  run(12000);
  assert.deepEqual(Object.keys(state.tiles),["1,4","1,5","1,6"]);
  // Four deliveries from Luma plus the three wild mushrooms in this tunnel.
  assert.equal(state.stock.food,7);assert.equal(state.shift.orders.length,0);assert.equal(state.day,1);
});

test("The first dug passage determines the entrance; the rare chamber changes bait costs",()=>{
  for(const first of ["moss","copper"]) {
    fresh();const before={...state.stock};queueDig(entrances[first].key);run(8000);
    assert.equal(nextEntrance(state),first);
    if(first==="copper") assert.ok(state.stock.gold-before.gold>=15);
  }
  fresh();queueDig("-4,1");queueDig(sporeCell);run(14500);
  assert.equal(state.tiles[sporeCell],"spores");assert.equal(foodPrice(state),2);
  state.tiles["4,-2"]="ward";assert.equal(guardStrength(state,"copper"),5);assert.equal(guardStrength(state,"moss"),3);
});

test("A keeper walks to the meeting, leads the beetles out and resumes after reload",()=>{
  for(const gate of Object.keys(entrances)) {
    fresh();queueDig(entrances[gate].key);run(8000);
    assert.ok(arriveParty());assert.equal(state.visit.gate,gate);assert.equal(arriveParty(),false);
    assert.ok(respondToParty("guard"));assert.equal(respondToParty("bait"),false);
    run(1300);const a=keeperPose(state.visit), insect=beetlePose(state.visit,0);
    assert.ok(insect);assert.equal(state.visit.keeper,2);assert.equal(state.visits,0);
    reload();assert.deepEqual(keeperPose(state.visit),a);assert.deepEqual(beetlePose(state.visit,0),insect);
    while(state.visit.phase!=="leaving") run(100);
    run(1500);const returning=JSON.stringify(state.visit);
    reload();assert.equal(JSON.stringify(state.visit),returning);
    state.visit.afterJob="farm";reload();
    run(18000);assert.equal(state.visit,null);assert.deepEqual(state.trails.safe,[gate]);assert.equal(state.visits,1);
    assert.equal(state.people[2].job,"farm");assert.notEqual(nextEntrance(state),gate);
    run(5000);assert.equal(state.visits,1);
  }
});

test("Each bait is paid once, used only at its gate and preserved across saves",()=>{
  fresh();const start=state.stock.food;
  assert.ok(prepareBait("copper"));assert.equal(prepareBait("copper"),false);
  assert.equal(state.stock.food,start-5);reload();arriveParty();
  assert.equal(state.visit.gate,"moss");assert.equal(state.visit.choice,"");run(15000);
  assert.equal(state.visit.phase,"waiting");assert.equal(state.trails.bait.copper,true);
  assert.ok(respondToParty("guard"));run(20000);
  const before=state.stock.food;arriveParty();
  assert.equal(state.visit.gate,"copper");assert.equal(state.visit.choice,"bait");assert.equal(state.stock.food,before);
  assert.equal(state.trails.bait.copper,false);reload();run(35000);
  assert.deepEqual(state.trails.safe,["moss","copper"]);assert.equal(state.trails.welcomed,2);
  arriveParty();assert.equal(state.visit.count,5);const price=foodPrice(state);
  const stock=state.stock.food;assert.ok(respondToParty("bait"));assert.equal(state.stock.food,stock-price);
  run(38000);assert.equal(state.trails.welcomed,3);
});

test("An unstaffed watch offers an alternative, departure is charged only at the exit",()=>{
  fresh();state.people[2].job="shop";state.stock.food=0;arriveParty();
  assert.equal(respondToParty("guard"),false);assert.equal(respondToParty("bait"),false);
  assert.ok(respondToParty("pass"));assert.equal(state.stock.gold,80);
  for(let i=0;i<400;i++)advanceParty(100);
  assert.equal(state.stock.gold,72);assert.equal(state.visits,1);assert.deepEqual(state.trails.safe,[]);
});

test("v1–v3 estates and old pending visits migrate without losing residents or fields",()=>{
  for(const version of [1,2,3]) {
    fresh();queueDig("4,-2");run(8000);queueDig("-4,1");
    const old=JSON.parse(JSON.stringify(state));old.version=version;old.day=5;old.visit=true;
    delete old.trails;delete old.guided;if(version<3) delete old.shift;
    setState(loadState(JSON.stringify(old)));ensureCrew();
    assert.equal(state.version,4);assert.equal(state.day,5);assert.deepEqual(state.stock,old.stock);
    assert.deepEqual(state.tiles,old.tiles);assert.deepEqual(state.people,old.people);
    assert.equal(state.visit.gate,"copper");assert.equal(state.shift.orders.length,version===3?1:0);
  }
  assert.match(STORE,/v4$/);
});
