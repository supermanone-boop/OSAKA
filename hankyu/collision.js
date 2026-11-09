"use strict";
(async()=>{
const C=window.Cesium,g=window.geofs,o=g?.objects;
if(!C||!g?.aircraft||!o?.getAltitudeAtLocation){alert("GeoFSの衝突判定システムが見つかりません");return;}
if(typeof DecompressionStream==="undefined"){alert("Chromeを最新版にしてください");return;}
window.__hankyuRailCollision?.destroy?.();
window.__hankyuRailCollisionV2?.destroy?.();
const URL_GZ="https://huggingface.co/supermanone-boop/hankyu/resolve/main/Hankyu_Rail_Collision_v2.bin.gz";
const DEG=Math.PI/180,R=6378137;
let chunks=[],allTriangles=0,enabled=true,timer=0,interval=null,originalUpdate=o.updateCollidables,wrappedUpdate=null,hadInterval=!!o.collidableInterval,wasOn=o.on,intervalWasReplaced=false;
const customSet=new Set();
let destroyed=false;
function makeTriangle(a,b,c){
 const t=[a,b,c];
 let u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],w=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
 let n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];
 if(n[2]<0){t[1]=c;t[2]=b;u=[t[1][0]-a[0],t[1][1]-a[1],t[1][2]-a[2]];w=[t[2][0]-a[0],t[2][1]-a[1],t[2][2]-a[2]];n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];}
 t.u=u;t.v=w;t.n=n;
 return t;
}
function parseBinary(buffer){
 const d=new DataView(buffer);let p=0;
 const magic=String.fromCharCode(d.getUint8(0),d.getUint8(1),d.getUint8(2),d.getUint8(3));p=4;
 const version=d.getUint32(p,true);p+=4;
 const count=d.getUint32(p,true);p+=4;
 const total=d.getUint32(p,true);p+=4;
 if(magic!=="HKCT"||version!==2)throw new Error("衝突データの形式が違います");
 let parsed=0;
 for(let i=0;i<count;i++){
  const lat=d.getFloat64(p,true);p+=8;
  const lon=d.getFloat64(p,true);p+=8;
  const alt=d.getFloat64(p,true);p+=8;
  const radius=d.getFloat32(p,true);p+=4;
  const ntri=d.getUint32(p,true);p+=4;
  const triangles=new Array(ntri);
  for(let j=0;j<ntri;j++){
   const a=[d.getFloat32(p,true),d.getFloat32(p+4,true),d.getFloat32(p+8,true)];p+=12;
   const b=[d.getFloat32(p,true),d.getFloat32(p+4,true),d.getFloat32(p+8,true)];p+=12;
   const c=[d.getFloat32(p,true),d.getFloat32(p+4,true),d.getFloat32(p+8,true)];p+=12;
   triangles[j]=makeTriangle(a,b,c);
  }
  const item={id:"hankyu_rail_collision_"+i,location:[lat,lon,alt],collisionRadius:radius,collisionTriangles:triangles,htr:[0,0,0],options:{},rotateModelOnly:true,_hankyuRailCollider:true};
  chunks.push(item);customSet.add(item);parsed+=ntri;
 }
 if(p!==buffer.byteLength||parsed!==total)throw new Error("衝突データの長さが一致しません");
 allTriangles=parsed;
}
function refresh(){
 if(destroyed)return;
 const list=(o.collidableObjectList||[]).filter(x=>!customSet.has(x));
 if(enabled){
  const ac=g.aircraft?.instance?.llaLocation;
  if(ac&&Number.isFinite(ac[0])&&Number.isFinite(ac[1])&&Number.isFinite(ac[2])){
   for(const item of chunks){
    const loc=item.location;
    const latMid=(ac[0]+loc[0])*.5*DEG;
    const east=(ac[1]-loc[1])*DEG*R*Math.cos(latMid);
    const north=(ac[0]-loc[0])*DEG*R;
    const up=ac[2]-loc[2];
    const d=Math.hypot(east,north,up);
    if(d<item.collisionRadius){item.metricOffset=[east,north,up];list.push(item);}
   }
  }
 }
 o.collidableObjectList=list;
 o.collidableObject=list.length>0;
}
const state={
 chunks,
 getStats(){return{enabled,chunks:chunks.length,triangles:allTriangles,supportWidthMeters:5.1,activeChunks:(o.collidableObjectList||[]).filter(x=>customSet.has(x)).length};},
 enable(){enabled=true;refresh();},
 disable(){enabled=false;refresh();},
 check(lat,lon,alt=100000){const hit=o.getAltitudeAtLocation([lat,lon,alt],true);return hit?{altitude:hit.location[2],normal:hit.normal,collider:hit.object?.id}:null;},
 checkCurrent(){const a=g.aircraft?.instance?.llaLocation;return a?this.check(a[0],a[1],a[2]+1000):null;},
 destroy(){
  if(destroyed)return;destroyed=true;
  if(timer)clearInterval(timer);
  if(interval)clearInterval(interval);
  if(o.updateCollidables===wrappedUpdate)o.updateCollidables=originalUpdate;
  if(o.collidableObjectList)o.collidableObjectList=o.collidableObjectList.filter(x=>!customSet.has(x));
  o.collidableObject=!!o.collidableObjectList?.length;
  if(intervalWasReplaced&&hadInterval&&wasOn&&typeof originalUpdate==="function")o.collidableInterval=setInterval(originalUpdate,2000);
  if(window.__hankyuRailCollisionV2===state)delete window.__hankyuRailCollisionV2;
  try{originalUpdate?.call(o);}catch(e){}
  console.log("Hankyu wide rail collision removed");
 }
};
window.__hankyuRailCollisionV2=state;
try{
 console.log("Hankyu wide collision data downloading...");
 const r=await fetch(URL_GZ,{cache:"no-store"});
 if(!r.ok)throw new Error("HTTP "+r.status);
 if(!r.body)throw new Error("ReadableStream unavailable");
 const raw=await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
 parseBinary(raw);
 if(hadInterval){clearInterval(o.collidableInterval);intervalWasReplaced=true;}
 if(typeof originalUpdate==="function"){
  wrappedUpdate=function(){originalUpdate.apply(o,arguments);refresh();};
  o.updateCollidables=wrappedUpdate;
  if(hadInterval&&wasOn){interval=setInterval(wrappedUpdate,2000);o.collidableInterval=interval;}
 }
 refresh();
 timer=setInterval(refresh,250);
 console.log("Hankyu wide rail collision ready",state.getStats());
 console.log("高度確認: __hankyuRailCollisionV2.checkCurrent()");
}catch(e){
 console.error("Hankyu wide rail collision load error",e);
 state.destroy();
 alert("阪急線路の拡幅コリジョン読み込みに失敗しました: "+e.message);
}
})();
