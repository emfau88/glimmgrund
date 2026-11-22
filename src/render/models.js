// The world uses one unit per diggable cell, with Y pointing up.
const TAU = Math.PI * 2;
const VERTEX = 11;
const UP = [0,1,0];
const clamp = (x,lo,hi) => Math.max(lo,Math.min(hi,x));
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const minus = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function unit(a) {
  const length = Math.hypot(...a) || 1;
  return a.map(x => x/length);
}
const sunDir = unit([-.53,.92,.57]);
function noise(x,z,seed=0) {
  let h = Math.imul(x+391,1597334677) ^ Math.imul(z+257,3812015801) ^ Math.imul(seed+31,2246822507);
  h = Math.imul(h ^ h>>>16,2246822507);
  return ((h ^ h>>>13)>>>0)/4294967296;
}
function paint(hex, texture=-1, repeat=1, glow=0) {
  return {rgb:[(hex>>16)/255,((hex>>8)&255)/255,(hex&255)/255], texture, repeat, glow};
}
function tone(material, amount) {
  return {...material,rgb:material.rgb.map(v=>v*amount)};
}
const M = {
  roof:paint(0x337c76,0,1), ridge:paint(0x96673f,2,1.15), timber:paint(0x805336,2,1.7),
  oak:paint(0xb5804c,2,1.65), bark:paint(0x573925,2,2), masonry:paint(0xb79471,1,1.05),
  trim:paint(0xc5a789,1,1.45), floor:paint(0xa68b73,3,.87), soil:paint(0x594a35,5,1.1),
  moss:paint(0x477263,5,1.4), slate:paint(0x656179,4,.78), edge:paint(0x494553,4,.8),
  copper:paint(0xa96a47,7,1.3), brass:paint(0xc49b62), iron:paint(0x596068),
  deep:paint(0x322c34), darkwood:paint(0x59412e,2,1.8), window:paint(0xffbb4e,-1,1,.9),
  flame:paint(0xffe6a3,-1,1,1), gold:paint(0xe4ae51,-1,1,.13),
  crystal:paint(0x9f72d3,8,2.1,.19), crystalLight:paint(0xca9deb,8,2.1,.24),
  cap:paint(0xae577c,6,2.6), lilac:paint(0x9775b6,6,2.6), coral:paint(0xb76c54,6,2.6), gills:paint(0xdcbfa3,-1,1,.09),
  stem:paint(0xd5bca3), spots:paint(0xf1d3b1), sage:paint(0x85a386), fern:paint(0x4c8270),
  skin:paint(0x95a263), leather:paint(0x916138,2,2.4), cloth:paint(0x537a6b),
  eye:paint(0x33262b), blush:paint(0xca947b), golem:paint(0x788783,4,1.7),
  shell:paint(0x439c87,-1,1,.13), wing:paint(0x70b99b,-1,1,.14), scarf:paint(0xf4af62), linen:paint(0xf1dfae),
  spores:paint(0x94e4b7,-1,1,.61)
};
class CaveMesh {
  constructor(lights) {
    this.lightBins=new Map();
    for(const light of lights) {
      const radius=Math.sqrt(light[3]);
      for(let x=Math.floor((light[0]-radius)/2);x<=Math.floor((light[0]+radius)/2);x++) {
        for(let z=Math.floor((light[2]-radius)/2);z<=Math.floor((light[2]+radius)/2);z++) {
          const key=x*64+z;
          if(!this.lightBins.has(key)) this.lightBins.set(key,[]);
          this.lightBins.get(key).push(light);
        }
      }
    }
    this.emptyLights=[];
    this.blocks=[];
    this.block=new Float32Array(VERTEX*3*2048);
    this.used=0;
    this.pose={x:0,y:0,z:0,c:1,s:0,k:1};
    this.owner=0;
    this.glows=[];
  }
  point(x,y,z) {
    const p=this.pose;
    return [p.x+(p.c*x+p.s*z)*p.k,p.y+y*p.k,p.z+(-p.s*x+p.c*z)*p.k];
  }
  at(x,y,z,angle,size,draw) {
    const old=this.pose, center=this.point(x,y,z), c=Math.cos(angle), s=Math.sin(angle);
    this.pose={x:center[0],y:center[1],z:center[2],c:old.c*c-old.s*s,s:old.s*c+old.c*s,k:old.k*size};
    draw();
    this.pose=old;
  }
  glow(x,y,z,r,color,smoke=false) {
    this.glows.push({p:this.point(x,y,z),r:r*this.pose.k,color,smoke});
  }
  face(points,mat,outward,tex,normals) {
    let n=unit(cross(minus(points[1],points[0]),minus(points[2],points[0])));
    if (outward && dot(n,outward)<0) n=n.map(v=>-v);
    const pose=this.pose;
    const values=[];
    for (let i=0;i<points.length;i++) {
      const p=points[i],world=this.point(...p),vn=normals?normals[i]:n;
      const normal=[pose.c*vn[0]+pose.s*vn[2],vn[1],-pose.s*vn[0]+pose.c*vn[2]];
      const sun=Math.max(0,dot(normal,sunDir)),ambient=.495+.18*Math.max(-.37,normal[1]),warm=sun*.46;
      const shade=(1-mat.glow)*clamp((sun-.05)*.52,0,.44);
      let red=ambient+warm,green=ambient*1.025+warm*.94,blue=ambient*1.15+warm*.83;
      const lights=this.lightBins.get(Math.floor(world[0]/2)*64+Math.floor(world[2]/2)) || this.emptyLights;
      for (const light of lights) {
        const dx=light[0]-world[0],dy=light[1]-world[1],dz=light[2]-world[2];
        const falloff=1-(dx*dx+dy*dy+dz*dz)/light[3];
        if (falloff<=0) continue;
        const power=falloff*falloff*.83;
        red+=light[4]*power; green+=light[5]*power;blue+=light[6]*power;
      }
      const mix=v=>v+(1.08-v)*mat.glow;
      let u,v;
      if (tex) [u,v]=tex[i];
      else if (Math.abs(n[1])>.68) {u=p[0];v=p[2];}
      else {u=Math.abs(n[0])>Math.abs(n[2])?p[2]:p[0];v=-p[1];}
      if(mat.texture===4) {
        u+=.35*Math.sin(v*.71)+.24*Math.sin(u*1.14);
        v+=.31*Math.sin(u*.87)+.09*Math.sin(v*1.71);
      }
      values.push([...world,mat.rgb[0]*mix(red),mat.rgb[1]*mix(green),mat.rgb[2]*mix(blue),
        u*mat.repeat,v*mat.repeat,mat.texture,shade,this.owner]);
    }
    for (let i=1;i<values.length-1;i++) {
      if(this.used===this.block.length){
        this.blocks.push(this.block);this.block=new Float32Array(this.block.length);this.used=0;
      }
      this.block.set(values[0],this.used);this.block.set(values[i],this.used+VERTEX);
      this.block.set(values[i+1],this.used+2*VERTEX);this.used+=3*VERTEX;
    }
  }
  finish() {
    const vertices=new Float32Array(this.blocks.length*this.block.length+this.used);
    let offset=0;
    for(const block of this.blocks){vertices.set(block,offset);offset+=block.length;}
    vertices.set(this.block.subarray(0,this.used),offset);
    return {vertices,glows:this.glows};
  }
}
function box(b,x,y,z,w,h,d,m) {
  const l=x-w/2,r=x+w/2,f=z+d/2,k=z-d/2,t=y+h;
  b.face([[l,t,k],[l,t,f],[r,t,f],[r,t,k]],m,UP);
  b.face([[l,y,f],[r,y,f],[r,t,f],[l,t,f]],m,[0,0,1]);
  b.face([[r,y,k],[l,y,k],[l,t,k],[r,t,k]],m,[0,0,-1]);
  b.face([[r,y,f],[r,y,k],[r,t,k],[r,t,f]],m,[1,0,0]);
  b.face([[l,y,k],[l,y,f],[l,t,f],[l,t,k]],m,[-1,0,0]);
  b.face([[l,y,k],[r,y,k],[r,y,f],[l,y,f]],m,[0,-1,0]);
}
function rim(b,lower,upper,mat,nlo,nhi) {
  const mid=lower.reduce((p,v)=>[p[0]+v[0]/lower.length,p[1]+v[1]/lower.length,p[2]+v[2]/lower.length],[0,0,0]);
  for(let i=0;i<lower.length;i++) {
    const j=(i+1)%lower.length;
    b.face([lower[i],lower[j],upper[j],upper[i]],mat,[lower[i][0]+lower[j][0]-2*mid[0],0,lower[i][2]+lower[j][2]-2*mid[2]],
      null,nlo?[nlo[i],nlo[j],nhi[j],nhi[i]]:null);
  }
}
function slab(b,x,y,z,w,h,d,mat,bevel=.045) {
  const a=w/2,k=d/2,e=Math.min(bevel,a*.4,k*.4);
  const lo=[[-a+e,-k],[a-e,-k],[a,-k+e],[a,k-e],[a-e,k],[-a+e,k],[-a,k-e],[-a,-k+e]];
  const ring=(height,scale)=>lo.map(([u,v])=>[x+u*scale,height,z+v*scale]);
  const foot=ring(y,.97),sides=ring(y+h*.76,1),top=ring(y+h,.965);
  rim(b,foot,sides,mat);rim(b,sides,top,tone(mat,1.06));b.face(top,mat,UP);
}
function turned(b,x,y,z,profile,mat,segments=8,stretch=1) {
  let prev=null,prevNormals=null;
  const smooth=[M.gills,M.stem,M.skin,M.cloth,M.leather].includes(mat);
  for(let k=0;k<profile.length;k++) {
    const [dy,r,m=mat]=profile[k];
    const ring=Array.from({length:segments},(_,i)=>[x+Math.cos(i*TAU/segments)*r,y+dy,z+Math.sin(i*TAU/segments)*r*stretch]);
    const lo=profile[Math.max(0,k-1)],hi=profile[Math.min(profile.length-1,k+1)],rise=hi[0]-lo[0];
    const normals=smooth?ring.map((_,i)=>unit([Math.cos(i*TAU/segments)*rise,lo[1]-hi[1],Math.sin(i*TAU/segments)*rise/stretch])):null;
    if (prev) rim(b,prev,ring,m,prevNormals,normals);
    prev=ring;prevNormals=normals;
  }
  if (profile.at(-1)[1]>.002) b.face(prev,profile.at(-1)[2] || mat,UP);
}
function beam(b,p,q,width,mat,depth=width) {
  const direction=unit(minus(q,p));
  const a=unit(cross(direction,Math.abs(direction[1])>.94?[0,0,1]:UP)).map(v=>v*width/2);
  const c=unit(cross(direction,a)).map(v=>v*depth/2);
  const ends=v=>[[1,1],[-1,1],[-1,-1],[1,-1]].map(([i,j])=>v.map((n,k)=>n+i*a[k]+j*c[k]));
  const p0=ends(p),p1=ends(q);
  for(let i=0;i<4;i++) {
    const j=(i+1)%4;
    b.face([p0[i],p0[j],p1[j],p1[i]],mat,p0[i].map((v,k)=>(v+p0[j][k])/2-p[k]));
  }
  b.face(p1,mat,direction);b.face(p0,mat,direction.map(v=>-v));
}
function rock(b,x,y,z,rx,h,rz,seed,mat=M.slate) {
  const count=7,angle=noise(seed,6)*TAU;
  const points=Array.from({length:count},(_,i)=>{
    const a=angle+i*TAU/count+(noise(seed,i,3)-.5)*.24;
    const radius=.82+noise(seed,i,2)*.24;
    return [Math.cos(a)*rx*radius,Math.sin(a)*rz*radius];
  });
  const rings=[0,.57,.86].map((level,k)=>points.map(([u,v],i)=>{
    const rad=[.9,1,.65][k]*(.93+noise(seed,i,k+6)*.12);
    return [x+u*rad+(k===2?.06*rx:0),y+h*(level+(k?noise(seed,i,k+13)*.11:0)),z+v*rad];
  }));
  rim(b,rings[0],rings[1],tone(mat,.92));rim(b,rings[1],rings[2],mat);
  for(let i=0;i<count;i++) b.face([rings[2][i],rings[2][(i+1)%count],[x+rx*.11,y+h,z-rz*.1]],tone(mat,.95+.11*noise(seed,i,18)),UP);
}
function crystal(b,x,y,z,h,r,lean,angle,mat=M.crystal) {
  const n=5,ring=(dy,k)=>Array.from({length:n},(_,i)=>{
    const a=angle+i*TAU/n;return [x+lean*dy+Math.cos(a)*r*k,y+h*dy,z+Math.sin(a)*r*k];
  });
  const low=ring(0,.67),wide=ring(.24,1),neck=ring(.72,.91),tip=[x+lean,y+h,z-r*.13];
  rim(b,low,wide,tone(mat,.74));
  for(let i=0;i<n;i++) {
    const j=(i+1)%n,face=[wide[i],wide[j],neck[j],neck[i]],a=wide[i];
    b.face(face,tone(mat,.72+.21*(i%3)),[a[0]-x,0,a[2]-z]);
    if(i%2===0) {
      const line=(p,q,t)=>p.map((v,k)=>v+(q[k]-v)*t);
      const c0=line(wide[i],wide[j],.075),c1=line(neck[i],neck[j],.026);
      const shift=p=>[p[0]+(p[0]-x)*.012,p[1],p[2]+(p[2]-z)*.012];
      b.face([shift(wide[i]),shift(c0),shift(c1),shift(neck[i])],M.crystalLight,[a[0]-x,0,a[2]-z]);
    }
  }
  for(let i=0;i<n;i++) b.face([neck[i],neck[(i+1)%n],tip],tone(mat,1.04+.06*(i%2)),[neck[i][0]-x,h*.25,neck[i][2]-z]);
}

function lantern(b,x,y,z,size=1) {
  b.at(x,y,z,0,size,()=>{
    turned(b,0,0,0,[[0,.054],[.023,.072],[.041,.057]],M.brass,8);
    turned(b,0,.033,0,[[0,.049],[.09,.061],[.154,.047]],M.window,8);
    turned(b,0,.18,0,[[0,.069],[.026,.061],[.052,.028],[.07,.02]],M.brass,8);
    for (const [a,c] of [[-.042,-.035],[.042,-.035],[-.042,.035],[.042,.035]])
      beam(b,[a,.035,c],[a,.18,c],.01,M.darkwood);
    b.glow(0,.12,0,.17,"amber");
  });
}
function postLamp(b,x,z,angle=0) {
  b.at(x,0,z,angle,1,()=>{
    slab(b,0,0,0,.2,.11,.21,M.slate);
    beam(b,[0,.06,0],[.012,.73,0],.065,M.timber);
    beam(b,[-.055,.72,0],[.23,.72,0],.055,M.oak);
    beam(b,[0,.52,0],[.16,.71,0],.038,M.timber);
    beam(b,[.2,.72,0],[.2,.63,0],.016,M.iron);
    lantern(b,.2,.396,0,1.05);
  });
}
function barrel(b,x,y,z,s=1) {
  b.at(x,y,z,0,s,()=>{
    turned(b,0,0,0,[[0,.10],[.035,.112],[.13,.124],[.23,.113],[.26,.105]],M.oak,10);
    for(const [h,r] of [[.031,.115],[.197,.12]]) turned(b,0,h,0,[[0,r],[.023,r]],M.iron,10);
    turned(b,0,.258,0,[[0,.105],[.009,.105]],M.darkwood,10);
  });
}
function fern(b,x,y,z,s,seed=1) {
  for(let i=0;i<6;i++) {
    const a=i*TAU/6+seed,h=(.15+.09*noise(i,seed))*s;
    const length=(.16+.1*noise(seed,i))*s,d=[Math.cos(a),Math.sin(a)],w=.045*s;
    const mid=[x+d[0]*length*.54,y+h,z+d[1]*length*.54];
    const a1=[mid[0]-d[1]*w,mid[1]-.02*s,mid[2]+d[0]*w],a2=[mid[0]+d[1]*w,mid[1]-.02*s,mid[2]-d[0]*w];
    const tip=[x+d[0]*length,y+h*.68,z+d[1]*length];
    b.face([[x,y,z],a1,mid],M.fern,UP);b.face([a1,tip,mid],M.fern,UP);
    b.face([[x,y,z],mid,a2],M.sage,UP);b.face([mid,tip,a2],M.sage,UP);
  }
}
function mushroom(b,x,y,z,s,mat,seed=0) {
  b.at(x,y,z,seed,s,()=>{
    turned(b,0,0,0,[[0,.078],[.075,.069],[.20,.045],[.29,.061]],M.stem,9);
    turned(b,0,.235,0,[[0,.062],[.008,.158],[.03,.22],[.056,.228,mat],[.106,.198,mat],[.175,.114,mat],[.197,.026,mat]],M.gills,12,.94);
    for(let i=0;i<7;i++) {
      const a=i*2.39+seed,r=.047+.12*noise(i,seed,18);
      const slope=r<.114?.25:.82,h=(r<.114?.432-(r-.026)*.25:.410-(r-.114)*.82)+.005;
      const cx=Math.cos(a)*r,cz=Math.sin(a)*r*.94,spot=.012+.012*noise(i,seed,8);
      const points=Array.from({length:6},(_,j)=>{
        const dx=Math.cos(j*TAU/6)*spot,dz=Math.sin(j*TAU/6)*spot*.82;
        return [cx+dx,h-(dx*Math.cos(a)+dz*Math.sin(a))*slope,cz+dz];
      });
      b.face(points,M.spots,UP);
    }
  });
}
function garden(b) {
  slab(b,0,.005,0,.9,.09,.9,M.bark,.085);
  slab(b,0,.08,0,.86,.04,.86,M.soil,.085);
  for(const z of [-.434,.434]) {
    for(const x of [-.408,0,.408]) {
      box(b,x,.02,z,.045,.245,.046,M.oak);
      turned(b,x,.255,z,[[0,.031],[.028,.002]],M.ridge,4);
    }
    box(b,0,.14,z,.84,.042,.034,M.timber);
  }
  for(const x of [-.432,.432]) box(b,x,.13,0,.034,.04,.82,M.timber);
  const groups=[[-.18,-.16,1.27,M.lilac],[.17,-.23,.94,M.cap],[-.28,.19,.63,M.coral],
    [.15,.10,.9,M.cap],[.31,.27,.54,M.lilac],[-.05,.29,.51,M.lilac],[.31,-.02,.52,M.coral]];
  groups.forEach(([x,z,s,m],i)=>mushroom(b,x,.12,z,s,m,i+1));
  fern(b,-.32,.1,-.28,.49);fern(b,.03,.1,.18,.43,3);
}
function harvestBasket(b,x,z,size) {
  b.at(x,.012,z,0,size,()=>{
    turned(b,0,0,0,[[0,.12],[.03,.15],[.16,.19],[.18,.19],[.18,.16]],M.oak,10,.78);
    turned(b,0,.052,0,[[0,.16],[.021,.17]],M.timber,10,.78);
    mushroom(b,-.067,.095,0,.32,M.cap,1);
    mushroom(b,.06,.10,.018,.25,M.coral,2);
  });
}
function archPanel(b,x,y,z,width,height,mat) {
  const r=width*.5,cy=y+height-r;
  const contour=[[x-r,y,z],[x+r,y,z],[x+r,cy,z]];
  for(let i=1;i<=10;i++) {const a=i*Math.PI/10;contour.push([x+r*Math.cos(a),cy+r*Math.sin(a),z]);}
  b.face(contour,mat,[0,0,1]);
}
function archFrame(b,x,y,z,w,h,band,mat) {
  const r=w*.5,cy=y+h-r,depth=.038;
  box(b,x-r-band/2,y,z,band,cy-y,depth,mat);
  box(b,x+r+band/2,y,z,band,cy-y,depth,mat);
  for(let i=0;i<9;i++) {
    const a=i*Math.PI/9+.008,c=(i+1)*Math.PI/9-.008;
    const point=(angle,rad,d)=>[x+Math.cos(angle)*rad,cy+Math.sin(angle)*rad,z+d];
    const ring=[point(a,r,depth/2),point(a,r+band,depth/2),point(c,r+band,depth/2),point(c,r,depth/2)];
    const m=tone(mat,.94+.08*(i%3)/2);
    b.face(ring,m,[0,0,1]);
    b.face([ring[1],point(a,r+band,-depth/2),point(c,r+band,-depth/2),ring[2]],m,[Math.cos((a+c)/2),Math.sin((a+c)/2),0]);
  }
}
function windowArch(b,x,y,z,w,h) {
  archPanel(b,x,y,z,w+.055,h+.035,M.bark); archPanel(b,x,y+.015,z+.008,w,h-.015,M.window);
  archFrame(b,x,y,z+.016,w,h,.018,M.oak);
  box(b,x,y+.012,z+.025,.014,h-.014,.012,M.darkwood);
  box(b,x,y+h*.5,z+.025,w*.96,.016,.018,M.darkwood);
  box(b,x,y-.016,z+.014,w+.074,.026,.072,M.oak);
}
function shingledRoof(b,w,d,eave,rise,roofMat=M.roof) {
  const half=w*.53,depth=d*.59,rows=4,columns=5;
  const cy=f=>eave+rise*(1-Math.pow(f,.79));
  // The overlapping courses and their lower lips remain visible in profile.
  for(const sign of [-1,1]) {
    b.face([[0,cy(0)-.025,-depth],[sign*half,cy(1)-.023,-depth],[sign*half,cy(1)-.023,depth],[0,cy(0)-.025,depth]],M.darkwood,[0,-1,0]);
    for(let row=0;row<rows;row++) {
      const a=row/rows,k=Math.min(1.038,(row+1)/rows+.035);
      const edge=row%2?.5:0;
      for(let j=-1;j<columns;j++) {
        const lo=Math.max(0,(j+edge)/columns),hi=Math.min(1,(j+1+edge)/columns);
        if (hi-lo<.005) continue;
        const l=depth*(2*lo-1)+.002,r=depth*(2*hi-1)-.002;
        const xa=sign*half*a,xb=sign*half*k,ya=cy(a)+.008,yb=cy(k)+.012;
        const curl=.009,lip=.014;
        const top=[[xa,ya,l],[xb-sign*curl,yb+curl,l],[xb,yb,(l+r)*.5],[xb-sign*curl,yb+curl,r],[xa,ya,r]];
        const tint=.90+.18*noise(j+10,row,sign+4);
        b.face(top,tone(roofMat,tint),[sign*.5,1,0],top.map(p=>[p[2]/(2*depth)+.5,Math.abs(p[0])/half]));
        b.face([top[1],top[2],top[3],[top[3][0],top[3][1]-lip,r],[xb,yb-lip,(l+r)*.5],[top[1][0],top[1][1]-lip,l]],tone(roofMat,.72),[sign,.3,0]);
      }
    }
    for(const z of [-depth,depth]) {
      for(let i=0;i<3;i++) beam(b,[sign*half*i/3,cy(i/3)-.015,z],[sign*half*(i+1)/3,cy((i+1)/3)-.015,z],.045,M.ridge);
    }
    beam(b,[sign*half,eave-.024,-depth],[sign*half,eave-.024,depth],.049,M.ridge);
  }
  beam(b,[0,eave+rise+.014,-depth-.022],[0,eave+rise+.014,depth+.022],.055,M.ridge);
}
function cottage(b,main=false) {
  slab(b,0,.005,0,.90,.10,.81,M.slate);
  slab(b,0,.1,0,.84,.40,.74,M.masonry,.033);
  for(const x of [-.398,.398]) for(const z of [-.345,.345]) box(b,x,.1,z,.055,.44,.055,M.timber);
  for(const z of [-.377,.377]) {
    box(b,0,.427,z,.85,.063,.046,M.timber);
    b.face([[-.423,.49,z],[.423,.49,z],[0,.855,z]],M.oak,[0,0,Math.sign(z)]);
    beam(b,[-.40,.483,z],[0,.825,z],.044,M.bark);
    beam(b,[.40,.483,z],[0,.825,z],.044,M.bark);
  }
  const doorZ=.395;
  archPanel(b,0,.078,doorZ,.30,.335,M.darkwood);
  archPanel(b,0,.078,doorZ+.005,.243,.294,M.oak);
  archFrame(b,0,.071,doorZ+.018,.283,.316,.044,M.trim);
  for(const x of [-.065,-.021,.025,.069]) box(b,x,.082,doorZ+.013,.006,.22,.006,M.darkwood);
  box(b,.001,.192,doorZ+.022,.225,.019,.016,M.iron);
  box(b,.075,.209,doorZ+.033,.026,.031,.023,M.brass);
  archPanel(b,0,.235,doorZ+.02,.128,.099,M.window);
  box(b,0,.237,doorZ+.026,.011,.094,.009,M.darkwood);
  box(b,0,.262,doorZ+.028,.123,.012,.008,M.darkwood);
  windowArch(b,0,.54,.39,.188,.19);
  b.at(.425,0,0,Math.PI/2,1,()=>{windowArch(b,-.16,.207,0,.16,.17);windowArch(b,.154,.207,0,.16,.17);});
  b.at(-.425,0,0,-Math.PI/2,1,()=>windowArch(b,0,.205,0,.2,.18));
  b.at(0,0,-.38,Math.PI,1,()=>windowArch(b,0,.25,0,.19,.16));
  shingledRoof(b,1.02,.86,.49,.39);
  slab(b,-.245,.634,-.185,.14,.40,.16,M.masonry,.016);
  slab(b,-.245,1.011,-.185,.179,.055,.195,M.copper,.02);
  box(b,-.245,1.063,-.185,.105,.004,.119,M.deep);
  b.glow(-.245,1.08,-.185,.25,"smoke",true);
  for(let i=0;i<3;i++) slab(b,0,.006,.64-i*.082,.46-i*.013,.023+i*.026,.126,M.trim,.025);
  lantern(b,-.25,.25,.423,.57);lantern(b,.25,.25,.423,.57);
  if(main) {
    barrel(b,.52,.008,.30,.85); barrel(b,.53,.008,.08,.72);
    fern(b,-.45,.02,.28,.7,6);
    for(const s of [-1,1]) beam(b,[s*.34,.28,.393],[s*.24,.43,.393],.026,M.timber);
    // A gabled dormer rises above the eastern roof slope.
    b.at(.355,.57,-.115,Math.PI/2,.345,()=>{
      box(b,0,-.10,.01,.68,.5,.49,M.oak);
      b.face([[-.35,.39,.267],[.35,.39,.267],[0,.66,.267]],M.timber,[0,0,1]);
      windowArch(b,0,.027,.265,.47,.445);
      shingledRoof(b,.875,.595,.39,.297);
    });
  }
}
function watch(b) {
  slab(b,0,0,0,.85,.16,.80,M.slate);
  box(b,0,.16,0,.73,.11,.70,M.oak);
  for(const x of [-.32,.32]) for(const z of [-.29,.29]) {
    box(b,x,.23,z,.079,.55,.079,M.timber);
    box(b,x,.245,z,.091,.058,.091,M.iron);
  }
  for(const z of [-.30,.3]) box(b,-.16,.39,z,.36,.078,.04,M.oak);
  for(const x of [-.34,.34]) beam(b,[x,.28,-.29],[x,.49,.29],.047,M.timber);
  const corners=[[-.47,.72,-.44],[.47,.72,-.44],[.47,.72,.44],[-.47,.72,.44]],top=[.015,1.03,-.028];
  for(let i=0;i<4;i++) {
    const a=corners[i],c=corners[(i+1)%4];
    b.face([a,c,top],tone(M.roof,.88+i*.045),[a[0]+c[0],1,a[2]+c[2]]);
    beam(b,a,c,.033,M.ridge);beam(b,a,top,.025,M.brass);
  }
  beam(b,[.015,1.01,-.028],[.015,1.25,-.028],.023,M.brass);
  b.face([[.015,1.24,-.028],[.24,1.17,.012],[.015,1.105,-.028]],M.coral,[0,0,1]);
  const shield=(s,z,m)=>b.face([[-.18-s*.12,.43+s*.12,z],[-.18+s*.12,.43+s*.12,z],[-.18+s*.105,.43-s*.07,z],[-.18,.43-s*.17,z],[-.18-s*.105,.43-s*.07,z]],m,[0,0,1]);
  shield(1,.332,M.brass);shield(.76,.337,M.cloth);
  lantern(b,.31,.47,.32,.72);
}
function oreCart(b,x,z,s=1) {
  b.at(x,.035,z,0,s,()=>{
    for(const side of [-.14,.14]) box(b,side,.005,0,.025,.027,.88,M.iron);
    for(const zz of [-.32,-.13,.06,.25]) box(b,0,0,zz,.40,.025,.062,M.timber);
    slab(b,0,.105,0,.34,.17,.42,M.darkwood,.02);
    for(const zz of [-.15,.15]) for(const side of [-.17,.17]) rock(b,side,.037,zz,.048,.095,.052,5,M.iron);
    for(const xx of [-.173,.173]) box(b,xx,.255,0,.024,.038,.44,M.iron);
    for(let i=0;i<7;i++) rock(b,(noise(i,2)-.5)*.24,.249,(noise(i,6)-.5)*.33,.061,.055+.065*noise(i,1),.065,i+3,M.gold);
  });
}
function workshop(b) {
  slab(b,0,0,0,.96,.095,.84,M.slate);
  box(b,-.05,.08,-.19,.67,.40,.3,M.masonry);
  for(const x of [-.38,.38]) for(const z of [-.30,.28]) box(b,x,.065,z,.078,z>0?.43:.61,.075,M.timber);
  for(let i=0;i<5;i++) {
    const x=-.47+i*.188;
    const arch=[[-.42,.605],[-.28,.678],[-.02,.707],[.21,.647],[.39,.548],[.433,.478]];
    for(let j=0;j<arch.length-1;j++){
      const [za,ya]=arch[j],[zc,yc]=arch[j+1];
      b.face([[x,ya,za],[x+.186,ya,za],[x+.186,yc,zc],[x,yc,zc]],tone(M.copper,.89+.055*(i%3)),[0,1,0]);
      beam(b,[x,ya+.003,za],[x,yc+.003,zc],.010,M.brass);
    }
  }
  box(b,0,.45,.409,.95,.038,.045,M.timber);
  windowArch(b,-.12,.22,-.028,.24,.191);
  box(b,-.1,.20,.14,.49,.045,.23,M.oak);
  for(const x of [-.29,.085]) box(b,x,.07,.14,.04,.14,.16,M.timber);
  box(b,-.14,.245,.14,.115,.042,.059,M.gold);
  lantern(b,.34,.228,.3,.85);barrel(b,-.46,.01,.24,.92);
  oreCart(b,.10,.66,.91);
}
function rockBank(b,x,z,rx,rz,h,seed) {
  rock(b,x,0,z,rx,h,rz,seed,M.slate);
  rock(b,x-.43*rx,.01,z+.49*rz,rx*.60,h*.53,rz*.65,seed+7,M.edge);
  rock(b,x+.52*rx,.02,z-.14*rz,rx*.55,h*.70,rz*.50,seed+17,M.slate);
  if(seed%3!==0) {
    rock(b,x-.04*rx,h*.87,z-.03*rz,rx*.46,h*.13,rz*.42,seed+5,M.moss);
    fern(b,x-.06*rx,h*.97,z,Math.max(.45,rx*.88),seed);
  }
}
function portal(b) {
  for(const s of [-1,1]) {
    slab(b,s*.38,0,0,.18,.13,.26,M.slate);
    beam(b,[s*.381,.07,0],[s*.322,.73,0],.094,M.timber,.14);
    beam(b,[s*.36,.51,0],[s*.205,.718,0],.051,M.oak);
    rock(b,s*.49,.01,.018,.17,.285,.23,s+9,M.slate);
  }
  beam(b,[-.42,.719,0],[.42,.719,0],.106,M.oak,.145);
  for(const s of [-1,1])box(b,s*.328,.664,.068,.035,.077,.014,M.iron);
  lantern(b,-.34,.40,.101,.69);
}
function crystalPocket(b,shrine=false) {
  rock(b,-.14,0,-.12,.42,.29,.34,4,M.edge);
  rock(b,.22,0,-.19,.20,.42,.19,11,M.slate);
  const clusters=[[-.09,-.13,.92,.123,-.045],[.10,-.18,.62,.111,.14],[-.26,.004,.55,.106,-.13],
    [.063,.057,.47,.102,.067],[-.12,.142,.34,.084,-.064],[.27,-.015,.35,.064,.08]];
  clusters.forEach(([x,z,h,r,lean],i)=>crystal(b,x,.10,z,h,r,lean,i,i%3===0?M.crystalLight:M.crystal));
  b.glow(-.07,.52,-.09,.48,"violet");
  if (shrine) {
    slab(b,0,.005,0,.88,.12,.87,M.slate);
    for(const side of [-.37,.37]) {
      slab(b,side,.08,-.31,.15,.65,.16,M.masonry);
      slab(b,side,.685,-.31,.195,.09,.198,M.trim);
    }
    beam(b,[-.4,.74,-.31],[.40,.74,-.31],.13,M.moss);
  } else {
    for(const side of [-.35,.35]) box(b,side,.02,.24,.064,.66,.075,M.timber);
    beam(b,[-.43,.67,.24],[.43,.67,.24],.078,M.oak);
    for(const s of [-1,1]) beam(b,[s*.35,.43,.24],[s*.18,.655,.24],.043,M.timber);
    beam(b,[-.19,.67,.24],[.19,.67,.24],.096,M.iron);
    for(let i=0;i<5;i++) box(b,-.113+i*.051,.608,.184,.023,.118,.116,M.ridge);
    beam(b,[.045,.62,.284],[.045,.291,.284],.014,M.bark);
    turned(b,.045,.147,.284,[[0,.059],[.104,.092],[.133,.096]],M.oak,9);
    turned(b,.045,.267,.284,[[0,.099],[.014,.099]],M.iron,9);
    lantern(b,.29,.44,.244,.78);
  }
}
function workBasket(b,x,y,z,filled) {
  b.at(x,y,z,0,1,()=>{
    turned(b,0,0,0,[[0,.079],[.086,.118],[.105,.122],[.115,.102]],M.oak,10,.72);
    for (const h of [.031,.082]) turned(b,0,h,0,[[0,.093+h*.26],[.014,.096+h*.26]],M.ridge,10,.73);
    for (const side of [-1,1]) beam(b,[side*.102,.10,0],[side*.068,.20,0],.014,M.brass);
    beam(b,[-.068,.20,0],[.068,.20,0],.014,M.brass);
    if (filled) for(const [u,v,s,m] of [[-.042,.017,.24,M.coral],[.033,.02,.23,M.cap],[.018,-.033,.18,M.lilac]])
      mushroom(b,u,.07,v,s,m,2);
  });
}
export function beetle(b,phase,variant) {
  const step=Math.sin(phase*TAU);
  for(const side of [-1,1]) {
    for(let i=0;i<3;i++) {
      const z=(i-1)*.069, toe=z+.031*step*(i%2?side:-side);
      beam(b,[side*.084,.077,z],[side*.166,.066,toe-.016],.021,M.darkwood);
      beam(b,[side*.166,.066,toe-.016],[side*.19,.014,toe+.025],.018,M.oak);
    }
  }
  turned(b,0,.041,-.015,[[0,.100],[.035,.145],[.095,.133],[.139,.083],[.149,.018]],variant?M.shell:M.wing,14,1.37);
  beam(b,[0,.184,-.065],[0,.18,.086],.014,M.brass);
  for(const s of [-1,1]) {
    rock(b,s*.062,.158,-.037,.028,.012,.038,5,M.linen);
    rock(b,s*.093,.132,.047,.015,.009,.021,7,M.linen);
  }
  turned(b,0,.058,.147,[[0,.059],[.039,.089],[.086,.072],[.107,.018]],M.deep,10,.88);
  for(const s of [-1,1]) {
    box(b,s*.057,.113,.205,.032,.030,.022,M.flame);
    beam(b,[s*.044,.142,.173],[s*.105,.218,.221+step*.009],.015,M.brass);
    rock(b,s*.105,.204,.221+step*.009,.020,.030,.019,3,M.flame);
  }
}
function worker(b,type,act,phase,variant=0) {
  const swing=Math.sin(phase*TAU),walking=["walk","carry","patrol","escort","meet"].includes(act);
  const picking=act==="pluck" || act==="unload",mining=act==="dig" || act==="ore";
  const bend=picking?Math.sin(phase*Math.PI):0;
  const stone=type==="guard", skin=stone?M.golem:type==="miner"?M.skin:M.stem;
  const bodyY=(walking?Math.abs(swing)*.026:0)-bend*.076, bodyZ=bend*.082;
  const width=stone?.101:.061;
  for (const side of [-1,1]) {
    const step=walking?swing*side:0, footZ=.018+step*.083, lift=Math.max(0,step)*.045;
    if (stone) rock(b,side*width,lift,footZ,.098,.16,.108,10+side,M.golem);
    else {
      beam(b,[side*width,.17+bodyY,bodyZ],[side*width,.036+lift,footZ],.067,M.bark);
      slab(b,side*width,.003+lift,footZ+.019,.085,.054,.126,M.darkwood,.017);
    }
  }
  b.at(0,bodyY,bodyZ,0,1,()=>{
    if(stone){
      rock(b,0,.105,0,.207,.28,.14,10,M.golem);
      rock(b,0,.33,.005,.143,.198,.119,11,M.golem);
      for(const x of [-.05,.05])box(b,x,.427,.106,.034,.018,.012,M.window);
      fern(b,-.03,.482,-.02,.33,3);
      turned(b,0,.324,0,[[0,.129],[.045,.139]],M.scarf,8,.93);
      b.face([[-.10,.35,.095],[-.018,.35,.129],[-.048,.233,.15]],M.scarf,[0,0,1]);
    }else{
      turned(b,0,.108,0,[[0,.097],[.052,.10],[.13,.086],[.16,.063]],type==="miner"?M.leather:M.cloth,9,.80);
      box(b,0,.15,.003,.195,.037,.13,M.darkwood);
      turned(b,0,.24,.009,[[0,.066],[.055,.111],[.13,.109],[.169,.059]],skin,10,.88);
      for(const x of [-.043,.043])box(b,x,.328,.10,.024,.025,.014,M.eye);
      rock(b,0,.285,.097,.042,.045,.031,3,skin);
      if(type==="miner"){
        for(const s of [-1,1])b.face([[s*.089,.29,.002],[s*.195,.384,0],[s*.099,.364,.017]],M.skin,[0,0,1]);
        turned(b,0,.368,0,[[0,.13],[.016,.134],[.073,.089],[.09,.036]],variant?M.shell:M.brass,10,.89);
        box(b,0,.385,.104,.060,.047,.018,M.window);
      }else {
        turned(b,0,.363,0,[[0,.111],[.019,.122],[.089,.091],[.112,.033]],M.linen,10,.87);
        turned(b,0,.378,0,[[0,.12],[.024,.117]],M.shell,10,.89);
        for(const s of [-1,1]) b.face([[0,.392,-.084],[s*.135,.442,-.112],[s*.102,.368,-.103]],M.linen,[0,.4,-1]);
        box(b,0,.203,.075,.103,.071,.016,M.scarf);
      }
    }
    const shoulderY=stone?.30:.237, shoulderX=stone?.142:.084;
    const strike=phase<.66?phase/.66:1-(phase-.66)/.34;
    const angle=mining?(-.92+2.30*(strike*strike)):(walking?.52*swing:.35);
    const wrist=[shoulderX+.048,shoulderY+(mining?.04+.076*Math.cos(angle):-.072-bend*.045),.065+(mining?.11*Math.sin(angle):bend*.095)];
    const elbow=[shoulderX+.064,shoulderY-.035,.039];
    beam(b,[shoulderX,shoulderY,.002],elbow,stone?.075:.047,skin);
    beam(b,elbow,wrist,stone?.064:.041,skin);
    const other=[-shoulderX-.057,shoulderY-.098,walking?-.048*swing+.04:.071];
    beam(b,[-shoulderX,shoulderY,.01],other,stone?.089:.046,skin);
    if(mining || (act==="walk" && type==="miner")){
      const tilt=mining?angle:.56,dy=Math.cos(tilt),dz=Math.sin(tilt),len=.277;
      const cy=wrist[1]+dy*len,cz=wrist[2]+dz*len,cx=wrist[0];
      beam(b,[cx,wrist[1]-dy*.072,wrist[2]-dz*.072],[cx,cy,cz],.031,M.oak);
      beam(b,[cx,cy-dy*.02,cz-dz*.02],[cx,cy+dz*.092,cz-dy*.092],.047,M.iron);
      beam(b,[cx,cy+dz*.092,cz-dy*.092],[cx,cy+dz*.144-dy*.035,cz-dy*.144-dz*.035],.023,M.trim);
      beam(b,[cx,cy,cz],[cx,cy-dz*.11,cz+dy*.11],.042,M.iron);
      beam(b,[cx,cy-dz*.11,cz+dy*.11],[cx,cy-dz*.16-dy*.045,cz+dy*.16-dz*.045],.022,M.trim);
    }else if(picking || act==="carry"){
      workBasket(b,other[0]-.035,other[1]-.116,.095,act==="carry" || (act==="unload" && phase<.68));
      if(act==="pluck" && phase>.47)mushroom(b,wrist[0],wrist[1]-.015,wrist[2]+.025,.25,M.coral,2);
    }else if(act==="escort" || act==="meet") lantern(b,other[0]-.04,.085,.12,.65);
    else if(type==="miner")lantern(b,other[0],.029,.064,.47);
  });
  if(act==="dig" && phase>=.57){
    const t=(phase-.57)/.43;
    for(let j=0;j<4;j++)rock(b,.08+(j-1.6)*t*.16,.18+t*(1-t)*.63,.37-t*(.08+j*.04),.028,.036,.03,j+6,M.trim);
  }
}

export { CaveMesh, M, TAU, UP, VERTEX, barrel, clamp, cottage, cross, crystal, crystalPocket, dot, fern, garden, harvestBasket, lantern, minus, mushroom, noise, portal, postLamp, rim, rock, rockBank, slab, sunDir, tone, unit, watch, worker, workshop };
