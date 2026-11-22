import { UP, VERTEX, clamp, cross, dot, sunDir, unit } from "./models.js";

const lightRight=unit(cross(UP,sunDir)), lightUp=unit(cross(sunDir,lightRight));
const SHADOW_SPAN=15;
const VERTEX_SHADER=`
  attribute vec3 aPosition,aColor,aSurface;
  attribute vec2 aUV;
  uniform vec3 uRight,uUp,uEye;
  uniform vec2 uScale,uOffset;
  varying vec3 vWorld,vColor,vSurface;
  varying vec2 vUV;
  void main() {
    vWorld=aPosition; vColor=aColor; vSurface=aSurface; vUV=aUV;
    vec2 projected=vec2(dot(aPosition,uRight),dot(aPosition,uUp));
    gl_Position=vec4(projected*uScale+uOffset,-dot(aPosition,uEye)/32.0,1.0);
  }`;
const FRAGMENT_SHADER=`
  precision highp float;
  uniform sampler2D uAtlas,uShadow,uMarks;
  uniform vec3 uLightRight,uLightUp,uSun,uAccent;
  uniform float uHover,uShadowStep,uPass,uReady;
  varying vec3 vWorld,vColor,vSurface;
  varying vec2 vUV;
  float blocked(vec2 uv,float z) {
    vec2 packedDepth=texture2D(uShadow,uv).rg;
    return step(packedDepth.x+packedDepth.y/255.0+.00085,z);
  }
  void main() {
    float id=floor(vSurface.z+.5);
    if(uPass>1.5) {gl_FragColor=vec4(mod(id,256.0)/255.0,floor(id/256.0)/255.0,0.0,1.0);return;}
    if(uPass>.5) {
      float z=gl_FragCoord.z*255.0;
      gl_FragColor=vec4(floor(z)/255.0,fract(z),0.0,1.0);return;
    }
    vec3 color=vColor;
    if(vSurface.x>-.5 && uReady>.5) {
      float t=floor(vSurface.x+.5);
      vec2 tile=vec2(mod(t,3.0),floor(t/3.0));
      vec2 uv=(tile+fract(vUV)*.984+.008)*.25;
      color*=texture2D(uAtlas,uv).rgb*2.0;
    }
    vec2 suv=vec2(dot(vWorld,uLightRight),dot(vWorld,uLightUp))/30.0+.5;
    float d=.5-dot(vWorld,uSun)/64.0;
    vec2 o=vec2(uShadowStep,-uShadowStep)*.72;
    float sh=(blocked(suv+o.xy,d)+blocked(suv-o.xy,d)+blocked(suv+o.xx,d)+blocked(suv-o.xx,d))*.25;
    color*=1.0-sh*vSurface.y;
    vec2 marks=texture2D(uMarks,(vec2(mod(id,32.0),floor(id/32.0))+.5)/32.0).rg;
    float mark=marks.r;
    if(mark>.5) {
      vec2 local=abs(fract(vWorld.xz+.5)-.5);
      float side=max(local.x,local.y),along=min(local.x,local.y);
      float rim=smoothstep(.396,.423,side)*(1.0-smoothstep(.461,.479,side))*smoothstep(.18,.32,along);
      color=mix(color,marks.g>.5?vec3(.41,.90,.77):uAccent,marks.g>.5?.20+.77*rim:.045+.78*rim);
    }
    if(uHover>.5 && abs(id-uHover)<.4) color=mix(color,uAccent,.19);
    gl_FragColor=vec4(color,1.0);
  }`;
function makeWebGL(canvas) {
  const gl=canvas.getContext("webgl",{alpha:true,antialias:true,depth:true,stencil:false,premultipliedAlpha:false,powerPreference:"low-power"});
  if(!gl) return null;
  const program=gl.createProgram();
  for(const [type,source] of [[gl.VERTEX_SHADER,VERTEX_SHADER],[gl.FRAGMENT_SHADER,FRAGMENT_SHADER]]) {
    const shader=gl.createShader(type);
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program,shader);gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);gl.enable(gl.DEPTH_TEST);gl.disable(gl.DITHER);
  const uniforms={};
  for(const name of ["Right","Up","Eye","Scale","Offset","Atlas","Shadow","Marks","LightRight","LightUp","Sun","Accent","Hover","ShadowStep","Pass","Ready"])
    uniforms[name]=gl.getUniformLocation(program,"u"+name);
  const geometry=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,geometry);
  for(const [name,n,offset] of [["Position",3,0],["Color",3,3],["UV",2,6],["Surface",3,8]]) {
    const loc=gl.getAttribLocation(program,"a"+name);
    gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,n,gl.FLOAT,false,VERTEX*4,offset*4);
  }
  function texture(width,height,data) {
    const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
    for(const param of [gl.TEXTURE_MAG_FILTER,gl.TEXTURE_MIN_FILTER]) gl.texParameteri(gl.TEXTURE_2D,param,gl.NEAREST);
    for(const param of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,param,gl.CLAMP_TO_EDGE);
    return tex;
  }
  function target(size) {
    const frame=gl.createFramebuffer(),color=texture(size,size,null),depth=gl.createRenderbuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,frame);gl.bindRenderbuffer(gl.RENDERBUFFER,depth);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,size,size);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw Error("Renderfläche fehlt");
    return {frame,color,size};
  }
  const neutral=texture(1,1,new Uint8Array([128,128,128,255]));
  const atlas=texture(1,1,new Uint8Array([128,128,128,255])), marks=texture(32,32,null);
  const shadow=target(Math.min(1024,gl.getParameter(gl.MAX_TEXTURE_SIZE))),pick=target(1);
  gl.uniform1i(uniforms.Atlas,0);gl.uniform1i(uniforms.Shadow,1);gl.uniform1i(uniforms.Marks,2);
  gl.uniform3fv(uniforms.LightRight,lightRight);gl.uniform3fv(uniforms.LightUp,lightUp);
  gl.uniform3fv(uniforms.Sun,sunDir);gl.uniform1f(uniforms.ShadowStep,1/shadow.size);
  const mapDepth=target(400),depthBytes=new Uint8Array(mapDepth.size*mapDepth.size*4);
  let depthCamera="";
  let count=0,currentView=null,ready=false;
  function pass(type,frame,w,h,right,up,eye,sx,sy,ox,oy) {
    gl.bindFramebuffer(gl.FRAMEBUFFER,frame);gl.viewport(0,0,w,h);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,atlas);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,type===1?neutral:shadow.color);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,marks);
    gl.uniform3fv(uniforms.Right,right);gl.uniform3fv(uniforms.Up,up);gl.uniform3fv(uniforms.Eye,eye);
    gl.uniform2f(uniforms.Scale,sx,sy);gl.uniform2f(uniforms.Offset,ox,oy);gl.uniform1f(uniforms.Pass,type);
    const blank=type===1?1:0;gl.clearColor(blank,blank,blank,blank);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,count);
  }
  return {
    setAtlas(image) {
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,atlas);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.generateMipmap(gl.TEXTURE_2D);
      ready=true;
    },
    setScene(scene) {
      depthCamera="";count=scene.vertices.length/VERTEX;gl.bindBuffer(gl.ARRAY_BUFFER,geometry);
      gl.bufferData(gl.ARRAY_BUFFER,scene.vertices,gl.STATIC_DRAW);
      pass(1,shadow.frame,shadow.size,shadow.size,lightRight,lightUp,sunDir,1/SHADOW_SPAN,1/SHADOW_SPAN,0,0);
    },
    setMarks(data) {
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,marks);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,data);
    },
    draw(v,accent,hover) {
      currentView=v;
      const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(2350000/(v.w*v.h)));
      const w=Math.max(1,Math.round(v.w*ratio)),h=Math.max(1,Math.round(v.h*ratio));
      if(canvas.width!==w || canvas.height!==h){canvas.width=w;canvas.height=h;}
      gl.uniform3fv(uniforms.Accent,accent);gl.uniform1f(uniforms.Hover,hover);gl.uniform1f(uniforms.Ready,ready?1:0);
      const signature=[v.w,v.h,v.k,v.ox,v.oy,...v.eye].join("/");
      if(depthCamera!==signature){
        const n=mapDepth.size;
        pass(1,mapDepth.frame,n,n,v.right,v.up,v.eye,2*v.k/v.w,2*v.k/v.h,2*v.ox/v.w-1,1-2*v.oy/v.h);
        gl.readPixels(0,0,n,n,gl.RGBA,gl.UNSIGNED_BYTE,depthBytes);depthCamera=signature;
      }
      pass(0,null,w,h,v.right,v.up,v.eye,2*v.k/v.w,2*v.k/v.h,2*v.ox/v.w-1,1-2*v.oy/v.h);
    },
    depthAt(x,y) {
      const v=currentView,n=mapDepth.size;if(!v)return -100;
      const ix=Math.min(n-1,Math.max(0,Math.floor(x*n/v.w))),iy=Math.min(n-1,Math.max(0,n-1-Math.floor(y*n/v.h)));
      const pos=(iy*n+ix)*4;return (.5-(depthBytes[pos]+depthBytes[pos+1]/255)/255)*64;
    },
    pick(x,y) {
      const v=currentView;if(!v) return 0;
      pass(2,pick.frame,1,1,v.right,v.up,v.eye,2*v.k,2*v.k,2*(v.ox-x),2*(y-v.oy));
      const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);return pixel[0]+256*pixel[1];
    }
  };
}

// The same mesh, camera, textures and z-buffer picking also work without WebGL.
function eachTriangle(v,width,height,scale,originX,originY,right,up,eye,sink) {
  const projected=new Float32Array(9);
  for(let start=0;start<v.length;start+=VERTEX*3) {
    for(let j=0;j<3;j++) {
      const i=start+j*VERTEX,x=v[i],y=v[i+1],z=v[i+2];
      projected[j*3]=originX+scale*(x*right[0]+y*right[1]+z*right[2]);
      projected[j*3+1]=originY-scale*(x*up[0]+y*up[1]+z*up[2]);
      projected[j*3+2]=x*eye[0]+y*eye[1]+z*eye[2];
    }
    const [ax,ay,az,bx,by,bz,cx,cy,cz]=projected;
    const w=(bx-ax)*(cy-ay)-(cx-ax)*(by-ay);
    if(Math.abs(w)<.075) continue;
    const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))),x1=Math.min(width-1,Math.ceil(Math.max(ax,bx,cx)));
    const y0=Math.max(0,Math.floor(Math.min(ay,by,cy))),y1=Math.min(height-1,Math.ceil(Math.max(ay,by,cy)));
    if(x1<x0 || y1<y0) continue;
    const ux=(cy-ay)/w,uy=-(cx-ax)/w,vx=-(by-ay)/w,vy=(bx-ax)/w;
    for(let y=y0;y<=y1;y++) {
      let u=(x0+.5-ax)*ux+(y+.5-ay)*uy,t=(x0+.5-ax)*vx+(y+.5-ay)*vy;
      for(let x=x0;x<=x1;x++,u+=ux,t+=vx) {
        if(u>=-.00001 && t>=-.00001 && u+t<=1.00001) sink(y*width+x,start,u,t,az+(bz-az)*u+(cz-az)*t);
      }
    }
  }
}
function makeSoftware(canvas) {
  const ctx=canvas.getContext("2d");
  let mesh=null,atlas=null,marks=null,pickIds=null,buffer=null,zbuf=null,ratio=1;
  const lightSize=640;
  let lightDepth=null;
  return {
    setAtlas(image) {
      const c=document.createElement("canvas");c.width=image.width;c.height=image.height;
      const g=c.getContext("2d",{willReadFrequently:true});g.drawImage(image,0,0);
      atlas=g.getImageData(0,0,c.width,c.height);
    },
    setScene(scene) {
      mesh=scene.vertices;lightDepth=new Float32Array(lightSize*lightSize).fill(-100);
      eachTriangle(mesh,lightSize,lightSize,lightSize/(2*SHADOW_SPAN),lightSize/2,lightSize/2,lightRight,lightUp,sunDir,
        (index,start,u,t,z)=>{if(z>lightDepth[index]) lightDepth[index]=z;});
    },
    setMarks(data) {marks=data;},
    draw(v,accent,hover,moving=false) {
      if(!mesh) return;
      ratio=Math.min(devicePixelRatio||1,moving?.85:1.55,Math.sqrt((moving?220000:950000)/(v.w*v.h)));
      const w=Math.max(1,Math.round(v.w*ratio)),h=Math.max(1,Math.round(v.h*ratio));
      if(!buffer || canvas.width!==w || canvas.height!==h) {
        canvas.width=w;canvas.height=h;buffer=ctx.createImageData(w,h);
        pickIds=new Uint16Array(w*h);zbuf=new Float32Array(w*h);
      }
      zbuf.fill(-100);pickIds.fill(0);buffer.data.fill(0);
      const data=buffer.data,m=mesh,tw=atlas?.width||1,texels=atlas?.data;
      eachTriangle(m,w,h,v.k*ratio,v.ox*ratio,v.oy*ratio,v.right,v.up,v.eye,(index,start,u,t,z)=>{
        if(z<=zbuf[index]) return;
        zbuf[index]=z;
        const j=start+VERTEX,k=j+VERTEX,id=m[start+10],material=m[start+8];pickIds[index]=id;
        const interp=n=>m[start+n]+(m[j+n]-m[start+n])*u+(m[k+n]-m[start+n])*t;
        const wx=interp(0),wy=interp(1),wz=interp(2);
        const lx=clamp(Math.floor((.5+(wx*lightRight[0]+wy*lightRight[1]+wz*lightRight[2])/(2*SHADOW_SPAN))*lightSize),0,lightSize-1);
        const ly=clamp(Math.floor((.5-(wx*lightUp[0]+wy*lightUp[1]+wz*lightUp[2])/(2*SHADOW_SPAN))*lightSize),0,lightSize-1);
        const dz=wx*sunDir[0]+wy*sunDir[1]+wz*sunDir[2],shade=dz<lightDepth[ly*lightSize+lx]-.062?1-m[start+9]:1;
        let tex=-1;
        if(texels && material>=0) {
          const a=interp(6),b=interp(7),s=tw/4;
          const tx=Math.floor(((a-Math.floor(a))*.984+.008+material%3)*s);
          const ty=Math.floor(((b-Math.floor(b))*.984+.008+Math.floor(material/3))*s);
          tex=(ty*tw+tx)*4;
        }
        let amount=0;
        if(marks?.[id*4]) {
          const a=Math.abs(wx-Math.round(wx)),b=Math.abs(wz-Math.round(wz));
          const hi=Math.max(a,b),lo=Math.min(a,b);
          amount=hi>.407 && hi<.466 && lo>.25?.80:.045;
        }
        if(id===hover && hover) amount+=.18;
        for(let c=0;c<3;c++) {
          const color=interp(3+c)*(tex>=0?texels[tex+c]/127.5:1)*shade;
          const planned=marks?.[id*4+1], mix=planned?Math.min(.95,amount+.14):amount;
          data[index*4+c]=(color*(1-mix)+(planned?mint[c]:accent[c])*mix)*255;
        }
        data[index*4+3]=255;
      });
      ctx.putImageData(buffer,0,0);
    },
    depthAt(x,y) {return zbuf?.[Math.floor(y*ratio)*canvas.width+Math.floor(x*ratio)]??-100;},
    pick(x,y) {return pickIds?.[Math.floor(y*ratio)*canvas.width+Math.floor(x*ratio)]||0;}
  };
}

const mint=[.51,.91,.72];

export { eachTriangle, makeSoftware, makeWebGL };

export function project(v,x,y,z) {
  return {x:v.ox+v.k*(x*v.right[0]+z*v.right[2]),y:v.oy-v.k*(x*v.up[0]+y*v.up[1]+z*v.up[2])};
}
