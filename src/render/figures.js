import { CaveMesh, VERTEX, beetle, harvestBasket, worker } from "./models.js";
import { eachTriangle, project } from "./terrain.js";
import { DAY_MS, MINUTE, PERSON_BASE, WALK_SPEED, cellId, dutyPoint, farmPose, jobOutput, parseKey, state } from "../simulation/colony.js";
import { beetlePose, entrances, keeperPose } from "../simulation/visits.js";

export const PARTY_ID=1002;
function actorPose(a,index,lead) {
  const time=(state.day-1)*DAY_MS+state.elapsed+lead;
  if(state.visit?.keeper===index) {
    const v=state.visit, pose=keeperPose(v);
    return {...pose,act:v.phase==="leaving"?"escort":"meet",beat:(time/810)%1};
  }
  if(a.mode==="farm")return farmPose(a,index,(a.phase+lead*jobOutput(state.people[index])/MINUTE)%1);
  let {x,z,yaw}=a,act="ore",beat=(time/1300+index*.17)%1;
  if(a.mode==="walk" && a.path.length){
    const [tx,tz]=a.path[0],dx=tx-x,dz=tz-z,dist=Math.hypot(dx,dz);
    if(dist>.001){const f=Math.min(1,lead*WALK_SPEED/(1000*dist));x+=dx*f;z+=dz*f;yaw=Math.atan2(dx,dz);}
    act="walk";beat=(time/600+index*.27)%1;
  }else if(a.mode==="dig"){
    act="dig";beat=(time/635+index*.19)%1;
  }else if(a.mode==="ward"){
    const p=(a.phase+lead/6200)%1,t=1-Math.abs(2*p-1),[sx,sz]=dutyPoint(a,index);
    x=sx+t*.69;z=sz+t*.18;yaw=p<.5?1.31:-1.83;act="patrol";beat=(time/870)%1;
  }
  return {x,z,yaw,act,beat};
}
function sceneFigures(lead) {
  const figures=state.people.map((p,i)=>({type:p.type,id:PERSON_BASE+i,name:p.name,variant:i%2,pose:actorPose(state.shift.crew[i],i,lead)}));
  const visit=state.visit;
  for(const [gate,entry] of Object.entries(entrances)) {
    if(!state.trails.bait[gate] && !(visit?.gate===gate && visit.choice==="bait")) continue;
    const [x,z]=entry.track[1];
    figures.push({type:"bait",id:visit?PARTY_ID:cellId(...parseKey(entry.key)),variant:0,pose:{x:x+.18,z:z+.14,yaw:0,act:"bait",beat:0}});
  }
  if(visit) for(let i=0;i<visit.count;i++) {
    const pose=beetlePose(visit,i,lead);
    if(!pose) continue;
    pose.act=visit.phase;pose.beat=((state.elapsed+lead)/(visit.phase==="waiting"?1400:490)+i*.23)%1;
    figures.push({type:"beetle",id:PARTY_ID,variant:i%2,name:i===0?"Höhlenkäfer im "+entrances[visit.gate].name:null,pose});
  }
  return figures;
}

export function createFigureLayer(crewCanvas) {
  const crewInk=crewCanvas.getContext("2d");
  const poses=new Map(),figureScale=1.58;
  let actorImage,actorDepth,actorIds,actorRatio=1,oldRects=[];
  function posedMesh(type,act,t,variant) {
    const frame=Math.min(11,Math.floor(t*12)),key=type+"/"+act+"/"+frame+"/"+variant;
    if(!poses.has(key)){
      const b=new CaveMesh([[0,.64,.65,1.8,.22,.11,.035]]);
      if(type==="beetle") beetle(b,frame/12,variant);
      else if(type==="bait") harvestBasket(b,0,0,1.15);
      else worker(b,type,act,frame/12,variant);
      poses.set(key,b.finish().vertices);
      if(poses.size>96)poses.delete(poses.keys().next().value);
    }
    return poses.get(key);
  }
  function workerAt(x,y) {
    const i=Math.floor(x*actorRatio),j=Math.floor(y*actorRatio);
    return actorIds && i>=0 && j>=0 && i<crewCanvas.width && j<crewCanvas.height?actorIds[j*crewCanvas.width+i]:0;
  }
  function paint(v,renderer,hoverId,lead,placeTarget) {
    const scale=actorRatio=Math.min(devicePixelRatio||1,1.5,Math.sqrt(1500000/(v.w*v.h)));
    const width=Math.max(1,Math.round(v.w*scale)),height=Math.max(1,Math.round(v.h*scale));
    if(!actorImage || crewCanvas.width!==width || crewCanvas.height!==height){
      crewCanvas.width=width;crewCanvas.height=height;actorImage=crewInk.createImageData(width,height);
      actorDepth=new Float32Array(width*height).fill(-100);actorIds=new Uint16Array(width*height);oldRects=[];
    }
    const data=actorImage.data, rects=[];
    for (const [x0,y0,x1,y1] of oldRects) for(let y=y0;y<y1;y++){
      const l=y*width+x0,r=y*width+x1;data.fill(0,l*4,r*4);actorDepth.fill(-100,l,r);actorIds.fill(0,l,r);
    }
    for(const {type,id,name,variant,pose} of sceneFigures(lead)){
      const foot=project(v,pose.x,.013,pose.z),chest=project(v,pose.x,type==="beetle"?.21:.40,pose.z);
      placeTarget({id,name,pose},chest);
      if(foot.x< -v.k || foot.x>v.w+v.k || foot.y< -v.k*.5 || foot.y>v.h+v.k*1.4)continue;
      const k=v.k*scale*figureScale,cx=foot.x*scale,cy=foot.y*scale;
      const x0=Math.max(0,Math.floor(cx-k*.76-2)),x1=Math.min(width,Math.ceil(cx+k*.76+2));
      const y0=Math.max(0,Math.floor(cy-k*.92-2)),y1=Math.min(height,Math.ceil(cy+k*.44+2));
      if(x0>=x1 || y0>=y1)continue;
      rects.push([x0,y0,x1,y1]);
      const footZ=pose.x*v.eye[0]+.013*v.eye[1]+pose.z*v.eye[2];
      const shadowW=Math.max(2,k*.22),shadowH=Math.max(1,shadowW*v.se);
      for (let y=Math.max(0,Math.floor(cy-shadowH));y<Math.min(height,cy+shadowH);y++) {
        for(let x=Math.max(0,Math.floor(cx-shadowW));x<Math.min(width,cx+shadowW);x++) {
          const d=((x-cx)/shadowW)**2+((y-cy)/shadowH)**2;if(d>=1)continue;
          const j=y*width+x;if(actorIds[j] || renderer.depthAt(x/scale,y/scale)>footZ+.28)continue;
          const off=j*4;data[off]=38;data[off+1]=26;data[off+2]=36;data[off+3]=Math.max(data[off+3],100*(1-d));
        }
      }
      const mesh=posedMesh(type,pose.act,pose.beat,variant),c=Math.cos(pose.yaw),s=Math.sin(pose.yaw);
      const local=axis=>[c*axis[0]-s*axis[2],axis[1],s*axis[0]+c*axis[2]];
      eachTriangle(mesh,width,height,k,cx,cy,local(v.right),local(v.up),local(v.eye),(j,start,u,f,z)=>{
        const depth=footZ+z*figureScale;
        if(depth<=actorDepth[j] || depth+.030<renderer.depthAt((j%width+.5)/scale,(Math.floor(j/width)+.5)/scale))return;
        actorDepth[j]=depth;actorIds[j]=id;
        const k1=start+VERTEX,k2=k1+VERTEX;
        for(let n=0;n<3;n++){
          const value=mesh[start+3+n],color=value+(mesh[k1+3+n]-value)*u+(mesh[k2+3+n]-value)*f;
          data[j*4+n]=(color+(id===hoverId?.065:0))*255;
        }
        data[j*4+3]=255;
      });
    }
    for(const [x0,y0,x1,y1] of [...oldRects,...rects])crewInk.putImageData(actorImage,0,0,x0,y0,x1-x0,y1-y0);
    oldRects=rects;
  }
  return {paint,pick:workerAt};
}
