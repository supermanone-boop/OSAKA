'use strict';
(async()=>{
  const C=window.Cesium,g=window.geofs,viewer=g&&g.api&&g.api.viewer,scene=viewer&&viewer.scene;
  if(!C||!g||!viewer||!scene||!C.PointPrimitiveCollection||!C.PolylineCollection||!C.Matrix4||!C.Transforms){
    console.error('[OSAKA road lights v4] Cesium / GeoFS API不足');return;
  }
  const COLLISION_URL='https://huggingface.co/supermanone-boop/hankyu/resolve/main/Osaka_Expressways_RoadCollision_v7.bin.gz';
  const ROAD_URL='https://raw.githubusercontent.com/supermanone-boop/model/main/itamishuhenexport.geojson';
  const CFG={
    LAMP_SPACING_M:50,LAMP_POLE_HEIGHT_M:14,LAMP_EDGE_OFFSET_M:1.25,LAMP_ARM_M:2.5,
    EDGE_MIN_M:4.5,EDGE_MAX_M:9.8,VERTEX_SNAP_M:.02,HEIGHT_GRID_M:40,
    LAMP_BUILD_RADIUS_M:8500,LAMP_VISIBLE_RADIUS_M:7000,LAMP_HIDE_RADIUS_M:9000,
    TILE_SCAN_MS:1800,LAMP_VISIBILITY_MS:1200,BUILD_YIELD_TRIANGLES:700,
    CAR_SPACING_M:80,CAR_SPEED_MPS:60/3.6,CAR_VISIBLE_M:4800,CAR_UPDATE_MS:120,
    CAR_HEIGHT_REFRESH_MS:650,CAR_LIGHT_HEIGHT_M:1.05,CAR_FRONT_M:2.0,CAR_REAR_M:2.0,
    CAR_NEAR_PX:1.45,CAR_FAR_PX:.95,MAX_CARS:9000,
    NIGHT_START_DEG:1,NIGHT_FULL_DEG:-5,NIGHT_UPDATE_MS:2500,
    ROUTE_MIN_LENGTH_M:35,INCLUDE_TOLL_TRUNK:true
  };
  const RAD=Math.PI/180,R=6378137,SY=R*RAD,LAT0=34.6,SX=R*RAD*Math.cos(LAT0*RAD),CELL_DEG=.01;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=Number.isFinite;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const prev=window.__osakaPointLights;
  if(prev&&typeof prev.stop==='function')try{prev.stop();}catch(_){}
  const oldTraffic=window.__osakaTraffic;
  if(oldTraffic&&oldTraffic.active&&typeof oldTraffic.stop==='function')try{oldTraffic.stop();}catch(_){}

  const state={active:true,version:'roadmesh-point-lights-v4',buffer:null,tiles:[],tileCells:new Map(),buildQueue:[],building:false,
    lamps:[],cars:[],routes:[],points:null,poles:null,callback:null,nightFactor:0,sunElevation:90,
    lastNight:0,lastTileScan:0,lastLampVisibility:0,lastCarUpdate:0,lastTick:performance.now(),stats:{tiles:0,triangles:0,tilesBuilt:0,edgeSegments:0,streetLamps:0,ways:0,cars:0,roadHeightMisses:0}};
  window.__osakaPointLights=state;
  state.points=scene.primitives.add(new C.PointPrimitiveCollection());
  state.poles=scene.primitives.add(new C.PolylineCollection());
  const poleMaterial=C.Material.fromType('Color',{color:new C.Color(.24,.25,.27,.96)});
  const warm=new C.Color(1,.82,.58,1),white=new C.Color(1,.96,.88,1),red=new C.Color(1,.055,.035,1);

  function focus(){
    const a=g.aircraft&&g.aircraft.instance,p=a&&a.llaLocation;
    if(Array.isArray(p)&&finite(+p[0])&&finite(+p[1]))return {lat:+p[0],lon:+p[1],x:+p[1]*SX,y:+p[0]*SY};
    const c=viewer.camera&&viewer.camera.positionCartographic;
    if(c)return {lat:c.latitude/RAD,lon:c.longitude/RAD,x:c.longitude/RAD*SX,y:c.latitude/RAD*SY};
    return null;
  }
  function distanceXY(lat1,lon1,lat2,lon2){
    const latMid=(lat1+lat2)*.5*RAD;
    return Math.hypot((lon2-lon1)*111319.49*Math.cos(latMid),(lat2-lat1)*110574);
  }
  function sunElevation(lat,lon,date){
    const y=date.getUTCFullYear(),start=Date.UTC(y,0,1),day=Math.floor((Date.UTC(y,date.getUTCMonth(),date.getUTCDate())-start)/86400000)+1;
    const hour=date.getUTCHours()+date.getUTCMinutes()/60+date.getUTCSeconds()/3600;
    const gamma=2*Math.PI/365*(day-1+(hour-12)/24);
    const eq=229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
    const dec=.006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
    let mins=hour*60+eq+4*lon;mins=((mins%1440)+1440)%1440;
    const ha=(mins/4-180)*RAD,phi=lat*RAD;
    return Math.asin(clamp(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(ha),-1,1))/RAD;
  }
  function updateNight(now,f){
    if(now-state.lastNight<CFG.NIGHT_UPDATE_MS)return;
    state.lastNight=now;state.sunElevation=sunElevation(f.lat,f.lon,new Date());
    state.nightFactor=clamp((CFG.NIGHT_START_DEG-state.sunElevation)/(CFG.NIGHT_START_DEG-CFG.NIGHT_FULL_DEG),0,1);
  }
  function addTileToGeoGrid(tile){
    const dLat=tile.radius/110574+.00015,dLon=tile.radius/(111319.49*Math.max(.2,Math.cos(tile.lat*RAD)))+.00015;
    const x0=Math.floor((tile.lon-dLon)/CELL_DEG),x1=Math.floor((tile.lon+dLon)/CELL_DEG);
    const y0=Math.floor((tile.lat-dLat)/CELL_DEG),y1=Math.floor((tile.lat+dLat)/CELL_DEG);
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
      const k=x+','+y;let a=state.tileCells.get(k);if(!a)state.tileCells.set(k,a=[]);a.push(tile);
    }
  }
  async function loadCollision(){
    if(typeof DecompressionStream==='undefined')throw Error('gzip DecompressionStream 非対応');
    const r=await fetch(COLLISION_URL,{cache:'no-store'});if(!r.ok)throw Error('RoadCollision HTTP '+r.status);
    if(!r.body)throw Error('ReadableStream unavailable');
    const buffer=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const v=new DataView(buffer);
    if(v.byteLength<12||v.getUint8(0)!==79||v.getUint8(1)!==83||v.getUint8(2)!==67||v.getUint8(3)!==82)throw Error('OSCRヘッダーが違います');
    const version=v.getUint16(4,true),count=v.getUint32(8,true);
    if(version!==1||count<1||count>2000)throw Error('OSCR version/tile count不正: '+version+'/'+count);
    let o=12,total=0;
    for(let i=0;i<count;i++){
      if(o+32>v.byteLength)throw Error('tile header truncated '+i);
      const ix=v.getInt32(o,true),iy=v.getInt32(o+4,true),lon=v.getFloat64(o+8,true),lat=v.getFloat64(o+16,true);
      const radius=v.getFloat32(o+24,true),triangleCount=v.getUint32(o+28,true);o+=32;
      const bytes=triangleCount*36;
      if(!finite(lon)||!finite(lat)||!finite(radius)||!triangleCount||o+bytes>v.byteLength)throw Error('tile data invalid '+i);
      const tile={ix,iy,lon,lat,radius,triangleCount,dataOffset:o,built:false,queued:false,heightGrid:null,lamps:[],enu:null};
      state.tiles.push(tile);addTileToGeoGrid(tile);total+=triangleCount;o+=bytes;
    }
    if(o!==v.byteLength)throw Error('OSCR末尾サイズ不一致 '+(v.byteLength-o));
    state.buffer=buffer;state.stats.tiles=count;state.stats.triangles=total;
    console.log('[OSAKA road lights v4] RoadCollision:',count,'tiles /',total.toLocaleString(),'triangles');
  }
  function keyCell(x,y){return Math.floor(x/CFG.HEIGHT_GRID_M)+','+Math.floor(y/CFG.HEIGHT_GRID_M);}
  function addHeightTriangle(grid,idx,ax,ay,bx,by,cx,cy){
    const minX=Math.floor(Math.min(ax,bx,cx)/CFG.HEIGHT_GRID_M),maxX=Math.floor(Math.max(ax,bx,cx)/CFG.HEIGHT_GRID_M);
    const minY=Math.floor(Math.min(ay,by,cy)/CFG.HEIGHT_GRID_M),maxY=Math.floor(Math.max(ay,by,cy)/CFG.HEIGHT_GRID_M);
    for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){
      const k=x+','+y;let a=grid.get(k);if(!a)grid.set(k,a=[]);a.push(idx);
    }
  }
  const snapKey=(x,y,z)=>Math.round(x/CFG.VERTEX_SNAP_M)+','+Math.round(y/CFG.VERTEX_SNAP_M)+','+Math.round(z/CFG.VERTEX_SNAP_M);
  function edgeKey(a,b){return a<b?a+'|'+b:b+'|'+a;}
  function tracePath(start,first,edges,graph,visited){
    const path=[];let node=start,eid=first;
    while(!visited[eid]){
      visited[eid]=1;const e=edges[eid],next=e.ak===node?e.bk:e.ak;
      path.push({edge:e,from:node});
      const adjacent=graph.get(next)||[];if(adjacent.length!==2)break;
      const nextEdge=adjacent[0]===eid?adjacent[1]:adjacent[0];if(visited[nextEdge])break;
      node=next;eid=nextEdge;
    }
    return path;
  }
  function localWorld(tile,x,y,z){
    const p=C.Matrix4.multiplyByPoint(tile.enu,new C.Cartesian3(x,y,z),new C.Cartesian3());return p;
  }
  function addLamp(tile,edge,fromKey,t){
    let ax,ay,az,bx,by,bz;
    if(fromKey===edge.ak){[ax,ay,az]=edge.a;[bx,by,bz]=edge.b;}
    else{[ax,ay,az]=edge.b;[bx,by,bz]=edge.a;}
    const mx=ax+(bx-ax)*t,my=ay+(by-ay)*t,mz=az+(bz-az)*t;
    let ix=edge.inside[0]-mx,iy=edge.inside[1]-my,il=Math.hypot(ix,iy);if(il<.001)return;
    ix/=il;iy/=il;
    const baseX=mx-ix*CFG.LAMP_EDGE_OFFSET_M,baseY=my-iy*CFG.LAMP_EDGE_OFFSET_M;
    const topZ=mz+CFG.LAMP_POLE_HEIGHT_M,headX=baseX+ix*CFG.LAMP_ARM_M,headY=baseY+iy*CFG.LAMP_ARM_M;
    const wx=tile.lon*SX+baseX,wy=tile.lat*SY+baseY;
    const dedupe=Math.round(wx/3)+','+Math.round(wy/3)+','+Math.round(mz/4);
    if(state.lampDedup.has(dedupe))return;state.lampDedup.add(dedupe);
    const base=localWorld(tile,baseX,baseY,mz+.12),top=localWorld(tile,baseX,baseY,topZ),head=localWorld(tile,headX,headY,topZ);
    const pole=state.poles.add({positions:[base,top,head],width:1.0,material:poleMaterial,show:false});
    const point=state.points.add({position:head,color:warm,pixelSize:1.8,show:false,outlineWidth:0,disableDepthTestDistance:0});
    const lamp={x:wx,y:wy,pole,point,tile};tile.lamps.push(lamp);state.lamps.push(lamp);
  }
  function samplePath(path){
    if(!path.length)return;let total=0;const lens=[];
    for(const p of path){const l=p.edge.len;lens.push(l);total+=l;}
    if(total<25)return;
    for(let d=25;d<total;d+=CFG.LAMP_SPACING_M){
      let acc=0;
      for(let i=0;i<path.length;i++){
        const e=path[i].edge,l=lens[i];
        if(d<=acc+l||i===path.length-1){addLamp(path[i].edge.tile,e,path[i].from,clamp((d-acc)/l,0,1));break;}
        acc+=l;
      }
    }
  }
  async function buildTile(tile){
    tile.enu=C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(tile.lon,tile.lat,0));
    const vals=new Float32Array(state.buffer,tile.dataOffset,tile.triangleCount*9),edgeMap=new Map(),heightGrid=new Map();
    tile.values=vals;
    for(let t=0;t<tile.triangleCount;t++){
      const j=t*9,ax=vals[j],ay=vals[j+1],az=vals[j+2],bx=vals[j+3],by=vals[j+4],bz=vals[j+5],cx=vals[j+6],cy=vals[j+7],cz=vals[j+8];
      if(!finite(ax)||!finite(ay)||!finite(az)||!finite(bx)||!finite(by)||!finite(bz)||!finite(cx)||!finite(cy)||!finite(cz))continue;
      addHeightTriangle(heightGrid,t,ax,ay,bx,by,cx,cy);
      const A=snapKey(ax,ay,az),B=snapKey(bx,by,bz),D=snapKey(cx,cy,cz);
      const add=(ka,kb,a,b,inside)=>{
        const k=edgeKey(ka,kb);let e=edgeMap.get(k);
        if(e)e.count++;
        else edgeMap.set(k,{ak:ka,bk:kb,a,b,inside,count:1,len:Math.hypot(b[0]-a[0],b[1]-a[1]),tile});
      };
      add(A,B,[ax,ay,az],[bx,by,bz],[cx,cy,cz]);
      add(B,D,[bx,by,bz],[cx,cy,cz],[ax,ay,az]);
      add(D,A,[cx,cy,cz],[ax,ay,az],[bx,by,bz]);
      if(t%CFG.BUILD_YIELD_TRIANGLES===0&&t>0)await sleep(0);
      if(!state.active)return;
    }
    const edges=[];
    for(const e of edgeMap.values())if(e.count===1&&e.len>=CFG.EDGE_MIN_M&&e.len<=CFG.EDGE_MAX_M)edges.push(e);
    const graph=new Map();
    for(let i=0;i<edges.length;i++){
      const e=edges[i];let a=graph.get(e.ak);if(!a)graph.set(e.ak,a=[]);a.push(i);
      let b=graph.get(e.bk);if(!b)graph.set(e.bk,b=[]);b.push(i);
    }
    const visited=new Uint8Array(edges.length);
    for(const [node,ids] of graph){if(ids.length===2)continue;for(const id of ids)if(!visited[id])samplePath(tracePath(node,id,edges,graph,visited));}
    for(let i=0;i<edges.length;i++)if(!visited[i])samplePath(tracePath(edges[i].ak,i,edges,graph,visited));
    tile.heightGrid=heightGrid;tile.built=true;tile.queued=false;tile.edgeSegments=edges.length;
    state.stats.tilesBuilt++;state.stats.edgeSegments+=edges.length;state.stats.streetLamps=state.lamps.length;
    console.log('[OSAKA road lights v4] tile built',tile.ix,tile.iy,'tri',tile.triangleCount,'edge',edges.length,'lamps',tile.lamps.length);
  }
  async function pumpBuild(){
    if(state.building||!state.active)return;state.building=true;
    while(state.active&&state.buildQueue.length){
      const tile=state.buildQueue.shift();
      try{await buildTile(tile);}catch(e){tile.queued=false;console.warn('[OSAKA road lights v4] tile build failed',tile.ix,tile.iy,e);}
      await sleep(0);
    }
    state.building=false;
  }
  function queueNearbyTiles(f){
    for(const tile of state.tiles){
      if(tile.built||tile.queued)continue;
      const d=distanceXY(f.lat,f.lon,tile.lat,tile.lon);
      if(d<=CFG.LAMP_BUILD_RADIUS_M+tile.radius){tile.queued=true;state.buildQueue.push(tile);}
    }
    if(state.buildQueue.length)pumpBuild();
  }
  function getCandidateTiles(lon,lat){return state.tileCells.get(Math.floor(lon/CELL_DEG)+','+Math.floor(lat/CELL_DEG))||[];}
  function baryZ(x,y,a,b,c){
    const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)return null;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;
    const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den,w=1-u-v;
    if(u<-.025||v<-.025||w<-.025)return null;
    return u*a[2]+v*b[2]+w*c[2];
  }
  function sampleRoadHeight(lon,lat,explicitZ){
    if(finite(explicitZ)&&Math.abs(explicitZ)>.5)return explicitZ;
    const candidates=getCandidateTiles(lon,lat);let best=-Infinity;
    for(const tile of candidates){
      if(!tile.heightGrid)continue;
      if(distanceXY(lat,lon,tile.lat,tile.lon)>tile.radius+20)continue;
      const sx=111319.49*Math.cos(tile.lat*RAD),x=(lon-tile.lon)*sx,y=(lat-tile.lat)*110574;
      const cx=Math.floor(x/CFG.HEIGHT_GRID_M),cy=Math.floor(y/CFG.HEIGHT_GRID_M),seen=new Set();
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
        const list=tile.heightGrid.get((cx+ox)+','+(cy+oy));if(!list)continue;
        for(const ti of list){if(seen.has(ti))continue;seen.add(ti);
          const a=tile.values,b=ti*9;
          const z=baryZ(x,y,[a[b],a[b+1],a[b+2]],[a[b+3],a[b+4],a[b+5]],[a[b+6],a[b+7],a[b+8]]);
          if(z!==null&&z>best)best=z;
        }
      }
    }
    return finite(best)?best:NaN;
  }
  function refreshLamps(f){
    const v2=CFG.LAMP_VISIBLE_RADIUS_M**2,h2=CFG.LAMP_HIDE_RADIUS_M**2;
    for(const lamp of state.lamps){
      const d2=(lamp.x-f.x)**2+(lamp.y-f.y)**2;
      if(d2>h2){lamp.pole.show=false;lamp.point.show=false;continue;}
      if(d2>v2){lamp.pole.show=false;lamp.point.show=false;continue;}
      lamp.pole.show=true;lamp.point.show=state.nightFactor>.025;
    }
  }
  function parseMeters(v){if(v===undefined||v===null)return NaN;const m=String(v).trim().toLowerCase().match(/[0-9]+(?:\.[0-9]+)?/);if(!m)return NaN;let n=Number(m[0]);if(/ft|feet|foot|'/i.test(String(v)))n*=.3048;return n;}
  function roadWidth(p){const n=parseMeters(p.lanes)||2,w=parseMeters(p.width||p['width:carriageway']);return finite(w)&&w>=4&&w<=40?w:clamp(n*3.5+2.4,5.8,31);}
  function expressway(p){const h=p&&p.highway;if(h==='motorway'||h==='motorway_link')return true;if(CFG.INCLUDE_TOLL_TRUNK&&(h==='trunk'||h==='trunk_link'))return p.toll==='yes'||/高速|expressway|E\d+|阪神高速|名神高速/.test([p.name,p.ref,p.destination].filter(Boolean).join(' '));return false;}
  function meters(a,b){const p1=a.lat*RAD,p2=b.lat*RAD,dp=(b.lat-a.lat)*RAD,dl=(b.lon-a.lon)*RAD;const q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));}
  function makeRoute(feature){
    const p=feature.properties||{},coords=feature.geometry&&feature.geometry.coordinates;if(!Array.isArray(coords)||coords.length<2)return null;
    const pts=[];for(const c of coords){if(!Array.isArray(c)||!finite(+c[0])||!finite(+c[1]))continue;pts.push({lon:+c[0],lat:+c[1],z:c.length>2&&finite(+c[2])?+c[2]:NaN});}
    if(pts.length<2)return null;const cum=new Float64Array(pts.length);let len=0;
    for(let i=1;i<pts.length;i++){len+=meters(pts[i-1],pts[i]);cum[i]=len;}if(len<CFG.ROUTE_MIN_LENGTH_M)return null;
    return {pts,cum,len,width:roadWidth(p),props:p};
  }
  function locate(route,d){let lo=0,hi=route.cum.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(route.cum[m]<=d)lo=m;else hi=m;}return Math.min(lo,route.cum.length-2);}
  function pointAt(route,d){d=clamp(d,0,route.len);const i=locate(route,d),a=route.pts[i],b=route.pts[i+1],span=Math.max(.001,route.cum[i+1]-route.cum[i]),t=clamp((d-route.cum[i])/span,0,1);return {lon:a.lon+(b.lon-a.lon)*t,lat:a.lat+(b.lat-a.lat)*t,z:finite(a.z)&&finite(b.z)?a.z+(b.z-a.z)*t:finite(a.z)?a.z:finite(b.z)?b.z:NaN};}
  function tangent(route,d){const a=pointAt(route,Math.max(0,d-4)),b=pointAt(route,Math.min(route.len,d+4)),east=(b.lon-a.lon)*SX,north=(b.lat-a.lat)*SY,n=Math.max(.001,Math.hypot(east,north));return {east:east/n,north:north/n,heading:Math.atan2(east,north)};}
  function makeCars(){
    let id=0;
    for(const route of state.routes){
      const one=String(route.props.oneway||'').toLowerCase(),dirs=one==='yes'||one==='1'||one==='true'?[1]:one==='-1'?[-1]:[1,-1];
      const lanes=clamp(Math.round(parseMeters(route.props.lanes)||2),1,4),lanePerDir=dirs.length===1?lanes:Math.max(1,Math.floor(lanes/2));
      const count=Math.max(1,Math.floor((route.len-20)/CFG.CAR_SPACING_M));
      for(const dir of dirs)for(let lane=0;lane<lanePerDir;lane++)for(let j=0;j<count;j++){
        if(state.cars.length>=CFG.MAX_CARS)return;
        const progress=10+(j+.45+Math.random()*.1)*(route.len-20)/count;
        state.cars.push({id:id++,route,dir,lane,laneN:lanePerDir,progress,speed:CFG.CAR_SPEED_MPS*(.88+Math.random()*.24),lastHeightAt:0,height:NaN,front:null,rear:null});
      }
    }
  }
  function carPose(car){
    const d=car.dir>0?car.progress:car.route.len-car.progress,p=pointAt(car.route,d),t=tangent(car.route,d);
    const side=car.dir>0?-1:1,lateral=side*car.route.width*.22+(car.lane-(car.laneN-1)/2)*3.35;
    const rightE=t.north,rightN=-t.east;
    const east=t.east*lateral,north=t.north*lateral;
    const lon=p.lon+east/(111319.49*Math.cos(p.lat*RAD)),lat=p.lat+north/110574;
    const heading=car.dir>0?t.heading:t.heading+Math.PI;
    return {lon,lat,z:p.z,heading};
  }
  function updateCars(now,dt,f){
    const limit2=CFG.CAR_VISIBLE_M**2,night=state.nightFactor>.025;
    for(const car of state.cars){
      car.progress+=car.speed*dt;if(car.progress>=car.route.len)car.progress%=car.route.len;
      const p=carPose(car),d2=((p.lon*SX-f.x)**2+(p.lat*SY-f.y)**2);
      if(d2>limit2||!night){if(car.front)car.front.show=false;if(car.rear)car.rear.show=false;continue;}
      if(now-car.lastHeightAt>=CFG.CAR_HEIGHT_REFRESH_MS){
        car.lastHeightAt=now;car.height=sampleRoadHeight(p.lon,p.lat,p.z);
        if(!finite(car.height))state.stats.roadHeightMisses++;
      }
      if(!finite(car.height)){if(car.front)car.front.show=false;if(car.rear)car.rear.show=false;continue;}
      const fe=Math.sin(p.heading),fn=Math.cos(p.heading),near=Math.sqrt(d2)<1600,px=near?CFG.CAR_NEAR_PX:CFG.CAR_FAR_PX;
      const front=C.Cartesian3.fromDegrees(p.lon+fe*CFG.CAR_FRONT_M/(111319.49*Math.cos(p.lat*RAD)),p.lat+fn*CFG.CAR_FRONT_M/110574,car.height+CFG.CAR_LIGHT_HEIGHT_M);
      const rear=C.Cartesian3.fromDegrees(p.lon-fe*CFG.CAR_REAR_M/(111319.49*Math.cos(p.lat*RAD)),p.lat-fn*CFG.CAR_REAR_M/110574,car.height+CFG.CAR_LIGHT_HEIGHT_M);
      if(!car.front)car.front=state.points.add({position:front,color:white,pixelSize:px,show:true,outlineWidth:0,disableDepthTestDistance:0});
      else{car.front.position=front;car.front.pixelSize=px;car.front.show=true;}
      if(!car.rear)car.rear=state.points.add({position:rear,color:red,pixelSize:px,show:true,outlineWidth:0,disableDepthTestDistance:0});
      else{car.rear.position=rear;car.rear.pixelSize=px;car.rear.show=true;}
    }
  }
  function hideAll(){for(const l of state.lamps){l.pole.show=false;l.point.show=false;}for(const c of state.cars){if(c.front)c.front.show=false;if(c.rear)c.rear.show=false;}}
  state.stop=()=>{
    if(!state.active)return;state.active=false;
    try{if(g.api.removeFrameCallback&&state.callback)g.api.removeFrameCallback(state.callback);else if(scene.preRender&&state.callback)scene.preRender.removeEventListener(state.callback);}catch(_){}
    hideAll();try{scene.primitives.remove(state.points);}catch(_){}try{scene.primitives.remove(state.poles);}catch(_){}
    state.buildQueue.length=0;state.lamps.length=0;state.cars.length=0;state.tiles.length=0;state.buffer=null;
    if(window.__osakaPointLights===state)window.__osakaPointLights=null;
    console.log('[OSAKA road lights v4] stopped');
  };

  try{
    console.log('[OSAKA road lights v4] 高速道路コリジョンを読み込み中...');
    const [_,roadResponse]=await Promise.all([loadCollision(),fetch(ROAD_URL,{cache:'no-store'})]);
    if(!state.active)return;
    if(!roadResponse.ok)throw Error('GeoJSON HTTP '+roadResponse.status);
    const data=await roadResponse.json();if(!data||!Array.isArray(data.features))throw Error('GeoJSON形式が違います');
    for(const feature of data.features){if(!feature||!feature.geometry||feature.geometry.type!=='LineString'||!expressway(feature.properties||{}))continue;const route=makeRoute(feature);if(route)state.routes.push(route);}
    makeCars();state.stats.ways=state.routes.length;state.stats.cars=state.cars.length;
    state.lampDedup=new Set();
    console.log('[OSAKA road lights v4] 高速道路:',state.routes.length,'ways / 点灯車両:',state.cars.length,'台（GLB車両モデルなし）');
    console.log('[OSAKA road lights v4] 街灯はRoadCollisionの道路面外周から抽出。地面getHeightは使用しません。左右端50m間隔 / 路面から',CFG.LAMP_POLE_HEIGHT_M,'m');
    const f=focus();if(!f)throw Error('航空機位置が取得できません');
    queueNearbyTiles(f);const now=performance.now();state.lastTick=now;state.lastTileScan=now;state.lastLampVisibility=now;state.lastCarUpdate=now;state.lastNight=0;
    function tick(){
      if(!state.active)return;const t=performance.now(),f=focus();if(!f)return;
      updateNight(t,f);
      if(t-state.lastTileScan>=CFG.TILE_SCAN_MS){state.lastTileScan=t;queueNearbyTiles(f);}
      if(t-state.lastLampVisibility>=CFG.LAMP_VISIBILITY_MS){state.lastLampVisibility=t;refreshLamps(f);}
      if(t-state.lastCarUpdate>=CFG.CAR_UPDATE_MS){const dt=clamp((t-state.lastCarUpdate)/1000,0,.25);state.lastCarUpdate=t;updateCars(t,dt,f);}
    }
    state.callback=tick;
    if(g.api.addFrameCallback)g.api.addFrameCallback(tick);else if(scene.preRender&&scene.preRender.addEventListener)scene.preRender.addEventListener(tick);else throw Error('frame callback APIがありません');
    tick();
    console.log('[OSAKA road lights v4] 稼働開始。照明は小さい点、支柱は細い1px線、青色光なし。',state.stats);
  }catch(e){console.error('[OSAKA road lights v4] 起動失敗:',e);state.stop();}
})().catch(e=>console.error('[OSAKA road lights v4] fatal:',e));