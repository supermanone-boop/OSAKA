/*
 * HANKYU GEOFS TRAFFIC v1.4 - Cesium 1.96 compatible
 * Upload all package assets to the same Hugging Face repository, then paste this file into GeoFS DevTools Console.
 * Route paths are reconstructed from the supplied GeoJSON. Station coordinates are fetched from the public station API.
 */
"use strict";
(async function(){
  const C=window.Cesium, g=window.geofs, viewer=g&&g.api&&g.api.viewer;
  if(!C||!viewer){console.error("[Hankyu] GeoFS/Cesium viewer not found.");return;}
  if(window.__HANKYU_TRAFFIC__&&window.__HANKYU_TRAFFIC__.stop){window.__HANKYU_TRAFFIC__.stop();}

  // ===================== SETTINGS =====================
  const BASE="https://huggingface.co/supermanone-boop/hankyu/resolve/main/";
  const ROUTE_FILE="Hankyu_RoutePaths_v1.json";
  const STATION_API="https://train.teraren.com/lines/";
  const CONFIG={
    enabledLines:["kobe","takarazuka","kyoto","imazu_takarazuka","imazu_imazu","koyo","itami","minoo","senri","arashiyama"],
    maxVisibleTrains:3,             // only nearest 3 consists are drawn to protect GeoFS FPS
    maxSpeed:27.0,                  // m/s, about 97 km/h
    acceleration:0.58,              // m/s^2
    braking:0.82,                   // m/s^2
    stationDwell:18,                // seconds at each station
    terminalDwell:28,               // seconds at each terminal
    stationSnapMeters:220,          // stations farther from the selected path are ignored
    stationStopOffset:0,            // meters from station track projection
    trackLift:0.45,                 // rail/sleeper clearance above terrain
    modelHeightOffset:1.5,          // raise each train model 1.5 m above the route/track placement height
    terrainBatchSize:350,
    terrainSampleEvery:1,           // sample all source path vertices
    updateMaxDelta:0.12,
    modelForwardCorrection:Math.PI, // rotate the train 180 degrees horizontally to reverse its nose direction
    showRouteDebug:false
  };
  const CAR_FILES=[
    "hankyu_car_9300.glb", "hankyu_car_9900.glb", "hankyu_car_9850.glb", "hankyu_car_9900.glb",
    "hankyu_car_9850.glb", "hankyu_car_9900.glb", "hankyu_car_9800.glb", "hankyu_car_9400.glb"
  ];
  const CAR_SPACING=19.4;
  const CONSIST_LENGTH=CAR_SPACING*7; // first-to-last car centre distance
  const STATUS={running:true, trains:[], routeNames:[], errors:[]};
  const log=(...a)=>console.log("%c[Hankyu]","color:#b98b43;font-weight:bold",...a);
  const warn=(...a)=>console.warn("[Hankyu]",...a);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mod=(v,m)=>((v%m)+m)%m;

  async function getJSON(url){const r=await fetch(url,{mode:"cors",cache:"force-cache"});if(!r.ok)throw new Error("HTTP "+r.status+" "+url);return r.json();}
  const routeData=await getJSON(BASE+ROUTE_FILE);
  if(!routeData||!Array.isArray(routeData.routes))throw new Error("Route JSON format invalid");

  // Build per-route station arrays. If the API is blocked, do not silently invent stop coordinates.
  const stationCache=new Map();
  async function getStations(id){
    if(!stationCache.has(id))stationCache.set(id,getJSON(STATION_API+id+"/stations.json"));
    return stationCache.get(id);
  }

  function hav(a,b){const R=6371008.8,la=a[1]*Math.PI/180,lb=b[1]*Math.PI/180,dlat=lb-la,dlon=(b[0]-a[0])*Math.PI/180;const x=dlon*Math.cos((la+lb)/2),y=dlat;return Math.hypot(x,y)*R;}
  function bearing(a,b){const la=a[1]*Math.PI/180,lb=b[1]*Math.PI/180,dl=(b[0]-a[0])*Math.PI/180;return Math.atan2(Math.sin(dl)*Math.cos(lb),Math.cos(la)*Math.sin(lb)-Math.sin(la)*Math.cos(lb)*Math.cos(dl));}
  function projectLocal(lon,lat,originLon,originLat){const x=(lon-originLon)*111320*Math.cos(originLat*Math.PI/180),y=(lat-originLat)*111320;return [x,y];}

  function makePath(points,sourceOffsets){
    const clean=[],cleanOffsets=[];
    for(let k=0;k<points.length;k++){const p=points[k];if(!clean.length||hav(clean[clean.length-1],p)>0.3){clean.push([+p[0],+p[1]]);cleanOffsets.push(Number(sourceOffsets&&sourceOffsets[k])||0);}}
    if(clean.length<2)throw new Error("Route has fewer than 2 points");
    let cum=[0];for(let i=1;i<clean.length;i++)cum.push(cum[i-1]+hav(clean[i-1],clean[i]));
    return {points:clean,cum,length:cum[cum.length-1],heights:new Array(clean.length).fill(null),offsets:cleanOffsets,stations:[]};
  }
  function segmentAt(path,s){
    if(s<=0)return 0;if(s>=path.length)return path.points.length-2;
    let lo=0,hi=path.cum.length-1;
    while(lo+1<hi){const m=(lo+hi)>>1;if(path.cum[m]<=s)lo=m;else hi=m;}
    return lo;
  }
  // Hermite curve in local metres: smoother than joining GeoJSON fragments as hard corners.
  function samplePath(path,s){
    const i=segmentAt(path,s),p1=path.points[i],p2=path.points[i+1];
    const d=path.cum[i+1]-path.cum[i];let t=d>0?(s-path.cum[i])/d:0;
    if(s<0){const b=bearing(path.points[0],path.points[1]);const ds=s;const lat=path.points[0][1]+(ds*Math.cos(b))/111320;const lon=path.points[0][0]+(ds*Math.sin(b))/(111320*Math.cos(path.points[0][1]*Math.PI/180));return {lon,lat,height:path.heights[0]||0,heading:b};}
    if(s>path.length){const b=bearing(path.points[path.points.length-2],path.points[path.points.length-1]);const ds=s-path.length;const lat=path.points[path.points.length-1][1]+(ds*Math.cos(b))/111320;const lon=path.points[path.points.length-1][0]+(ds*Math.sin(b))/(111320*Math.cos(path.points[path.points.length-1][1]*Math.PI/180));return {lon,lat,height:path.heights[path.heights.length-1]||0,heading:b};}
    t=clamp(t,0,1);
    const origin=p1;
    const p0=path.points[Math.max(0,i-1)],p3=path.points[Math.min(path.points.length-1,i+2)];
    const a=projectLocal(p0[0],p0[1],origin[0],origin[1]),b=projectLocal(p1[0],p1[1],origin[0],origin[1]),c=projectLocal(p2[0],p2[1],origin[0],origin[1]),d3=projectLocal(p3[0],p3[1],origin[0],origin[1]);
    const dPrev=i>0?path.cum[i]-path.cum[i-1]:d;
    const dNext=i+2<path.cum.length?path.cum[i+2]-path.cum[i+1]:d;
    const v1scale=d/Math.max(0.01,dPrev+d),v2scale=d/Math.max(0.01,d+dNext);
    const v1=[(c[0]-a[0])*v1scale,(c[1]-a[1])*v1scale],v2=[(d3[0]-b[0])*v2scale,(d3[1]-b[1])*v2scale];
    const t2=t*t,t3=t2*t;
    const h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2;
    const x=h00*b[0]+h10*v1[0]+h01*c[0]+h11*v2[0];
    const y=h00*b[1]+h10*v1[1]+h01*c[1]+h11*v2[1];
    const dx=(6*t2-6*t)*b[0]+(3*t2-4*t+1)*v1[0]+(-6*t2+6*t)*c[0]+(3*t2-2*t)*v2[0];
    const dy=(6*t2-6*t)*b[1]+(3*t2-4*t+1)*v1[1]+(-6*t2+6*t)*c[1]+(3*t2-2*t)*v2[1];
    const lon=origin[0]+x/(111320*Math.cos(origin[1]*Math.PI/180));const lat=origin[1]+y/111320;
    let h1=path.heights[i],h2=path.heights[i+1];if(h1==null)h1=0;if(h2==null)h2=h1;
    let height=h1+(h2-h1)*t;
    const off1=path.offsets[i]||0,off2=path.offsets[i+1]||0;height+=(off1+(off2-off1)*t);
    return {lon,lat,height,heading:Math.atan2(dx,dy)};
  }
  function stationPosition(path,station){
    const q=[+station.lon,+station.lat];let best={dist:Infinity,s:0};
    for(let i=0;i<path.points.length-1;i++){
      const a=path.points[i],b=path.points[i+1];const o=q;
      const A=projectLocal(a[0],a[1],o[0],o[1]),B=projectLocal(b[0],b[1],o[0],o[1]);
      const vx=B[0]-A[0],vy=B[1]-A[1],den=vx*vx+vy*vy;
      const t=den?clamp(-(A[0]*vx+A[1]*vy)/den,0,1):0;
      const px=A[0]+vx*t,py=A[1]+vy*t;const dist=Math.hypot(px,py);
      if(dist<best.dist)best={dist,s:path.cum[i]+(path.cum[i+1]-path.cum[i])*t};
    }
    return best;
  }
  async function orderStations(route,path){
    const raw=await getStations(route.apiLineId);
    const rows=(Array.isArray(raw)?raw:[]).map((s,i)=>({i,name:s.station_name||s.name||("駅"+(i+1)),lat:Number(s.lat),lon:Number(s.lon)})).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon));
    const matched=[];
    for(const s of rows){const p=stationPosition(path,s);if(p.dist<=CONFIG.stationSnapMeters)matched.push({...s,s:p.s,dist:p.dist});}
    if(matched.length<2)throw new Error(route.line+"の駅を線路に割り当てできませんでした (matched="+matched.length+")");
    // Align path orientation with the route API station order.
    if(matched[0].s>matched[matched.length-1].s){path.points.reverse();path.heights.reverse();path.offsets.reverse();path.cum=[0];for(let i=1;i<path.points.length;i++)path.cum.push(path.cum[i-1]+hav(path.points[i-1],path.points[i]));path.length=path.cum[path.cum.length-1];for(const s of matched)s.s=path.length-s.s;}
    matched.sort((a,b)=>a.s-b.s);
    // Stations are projected back onto this track, so a platform point does not pull the train sideways.
    path.stations=matched.map(s=>({name:s.name,s:clamp(s.s+CONFIG.stationStopOffset,0,path.length),dwell:(s.i===0||s.i===rows.length-1)?CONFIG.terminalDwell:CONFIG.stationDwell,apiIndex:s.i,offsetMeters:s.dist}));
    return path.stations;
  }

  async function sampleHeights(path){
    const cp=C.Cartographic.fromDegrees;
    const cartos=path.points.map(p=>cp(p[0],p[1]));
    if(typeof C.sampleTerrainMostDetailed==="function"&&viewer.terrainProvider){
      try{
        for(let i=0;i<cartos.length;i+=CONFIG.terrainBatchSize){
          const batch=cartos.slice(i,i+CONFIG.terrainBatchSize);
          const sampled=await C.sampleTerrainMostDetailed(viewer.terrainProvider,batch);
          for(let j=0;j<sampled.length;j++)path.heights[i+j]=Number.isFinite(sampled[j].height)?sampled[j].height:null;
        }
      }catch(e){warn("terrain sampling incomplete; falling back to globe height",e);}
    }
    for(let i=0;i<path.heights.length;i++){
      if(path.heights[i]==null){let h=0;try{h=viewer.scene.globe.getHeight(cartos[i]);}catch(e){}path.heights[i]=Number.isFinite(h)?h:0;}
    }
  }

  // Route JSON contains per-vertex vertical offsets from the original bridge/tunnel/layer tags.
  function addRouteLift(path,route){
    for(let i=0;i<path.offsets.length;i++)path.offsets[i]=(Number(path.offsets[i])||0)+CONFIG.trackLift;
  }

  // Each car is one independently oriented GLB. This is what allows the consist to articulate through curves.
  function carModelMatrix(pos,heading){
    const p=C.Cartesian3.fromDegrees(pos.lon,pos.lat,(pos.height||0)+CONFIG.modelHeightOffset);
    const enu=C.Transforms.eastNorthUpToFixedFrame(p);
    // Cesium 1.96 already converts glTF Y-up / +Z-forward into its Z-up / +X-forward frame.
    // Do NOT apply an extra X rotation here: it rolls the train 90 degrees.
    // In ENU, +X is east; rotate it by (90deg - bearing) to align it with the track.
    const rz=C.Matrix3.fromRotationZ(Math.PI/2-heading+CONFIG.modelForwardCorrection,new C.Matrix3());
    const r4=C.Matrix4.fromRotationTranslation(rz,C.Cartesian3.ZERO,new C.Matrix4());
    return C.Matrix4.multiply(enu,r4,new C.Matrix4());
  }

  function removeModels(models){
    if(!models)return;
    for(const m of models){try{viewer.scene.primitives.remove(m);}catch(e){}}
  }
  async function loadCarModels(){
    const models=[];
    try{
      for(let i=0;i<CAR_FILES.length;i++){
        const url=BASE+CAR_FILES[i];
        const matrix=C.Matrix4.clone(C.Matrix4.IDENTITY);
        const model=C.Model.fromGltf({url,modelMatrix:matrix,show:false,allowPicking:false,asynchronous:true});
        viewer.scene.primitives.add(model);
        models.push(model);
      }
      // Only the nearest consists are instantiated; each car remains a separate articulated GLB.
      await Promise.all(models.map(m=>new Promise((resolve,reject)=>{
        if(m.ready){resolve();return;}
        if(m.readyPromise&&m.readyPromise.then)m.readyPromise.then(resolve,reject);
        else if(m.readyToRender&&m.readyToRender.addEventListener)m.readyToRender.addEventListener(()=>resolve());
        else setTimeout(resolve,15000);
      })));
      return models;
    }catch(e){removeModels(models);throw e;}
  }

  function createTrain(route,path,models){
    const stops=path.stations;
    const first=stops[0].s,last=stops[stops.length-1].s;
    const min=Math.min(first,last),max=Math.max(first,last);
    const train={route,path,models,loading:false,loadFailed:false,stops,dir:1,s:min+Math.min(CONSIST_LENGTH+10,(max-min)*0.20),speed:0,dwell:8,stopIndex:1,visible:false,removed:false,lastDistance:Infinity};
    if(train.s<min)train.s=min;
    train.lastDistance=Infinity;
    return train;
  }
  function nextTarget(train){
    const eps=2;
    if(train.dir>0){for(const st of train.stops){if(st.s>train.s+eps)return st;}return null;}
    for(let i=train.stops.length-1;i>=0;i--){const st=train.stops[i];if(st.s<train.s-eps)return st;}return null;
  }
  function endpointTarget(train){return train.dir>0?train.stops[train.stops.length-1]:train.stops[0];}
  function updateTrain(train,dt){
    if(train.removed)return;
    if(train.dwell>0){train.dwell=Math.max(0,train.dwell-dt);train.speed=0;return;}
    let target=nextTarget(train);
    if(!target){target=endpointTarget(train);}
    const signed=(target.s-train.s)*train.dir;
    const dist=Math.max(0,signed);
    const stopDist=Math.max(0,dist-1.2);
    const brakingSpeed=Math.sqrt(2*CONFIG.braking*stopDist);
    const desired=Math.min(CONFIG.maxSpeed,brakingSpeed);
    if(train.speed<desired)train.speed=Math.min(desired,train.speed+CONFIG.acceleration*dt);
    else train.speed=Math.max(desired,train.speed-CONFIG.braking*dt);
    let step=train.speed*dt;
    if(step>=dist){train.s=target.s;train.speed=0;const atTerminal=(target===endpointTarget(train));train.dwell=atTerminal?CONFIG.terminalDwell:CONFIG.stationDwell;
      if(atTerminal){
        // Reversing cabs swaps the lead car but the physical eight-car formation must not jump.
        train.s-=train.dir*CONSIST_LENGTH;
        train.dir*=-1;
      }
    }else train.s+=train.dir*step;
  }

  function updateCarModels(train){
    if(!train.models)return;
    const s0=train.s;
    for(let i=0;i<8;i++){
      // Node order is front-to-rear in the source 9300F formation. On the return trip the 9400 cab leads.
      const s=train.dir>0?s0-i*CAR_SPACING:s0+(7-i)*CAR_SPACING;
      const pos=samplePath(train.path,s);
      const m=train.models[i];
      if(!m||!m.ready)continue;
      const heading=pos.heading+(train.dir<0?Math.PI:0);
      m.modelMatrix=carModelMatrix(pos,heading);
      m.show=train.visible;
    }
  }

  let routes=[];
  for(const row of routeData.routes){
    if(!CONFIG.enabledLines.includes(row.id))continue;
    try{
      const path=makePath(row.points,row.offsets);
      const route={...row};
      const stops=await orderStations(route,path);
      await sampleHeights(path);addRouteLift(path,route);
      route.path=path;
      routes.push(route);
      log(route.section,Math.round(path.length/1000*10)/10+" km",stops.length+" stations", "first="+stops[0].name,"last="+stops[stops.length-1].name);
    }catch(e){STATUS.errors.push({route:row.section,message:String(e)});warn("route skipped:",row.section,e);}
  }
  if(!routes.length)throw new Error("No enabled Hankyu routes were built");

  // Create the traffic state for every route. Actual GLB primitives are loaded lazily
  // for the nearest consists only, keeping mobile GPU memory under control.
  for(const route of routes){
    const t=createTrain(route,route.path,null);
    STATUS.trains.push(t);STATUS.routeNames.push(route.section);
  }

  function updateVisibility(){
    const camera=viewer.camera.positionWC;
    const list=STATUS.trains.map(t=>{
      const s=samplePath(t.path,t.s);const p=C.Cartesian3.fromDegrees(s.lon,s.lat,s.height||0);
      const d=C.Cartesian3.distance(camera,p);return {t,d};
    }).sort((a,b)=>a.d-b.d);
    list.forEach((x,i)=>{
      const t=x.t,want=i<CONFIG.maxVisibleTrains&&x.d<18000;
      t.visible=want;
      if(want&&!t.models&&!t.loading&&!t.loadFailed){
        t.loading=true;
        loadCarModels().then(models=>{
          t.loading=false;
          if(!STATUS.running||!t.visible){removeModels(models);return;}
          t.models=models;updateCarModels(t);
          log("visible train loaded:",t.route.section);
        }).catch(e=>{t.loading=false;t.loadFailed=true;STATUS.errors.push({route:t.route.section,message:String(e)});warn("model load failed:",t.route.section,e);});
      }else if(!want){if(t.models){removeModels(t.models);t.models=null;}t.loadFailed=false;}
    });
  }
  let acc=0,last=Date.now(),frame=0;
  function tick(){
    if(!STATUS.running)return;
    const now=Date.now();let dt=(now-last)/1000;last=now;dt=clamp(dt,0,CONFIG.updateMaxDelta);acc+=dt;
    for(const t of STATUS.trains){updateTrain(t,dt);if(t.models)for(let i=0;i<8;i++){const m=t.models[i];if(m&&m.ready)m.show=t.visible;}}
    // Full transforms are updated at ~20 Hz; physics runs every render frame.
    if(acc>=0.05){acc=0;for(const t of STATUS.trains)updateCarModels(t);}
    if((frame++%30)===0)updateVisibility();
  }
  updateVisibility();
  const removeTick=viewer.scene.preRender.addEventListener(tick);
  STATUS.stop=function(){
    STATUS.running=false;
    try{removeTick();}catch(e){}
    for(const t of STATUS.trains){removeModels(t.models);t.models=null;}
    STATUS.trains.length=0;
    log("traffic stopped and models removed");
  };
  STATUS.config=CONFIG;
  STATUS.routes=routes.map(r=>({id:r.id,name:r.section,length:r.path.length,stations:r.path.stations.length}));
  window.__HANKYU_TRAFFIC__=STATUS;
  log("started",STATUS.routes.length,"route sections; consists=",STATUS.trains.length,"; visible cap=",CONFIG.maxVisibleTrains);
  log("Control: __HANKYU_TRAFFIC__.stop() | config: __HANKYU_TRAFFIC__.config");
})().catch(e=>console.error("[Hankyu] initialization failed:",e));
