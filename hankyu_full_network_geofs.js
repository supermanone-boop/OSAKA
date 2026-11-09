"use strict";
(async()=>{
const C=window.Cesium,g=window.geofs;
if(!C||!g?.api?.viewer){alert("GeoFS / Cesium が読み込まれていません。");return;}
window.__HANKYU_NETWORK__?.destroy?.();
const viewer=g.api.viewer,scene=viewer.scene,ellipsoid=C.Ellipsoid.WGS84;
const CFG={
  bbox:"34.39,134.85,35.16,135.96",
  maxStep:10,
  gauge:1.435,
  railWidth:0.065,
  bedWidth:3.05,
  sleeperLength:2.55,
  sleeperWidth:0.24,
  sleeperSpacing:0.65,
  trackSpacing:3.80,
  railTopAboveGround:0.42,
  bridgeDeckAboveGround:6.2,
  viaductDeckAboveGround:7.0,
  embankmentAboveGround:1.4,
  cuttingBelowGround:1.6,
  tunnelBelowGround:3.5,
  catenary:true,
  catenaryPoleSpacing:48,
  catenaryWireHeight:5.05,
  catenaryPoleHeight:6.35,
  demZoom:15,
  useTerrainFallback:true,
  debug:false
};
const state={primitives:[],cancelled:false,stats:{ways:0,tracks:0,km:0,demTiles:0,sleepers:0,demSources:{}},destroy(){this.cancelled=true;for(const p of this.primitives.splice(0))try{scene.primitives.remove(p);}catch(e){};console.log("[Hankyu] model removed");}};
window.__HANKYU_NETWORK__=state;
const log=(...x)=>console.log("[Hankyu]",...x);
const status=(s)=>log(s);
const bbox=CFG.bbox;
const q=`[out:json][timeout:120];
relation["route"="railway"]["operator"~"Hankyu|阪急",i](${bbox})->.r1;
relation["route"="railway"]["name"~"阪急|Hankyu|神戸高速線",i](${bbox})->.r2;
(.r1;.r2;)->.rr;
.rr out body;
way(r.rr)["railway"="rail"]->.rw;
way["railway"="rail"]["operator"~"Hankyu|阪急",i](${bbox})->.w1;
way["railway"="rail"]["name"~"阪急|Hankyu|神戸本線|宝塚本線|京都本線|伊丹線|今津線|甲陽線|箕面線|千里線|嵐山線|神戸高速線",i](${bbox})->.w2;
(.rw;.w1;.w2;)->.allways;
.allways out body;
node(w.allways)->.allnodes;
.allnodes out body;`;
const endpoints=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://overpass.private.coffee/api/interpreter"];
async function fetchOSM(){let last;for(const url of endpoints){if(state.cancelled)throw Error("cancelled");try{status("OSMの阪急線路データを取得中: "+url);const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),125000);let r;try{r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(q),signal:ctrl.signal});}finally{clearTimeout(timer);}if(!r.ok)throw Error("HTTP "+r.status);const j=await r.json();if(!Array.isArray(j.elements))throw Error("OSM応答形式が不正です");const wc=j.elements.filter(x=>x.type==="way"&&x.tags?.railway==="rail").length;if(!wc)throw Error("阪急の線路wayが見つかりません");return j;}catch(e){last=e;log("Overpass fallback",String(e));}}throw last||Error("Overpassに接続できませんでした");}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function parseEle(v){if(v==null)return null;const n=parseFloat(String(v).replace(/,/g,"."));return Number.isFinite(n)?n:null;}
function meters(a,b){const dy=(b.lat-a.lat)*111132,dx=(b.lon-a.lon)*111320*Math.cos((a.lat+b.lat)*Math.PI/360);return Math.hypot(dx,dy);}
function interpEle(a,b,f){if(a.ele!=null&&b.ele!=null)return a.ele+(b.ele-a.ele)*f;if(a.ele!=null)return a.ele;if(b.ele!=null)return b.ele;return null;}
function smoothCoords(p){if(p.length<4)return p;const o=[p[0]];for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1];o.push({lon:a.lon*.75+b.lon*.25,lat:a.lat*.75+b.lat*.25,ele:interpEle(a,b,.25)},{lon:a.lon*.25+b.lon*.75,lat:a.lat*.25+b.lat*.75,ele:interpEle(a,b,.75)});}o.push(p[p.length-1]);return o;}
function densify(raw,step){const p=smoothCoords(raw),out=[];for(let i=0;i<p.length-1;i++){const a=C.Cartographic.fromDegrees(p[i].lon,p[i].lat),b=C.Cartographic.fromDegrees(p[i+1].lon,p[i+1].lat),geo=new C.EllipsoidGeodesic(a,b,ellipsoid),d=geo.surfaceDistance,n=Math.max(1,Math.ceil(d/step));for(let k=0;k<n;k++){const z=geo.interpolateUsingFraction(k/n);out.push({lon:C.Math.toDegrees(z.longitude),lat:C.Math.toDegrees(z.latitude),ele:interpEle(p[i],p[i+1],k/n)});}}out.push(p[p.length-1]);return out;}
function decodeElements(json,relationTrackDefaults){const nodes=new Map(),ways=[];for(const e of json.elements){if(e.type==="node")nodes.set(e.id,{lon:e.lon,lat:e.lat,ele:parseEle(e.tags?.ele)});else if(e.type==="way"&&e.tags?.railway==="rail"&&Array.isArray(e.nodes))ways.push(e);}const seen=new Set(),out=[];for(const w of ways){if(seen.has(w.id))continue;seen.add(w.id);const raw=[];for(const id of w.nodes){const n=nodes.get(id);if(n)raw.push({lon:n.lon,lat:n.lat,ele:n.ele});}if(raw.length>=2){const clean=[raw[0]];for(let k=1;k<raw.length;k++)if(meters(clean[clean.length-1],raw[k])>0.08)clean.push(raw[k]);if(clean.length>=2){const pts=densify(clean,CFG.maxStep);out.push({id:w.id,tags:w.tags||{},defaultTracks:relationTrackDefaults.get(w.id)||0,raw:clean,pts});}}}return out;}
function tileXY(lon,lat,z){const n=2**z,x=(lon+180)/360*n,lr=lat*Math.PI/180,y=(1-Math.asinh(Math.tan(lr))/Math.PI)/2*n;return{x:Math.floor(x),y:Math.floor(y),px:(x-Math.floor(x))*256,py:(y-Math.floor(y))*256};}
function loadImage(url){return new Promise((resolve,reject)=>{const im=new Image();im.crossOrigin="anonymous";im.onload=()=>{try{const c=document.createElement("canvas");c.width=256;c.height=256;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(im,0,0,256,256);resolve(x.getImageData(0,0,256,256).data);}catch(e){reject(e);}};im.onerror=()=>reject(Error("image load failed"));im.src=url;});}
const demCache=new Map();
const demLayers=[{base:"dem1a_png",z:17},{base:"dem5a_png",z:15},{base:"dem5b_png",z:15},{base:"dem5c_png",z:15},{base:"dem_png",z:14}];
async function loadDemTile(base,z,x,y){const key=base+"/"+z+"/"+x+"/"+y;if(demCache.has(key))return demCache.get(key);const promise=(async()=>{try{const data=await loadImage(`https://cyberjapandata.gsi.go.jp/xyz/${base}/${z}/${x}/${y}.png`);let valid=false;for(let i=0;i<data.length;i+=4){if(data[i+3]>0&&!(data[i]===128&&data[i+1]===0&&data[i+2]===0)){valid=true;break;}}return valid?{data,base,z,x,y}:null;}catch(e){return null;}})();demCache.set(key,promise);return promise;}
function pixHeight(data,x,y){x=Math.max(0,Math.min(255,x));y=Math.max(0,Math.min(255,y));const i=(y*256+x)*4,r=data[i],g=data[i+1],b=data[i+2],alpha=data[i+3],v=r*65536+g*256+b;if(alpha===0||v===8388608)return null;return(v>8388608?v-16777216:v)*0.01;}
function sampleTile(data,px,py){const x=Math.floor(px),y=Math.floor(py),fx=px-x,fy=py-y;const a=pixHeight(data,x,y),b=pixHeight(data,x+1,y),c=pixHeight(data,x,y+1),d=pixHeight(data,x+1,y+1);const vals=[a,b,c,d];if(vals.every(v=>v==null))return null;const get=(v,alt)=>v==null?alt:v,aa=get(a,get(b,get(c,d))),bb=get(b,aa),cc=get(c,aa),dd=get(d,bb);return(aa*(1-fx)*(1-fy)+bb*fx*(1-fy)+cc*(1-fx)*fy+dd*fx*fy);}
async function groundAt(p){for(const layer of demLayers){const t=tileXY(p.lon,p.lat,layer.z),tile=await loadDemTile(layer.base,layer.z,t.x,t.y);if(!tile)continue;const h=sampleTile(tile.data,t.px,t.py);if(h!=null)return{h,source:layer.base};}if(CFG.useTerrainFallback){try{const h=scene.globe.getHeight(C.Cartographic.fromDegrees(p.lon,p.lat));if(Number.isFinite(h))return{h,source:"GeoFS terrain fallback"};}catch(e){}}return{h:0,source:"0m fallback"};}
async function sampleGround(points){const out=new Array(points.length),counts={};let done=0;for(let i=0;i<points.length;i+=48){if(state.cancelled)throw Error("cancelled");const batch=points.slice(i,i+48);const result=await Promise.all(batch.map(groundAt));for(let j=0;j<result.length;j++){out[i+j]=result[j].h;counts[result[j].source]=(counts[result[j].source]||0)+1;}done+=batch.length;if(done%768===0||done===points.length)log(`標高サンプル ${done}/${points.length}`);}state.stats.demTiles=demCache.size;state.stats.demSources=counts;return out;}
const v3=(x,y,z)=>new C.Cartesian3(x,y,z);
function add(a,b){return C.Cartesian3.add(a,b,new C.Cartesian3());}
function sub(a,b){return C.Cartesian3.subtract(a,b,new C.Cartesian3());}
function mul(a,s){return C.Cartesian3.multiplyByScalar(a,s,new C.Cartesian3());}
function unit(a){return C.Cartesian3.normalize(a,new C.Cartesian3());}
function dot(a,b){return C.Cartesian3.dot(a,b);}
class Mesh{constructor(){this.p=new Float64Array(3*65536);this.i=new Uint32Array(6*65536);this.pn=0;this.in=0;this.v=0;}grow(pn,inn){if(this.pn+pn>this.p.length){let n=this.p.length;while(n<this.pn+pn)n*=2;const a=new Float64Array(n);a.set(this.p);this.p=a;}if(this.in+inn>this.i.length){let n=this.i.length;while(n<this.in+inn)n*=2;const a=new Uint32Array(n);a.set(this.i);this.i=a;}}quad(a,b,c,d){this.grow(12,6);let k=this.pn;for(const p of[a,b,c,d]){this.p[k++]=p.x;this.p[k++]=p.y;this.p[k++]=p.z;}const z=this.v;this.i[this.in++]=z;this.i[this.in++]=z+1;this.i[this.in++]=z+2;this.i[this.in++]=z;this.i[this.in++]=z+2;this.i[this.in++]=z+3;this.pn=k;this.v+=4;}box(center,side,tangent,up,w,d,h){const s=mul(side,w/2),t=mul(tangent,d/2),u=mul(up,h),p0=add(add(sub(center,s),mul(t,-1)),v3(0,0,0)),p1=add(add(center,s),mul(t,-1)),p2=add(add(center,s),t),p3=add(sub(center,s),t),q0=add(p0,u),q1=add(p1,u),q2=add(p2,u),q3=add(p3,u);this.quad(p0,p1,p2,p3);this.quad(q3,q2,q1,q0);this.quad(p0,q0,q1,p1);this.quad(p1,q1,q2,p2);this.quad(p2,q2,q3,p3);this.quad(p3,q3,q0,p0);}finish(){if(!this.v)return null;const p=this.p.slice(0,this.pn),i=this.i.slice(0,this.in);return{p,i};}}
const meshes={bed:new Mesh(),ties:new Mesh(),rails:new Mesh(),deck:new Mesh(),pillars:new Mesh(),poles:new Mesh(),wires:new Mesh()};
function color(r,g,b){return C.Color.fromBytes(r,g,b,255);}
function pushRibbon(mesh,aSide0,bSide0,aSide1,bSide1){mesh.quad(aSide0,bSide0,bSide1,aSide1);}
function offset(p,axis,amount){return add(p,mul(axis,amount));}
function structureOffset(tags){if(tags.tunnel==="yes"||tags.tunnel==="building_passage"||tags.location==="underground"||Number(tags.layer)<=-1)return-CFG.tunnelBelowGround;if(tags.bridge&&tags.bridge!=="no")return tags.bridge==="viaduct"?CFG.viaductDeckAboveGround:CFG.bridgeDeckAboveGround;if(Number(tags.layer)>=1)return 4.5;if(tags.embankment==="yes")return CFG.embankmentAboveGround;if(tags.cutting==="yes")return-CFG.cuttingBelowGround;return CFG.railTopAboveGround;}
function trackOffsets(path,all){const explicit=parseInt(path.tags.tracks||"0",10)||0,n=Math.max(1,Math.min(4,explicit||path.defaultTracks||1));if(n===1)return[0];const m=Math.floor(path.pts.length/2),mid=path.pts[m],a=path.pts[Math.max(0,m-2)],b=path.pts[Math.min(path.pts.length-1,m+2)],dx=(b.lon-a.lon)*Math.cos(mid.lat*Math.PI/180),dy=b.lat-a.lat,ln=Math.hypot(dx,dy)||1;let near=false;for(const o of all){if(o.id===path.id)continue;const j=Math.floor(o.pts.length/2),om=o.pts[j],oa=o.pts[Math.max(0,j-2)],ob=o.pts[Math.min(o.pts.length-1,j+2)];if(meters(mid,om)>=9)continue;const ox=(ob.lon-oa.lon)*Math.cos(om.lat*Math.PI/180),oy=ob.lat-oa.lat,on=Math.hypot(ox,oy)||1;if(Math.abs((dx*ox+dy*oy)/(ln*on))>.82){near=true;break;}}if(near)return[0];const arr=[];for(let i=0;i<n;i++)arr.push((i-(n-1)/2)*CFG.trackSpacing);return arr;}
function makeFrames(pts,ground,tags,trackOffset){const base=[],ups=[],sides=[],tans=[],rails=[];const off=structureOffset(tags);for(let i=0;i<pts.length;i++){const b=C.Cartesian3.fromDegrees(pts[i].lon,pts[i].lat,0,ellipsoid);base.push(b);ups.push(ellipsoid.geodeticSurfaceNormal(b,new C.Cartesian3()));}for(let i=0;i<pts.length;i++){const prev=base[Math.max(0,i-1)],next=base[Math.min(base.length-1,i+1)],up=ups[i];let t=sub(next,prev);t=sub(t,mul(up,dot(t,up)));t=unit(t);let s=unit(C.Cartesian3.cross(t,up,new C.Cartesian3()));tans.push(t);sides.push(s);const z=pts[i].ele!=null?pts[i].ele:ground[i]+off;let c=add(add(base[i],mul(up,z)),mul(s,trackOffset));rails.push(c);}return pts.map((p,i)=>({center:rails[i],up:ups[i],side:sides[i],tangent:tans[i],ground:ground[i],rail:p.ele!=null?p.ele:ground[i]+off}));}
function makeStrip(mesh,frames,centerOffset,width,heightOffset){for(let i=0;i<frames.length-1;i++){const a=frames[i],b=frames[i+1],a0=offset(offset(a.center,a.side,centerOffset-width/2),a.up,heightOffset),a1=offset(offset(a.center,a.side,centerOffset+width/2),a.up,heightOffset),b0=offset(offset(b.center,b.side,centerOffset-width/2),b.up,heightOffset),b1=offset(offset(b.center,b.side,centerOffset+width/2),b.up,heightOffset);pushRibbon(mesh,a0,a1,b0,b1);}}
function makeRails(mesh,frames){const g=CFG.gauge/2;for(let i=0;i<frames.length-1;i++){const a=frames[i],b=frames[i+1],d=C.Cartesian3.distance(a.center,b.center);if(d<0.15)continue;const center=C.Cartesian3.lerp(a.center,b.center,0.5,new C.Cartesian3()),up=unit(C.Cartesian3.lerp(a.up,b.up,0.5,new C.Cartesian3())),side=unit(C.Cartesian3.lerp(a.side,b.side,0.5,new C.Cartesian3())),tangent=unit(sub(b.center,a.center));for(const s of[-g,g])mesh.box(offset(offset(center,side,s),up,-0.15),side,tangent,up,CFG.railWidth,d+0.05,0.15);}}
function makeSleepers(mesh,frames){let dist=0,next=0;for(let i=0;i<frames.length-1;i++){const a=frames[i],b=frames[i+1],d=C.Cartesian3.distance(a.center,b.center);if(d<0.001)continue;while(next<=dist+d){const f=(next-dist)/d,base=C.Cartesian3.lerp(a.center,b.center,Math.max(0,Math.min(1,f)),new C.Cartesian3()),up=unit(C.Cartesian3.lerp(a.up,b.up,Math.max(0,Math.min(1,f)),new C.Cartesian3())),side=unit(C.Cartesian3.lerp(a.side,b.side,Math.max(0,Math.min(1,f)),new C.Cartesian3())),tan=unit(C.Cartesian3.lerp(a.tangent,b.tangent,Math.max(0,Math.min(1,f)),new C.Cartesian3())),c=offset(base,up,-0.12),s=mul(side,CFG.sleeperLength/2),t=mul(tan,CFG.sleeperWidth/2),p0=sub(sub(c,s),t),p1=add(sub(c,t),s),p2=add(add(c,s),t),p3=add(sub(c,s),t);mesh.quad(p0,p1,p2,p3);state.stats.sleepers++;next+=CFG.sleeperSpacing;}dist+=d;}}
function makePoleAndWire(frames){let d=0,next=0;for(let i=0;i<frames.length-1;i++){const a=frames[i],b=frames[i+1],seg=C.Cartesian3.distance(a.center,b.center);if(seg<0.001)continue;while(next<=d+seg){const f=(next-d)/seg,center=C.Cartesian3.lerp(a.center,b.center,Math.max(0,Math.min(1,f)),new C.Cartesian3()),up=unit(C.Cartesian3.lerp(a.up,b.up,Math.max(0,Math.min(1,f)),new C.Cartesian3())),side=unit(C.Cartesian3.lerp(a.side,b.side,Math.max(0,Math.min(1,f)),new C.Cartesian3())),tan=unit(C.Cartesian3.lerp(a.tangent,b.tangent,Math.max(0,Math.min(1,f)),new C.Cartesian3())),base=offset(center,side,2.25);meshes.poles.box(base,side,tan,up,0.13,0.13,CFG.catenaryPoleHeight);const arm=offset(offset(center,side,1.1),up,5.45);meshes.poles.box(arm,side,tan,up,2.25,0.09,0.08);next+=CFG.catenaryPoleSpacing;}d+=seg;}}
function makeViaductPillars(frames){let d=0,next=0;for(let i=0;i<frames.length-1;i++){const a=frames[i],b=frames[i+1],seg=C.Cartesian3.distance(a.center,b.center);if(seg<0.001)continue;while(next<=d+seg){const f=(next-d)/seg,center=C.Cartesian3.lerp(a.center,b.center,Math.max(0,Math.min(1,f)),new C.Cartesian3()),up=unit(C.Cartesian3.lerp(a.up,b.up,Math.max(0,Math.min(1,f)),new C.Cartesian3())),side=unit(C.Cartesian3.lerp(a.side,b.side,Math.max(0,Math.min(1,f)),new C.Cartesian3())),tan=unit(C.Cartesian3.lerp(a.tangent,b.tangent,Math.max(0,Math.min(1,f)),new C.Cartesian3()));const h=a.rail-a.ground-0.58;if(h>1.2){const base=offset(center,up,-(a.rail-a.ground));meshes.pillars.box(base,side,tan,up,0.78,0.78,h);}next+=27; }d+=seg;}}
function addPathGeometry(frames,tags){if(frames.length<2)return;const bridge=!!(tags.bridge&&tags.bridge!=="no"),tunnel=tags.tunnel==="yes"||tags.tunnel==="building_passage"||tags.location==="underground"||Number(tags.layer)<=-1;const deckBottom=bridge?-0.58:0;if(bridge)makeStrip(meshes.deck,frames,0,CFG.bedWidth+1.1,deckBottom);if(tags.bridge==="viaduct")makeViaductPillars(frames);makeStrip(meshes.bed,frames,0,CFG.bedWidth,bridge?-0.22:-0.20);makeRails(meshes.rails,frames);makeSleepers(meshes.ties,frames);if(CFG.catenary&&!tunnel){makeStrip(meshes.wires,frames,0,0.025,CFG.catenaryWireHeight);makePoleAndWire(frames);}}
function addMesh(mesh,name,col){const data=mesh.finish();if(!data)return;const geom=new C.Geometry({attributes:{position:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.DOUBLE,componentsPerAttribute:3,values:data.p})},indices:data.i,primitiveType:C.PrimitiveType.TRIANGLES,boundingSphere:C.BoundingSphere.fromVertices(data.p)});const inst=new C.GeometryInstance({geometry:geom,attributes:{color:C.ColorGeometryInstanceAttribute.fromColor(col)}});const primitive=scene.primitives.add(new C.Primitive({geometryInstances:inst,appearance:new C.PerInstanceColorAppearance({flat:true,translucent:false,closed:false}),asynchronous:true,compressVertices:true,allowPicking:false}));state.primitives.push(primitive);log(name+" mesh",data.p.length/3,"vertices");}
try{
 status("OSMデータを解析中");const json=await fetchOSM();if(state.cancelled)return;const relations=json.elements.filter(e=>e.type==="relation"&&e.tags?.name),relationNames=[...new Set(relations.map(e=>e.tags.name))],relationTrackDefaults=new Map();for(const r of relations){const name=r.tags.name,single=/甲陽線|嵐山線|Koyo|Arashiyama/i.test(name),known=single||/阪急|Hankyu|神戸本線|宝塚本線|京都本線|伊丹線|今津線|箕面線|千里線|神戸高速線/i.test(name);if(known)for(const m of r.members||[])if(m.type==="way"){if(single)relationTrackDefaults.set(m.ref,1);else if(!relationTrackDefaults.has(m.ref))relationTrackDefaults.set(m.ref,2);}}log("OSM route relations:",relationNames);const paths=decodeElements(json,relationTrackDefaults);if(!paths.length)throw Error("有効な線路geometryがありません");state.stats.ways=paths.length;log("OSM ways:",paths.length);
 const allPts=[];for(const p of paths)for(const z of p.pts)allPts.push(z);log("elevation sample points:",allPts.length);
 status("国土地理院DEM1A/5A/5B/5C/10Bで地表標高を取得中");const ground=await sampleGround(allPts);if(state.cancelled)return;let cursor=0,processed=0;
 status("曲線を平滑化し、軌間1,435mm・枕木・架線を生成中");for(const path of paths){if(state.cancelled)return;const pts=path.pts,n=pts.length,gh=ground.slice(cursor,cursor+n);cursor+=n;const offsets=trackOffsets(path,paths);for(const off of offsets){const frames=makeFrames(pts,gh,path.tags,off);addPathGeometry(frames,path.tags);state.stats.tracks++;let km=0;for(let i=1;i<pts.length;i++)km+=meters(pts[i-1],pts[i]);state.stats.km+=km/1000;}processed++;if(processed%20===0)log(`線路way ${processed}/${paths.length} 生成中`);}
 if(state.cancelled)return;
 status("Cesiumへ阪急線路モデルを登録中");addMesh(meshes.deck,"bridge decks",color(132,137,141));addMesh(meshes.pillars,"viaduct piers",color(122,126,129));addMesh(meshes.bed,"ballast / track bed",color(112,108,101));addMesh(meshes.ties,"sleepers",color(91,75,61));addMesh(meshes.rails,"rails",color(48,52,55));if(CFG.catenary){addMesh(meshes.poles,"catenary masts",color(89,91,91));addMesh(meshes.wires,"overhead contact wires",color(51,54,55));}
 log("完成",{ways:state.stats.ways,trackWays:state.stats.tracks,estimatedTrackKm:state.stats.km.toFixed(1),demTiles:state.stats.demTiles,demSources:state.stats.demSources,sleepers:state.stats.sleepers,gauge:"1435 mm",voltage:"DC 1500 V"});
 log("OSM attribution: © OpenStreetMap contributors (ODbL) https://www.openstreetmap.org/copyright");log("DEM: Geospatial Information Authority of Japan (GSI) elevation tiles");
}catch(e){if(!state.cancelled){console.error("[Hankyu] failed",e);alert("阪急線路モデルの生成に失敗しました。コンソールの [Hankyu] エラーを確認してください。\n"+String(e));state.destroy();}}
})();
