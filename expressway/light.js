'use strict';
(async()=>{
  const BASE_URL='https://raw.githubusercontent.com/supermanone-boop/OSAKA/refs/heads/main/expressway/beta.js';
  const res=await fetch(BASE_URL+'?v='+Date.now(),{cache:'no-store'});
  if(!res.ok)throw Error('交通コードHTTP '+res.status);
  const base=await res.text();
  (0,eval)(base);

  const C=window.Cesium,g=window.geofs,viewer=g&&g.api&&g.api.viewer,scene=viewer&&viewer.scene;
  if(!C||!viewer||!scene||!C.BillboardCollection)throw Error('照明追加に必要なCesium APIがありません');
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let state=null;
  for(let i=0;i<600;i++){
    state=window.__osakaTraffic;
    if(state&&state.active&&state.routes&&state.routes.length&&state.cars&&state.cars.length&&state.callback)break;
    await sleep(100);
  }
  if(!state||!state.active||!state.routes||!state.routes.length||!state.callback)throw Error('交通シミュレーションの起動を確認できませんでした');
  state.lightingAddon&&state.lightingAddon.stop&&state.lightingAddon.stop();
  if(state._osakaBaseStop)state.stop=state._osakaBaseStop;

  const CFG={
    ROAD_LIGHT_SPACING_M:50,
    ROAD_LIGHT_EDGE_OFFSET_M:9.0,
    ROAD_LIGHT_HEIGHT_M:5.2,
    CAR_LIGHT_FRONT_OFFSET_M:2.05,
    CAR_LIGHT_REAR_OFFSET_M:2.05,
    CAR_LIGHT_HEIGHT_M:0.48,
    NIGHT_START_SUN_ELEVATION_DEG:-1.0,
    NIGHT_FULL_SUN_ELEVATION_DEG:-6.0,
    NIGHT_UPDATE_MS:3000,
    ROAD_REFRESH_MS:1000,
    CAR_REFRESH_MS:100
  };
  const RAD=Math.PI/180,R=6378137,LAT0=34.6,SX=R*RAD*Math.cos(LAT0*RAD),SY=R*RAD;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const distXY=(ax,ay,bx,by)=>Math.hypot(ax-bx,ay-by);
  const state2={active:true,nightFactor:0,sunElevation:90,lastNight:0,lastRoad:0,lastCars:0,
    visibleRoadLights:[],activeLampCars:[],roadLightsCreated:0,carLightsCreated:0,callback:null,
    proxyDayImages:[],proxyNightImages:[],carCollection:new C.BillboardCollection(),roadCollection:new C.BillboardCollection()};
  scene.primitives.add(state2.carCollection);
  scene.primitives.add(state2.roadCollection);
  state2.version='night-light-addon-1';

  function focusLLA(){
    const p=viewer.camera&&viewer.camera.positionCartographic;
    if(p)return {lon:p.longitude/RAD,lat:p.latitude/RAD};
    const a=g&&g.aircraft&&g.aircraft.instance;
    if(a&&a.llaLocation){const v=a.llaLocation;if(Array.isArray(v))return {lon:Number(v[1]),lat:Number(v[0])};}
    return null;
  }
  function sunElevation(lat,lon,date){
    const y=date.getUTCFullYear(),start=Date.UTC(y,0,1);
    const day=Math.floor((Date.UTC(y,date.getUTCMonth(),date.getUTCDate())-start)/86400000)+1;
    const hour=date.getUTCHours()+date.getUTCMinutes()/60+date.getUTCSeconds()/3600;
    const gamma=2*Math.PI/365*(day-1+(hour-12)/24);
    const eq=229.18*(0.000075+0.001868*Math.cos(gamma)-0.032077*Math.sin(gamma)-0.014615*Math.cos(2*gamma)-0.040849*Math.sin(2*gamma));
    const dec=0.006918-0.399912*Math.cos(gamma)+0.070257*Math.sin(gamma)-0.006758*Math.cos(2*gamma)+0.000907*Math.sin(2*gamma)-0.002697*Math.cos(3*gamma)+0.00148*Math.sin(3*gamma);
    let solarMinutes=hour*60+eq+4*lon;
    solarMinutes=((solarMinutes%1440)+1440)%1440;
    const ha=(solarMinutes/4-180)*RAD,phi=lat*RAD;
    const sinEl=Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(ha);
    return Math.asin(clamp(sinEl,-1,1))/RAD;
  }
  function updateNight(now,focus){
    if(now-state2.lastNight<CFG.NIGHT_UPDATE_MS)return;
    state2.lastNight=now;
    state2.sunElevation=sunElevation(focus.lat,focus.lon,new Date());
    state2.nightFactor=clamp((CFG.NIGHT_START_SUN_ELEVATION_DEG-state2.sunElevation)/
      (CFG.NIGHT_START_SUN_ELEVATION_DEG-CFG.NIGHT_FULL_SUN_ELEVATION_DEG),0,1);
  }
  function fromXY(x,y){return [x/SX,y/SY];}
  function pointAt(route,s){
    s=clamp(s,0,route.len);const c=route.cum;let lo=0,hi=c.length-1;
    while(lo+1<hi){const m=(lo+hi)>>1;if(c[m]<=s)lo=m;else hi=m;}
    const i=Math.min(lo,c.length-2),d=Math.max(.001,c[i+1]-c[i]),t=clamp((s-c[i])/d,0,1),t2=t*t,t3=t2*t;
    const i0=Math.max(0,i-1),i3=Math.min(route.n-1,i+2),o=route.p;
    const h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2,out=new Array(3);
    for(let k=0;k<3;k++){
      const p0=o[i0*3+k],p1=o[i*3+k],p2=o[(i+1)*3+k],p3=o[i3*3+k];
      const den1=Math.max(.001,c[i+1]-c[i0]),den2=Math.max(.001,c[i3]-c[i]);
      const m1=(p2-p0)/den1*d,m2=(p3-p1)/den2*d;
      let v=h00*p1+h10*m1+h01*p2+h11*m2;
      if(k===2)v=clamp(v,Math.min(p1,p2)-.16,Math.max(p1,p2)+.16);
      out[k]=v;
    }
    return out;
  }
  function getPose(car,progress){
    const r=car.route,s=car.dir>0?progress:r.len-progress,L=24;
    const a=pointAt(r,clamp(s-L,0,r.len)),b=pointAt(r,clamp(s+L,0,r.len)),p=pointAt(r,s);
    const east=b[0]-a[0],north=b[1]-a[1],horizontal=Math.max(.01,Math.hypot(east,north));
    let heading=Math.atan2(east,north);
    if(car.dir<0)heading+=Math.PI;
    const offset=[2.1,5.7][car.lane]||2.1;
    const x=p[0]+Math.cos(heading)*offset,y=p[1]-Math.sin(heading)*offset,ll=fromXY(x,y);
    return {lon:ll[0],lat:ll[1],alt:p[2]+0.38,heading};
  }
  function roundedRect(ctx,x,y,w,h,r){
    if(typeof ctx.roundRect==='function'){ctx.beginPath();ctx.roundRect(x,y,w,h,r);return;}
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
  }
  function makeProxyImage(color,night){
    const c=document.createElement('canvas');c.width=64;c.height=32;const x=c.getContext('2d');
    x.clearRect(0,0,64,32);x.fillStyle='rgba(0,0,0,.42)';x.fillRect(7,5,50,22);
    x.fillStyle=color;roundedRect(x,5,4,54,24,7);x.fill();
    x.fillStyle='rgba(30,42,54,.9)';roundedRect(x,17,7,30,18,5);x.fill();
    x.fillStyle='rgba(205,225,238,.8)';x.fillRect(19,8,11,7);x.fillRect(34,8,11,7);
    if(night){
      x.fillStyle='rgba(255,250,229,.98)';x.fillRect(1,10,4,4);x.fillRect(59,10,4,4);
      x.fillStyle='rgba(255,45,45,.98)';x.fillRect(1,19,4,5);x.fillRect(59,19,4,5);
    }
    return c;
  }
  const palette=['#929292','#202124','#eeeeee','#aeb4ba','#2462b4','#bd2428','#929292','#202124','#eeeeee','#aeb4ba','#2462b4','#bd2428'];
  for(const color of palette){state2.proxyDayImages.push(makeProxyImage(color,false));state2.proxyNightImages.push(makeProxyImage(color,true));}
  function applyProxyImage(car,night){
    if(!car.billboard)return;
    if(car._osakaOriginalImage===undefined)car._osakaOriginalImage=car.billboard.image;
    const mode=night?1:0;
    if(car._osakaProxyMode===mode)return;
    car.billboard.image=night?state2.proxyNightImages[car.variant]:state2.proxyDayImages[car.variant];
    car._osakaProxyMode=mode;
  }
  function makePairLampImage(type){
    const c=document.createElement('canvas');c.width=64;c.height=24;
    const x=c.getContext('2d');x.clearRect(0,0,64,24);x.globalCompositeOperation='lighter';
    const color=type==='head'?'255,238,190':'255,22,28';
    for(const cx of [12,52]){
      const grad=x.createRadialGradient(cx,12,1,cx,12,12);
      grad.addColorStop(0,type==='head'?'rgba(255,255,245,1)':'rgba(255,65,65,1)');
      grad.addColorStop(.24,'rgba('+color+',.92)');
      grad.addColorStop(1,'rgba('+color+',0)');
      x.fillStyle=grad;x.fillRect(cx-12,0,24,24);
      x.beginPath();x.arc(cx,12,3.2,0,Math.PI*2);
      x.fillStyle=type==='head'?'rgba(255,255,255,1)':'rgba(255,95,95,1)';x.fill();
    }
    return c;
  }
  function makeRoadLampImage(){
    const c=document.createElement('canvas');c.width=64;c.height=256;
    const x=c.getContext('2d');x.clearRect(0,0,64,256);
    x.save();x.globalCompositeOperation='lighter';
    const glow=x.createRadialGradient(51,34,1,51,34,27);
    glow.addColorStop(0,'rgba(255,250,210,.95)');glow.addColorStop(.22,'rgba(255,211,112,.62)');glow.addColorStop(1,'rgba(255,183,72,0)');
    x.fillStyle=glow;x.fillRect(22,5,42,58);x.restore();
    x.lineCap='round';x.strokeStyle='rgba(37,43,48,.96)';x.lineWidth=5;
    x.beginPath();x.moveTo(29,254);x.lineTo(29,48);x.quadraticCurveTo(29,34,42,34);x.lineTo(52,34);x.stroke();
    x.strokeStyle='rgba(160,168,174,.85)';x.lineWidth=1.5;x.beginPath();x.moveTo(32,248);x.lineTo(32,51);x.stroke();
    x.fillStyle='rgba(65,70,73,.98)';x.fillRect(44,29,13,7);
    x.fillStyle='rgba(255,246,194,.98)';x.beginPath();x.ellipse(53,34,5,3.5,0,0,Math.PI*2);x.fill();
    return c;
  }
  const headImage=makePairLampImage('head'),tailImage=makePairLampImage('tail'),roadImage=makeRoadLampImage();
  function ensureCarLights(car){
    if(!car._osakaHeadLamp){
      car._osakaHeadLamp=state2.carCollection.add({image:headImage,show:false,width:2.45,height:.78,sizeInMeters:true,
        horizontalOrigin:C.HorizontalOrigin.CENTER,verticalOrigin:C.VerticalOrigin.CENTER,allowPicking:false});
      car._osakaTailLamp=state2.carCollection.add({image:tailImage,show:false,width:2.45,height:.78,sizeInMeters:true,
        horizontalOrigin:C.HorizontalOrigin.CENTER,verticalOrigin:C.VerticalOrigin.CENTER,allowPicking:false});
      state2.carLightsCreated++;
    }
  }
  function setCarLampPosition(billboard,pose,forwardOffset,color){
    const x=pose.lon*SX+Math.sin(pose.heading)*forwardOffset;
    const y=pose.lat*SY+Math.cos(pose.heading)*forwardOffset;
    const ll=fromXY(x,y);
    billboard.position=C.Cartesian3.fromDegrees(ll[0],ll[1],pose.alt+CFG.CAR_LIGHT_HEIGHT_M);
    billboard.rotation=-pose.heading;billboard.color=new C.Color(color[0],color[1],color[2],state2.nightFactor);
    billboard.show=state2.nightFactor>.015;
  }
  function renderCarLights(now){
    const alpha=clamp((now-state.lastSim)/120,0,1),night=state2.nightFactor>.015;
    for(const old of state2.activeLampCars){if(old._osakaHeadLamp)old._osakaHeadLamp.show=false;if(old._osakaTailLamp)old._osakaTailLamp.show=false;}
    state2.activeLampCars.length=0;
    for(const car of state.visibleCars||[]){
      applyProxyImage(car,night);
      const slot=car.modelSlot,usesGLB=!!(slot&&slot.model&&slot.ready&&slot.car===car);
      if(!usesGLB){if(car._osakaHeadLamp)car._osakaHeadLamp.show=false;if(car._osakaTailLamp)car._osakaTailLamp.show=false;continue;}
      ensureCarLights(car);
      const head=car._osakaHeadLamp,tail=car._osakaTailLamp;
      if(!night||car.sleeping){head.show=false;tail.show=false;continue;}
      const progress=car.prevProgress+(car.progress-car.prevProgress)*alpha;
      const pose=getPose(car,progress);
      setCarLampPosition(head,pose,CFG.CAR_LIGHT_FRONT_OFFSET_M,[1,.96,.79]);
      setCarLampPosition(tail,pose,-CFG.CAR_LIGHT_REAR_OFFSET_M,[1,.045,.035]);
      state2.activeLampCars.push(car);
    }
  }
  function ensureRouteLights(route){
    if(route._osakaRoadLights)return route._osakaRoadLights;
    const lights=[],spacing=CFG.ROAD_LIGHT_SPACING_M;
    for(let s=spacing*.5;s<route.len;s+=spacing){
      const p=pointAt(route,s),a=pointAt(route,Math.max(0,s-5)),b=pointAt(route,Math.min(route.len,s+5));
      const heading=Math.atan2(b[0]-a[0],b[1]-a[1]);
      for(const side of [-1,1]){
        const x=p[0]+Math.cos(heading)*side*CFG.ROAD_LIGHT_EDGE_OFFSET_M;
        const y=p[1]-Math.sin(heading)*side*CFG.ROAD_LIGHT_EDGE_OFFSET_M;
        const ll=fromXY(x,y),position=C.Cartesian3.fromDegrees(ll[0],ll[1],p[2]+.05);
        const billboard=state2.roadCollection.add({image:roadImage,position,show:false,width:1.45,height:CFG.ROAD_LIGHT_HEIGHT_M,
          sizeInMeters:true,horizontalOrigin:C.HorizontalOrigin.CENTER,verticalOrigin:C.VerticalOrigin.BOTTOM,
          rotation:side<0?Math.PI:0,allowPicking:false});
        lights.push({x,y,position,billboard});
      }
    }
    route._osakaRoadLights=lights;state2.roadLightsCreated+=lights.length;
    return lights;
  }
  function hideVisibleRoadLights(){
    for(const light of state2.visibleRoadLights)light.billboard.show=false;
    state2.visibleRoadLights.length=0;
  }
  function refreshRoadLights(focus){
    hideVisibleRoadLights();
    if(state2.nightFactor<=.015)return;
    const fx=focus.lon*SX,fy=focus.lat*SY,visibleRadius=20000;
    const cam=viewer.camera,fr=cam&&cam.frustum;let culling=null;
    try{if(fr&&fr.computeCullingVolume)culling=fr.computeCullingVolume(cam.positionWC,cam.directionWC,cam.upWC);}catch(_){}
    for(const route of state.routes){
      const center=route.center;
      if(center&&Math.hypot((center.lon-focus.lon)*SX,(center.lat-focus.lat)*SY)>visibleRadius+route.radius)continue;
      for(const light of ensureRouteLights(route)){
        if(distXY(fx,fy,light.x,light.y)>visibleRadius)continue;
        if(culling){try{if(culling.computeVisibility(new C.BoundingSphere(light.position,6))===C.Intersect.OUTSIDE)continue;}catch(_){}}
        light.billboard.color=new C.Color(1,.84,.53,state2.nightFactor);
        light.billboard.show=true;state2.visibleRoadLights.push(light);
      }
    }
  }
  function tick(){
    if(!state2.active||!state.active)return;
    const now=performance.now(),focus=focusLLA();
    if(!focus)return;
    updateNight(now,focus);
    if(now-state2.lastRoad>=CFG.ROAD_REFRESH_MS){state2.lastRoad=now;refreshRoadLights(focus);}
    if(now-state2.lastCars>=CFG.CAR_REFRESH_MS){state2.lastCars=now;renderCarLights(now);}
  }
  state2.callback=tick;
  if(g.api.addFrameCallback)g.api.addFrameCallback(tick);
  else if(scene.preRender&&scene.preRender.addEventListener)scene.preRender.addEventListener(tick);
  else throw Error('フレームコールバックAPIがありません');

  const baseStop=state.stop;
  let wrappedStop=null;
  state._osakaBaseStop=baseStop;
  state2.stop=()=>{
    if(!state2.active)return;state2.active=false;
    if(state2.callback){try{if(g.api.removeFrameCallback)g.api.removeFrameCallback(state2.callback);else if(scene.preRender&&scene.preRender.removeEventListener)scene.preRender.removeEventListener(state2.callback);}catch(_){}}
    hideVisibleRoadLights();
    for(const car of state2.activeLampCars){if(car._osakaHeadLamp)car._osakaHeadLamp.show=false;if(car._osakaTailLamp)car._osakaTailLamp.show=false;}
    state2.activeLampCars.length=0;
    for(const car of state.cars||[]){
      if(car._osakaOriginalImage!==undefined&&car.billboard)car.billboard.image=car._osakaOriginalImage;
      try{delete car._osakaOriginalImage;delete car._osakaProxyMode;delete car._osakaHeadLamp;delete car._osakaTailLamp;}catch(_){}
    }
    for(const route of state.routes||[]){try{delete route._osakaRoadLights;}catch(_){}}
    try{scene.primitives.remove(state2.carCollection);}catch(_){}
    try{scene.primitives.remove(state2.roadCollection);}catch(_){}
    state2.carCollection=null;state2.roadCollection=null;
    if(wrappedStop&&state.stop===wrappedStop)state.stop=baseStop;
    if(state.lightingAddon===state2)state.lightingAddon=null;
  };
  wrappedStop=()=>{state2.stop();return baseStop();};
  state.stop=wrappedStop;
  state.lightingAddon=state2;
  tick();
  console.log('[OSAKA traffic lights] 追加完了: 車前方=白色灯 / 後方=赤色灯 / 道路両端='+CFG.ROAD_LIGHT_SPACING_M+'m間隔');
  console.log('[OSAKA traffic lights] 夜間は太陽高度で自動点灯。街灯位置は道路中心から左右'+CFG.ROAD_LIGHT_EDGE_OFFSET_M+'m。');
  console.log('[OSAKA traffic lights] 設定:',{roadLights:state2.roadLightsCreated,carLampPairs:state2.carLightsCreated,nightFactor:state2.nightFactor,sunElevation:state2.sunElevation});
})().catch(e=>console.error('[OSAKA traffic lights] 起動失敗:',e));
