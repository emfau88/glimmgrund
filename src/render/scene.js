import { CaveMesh, M, UP, barrel, cottage, crystal, crystalPocket, fern, garden, harvestBasket, lantern, mushroom, noise, portal, postLamp, rock, rockBank, slab, tone, watch, workshop } from "./models.js";
import { FIELD, FIELD_W, cellId, deposit, directions, floorAt, frontier, homeSpots, keyOf, parseKey, state } from "../simulation/colony.js";

function distanceToTunnels() {
  const side=FIELD_W, distances=new Uint8Array(side*side).fill(255), queue=[];
  for(let r=-FIELD;r<=FIELD;r++) for(let q=-FIELD;q<=FIELD;q++) {
    if(floorAt(q,r)){const index=cellId(q,r)-1;distances[index]=0;queue.push([q,r]);}
  }
  for(let i=0;i<queue.length;i++) {
    const [q,r]=queue[i],next=distances[cellId(q,r)-1]+1;
    for(const [x,z] of directions) {
      const u=q+x,v=r+z,k=cellId(u,v)-1;
      if(Math.abs(u)<=FIELD && Math.abs(v)<=FIELD && distances[k]>next){distances[k]=next;queue.push([u,v]);}
    }
  }
  return (q,r)=>(Math.abs(q)>FIELD || Math.abs(r)>FIELD)?7:distances[cellId(q,r)-1];
}
function sceneLights() {
  // Position, squared radius, then warm or cool bounce-light contributions.
  const lights=[[-.42,.82,.59,6.6,.47,.23,.055],[-2.1,.7,1.77,3.8,.26,.055,.22],
    [1.73,1.05,-2.16,6.5,.20,.085,.55],[2.25,.78,1.78,4.2,.46,.21,.04],
    [-1.17,.54,2.77,3.2,.26,.13,.033],[2.93,.60,-.81,2.7,.28,.14,.035]];
  for(const [key,kind] of Object.entries(state.tiles)) {
    if(kind==="floor") continue;
    const [q,r]=parseKey(key);
    lights.push(kind==="grotto"?[q,.6,r,2.6,.14,.06,.36]:[q,.5,r+.22,2.0,.22,.11,.025]);
  }
  return lights;
}
function caveScene() {
  const b=new CaveMesh(sceneLights()),dist=distanceToTunnels(),edge=frontier(),heightById=new Map();
  const cornerHeight=(u,v)=>{
    const near=Math.min(dist(u,v),dist(u-1,v),dist(u,v-1),dist(u-1,v-1));
    return .34+.27*noise(u,v,31)+Math.min(near,4)*.13+.16*(.5+.5*Math.sin(u*1.1+v*.63));
  };
  for(let r=-FIELD;r<=FIELD;r++) for(let q=-FIELD;q<=FIELD;q++) {
    const key=keyOf(q,r), id=cellId(q,r),salt=(q+17)*29+r+18;
    b.owner=id;
    const l=q-.5,k=r-.5;
    if (floorAt(q,r)) {
      const m=tone(M.floor,.91+.11*noise(q,r,6));
      b.face([[l,0,k],[l,0,k+1],[l+1,0,k+1],[l+1,0,k]],m,UP);
      heightById.set(id,.018);
      continue;
    }
    const distance=dist(q,r), rand=noise(q,r,44);
    const tint=Math.max(.30,1.0-.157*distance)*(.88+.17*rand);
    const stone=tone(M.slate,tint);
    const corners=[[l,cornerHeight(q,r),k],[l,cornerHeight(q,r+1),k+1],
      [l+1,cornerHeight(q+1,r+1),k+1],[l+1,cornerHeight(q+1,r),k]];
    const top=corners.reduce((sum,p)=>sum+p[1],0)*.25+.04+rand*.13;
    const center=[q+(noise(q,r,12)-.5)*.24,top,r+(rand-.5)*.22];
    heightById.set(id,top);
    const adj=[[-1,0],[0,1],[1,0],[0,-1]];
    for(let j=0;j<4;j++) {
      const a=corners[j],c=corners[(j+1)%4];
      b.face([a,c,center],tone(stone,.955+.08*noise(q,r,j)),UP);
      const [dx,dz]=adj[j],u=q+dx,v=r+dz;
      if(!floorAt(u,v) && Math.abs(u)<=FIELD && Math.abs(v)<=FIELD) continue;
      const beyond=Math.abs(u)>FIELD || Math.abs(v)>FIELD;
      const foot=(p)=>[p[0],beyond?-1.1:-.035,p[2]],edgePoint=(p,ratio,offset)=>[p[0]+dx*offset,p[1]*ratio,p[2]+dz*offset];
      const layers=[[foot(a),foot(c)],[edgePoint(a,.37,.025),edgePoint(c,.37,.025)],
        [edgePoint(a,.43,.045),edgePoint(c,.43,.045)],[edgePoint(a,.9,.026),edgePoint(c,.9,.026)],[a,c]];
      for(let band=0;band<layers.length-1;band++) {
        const [a0,c0]=layers[band],[a1,c1]=layers[band+1];
        b.face([a0,c0,c1,a1],tone(M.slate,tint*[.79,1.14,.91,1.07][band]),[dx,.2,dz]);
      }
    }
    if(edge.has(key)) {
      const seam=deposit(q,r);
      if(seam==="sporerock") {
        for(const [x,z,s] of [[-.19,.06,.70],[.08,.12,.88],[.22,-.12,.54]]) mushroom(b,q+x,top-.035,r+z,s,M.spores,salt+2);
      } else if(seam==="motherlode") {
        for(const [x,z,h] of [[-.22,.07,.29],[.04,0,.38],[.20,-.11,.22]]) crystal(b,q+x,top-.05,r+z,h,.107,x*.24,salt,M.gold);
      } else if(seam==="mossrock") {
        mushroom(b,q-.12,top-.05,r+.05,.69,M.cap,salt);
        mushroom(b,q+.10,top-.055,r+.15,.48,M.lilac,salt+1);
      } else if(seam==="crystalrock") {
        for(let j=0;j<3;j++) crystal(b,q-.12+j*.12,top-.055,r+.08,.13+.14*noise(q,r,j),.047,(j-1)*.056,j,M.crystal);
      } else {
        // Small mineral seams sit in the rock itself. The whole face can be tapped.
        for(let j=0;j<(seam==="goldrock"?4:2);j++) {
          const u=q-.24+j*.14,v=r+.09*Math.sin(j+salt);
          rock(b,u,top-.063,v,.11,.106+.035*noise(q,r,j),.058,salt+j,seam==="goldrock"?M.gold:M.trim);
        }
      }
    } else if (rand>.78 && distance<=4) {
      rock(b,q-.09,top-.07,r+.04,.29,.12+rand*.18,.21,salt,stone);
      if(rand>.91) fern(b,q+.12,top-.025,r+.1,.82,salt);
    } else if (rand<.09 && distance<4) {
      crystal(b,q+.12,top-.035,r,.21,.06,-.035,salt,tone(M.crystal,.65));
    }
  }
  function home(type,x,z,angle,size,draw) {
    b.owner=homeSpots[type].id; b.at(x,.008,z,angle,size,draw);
  }
  home("heart",-.48,-.64,.075,2.18,()=>cottage(b,true));
  home("farm",-2.10,1.76,-.07,1.95,()=>{
    slab(b,0,0,0,1.11,.075,1.09,M.slate,.095);
    b.at(0,.067,0,0,1,()=>garden(b));
  });
  home("mine",1.82,-2.08,-.14,1.80,()=>{
    slab(b,0,0,-.05,1.27,.14,1.06,M.slate,.15);
    slab(b,0,.128,-.05,1.20,.036,.99,M.floor,.14);
    for(let i=0;i<3;i++)slab(b,.10,0,.50+i*.079,.43,.134-i*.039,.118,M.trim,.02);
    b.at(0,.154,0,0,1,()=>crystalPocket(b));
  });
  home("shop",2.16,1.24,.14,1.59,()=>workshop(b));
  // The seams of the starter rooms and of later tunnels share the same ground.
  b.owner=homeSpots.mine.id;
  for(let i=0;i<4;i++) rockBank(b,.68+i*.66,-3.04,.55,.44,.69+noise(i,5)*.46,i+5);
  rockBank(b,2.88,-2.67,.66,.72,1.13,22);
  rockBank(b,3.10,-1.81,.47,.68,.78,15);
  fern(b,2.59,.01,-2.36,.98,9);
  b.owner=homeSpots.farm.id;fern(b,-2.83,.012,2.53,1.05,2);
  harvestBasket(b,-.10,2.59,1.15);
  rockBank(b,-3.06,2.94,.76,.53,.66,21);rockBank(b,-3.11,.69,.49,.56,.67,31);
  rockBank(b,-1.84,3.10,.65,.41,.42,14);
  b.at(-2.87,.065,.51,0,1,()=>mushroom(b,0,0,0,.81,M.lilac,2));
  b.owner=homeSpots.shop.id;
  barrel(b,2.91,.008,.37,1.30);barrel(b,2.67,.008,.24,1.15);
  postLamp(b,2.9,-.85,-.68);rockBank(b,3.12,2.91,.73,.60,.67,10);rockBank(b,3.17,.29,.45,.78,.62,8);
  b.owner=homeSpots.heart.id;
  postLamp(b,-1.23,2.81,.32);postLamp(b,-2.89,-1.46,1.6);
  fern(b,-1.74,.01,-1.50,.84,3);
  for(const [x,z,rx,rz,h,seed] of [[-2.90,-2.91,.80,.71,1.15,3],[-1.88,-3.10,.74,.54,.88,7],[-.82,-3.04,.67,.43,.62,11],[-3.14,-1.95,.49,.72,.84,12]])
    rockBank(b,x,z,rx,rz,h,seed);
  for(const [key,x,z,angle] of [["1,4",1,3.44,0],["4,-2",3.42,-2,Math.PI/2],["-4,1",-3.43,1,Math.PI/2]]) {
    b.owner=cellId(...parseKey(key));b.at(x,0,z,angle,1,()=>portal(b));
  }
  for(const [key,room] of Object.entries(state.tiles)) {
    const [q,r]=parseKey(key);b.owner=cellId(q,r);
    if(room==="floor") {
      const n=directions.find(([dx,dz])=>!floorAt(q+dx,r+dz));
      if(n && (q+r+21)%3===0) {
        const [dx,dz]=n;b.at(q+dx*.44,.004,r+dz*.44,Math.atan2(dx,dz),.76,()=>lantern(b,0,.015,0,1));
      }
      continue;
    }
    heightById.set(b.owner,room==="farm"?.30:.49);
    b.at(q,.008,r,0,.81,()=>{
      if(room==="farm") garden(b);
      if(room==="bed") cottage(b);
      if(room==="ward") watch(b);
      if(room==="grotto") crystalPocket(b,true);
      if(room==="spores") {
        slab(b,0,0,0,.94,.055,.92,M.moss,.12);
        for(const [x,z,s] of [[-.22,-.18,1.1],[.04,.12,1.52],[.26,-.1,.81],[-.25,.25,.58]]) mushroom(b,x,.05,z,s,M.spores,3);
        fern(b,.23,.05,.22,.71,8);
      }
    });
    if(room==="farm") harvestBasket(b,q+.43,r+.23,.55);
  }
  const scene=b.finish();
  scene.heights=heightById;
  return scene;
}

export { caveScene };
