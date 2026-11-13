'use strict';
(async()=>{
  const ROOT='https://raw.githubusercontent.com/supermanone-boop/model/main/';
  const ROUTE_URL=ROOT+'osaka_road_routes_beta.json.gz';
  const g=window.geofs,C=window.Cesium,viewer=g&&g.api&&g.api.viewer,scene=viewer&&viewer.scene;
  const modelApi=C&&C.Model&&typeof C.Model.fromGltfAsync==='function'?'fromGltfAsync':(C&&C.Model&&typeof C.Model.fromGltf==='function'?'fromGltf':'none');
  if(!C||!viewer||!scene||!C.Model||modelApi==='none'||!C.BillboardCollection){console.error('[OSAKA traffic v7-beta] 必要API不足:',{cesium:C&&C.VERSION,modelApi,billboards:!!(C&&C.BillboardCollection),viewer:!!viewer});return;}
  if(window.__osakaTraffic&&window.__osakaTraffic.stop)window.__osakaTraffic.stop();

  const MODEL_FILES=[
    'sag1_factory.glb','sag1_black.glb','sag1_white.glb','sag1_silver.glb','sag1_blue.glb','sag1_red.glb',
    'xterra2_factory.glb','xterra2_black.glb','xterra2_white.glb','xterra2_silver.glb','xterra2_blue.glb','xterra2_red.glb'
  ];
  const CFG={
    VISIBLE_RADIUS_M:20000,
    MODEL_RADIUS_M:2600,
    MODEL_POOL_PER_VARIANT:2,
    MODEL_SCALE:1,
    MODEL_HEADING_OFFSET_DEG:0,
    MIN_ROUTE_LENGTH_M:250,
    ROUTE_ZONE_RADIUS_M:18000,
    LANE_OFFSET_M:[2.1,5.7],
    HEIGHT_OFFSET_M:0.38,
    LOOKAHEAD_M:24,
    AVG_FLOW_SPEED_KMH:72,
    LANES_PER_DIRECTION:2,
    MIN_LANE_SPACING_M:64,
    MIN_END_CLEARANCE_M:18,
    MIN_SPEED_MPS:15.5,
    MAX_SPEED_MPS:21.5,
    SAFE_GAP_M:12,
    HEADWAY_S:2.0,
    ACCEL_MPS2:0.34,
    BRAKE_MPS2:0.72,
    SIM_INTERVAL_MS:120,
    MODEL_RENDER_INTERVAL_MS:33,
    PROXY_RENDER_INTERVAL_MS:110,
    LOD_INTERVAL_MS:1000,
    MODEL_LOAD_INTERVAL_MS:180,
    RESPAWN_MIN_MS:2500,
    RESPAWN_MAX_MS:4500
  };
  const R=6378137,RAD=Math.PI/180,LAT0=34.6,SX=R*RAD*Math.cos(LAT0*RAD),SY=R*RAD;
  const PALETTE=['#929292','#202124','#eeeeee','#aeb4ba','#2462b4','#bd2428','#929292','#202124','#eeeeee','#aeb4ba','#2462b4','#bd2428'];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const rand=(a,b)=>a+Math.random()*(b-a);
  const state={active:true,routes:[],zoneMap:new Map(),cars:[],groups:[],visibleCars:[],billboards:null,slots:Array.from({length:12},()=>[]),loadQueue:[],loadingPump:false,models:new Set(),lastFrame:performance.now(),lastSim:performance.now(),lastModelRender:0,lastProxyRender:0,lastLod:0,callback:null,traffic:null,stats:{}};
  state.version='7-beta';
  state.diagnostics={cesiumVersion:C.VERSION||'unknown',modelApi,modelAsync:modelApi==='fromGltfAsync',billboardCollection:!!C.BillboardCollection,modelReadyPromise:modelApi==='fromGltf'};
  window.__osakaTraffic=state;

  function fromXY(x,y){return [x/SX,y/SY];}
  function distLL(a,b){return Math.hypot((a.lon-b.lon)*SX,(a.lat-b.lat)*SY);}
  function focusLLA(){
    const p=viewer.camera&&viewer.camera.positionCartographic;
    if(p)return {lon:p.longitude/RAD,lat:p.latitude/RAD};
    const a=g&&g.aircraft&&g.aircraft.instance;
    if(a&&a.llaLocation){const v=a.llaLocation;if(Array.isArray(v))return {lon:Number(v[1]),lat:Number(v[0])};}
    return null;
  }
  function hourlyFactor(){
    const p=state.traffic&&state.traffic.hourly_profile&&state.traffic.hourly_profile.estimated_thousand_vehicles_per_hour;
    if(!p||p.length!==24)return 1;
    let h=0;
    try{
      const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
      const get=t=>Number(parts.find(x=>x.type===t)?.value||0);
      h=get('hour')+get('minute')/60;
    }catch(_){const d=new Date();h=d.getHours()+d.getMinutes()/60;}
    const h0=Math.floor(h)%24,h1=(h0+1)%24,t=h-Math.floor(h);
    const now=p[h0]*(1-t)+p[h1]*t;
    let base=0;for(let i=7;i<19;i++)base+=p[i]/12;
    return clamp(now/Math.max(1,base),.08,1.25);
  }
  function locate(route,s){
    const c=route.cum;let lo=0,hi=c.length-1;
    while(lo+1<hi){const m=(lo+hi)>>1;if(c[m]<=s)lo=m;else hi=m;}
    return Math.min(lo,c.length-2);
  }
  function pointAt(route,s){
    s=clamp(s,0,route.len);const c=route.cum,i=locate(route,s),d=Math.max(.001,c[i+1]-c[i]);
    const t=clamp((s-c[i])/d,0,1),t2=t*t,t3=t2*t;
    const i0=Math.max(0,i-1),i3=Math.min(route.n-1,i+2),o=route.p;
    const h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2;
    const out=new Array(3);
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
  function finishRoute(route){
    const mid=pointAt(route,route.len*.5),ll=fromXY(mid[0],mid[1]);
    route.center={lon:ll[0],lat:ll[1]};route.radius=0;route.groups=[];
    const stride=Math.max(1,Math.floor(route.n/80));
    for(let i=0;i<route.n;i+=stride){const dx=route.p[i*3]-mid[0],dy=route.p[i*3+1]-mid[1];route.radius=Math.max(route.radius,Math.hypot(dx,dy));}
    route.radius+=15;
  }
  async function loadRoutes(){
    const res=await fetch(ROUTE_URL,{cache:'no-store'});if(!res.ok)throw Error('道路データHTTP '+res.status);
    if(typeof DecompressionStream==='undefined')throw Error('gzip DecompressionStream 非対応');
    const raw=await res.arrayBuffer();
    const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    const data=await new Response(stream).json();
    if(!data||data.version!==2||!Array.isArray(data.routes))throw Error('道路ルートデータの形式が違います。');
    state.traffic=data.traffic||null;state.zoneMap=new Map((data.traffic_zones||[]).map(z=>[z.id,z]));
    for(const src of data.routes){
      if(!src.tz||!state.zoneMap.has(src.tz)||!src.p||src.p.length<5||Number(src.m)<CFG.MIN_ROUTE_LENGTH_M)continue;
      const xyz=new Float64Array(src.p.length*3),cum=new Float64Array(src.p.length);
      for(let i=0;i<src.p.length;i++){
        const p=src.p[i];xyz[i*3]=p[0]*SX;xyz[i*3+1]=p[1]*SY;xyz[i*3+2]=p[2];
        if(i){const dx=xyz[i*3]-xyz[(i-1)*3],dy=xyz[i*3+1]-xyz[(i-1)*3+1];cum[i]=cum[i-1]+Math.hypot(dx,dy);}
      }
      const len=cum[cum.length-1];if(len<CFG.MIN_ROUTE_LENGTH_M)continue;
      const route={id:src.id,zoneId:src.tz,zoneDistance:src.td||0,p:xyz,cum,n:src.p.length,len,groups:[]};
      finishRoute(route);state.routes.push(route);
    }
    console.log('[OSAKA traffic v7-beta] 道路:',state.routes.length,'/ route length:',(state.routes.reduce((s,r)=>s+r.len,0)/1000).toFixed(1),'km / zones:',state.zoneMap.size);
  }
  function buildTraffic(){
    const factor=hourlyFactor(),zoneStats=new Map();let index=0;
    for(const z of state.zoneMap.values())zoneStats.set(z.id,{name:z.name,routes:0,lengthKm:0,cars:0,vehicles12h:z.vehicles_12h});
    for(const route of state.routes){
      const zone=state.zoneMap.get(route.zoneId);if(!zone)continue;
      const flowPerDirection=(Number(zone.vehicles_12h)||0)/12*factor*.5;
      const densityPerLaneKm=flowPerDirection/CFG.AVG_FLOW_SPEED_KMH/CFG.LANES_PER_DIRECTION;
      const usable=route.len-CFG.MIN_END_CLEARANCE_M*2;
      const maxCarsPerLane=Math.max(0,Math.floor(usable/CFG.MIN_LANE_SPACING_M));
      const laneCars=Math.min(maxCarsPerLane,Math.max(0,Math.round(densityPerLaneKm*route.len/1000)));
      if(!laneCars)continue;
      const zs=zoneStats.get(zone.id);zs.routes++;zs.lengthKm+=route.len/1000;
      for(const dir of [-1,1])for(let lane=0;lane<CFG.LANES_PER_DIRECTION;lane++){
        const group=[];route.groups.push(group);state.groups.push(group);
        const spacing=usable/laneCars;
        for(let j=0;j<laneCars;j++){
          const jitter=rand(-Math.min(2,spacing*.025),Math.min(2,spacing*.025));
          const progress=clamp(CFG.MIN_END_CLEARANCE_M+(j+.5)*spacing+jitter,8,route.len-8);
          const cruise=rand(CFG.MIN_SPEED_MPS,CFG.MAX_SPEED_MPS);
          const car={index:index++,variant:(index-1)%MODEL_FILES.length,route,zoneId:zone.id,dir,lane,progress,prevProgress:progress,
            speed:cruise,targetSpeed:cruise,cruiseSpeed:cruise,nextSpeedChange:performance.now()+rand(4500,9500),
            sleeping:false,respawnAt:0,billboard:null,modelSlot:null,group};
          state.cars.push(car);group.push(car);zs.cars++;
        }
        group.sort((a,b)=>a.progress-b.progress);
      }
    }
    state.stats={totalCars:state.cars.length,routeCount:state.routes.length,routeLengthKm:state.routes.reduce((s,r)=>s+r.len,0)/1000,
      hourFactor:factor,hourJST:new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}),zoneStats:Array.from(zoneStats.values()).filter(z=>z.routes),
      actualModelPoolMax:MODEL_FILES.length*CFG.MODEL_POOL_PER_VARIANT,proxyType:'single BillboardCollection'};
    console.log('[OSAKA traffic v7-beta] 推計車両:',state.stats.totalCars.toLocaleString(),'台 / 係数:',factor.toFixed(2),' / 車間最小:',CFG.MIN_LANE_SPACING_M+'m');
    for(const z of state.stats.zoneStats)console.log('[OSAKA traffic v7-beta]',z.name,'routes',z.routes,'length',(z.lengthKm).toFixed(1)+'km','cars',z.cars,'12h count',z.vehicles12h);
  }
  function interpProgress(car,alpha){return car.prevProgress+(car.progress-car.prevProgress)*alpha;}
  function getPose(car,progress){
    const r=car.route,s=car.dir>0?progress:r.len-progress,L=CFG.LOOKAHEAD_M;
    const a=pointAt(r,clamp(s-L,0,r.len)),b=pointAt(r,clamp(s+L,0,r.len)),p=pointAt(r,s);
    const east=b[0]-a[0],north=b[1]-a[1],horizontal=Math.max(.01,Math.hypot(east,north));
    let heading=Math.atan2(east,north),pitch=Math.atan2(b[2]-a[2],horizontal);
    if(car.dir<0){heading+=Math.PI;pitch=-pitch;}
    const offset=CFG.LANE_OFFSET_M[car.lane],x=p[0]+Math.cos(heading)*offset,y=p[1]-Math.sin(heading)*offset;
    const ll=fromXY(x,y);return {lon:ll[0],lat:ll[1],alt:p[2]+CFG.HEIGHT_OFFSET_M,heading,pitch};
  }
  function makeMatrix(pose){
    const pos=C.Cartesian3.fromDegrees(pose.lon,pose.lat,pose.alt);
    const hpr=new C.HeadingPitchRoll(pose.heading+CFG.MODEL_HEADING_OFFSET_DEG*RAD,pose.pitch,0);
    return C.Transforms.headingPitchRollToFixedFrame(pos,hpr);
  }
  function roundedRectPath(x,px,py,w,h,r){
    if(typeof x.roundRect==='function'){x.beginPath();x.roundRect(px,py,w,h,r);return;}
    x.beginPath();x.moveTo(px+r,py);x.lineTo(px+w-r,py);x.quadraticCurveTo(px+w,py,px+w,py+r);
    x.lineTo(px+w,py+h-r);x.quadraticCurveTo(px+w,py+h,px+w-r,py+h);x.lineTo(px+r,py+h);
    x.quadraticCurveTo(px,py+h,px,py+h-r);x.lineTo(px,py+r);x.quadraticCurveTo(px,py,px+r,py);x.closePath();
  }
  function makeCarImage(color){
    const c=document.createElement('canvas');c.width=64;c.height=32;const x=c.getContext('2d');
    x.clearRect(0,0,64,32);x.fillStyle='rgba(0,0,0,.42)';x.fillRect(7,5,50,22);
    x.fillStyle=color;roundedRectPath(x,5,4,54,24,7);x.fill();
    x.fillStyle='rgba(30,42,54,.9)';roundedRectPath(x,17,7,30,18,5);x.fill();
    x.fillStyle='rgba(205,225,238,.8)';x.fillRect(19,8,11,7);x.fillRect(34,8,11,7);
    x.fillStyle='rgba(240,240,240,.6)';x.fillRect(1,10,4,4);x.fillRect(59,10,4,4);
    x.fillStyle='rgba(255,65,65,.85)';x.fillRect(1,19,4,5);x.fillRect(59,19,4,5);
    return c;
  }
  const images=PALETTE.map(makeCarImage);
  state.billboards=new C.BillboardCollection();scene.primitives.add(state.billboards);
  function ensureBillboard(car){
    if(car.billboard)return car.billboard;
    car.billboard=state.billboards.add({image:images[car.variant],show:false,width:7.2,height:3.0,sizeInMeters:true,rotation:0,
      horizontalOrigin:C.HorizontalOrigin.CENTER,verticalOrigin:C.VerticalOrigin.CENTER,allowPicking:false});
    return car.billboard;
  }
  function hideCurrent(){
    for(const car of state.visibleCars){if(car.billboard)car.billboard.show=false;car.modelSlot=null;}
    for(const list of state.slots)for(const slot of list){slot.car=null;if(slot.model)slot.model.show=false;}
    state.visibleCars.length=0;
  }
  function queueModel(slot){
    if(slot.queued||slot.loading||slot.model||slot.failed)return;
    slot.queued=true;state.loadQueue.push(slot);pumpModelQueue();
  }
  function pumpModelQueue(){
    if(state.loadingPump||!state.active||!state.loadQueue.length)return;
    state.loadingPump=true;
    const run=async()=>{
      let slot=null,model=null;
      try{
        slot=state.loadQueue.shift();
        if(!slot)return;
        slot.queued=false;
        if(slot.model||slot.failed)return;
        slot.loading=true;
        const options={
          url:ROOT+MODEL_FILES[slot.variant],
          modelMatrix:C.Matrix4.IDENTITY,
          scale:CFG.MODEL_SCALE,
          show:false,
          allowPicking:false,
          incrementallyLoadTextures:true,
          asynchronous:true,
          shadows:C.ShadowMode?C.ShadowMode.DISABLED:0
        };
        if(modelApi==='fromGltfAsync'){
          // Cesium modern API: model is resolved after resources are ready.
          model=await C.Model.fromGltfAsync(options);
          if(!state.active){try{model.destroy&&model.destroy();}catch(_){}return;}
          slot.model=model;
          scene.primitives.add(model);
          state.models.add(model);
          slot.ready=true;
          slot.loading=false;
          if(model.errorEvent&&model.errorEvent.addEventListener){
            model.errorEvent.addEventListener(err=>console.warn('[OSAKA traffic v7-beta] model runtime error:',MODEL_FILES[slot.variant],err));
          }
        }else{
          // Compatibility fallback for older Cesium builds.
          model=C.Model.fromGltf(options);
          slot.model=model;
          scene.primitives.add(model);
          state.models.add(model);
          if(model.readyPromise&&typeof model.readyPromise.then==='function'){
            await model.readyPromise;
          }else if(model.ready===false){
            await new Promise((resolve,reject)=>{
              let done=false;
              const ok=()=>{if(done)return;done=true;resolve();};
              const bad=e=>{if(done)return;done=true;reject(e);};
              if(model.readyEvent&&model.readyEvent.addEventListener)model.readyEvent.addEventListener(ok);
              if(model.errorEvent&&model.errorEvent.addEventListener)model.errorEvent.addEventListener(bad);
              setTimeout(()=>{if(!model.ready)bad(Error('Model ready timeout'));else ok();},30000);
            });
          }
          if(!state.active)return;
          slot.ready=true;
          slot.loading=false;
        }
      }catch(e){
        if(slot){
          slot.failed=true;
          slot.loading=false;
          slot.ready=false;
          slot.model=null;
        }
        if(model){try{scene.primitives.remove(model);}catch(_){}try{model.destroy&&model.destroy();}catch(_){}state.models.delete(model);}
        console.warn('[OSAKA traffic v7-beta] GLB load failed:',slot?MODEL_FILES[slot.variant]:'unknown',e);
      }finally{
        state.loadingPump=false;
        if(state.active&&state.loadQueue.length)setTimeout(pumpModelQueue,CFG.MODEL_LOAD_INTERVAL_MS);
      }
    };
    setTimeout(run,0);
  }
  function getOrCreateSlot(variant,index){
    let slot=state.slots[variant][index];
    if(!slot){slot={variant,index,model:null,ready:false,loading:false,queued:false,failed:false,car:null};state.slots[variant][index]=slot;queueModel(slot);}
    else queueModel(slot);
    return slot;
  }
  function refreshLOD(focus,now){
    hideCurrent();
    const cam=viewer.camera,fr=cam&&cam.frustum;
    let culling=null;
    try{if(fr&&fr.computeCullingVolume)culling=fr.computeCullingVolume(cam.positionWC,cam.directionWC,cam.upWC);}catch(_){}
    const byVariant=Array.from({length:12},()=>[]);
    for(const route of state.routes){
      if(distLL(focus,route.center)>CFG.VISIBLE_RADIUS_M+route.radius)continue;
      for(const group of route.groups)for(const car of group){
        if(car.sleeping)continue;
        const p=interpProgress(car,clamp((now-state.lastSim)/CFG.SIM_INTERVAL_MS,0,1));
        const pose=getPose(car,p),pos=C.Cartesian3.fromDegrees(pose.lon,pose.lat,pose.alt);
        const d=distLL(focus,{lon:pose.lon,lat:pose.lat});if(d>CFG.VISIBLE_RADIUS_M)continue;
        if(culling){try{if(culling.computeVisibility(new C.BoundingSphere(pos,9))===C.Intersect.OUTSIDE)continue;}catch(_){}}
        car._pose=pose;car._pos=pos;car._distance=d;ensureBillboard(car);
        car.billboard.show=true;state.visibleCars.push(car);
        if(d<=CFG.MODEL_RADIUS_M)byVariant[car.variant].push(car);
      }
    }
    // 3D GLB is capped to 2 instances per variant (24 drawables total); all other traffic stays visible as one batched billboard set.
    for(let v=0;v<12;v++){
      const a=byVariant[v];a.sort((x,y)=>x._distance-y._distance);
      for(let i=0;i<Math.min(CFG.MODEL_POOL_PER_VARIANT,a.length);i++){
        const car=a[i],slot=getOrCreateSlot(v,i);car.modelSlot=slot;slot.car=car;
      }
    }
    state.stats.visibleCars=state.visibleCars.length;
    state.stats.realModelSlots=state.slots.reduce((s,a)=>s+a.length,0);
  }
  function updateMotion(dt,now){
    for(const group of state.groups){
      let resort=false;
      for(let i=group.length-1;i>=0;i--){
        const car=group[i];
        if(car.sleeping){
          if(now>=car.respawnAt){car.progress=rand(18,38);car.prevProgress=car.progress;car.speed=rand(CFG.MIN_SPEED_MPS,CFG.MAX_SPEED_MPS);car.cruiseSpeed=car.speed;car.targetSpeed=car.speed;car.nextSpeedChange=now+rand(4500,9500);car.sleeping=false;resort=true;}
          else continue;
        }
        car.prevProgress=car.progress;
        if(now>=car.nextSpeedChange){car.targetSpeed=clamp(car.cruiseSpeed+rand(-1,1),CFG.MIN_SPEED_MPS,CFG.MAX_SPEED_MPS);car.nextSpeedChange=now+rand(6500,12000);}
        const leader=i===group.length-1?null:group[i+1];let target=car.targetSpeed;
        if(leader&&!leader.sleeping){
          const gap=leader.progress-car.progress;
          const safe=CFG.SAFE_GAP_M+car.speed*CFG.HEADWAY_S;
          if(gap>0&&gap<safe)target=Math.min(target,Math.max(4,(gap-CFG.SAFE_GAP_M)/CFG.HEADWAY_S));
        }
        const dv=clamp(target-car.speed,-CFG.BRAKE_MPS2*dt,CFG.ACCEL_MPS2*dt);car.speed+=dv;
        car.progress+=car.speed*dt;
        if(car.progress>=car.route.len-12){car.sleeping=true;car.respawnAt=now+rand(CFG.RESPAWN_MIN_MS,CFG.RESPAWN_MAX_MS);if(car.billboard)car.billboard.show=false;if(car.modelSlot&&car.modelSlot.model)car.modelSlot.model.show=false;resort=true;}
      }
      if(resort)group.sort((a,b)=>a.progress-b.progress);
    }
  }
  function renderModels(alpha){
    for(const car of state.visibleCars){
      const slot=car.modelSlot;if(!slot||!slot.model||!slot.ready||!slot.car)continue;
      const p=interpProgress(car,alpha),pose=getPose(car,p);
      slot.model.modelMatrix=makeMatrix(pose);slot.model.show=true;
      if(car.billboard)car.billboard.show=false;
    }
  }
  function renderProxies(alpha){
    for(const car of state.visibleCars){
      const slot=car.modelSlot;
      if(slot&&slot.model&&slot.ready&&slot.car)continue;
      if(!car.billboard)continue;
      const p=interpProgress(car,alpha),pose=getPose(car,p);
      car.billboard.position=C.Cartesian3.fromDegrees(pose.lon,pose.lat,pose.alt);
      car.billboard.rotation=-pose.heading;
      car.billboard.show=true;
    }
  }
  state.stop=()=>{
    if(!state.active)return;state.active=false;
    if(state.callback){try{if(g.api.removeFrameCallback)g.api.removeFrameCallback(state.callback);else if(scene.preRender&&scene.preRender.removeEventListener)scene.preRender.removeEventListener(state.callback);}catch(_){}}
    for(const m of Array.from(state.models)){try{scene.primitives.remove(m);}catch(_){}}
    if(state.billboards){try{scene.primitives.remove(state.billboards);}catch(_){}}
    state.models.clear();state.loadQueue.length=0;state.visibleCars.length=0;state.cars.length=0;state.groups.length=0;
    console.log('[OSAKA traffic v7-beta] 停止しました。');
  };
  try{
    await loadRoutes();if(!state.active)return;
    buildTraffic();if(!state.cars.length)throw Error('交通量から車両を生成できませんでした。');
    const focus=focusLLA();if(!
focus)throw Error('GeoFSカメラ位置が取得できません。');
    const now=performance.now();state.lastFrame=now;state.lastSim=now;state.lastLod=0;
    state.callback=()=>{
      if(!state.active)return;
      const t=performance.now();
      if(t-state.lastSim>=CFG.SIM_INTERVAL_MS){const dt=clamp((t-state.lastSim)/1000,.05,.22);updateMotion(dt,t);state.lastSim=t;}
      if(t-state.lastLod>=CFG.LOD_INTERVAL_MS){state.lastLod=t;const f=focusLLA();if(f)refreshLOD(f,t);}
      const alpha=clamp((t-state.lastSim)/CFG.SIM_INTERVAL_MS,0,1);
      if(t-state.lastModelRender>=CFG.MODEL_RENDER_INTERVAL_MS){state.lastModelRender=t;renderModels(alpha);}
      if(t-state.lastProxyRender>=CFG.PROXY_RENDER_INTERVAL_MS){state.lastProxyRender=t;renderProxies(alpha);}
    };
    if(g.api.addFrameCallback)g.api.addFrameCallback(state.callback);else scene.preRender.addEventListener(state.callback);
    state.callback();
    console.log('[OSAKA traffic v7-beta] 起動 / 推計 '+state.cars.length.toLocaleString()+'台 / 道路 '+state.routes.length+'本 / 実車GLB最大24台 / 長方形は20kmまで');
    console.log('[OSAKA traffic v7-beta] シミュレーション120ms / 実車33ms / 長方形110ms / LOD1000ms / BillboardCollection一括描画');
    console.log('[OSAKA traffic v7-beta] stats:',state.stats);
    console.log('[OSAKA traffic v7-beta] Cesium診断:',state.diagnostics);
  }catch(e){console.error('[OSAKA traffic v7-beta] 起動失敗:',e);state.stop();}
})()