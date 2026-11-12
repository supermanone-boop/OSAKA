'use strict';
(async()=>{
  const ROOT='https://raw.githubusercontent.com/supermanone-boop/model/main/';
  const ROUTE_URL=ROOT+'osaka_road_routes_v5.json.gz';
  const g=window.geofs,C=window.Cesium,viewer=g&&g.api&&g.api.viewer;
  if(!C||!viewer||!viewer.scene||!C.Model||!C.Model.fromGltf){console.error('[OSAKA traffic v5] Cesium.Model.fromGltf / geofs.api.viewer がありません。');return;}
  if(window.__osakaTraffic&&window.__osakaTraffic.stop)window.__osakaTraffic.stop();

  const MODEL_FILES=[
    'sag1_factory.glb','sag1_black.glb','sag1_white.glb','sag1_silver.glb','sag1_blue.glb','sag1_red.glb',
    'xterra2_factory.glb','xterra2_black.glb','xterra2_white.glb','xterra2_silver.glb','xterra2_blue.glb','xterra2_red.glb'
  ];
  const CFG={
    VISIBLE_RADIUS_M:20000,DETAIL_RADIUS_M:18000,
    MIN_ROUTE_LENGTH_M:250,ROUTE_ZONE_RADIUS_M:18000,
    LANE_OFFSET_M:[2.1,5.7],HEIGHT_OFFSET_M:0.38,
    MODEL_SCALE:1,MODEL_HEADING_OFFSET_DEG:0,LOOKAHEAD_M:22,
    AVG_FLOW_SPEED_KMH:72,LANES_PER_DIRECTION:2,MIN_LANE_SPACING_M:46,
    MIN_SPEED_MPS:17.5,MAX_SPEED_MPS:21.5,SAFE_GAP_M:10,HEADWAY_S:1.85,
    ACCEL_MPS2:0.38,BRAKE_MPS2:0.82,
    LOD_INTERVAL_MS:350,RESPAWN_MIN_MS:1800,RESPAWN_MAX_MS:3200
  };
  const R=6378137,RAD=Math.PI/180,LAT0=34.6,SX=R*RAD*Math.cos(LAT0*RAD),SY=R*RAD;
  const PALETTE=['#929292','#202124','#eeeeee','#aeb4ba','#2462b4','#bd2428','#929292','#202124','#eeeeee','#aeb4ba','#2462b4','#bd2428'];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const rand=(a,b)=>a+Math.random()*(b-a);
  const state={active:true,routes:[],zoneMap:new Map(),cars:[],groups:[],visibleCars:[],models:new Set(),proxies:new Set(),lastFrame:performance.now(),lastLod:0,callback:null,sourceLabel:'未読込',traffic:null,stats:{}};
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
    return clamp(now/Math.max(1,base),.08,1.2);
  }
  function locate(route,s){
    const c=route.cum;let lo=0,hi=c.length-1;
    while(lo+1<hi){const m=(lo+hi)>>1;if(c[m]<=s)lo=m;else hi=m;}
    return Math.min(lo,c.length-2);
  }
  // 距離に沿った非一様Hermite補間。標準Catmull-Romより端点・勾配の暴れを抑えます。
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
      if(k===2)v=clamp(v,Math.min(p1,p2)-.18,Math.max(p1,p2)+.18);
      out[k]=v;
    }
    return out;
  }
  function finishRoute(route){
    const mid=pointAt(route,route.len*.5),ll=fromXY(mid[0],mid[1]);
    route.center={lon:ll[0],lat:ll[1]};route.radius=0;
    const stride=Math.max(1,Math.floor(route.n/80));
    for(let i=0;i<route.n;i+=stride){const dx=route.p[i*3]-mid[0],dy=route.p[i*3+1]-mid[1];route.radius=Math.max(route.radius,Math.hypot(dx,dy));}
    route.radius+=12;route.groups=[];
  }
  async function loadRoutes(){
    const res=await fetch(ROUTE_URL,{cache:'no-store'});if(!res.ok)throw Error('道路データHTTP '+res.status);
    if(typeof DecompressionStream==='undefined')throw Error('gzip DecompressionStream 非対応');
    const raw=await res.arrayBuffer();
    const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    const data=await new Response(stream).json();
    if(!data||data.version!==2||!Array.isArray(data.routes))throw Error('道路ルートデータの形式が違います。');
    state.traffic=data.traffic||null;state.sourceLabel=state.traffic?.network?.month||'unknown';
    state.zoneMap=new Map((data.traffic_zones||[]).map(z=>[z.id,z]));
    for(const src of data.routes){
      if(!src.tz||!state.zoneMap.has(src.tz)||!src.p||src.p.length<5||Number(src.m)<CFG.MIN_ROUTE_LENGTH_M)continue;
      const xyz=new Float64Array(src.p.length*3),cum=new Float64Array(src.p.length);
      for(let i=0;i<src.p.length;i++){
        const p=src.p[i];xyz[i*3]=p[0]*SX;xyz[i*3+1]=p[1]*SY;xyz[i*3+2]=p[2];
        if(i){const dx=xyz[i*3]-xyz[(i-1)*3],dy=xyz[i*3+1]-xyz[(i-1)*3+1];cum[i]=cum[i-1]+Math.hypot(dx,dy);}
      }
      const len=cum[cum.length-1];if(len<CFG.MIN_ROUTE_LENGTH_M)continue;
      const route={id:src.id,zoneId:src.tz,zoneDistance:src.td||0,p:xyz,cum,n:src.p.length,len,m:src.m||len};
      finishRoute(route);state.routes.push(route);
    }
    console.log('[OSAKA traffic v5] roads:',state.routes.length,'/ coverage:',state.routes.reduce((s,r)=>s+r.len,0)/1000,'km / census zones:',state.zoneMap.size);
  }
  function hideCar(car){
    if(car.model)car.model.show=false;
    if(car.proxy)car.proxy.show=false;
    car.lod='off';
  }
  function buildTraffic(){
    const factor=hourlyFactor(),zoneStats=new Map();let index=0;
    for(const z of state.zoneMap.values())zoneStats.set(z.id,{name:z.name,routes:0,lengthKm:0,cars:0,vehicles12h:z.vehicles_12h});
    for(const route of state.routes){
      const zone=state.zoneMap.get(route.zoneId);if(!zone)continue;
      const flowOneDirection=(Number(zone.vehicles_12h)||0)/12*factor*.5;
      const densityPerLaneKm=flowOneDirection/CFG.AVG_FLOW_SPEED_KMH/CFG.LANES_PER_DIRECTION;
      const maxCarsPerLane=Math.max(0,Math.floor((route.len-30)/CFG.MIN_LANE_SPACING_M));
      const laneCount=Math.min(maxCarsPerLane,Math.max(0,Math.round(densityPerLaneKm*route.len/1000)));
      if(!laneCount)continue;
      const zs=zoneStats.get(zone.id);zs.routes++;zs.lengthKm+=route.len/1000;
      for(const dir of [-1,1]){
        for(let lane=0;lane<CFG.LANES_PER_DIRECTION;lane++){
          const n=laneCount;
          if(!n)continue;
          const group=[];route.groups.push(group);state.groups.push(group);
          const usable=route.len-30,spacing=usable/n;
          for(let j=0;j<n;j++){
            const jitter=rand(-Math.min(4,spacing*.06),Math.min(4,spacing*.06));
            const progress=clamp(15+(j+.5)*spacing+jitter,8,route.len-8);
            const cruise=rand(CFG.MIN_SPEED_MPS,CFG.MAX_SPEED_MPS),car={
              index:index,variant:index%MODEL_FILES.length,route,zoneId:zone.id,dir,lane,progress,
              speed:cruise,targetSpeed:cruise,cruiseSpeed:cruise,nextSpeedChange:performance.now()+rand(3500,8000),
              sleeping:false,respawnAt:0,model:null,modelLoading:false,proxy:null,lod:'off',group
            };
            state.cars.push(car);group.push(car);zs.cars++;index++;
          }
          group.sort((a,b)=>a.progress-b.progress);
        }
      }
    }
    state.stats={totalCars:state.cars.length,routeCount:state.routes.length,routeLengthKm:state.routes.reduce((s,r)=>s+r.len,0)/1000,hourFactor:factor,hourJST:new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}),zoneStats:Array.from(zoneStats.values()).filter(z=>z.routes)};
    console.log('[OSAKA traffic v5] 推計車両数:',state.stats.totalCars,'/ 時間帯係数:',factor.toFixed(2),'/ 道路延長:',state.stats.routeLengthKm.toFixed(1)+'km');
    for(const z of state.stats.zoneStats)console.log('[OSAKA traffic v5]',z.name,'ルート',z.routes,'/ 延長',z.lengthKm.toFixed(1)+'km','/ 車',z.cars,'/ 実測12h',z.vehicles12h);
  }
  function getPose(car){
    const r=car.route,s=car.dir>0?car.progress:r.len-car.progress,L=CFG.LOOKAHEAD_M;
    const a=pointAt(r,clamp(s-L,0,r.len)),b=pointAt(r,clamp(s+L,0,r.len)),p=pointAt(r,s);
    const east=b[0]-a[0],north=b[1]-a[1],horizontal=Math.max(.01,Math.hypot(east,north));
    let heading=Math.atan2(east,north),pitch=Math.atan2(b[2]-a[2],horizontal);
    if(car.dir<0){heading+=Math.PI;pitch=-pitch;}
    // 車線は進行方向に対して常に右側。逆方向車も反対側の車道に配置されます。
    const offset=CFG.LANE_OFFSET_M[car.lane],x=p[0]+Math.cos(heading)*offset,y=p[1]-Math.sin(heading)*offset;
    const ll=fromXY(x,y);return {lon:ll[0],lat:ll[1],alt:p[2]+CFG.HEIGHT_OFFSET_M,heading,pitch};
  }
  function makeTransform(pose){
    const pos=C.Cartesian3.fromDegrees(pose.lon,pose.lat,pose.alt);
    const hpr=new C.HeadingPitchRoll(pose.heading+CFG.MODEL_HEADING_OFFSET_DEG*RAD,pose.pitch,0);
    return {pos,hpr,matrix:C.Transforms.headingPitchRollToFixedFrame(pos,hpr)};
  }
  function visibleInFrustum(pos){
    try{
      const cam=viewer.camera,fr=cam.frustum;if(!fr||!fr.computeCullingVolume)return true;
      const cv=fr.computeCullingVolume(cam.positionWC,cam.directionWC,cam.upWC);
      return cv.computeVisibility(new C.BoundingSphere(pos,12))!==C.Intersect.OUTSIDE;
    }catch(_){return true;}
  }
  function removeModel(car){
    if(!car.model)return;
    try{viewer.scene.primitives.remove(car.model);}catch(_){}
    state.models.delete(car.model);car.model=null;car.modelLoading=false;
  }
  function removeProxy(car){
    if(!car.proxy)return;
    try{viewer.entities.remove(car.proxy);}catch(_){}
    state.proxies.delete(car.proxy);car.proxy=null;
  }
  function ensureModel(car,matrix){
    if(car.model){car.model.modelMatrix=matrix;car.model.show=true;return;}
    if(car.modelLoading)return;
    car.modelLoading=true;const file=MODEL_FILES[car.variant];
    try{
      const m=C.Model.fromGltf({url:ROOT+file,modelMatrix:matrix,scale:CFG.MODEL_SCALE,show:false,allowPicking:false,incrementallyLoadTextures:true,asynchronous:true,shadows:C.ShadowMode?C.ShadowMode.DISABLED:0});
      car.model=m;state.models.add(m);viewer.scene.primitives.add(m);
      const ready=m.readyPromise;
      if(ready&&ready.then)ready.then(()=>{if(state.active&&car.model===m){car.modelLoading=false;m.show=car.lod==='model';}}).catch(e=>{if(car.model===m)removeModel(car);console.warn('[OSAKA traffic v5] GLB読込失敗:',file,e);});
      else car.modelLoading=false;
    }catch(e){car.modelLoading=false;console.warn('[OSAKA traffic v5] GLB生成失敗:',file,e);}
  }
  function ensureProxy(car,tx){
    if(!car.proxy){
      const color=C.Color.fromCssColorString(PALETTE[car.variant]);
      car.proxy=viewer.entities.add({show:true,position:tx.pos,orientation:C.Transforms.headingPitchRollQuaternion(tx.pos,tx.hpr),box:{dimensions:new C.Cartesian3(4.6,1.9,1.45),material:color,outline:false}});
      state.proxies.add(car.proxy);
    }else{car.proxy.show=true;car.proxy.position=tx.pos;car.proxy.orientation=C.Transforms.headingPitchRollQuaternion(tx.pos,tx.hpr);}
  }
  function refreshLOD(focus){
    state.visibleCars.length=0;
    for(const route of state.routes){
      const routeDistance=distLL(focus,route.center);
      if(routeDistance>CFG.VISIBLE_RADIUS_M+route.radius){
        for(const group of route.groups)for(const car of group)if(car.lod!=='off')hideCar(car);
        continue;
      }
      for(const group of route.groups)for(const car of group){
        if(car.sleeping){hideCar(car);continue;}
        const pose=getPose(car),tx=makeTransform(pose),d=distLL(focus,{lon:pose.lon,lat:pose.lat});
        if(d>CFG.VISIBLE_RADIUS_M||!visibleInFrustum(tx.pos)){hideCar(car);continue;}
        if(d<=CFG.DETAIL_RADIUS_M){
          car.lod='model';removeProxy(car);ensureModel(car,tx.matrix);
        }else{
          car.lod='box';removeModel(car);ensureProxy(car,tx);
        }
        state.visibleCars.push(car);
      }
    }
  }
  // LODの判定は間引き、位置・姿勢は毎フレーム更新して450ms刻みのカクつきを解消します。
  function updateVisibleTransforms(){
    for(const car of state.visibleCars){
      if(car.sleeping||car.lod==='off')continue;
      const pose=getPose(car),tx=makeTransform(pose);
      if(car.lod==='model'&&car.model){car.model.modelMatrix=tx.matrix;car.model.show=true;}
      else if(car.lod==='box'&&car.proxy){car.proxy.position=tx.pos;car.proxy.orientation=C.Transforms.headingPitchRollQuaternion(tx.pos,tx.hpr);car.proxy.show=true;}
    }
  }
  function updateMotion(dt,now){
    for(const group of state.groups){
      let resort=false;
      for(let i=group.length-1;i>=0;i--){
        const car=group[i];
        if(car.sleeping){
          if(now>=car.respawnAt){car.progress=rand(15,35);car.speed=rand(CFG.MIN_SPEED_MPS,CFG.MAX_SPEED_MPS);car.cruiseSpeed=car.speed;car.targetSpeed=car.speed;car.nextSpeedChange=now+rand(3500,8000);car.sleeping=false;resort=true;}
          else continue;
        }
        if(now>=car.nextSpeedChange){car.targetSpeed=clamp(car.cruiseSpeed+rand(-1.25,1.25),CFG.MIN_SPEED_MPS,CFG.MAX_SPEED_MPS);car.nextSpeedChange=now+rand(6500,11500);}
        const leader=i===group.length-1?null:group[i+1];let target=car.targetSpeed;
        if(leader&&!leader.sleeping){
          const gap=leader.progress-car.progress;
          const safe=CFG.SAFE_GAP_M+car.speed*CFG.HEADWAY_S;
          if(gap>0&&gap<safe)target=Math.min(target,Math.max(5,(gap-CFG.SAFE_GAP_M)/CFG.HEADWAY_S));
        }
        const dv=clamp(target-car.speed,-CFG.BRAKE_MPS2*dt,CFG.ACCEL_MPS2*dt);car.speed+=dv;
        car.progress+=car.speed*dt;
        if(car.progress>=car.route.len-12){
          car.sleeping=true;car.respawnAt=now+rand(CFG.RESPAWN_MIN_MS,CFG.RESPAWN_MAX_MS);hideCar(car);resort=true;
        }
      }
      if(resort)group.sort((a,b)=>a.progress-b.progress);
    }
  }
  state.stop=()=>{
    if(!state.active)return;state.active=false;
    if(state.callback){try{if(g.api.removeFrameCallback)g.api.removeFrameCallback(state.callback);else if(viewer.scene.preRender&&viewer.scene.preRender.removeEventListener)viewer.scene.preRender.removeEventListener(state.callback);}catch(_){}}
    for(const m of Array.from(state.models)){try{viewer.scene.primitives.remove(m);}catch(_){}}
    for(const e of Array.from(state.proxies)){try{viewer.entities.remove(e);}catch(_){}}
    state.models.clear();state.proxies.clear();state.cars.length=0;state.groups.length=0;state.visibleCars.length=0;
    console.log('[OSAKA traffic v5] 停止しました。');
  };
  try{
    await loadRoutes();if(!state.active)return;
    buildTraffic();
    if(!state.cars.length)throw Error('交通量から車両を生成できませんでした。');
    const focus=focusLLA();if(!focus)throw Error('GeoFSのカメラ位置が取得できません。');
    state.callback=()=>{
      if(!state.active)return;
      const now=performance.now(),dt=clamp((now-state.lastFrame)/1000,0,.15);state.lastFrame=now;
      updateMotion(dt,now);
      if(now-state.lastLod>=CFG.LOD_INTERVAL_MS){state.lastLod=now;const f=focusLLA();if(f)refreshLOD(f);}
      updateVisibleTransforms();
    };
    if(g.api.addFrameCallback)g.api.addFrameCallback(state.callback);else viewer.scene.preRender.addEventListener(state.callback);
    const now=performance.now();state.lastLod=0;state.callback();
    console.log('[OSAKA traffic v5] 起動完了 / 推計車両 '+state.cars.length.toLocaleString()+'台 / 実車 '+(CFG.DETAIL_RADIUS_M/1000)+'km以内 / 長方形 '+(CFG.DETAIL_RADIUS_M/1000)+'〜'+(CFG.VISIBLE_RADIUS_M/1000)+'km / '+(CFG.VISIBLE_RADIUS_M/1000)+'km超は非表示');
    console.log('[OSAKA traffic v5] 走行更新: 毎フレーム / LOD確認:',CFG.LOD_INTERVAL_MS+'ms / 車間目安:',CFG.MIN_LANE_SPACING_M+'m / 追従:',CFG.HEADWAY_S+'s');
    console.log('[OSAKA traffic v5] 全車種の実測交通量をSUVモデルで視覚化。交通量は4地点の2021年センサス値を最寄り基準として18km以内の道路へ展開した推計であり、リアルタイムの車両位置情報ではありません。');
  }catch(e){console.error('[OSAKA traffic v5] 起動失敗:',e);state.stop();}
})();
