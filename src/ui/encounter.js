import { DAY_MS, state, availableKeeper, offering, demand, power, tileCount } from "../simulation/colony.js";
import { entrances, guardStrength, nextEntrance } from "../simulation/visits.js";
import { escape, fact, primary, secondary } from "./elements.js";

export function visitStatus() {
  const v=state.visit, name=entrances[v.gate].name;
  if(v.choice==="guard") return state.people[v.keeper].name+(v.phase==="leaving"?" begleitet die Käfer":" holt die Käfer ab");
  if(v.phase==="leaving") return "Käfer auf dem Heimweg";
  return v.phase==="waiting"?"Käfer warten · "+name:"Käfer aus dem "+name;
}

export function visitPanel() {
  const v=state.visit,gate=v?.gate || nextEntrance(state),entry=entrances[gate],food=offering(),keeper=availableKeeper();
  let html;
  if(v) {
    html='<p class="intro">'+escape(visitStatus())+'. Die goldenen Spuren zeigen den Weg vom Zugang zum Treffpunkt.</p>';
    if(!v.choice) {
      html+='<div class="facts">'+fact("Wachstärke am "+entry.name,power()+" / "+demand())+'</div>';
      html+=primary("visit-guard",keeper<0?"Bewohner auf Wache benötigt":power()<demand()?"Wachstärke "+demand()+" benötigt":escape(state.people[keeper].name)+" rufen",keeper<0||power()<demand());
      html+=secondary("visit-feed","Pilzköder legen · "+food+" Nahrung")+secondary("visit-pass","Vorbeiziehen lassen · bis zu 8 Gold");
    }
    html+=(v.choice?primary:secondary)("watch-visit","Auf der Karte ansehen");
  } else {
    const time=Math.max(0,Math.ceil(((state.nextVisit-state.day)*DAY_MS-state.elapsed)/1000));
    html='<p class="intro">Die nächste Gruppe kommt aus dem <b>'+entry.name+'</b>. An Tag '+state.nextVisit+' erreicht sie das Dorf. Du kannst sie nach drei Grabungen früher rufen.</p>';
    html+='<div class="visit-gates">'+Object.entries(entrances).map(([id,e])=>
      '<div class="visit-gate '+(id===gate?"expected":"")+'"><b>'+e.name+'</b><small>'+guardStrength(state,id)+' Wachstärke · '+(state.trails.safe.includes(id)?"Heimweg bekannt":"Neuer Heimweg")+'</small><button class="secondary" data-bait="'+id+'"'+(state.trails.bait[id]||state.stock.food<food?" disabled":"")+'>'+(state.trails.bait[id]?"Köder liegt bereit":"Köder legen · "+food+" Nahrung")+'</button></div>').join("")+'</div>';
    html+=primary("invite",tileCount()>=3?"Käfer jetzt anlocken":"Anlocken ab drei Grabungen",tileCount()<3);
    if(state.trails.welcomed) html+='<div class="facts">'+fact("Sichere Heimwege",state.trails.safe.length+" / 2")+fact("Friedliche Besuche",Math.min(3,state.trails.welcomed)+" / 3")+'</div>';
    html+='<p class="soft">Ankunft in <span id="visit-countdown">'+time+'</span> s Spielzeit. Eine Wachstube stärkt ihren nahen Zugang.</p>';
  }
  html+=secondary("crew","Wache einteilen");
  return [v?entry.name:"Die Käferpfade",v?(v.count===5?"Große Wanderung":"Käferbesuch"):"Mooswiege",html];
}
