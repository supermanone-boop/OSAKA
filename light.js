'use strict';
(async()=>{
  const C=window.Cesium,g=window.geofs,viewer=g&&g.api&&g.api.viewer,scene=viewer&&viewer.scene;
  if(!C||!g||!viewer||!scene||!C.PointPrimitiveCollection||!C.PolylineCollection){
    console.error('[OSAKA expressway lights v5] Cesium / GeoFS API不足');return;
  }

  const ROOT='https://raw.githubusercontent.com/supermanone-boop/model/main/';
  const ROAD_URL=ROOT+'itamishuhenexport.geojson';
  const TRAFFIC_URL=ROOT+'osaka_road_routes_beta.json.gz';
  const COLLISION_URLS=[
    'https://huggingface.co/supermanone-boop/hankyu/resolve/main/Osaka_Expressways_RoadCollision_v7.bin.gz',
    ROOT+'Osaka_Expressways_RoadCollision_v7.bin.gz'
  ];
  const CFG={
    LAMP_SPACING_M:50,
    LAMP_STATION_START_M:25,
    LAMP_PAIR_ENDPOINT_MAX_M:65,
    LAMP_PAIR_MIN_SEPARATION_M:6,
    LAMP_PAIR_MAX_SEPARATION_M:55,
    LAMP_POLE_HEIGHT_M:14,
    LAMP_SIDE_MARGIN_M:1.6,
    LAMP_ARM_M:4.5,
    LAMP_BUILD_RADIUS_M:8500,
    LAMP_VISIBLE_RADIUS_M:6800,
    LAMP_SCAN_MS:1800,
    TILE_SCAN_MS:2500,
    TILE_CELL_M:32,
    TILE_YIELD_TRIANGLES:12000,
    LAMP_MAX_COUNT:2400,
    LAMP_BULB_DIAMETER_M:.20,
    LAMP_HALO_DIAMETER_M:.92,
    LAMP_HALO_FADE_M:1800,
    CAR_VISIBLE_RADIUS_M:7500,
    CAR_SPACING_M:72,
    CAR_MAX_COUNT:14000,
    CAR_UPDATE_MS:120,
    CAR_HEIGHT_REFRESH_MS:800,
    CAR_LIGHT_HEIGHT_M:1.12,
    CAR_FRONT_M:2.15,
    CAR_REAR_M:2.05,
    CAR_SIDE_M:0.62,
    CAR_BODY_DIAMETER_M:1.25,
    CAR_LIGHT_DIAMETER_M:.18,
    CAR_HALO_DIAMETER_M:.72,
    CAR_HALO_FADE_M:1500,
    AVG_FLOW_SPEED_KMH:72,
    LANES_PER_DIRECTION:2,
    MIN_SPEED_MPS:15.0,
    MAX_SPEED_MPS:22.5,
    SAFE_GAP_M:13,
    HEADWAY_S:2.0,
    ACCEL_MPS2:0.34,
    BRAKE_MPS2:0.72,
    NIGHT_START_DEG:1,
    NIGHT_FULL_DEG:-5,
    NIGHT_UPDATE_MS:2500,
    MODEL_FREE:true
  };
  const RAD=Math.PI/180,R=6378137,LAT0=34.6,SY=R*RAD,SX=R*RAD*Math.cos(LAT0*RAD),GRID_DEG=.01;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=Number.isFinite;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const prev=window.__osakaExpresswayNightTraffic;
  if(prev&&typeof prev.stop==='function')try{prev.stop();}catch(_){}
  if(window.__osakaPointLights&&typeof window.__osakaPointLights.stop==='function')try{window.__osakaPointLights.stop();}catch(_){}
  if(window.__osakaTraffic&&window.__osakaTraffic.active&&typeof window.__osakaTraffic.stop==='function')try{window.__osakaTraffic.stop();}catch(_){}

  const state={active:true,version:'5.0',buffer:null,tiles:[],tileCells:new Map(),tileQueue:[],tilePump:false,
    lampRoutes:[],lampPaths:[],lamps:[],lampStationDedup:new Map(),traffic:null,routes:[],zoneMap:new Map(),groups:[],cars:[],
    poleCollection:null,lampPoints:null,lampHalos:null,carPoints:null,carHalos:null,callback:null,
    nightFactor:0,sunElevation:90,forceNight:null,bloomStage:null,bloomWasEnabled:false,lastNight:0,lastTileScan:0,lastLampScan:0,lastCarUpdate:0,lastVisibility:0,
    scanPromise:null,stats:{tiles:0,triangles:0,tilesBuilt:0,lamps:0,lampHeightMisses:0,roads:0,lampPaths:0,cars:0,visibleCars:0}};
  window.__osakaExpresswayNightTraffic=state;

  const warm=new C.Color(1,.76,.43,1);
  const warmHalo=new C.Color(1,.58,.25,.18);
  const white=new C.Color(1,.97,.88,1);
  const whiteHalo=new C.Color(1,.91,.70,.23);
  const red=new C.Color(1,.035,.025,1);
  const redHalo=new C.Color(1,.025,.018,.24);
  const bodyColor=new C.Color(.29,.29,.28,.88);
  const poleColor=new C.Color(.21,.21,.20,.92);

  function focus(){
    const a=g.aircraft&&g.aircraft.instance,p=a&&a.llaLocation;
    if(Array.isArray(p)&&finite(+p[0])&&finite(+p[1]))return {lat:+p[0],lon:+p[1],x:+p[1]*SX,y:+p[0]*SY};
    const c=viewer.camera&&viewer.camera.positionCartographic;
    if(c)return {lat:c.latitude/RAD,lon:c.longitude/RAD,x:c.longitude/RAD*SX,y:c.latitude/RAD*SY};
    return null;
  }
  function distanceXY(lat1,lon1,lat2,lon2){
    const lm=(lat1+lat2)*.5*RAD;
    return Math.hypot((lon2-lon1)*111319.49*Math.cos(lm),(lat2-lat1)*110574);
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
  function simulationDate(){
    try{
      const t=viewer.clock&&viewer.clock.currentTime;
      if(t&&C.JulianDate&&typeof C.JulianDate.toDate==='function')return C.JulianDate.toDate(t);
    }catch(_){}
    return new Date();
  }
  function updateNight(now,f){
    if(now-state.lastNight<CFG.NIGHT_UPDATE_MS&&state.forceNight===null)return;
    state.lastNight=now;
    if(state.forceNight!==null){
      state.nightFactor=state.forceNight===true?1:state.forceNight===false?0:clamp(Number(state.forceNight)||0,0,1);
    }else{
      state.sunElevation=sunElevation(f.lat,f.lon,simulationDate());
      state.nightFactor=clamp((CFG.NIGHT_START_DEG-state.sunElevation)/(CFG.NIGHT_START_DEG-CFG.NIGHT_FULL_DEG),0,1);
    }
    if(state.bloomStage){try{state.bloomStage.enabled=state.bloomWasEnabled||state.nightFactor>.08;}catch(_){}}
  }
  function addTileToGrid(tile){
    const dLat=tile.radius/110574+.00012,dLon=tile.radius/(111319.49*Math.max(.2,Math.cos(tile.lat*RAD)))+.00012;
    const x0=Math.floor((tile.lon-dLon)/GRID_DEG),x1=Math.floor((tile.lon+dLon)/GRID_DEG);
    const y0=Math.floor((tile.lat-dLat)/GRID_DEG),y1=Math.floor((tile.lat+dLat)/GRID_DEG);
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
      const k=x+','+y;let a=state.tileCells.get(k);if(!a)state.tileCells.set(k,a=[]);a.push(tile);
    }
  }
  async function loadCollision(){
    if(typeof DecompressionStream==='undefined')throw Error('gzip DecompressionStream 非対応');
    let response=null,lastError=null;
    for(const url of COLLISION_URLS){
      try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);response=r;break;}
      catch(e){lastError=e;}
    }
    if(!response)throw Error('RoadCollision取得失敗: '+(lastError&&lastError.message||'unknown'));
    const stream=response.body?response.body.pipeThrough(new DecompressionStream('gzip')):new Blob([await response.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'));
    const buffer=await new Response(stream).arrayBuffer(),v=new DataView(buffer);
    if(v.byteLength<12||v.getUint8(0)!==79||v.getUint8(1)!==83||v.getUint8(2)!==67||v.getUint8(3)!==82)throw Error('OSCRヘッダー不正');
    const version=v.getUint16(4,true),count=v.getUint32(8,true);
    if(version!==1||count<1||count>2000)throw Error('OSCR version/tile count不正 '+version+'/'+count);
    let o=12,total=0;
    for(let i=0;i<count;i++){
      if(o+32>v.byteLength)throw Error('tile header truncated '+i);
      const ix=v.getInt32(o,true),iy=v.getInt32(o+4,true),lon=v.getFloat64(o+8,true),lat=v.getFloat64(o+16,true);
      const radius=v.getFloat32(o+24,true),triangleCount=v.getUint32(o+28,true);o+=32;
      if(!finite(lon)||!finite(lat)||!finite(radius)||!triangleCount||o+triangleCount*36>v.byteLength)throw Error('tile data invalid '+i);
      const tile={ix,iy,lon,lat,radius,triangleCount,dataOffset:o,values:null,heightGrid:null,built:false,queued:false};
      state.tiles.push(tile);addTileToGrid(tile);total+=triangleCount;o+=triangleCount*36;
    }
    if(o!==v.byteLength)throw Error('OSCR末尾サイズ不一致 '+(v.byteLength-o));
    state.buffer=buffer;state.stats.tiles=count;state.stats.triangles=total;
    console.log('[OSAKA expressway lights v5] 高度タイル:',count,'/ 三角形:',total.toLocaleString());
  }
  function addHeightTri(grid,index,a,b,c){
    const minX=Math.floor(Math.min(a[0],b[0],c[0])/CFG.TILE_CELL_M),maxX=Math.floor(Math.max(a[0],b[0],c[0])/CFG.TILE_CELL_M);
    const minY=Math.floor(Math.min(a[1],b[1],c[1])/CFG.TILE_CELL_M),maxY=Math.floor(Math.max(a[1],b[1],c[1])/CFG.TILE_CELL_M);
    for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){
      const k=x+','+y;let list=grid.get(k);if(!list)grid.set(k,list=[]);list.push(index);
    }
  }
  async function buildHeightTile(tile){
    const vals=new Float32Array(state.buffer,tile.dataOffset,tile.triangleCount*9),grid=new Map();
    for(let i=0;i<tile.triangleCount;i++){
      const j=i*9,a=[vals[j],vals[j+1],vals[j+2]],b=[vals[j+3],vals[j+4],vals[j+5]],c=[vals[j+6],vals[j+7],vals[j+8]];
      if(finite(a[0])&&finite(a[1])&&finite(a[2])&&finite(b[0])&&finite(b[1])&&finite(b[2])&&finite(c[0])&&finite(c[1])&&finite(c[2]))addHeightTri(grid,i,a,b,c);
      if(i>0&&i%CFG.TILE_YIELD_TRIANGLES===0){await sleep(0);if(!state.active)return;}
    }
    tile.values=vals;tile.heightGrid=grid;tile.built=true;tile.queued=false;state.stats.tilesBuilt++;
  }
  async function pumpTileQueue(){
    if(state.tilePump||!state.active)return;state.tilePump=true;
    while(state.active&&state.tileQueue.length){
      const tile=state.tileQueue.shift();
      try{await buildHeightTile(tile);}catch(e){tile.queued=false;console.warn('[OSAKA expressway lights v5] 高度タイル処理失敗',tile.ix,tile.iy,e);}
      await sleep(0);
    }
    state.tilePump=false;
  }
  function queueNearbyTiles(f){
    for(const tile of state.tiles){
      if(tile.built||tile.queued)continue;
      if(distanceXY(f.lat,f.lon,tile.lat,tile.lon)<=CFG.LAMP_BUILD_RADIUS_M+tile.radius){tile.queued=true;state.tileQueue.push(tile);}
    }
    if(state.tileQueue.length)pumpTileQueue();
  }
  function candidateTiles(lon,lat){return state.tileCells.get(Math.floor(lon/GRID_DEG)+','+Math.floor(lat/GRID_DEG))||[];}
  function baryZ(x,y,a,b,c){
    const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)return null;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;
    const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den,w=1-u-v;
    if(u<-.035||v<-.035||w<-.035||u>1.035||v>1.035||w>1.035)return null;
    return u*a[2]+v*b[2]+w*c[2];
  }
  function sampleRoadHeight(lon,lat,route,preferredHeight){
    const tiles=candidateTiles(lon,lat).filter(tile=>tile.built&&tile.heightGrid&&distanceXY(lat,lon,tile.lat,tile.lon)<=tile.radius+25);
    if(!tiles.length)return NaN;
    const collectAt=(tile,x,y)=>{
      const cx=Math.floor(x/CFG.TILE_CELL_M),cy=Math.floor(y/CFG.TILE_CELL_M),seen=new Set(),out=[];
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
        const list=tile.heightGrid.get((cx+ox)+','+(cy+oy));if(!list)continue;
        for(const ti of list){if(seen.has(ti))continue;seen.add(ti);const a=tile.values,j=ti*9;
          const z=baryZ(x,y,[a[j],a[j+1],a[j+2]],[a[j+3],a[j+4],a[j+5]],[a[j+6],a[j+7],a[j+8]]);
          if(z!==null&&finite(z))out.push(z);
        }
      }
      return out;
    };
    let heights=[];
    for(const tile of tiles){
      const sx=111319.49*Math.cos(tile.lat*RAD),x=(lon-tile.lon)*sx,y=(lat-tile.lat)*110574;
      heights.push(...collectAt(tile,x,y));
    }
    // Centerline and mesh can differ by a few metres. Search nearby positions only when the exact point misses.
    if(!heights.length){
      const offsets=[[2,0],[-2,0],[0,2],[0,-2],[4,0],[-4,0],[0,4],[0,-4],[6,0],[-6,0],[0,6],[0,-6]];
      for(const [oe,on] of offsets){
        for(const tile of tiles){
          const sx=111319.49*Math.cos(tile.lat*RAD),x=(lon-tile.lon)*sx+oe,y=(lat-tile.lat)*110574+on;
          heights.push(...collectAt(tile,x,y));
        }
        if(heights.length)break;
      }
    }
    if(!heights.length)return NaN;
    heights.sort((a,b)=>a-b);
    const p=route&&route.props||{},layer=Number(p.layer)||0;
    const preferred=finite(preferredHeight)?preferredHeight:(route&&route.props&&finite(route.lastZ)?route.lastZ:NaN);
    let z;
    if(String(p.bridge).toLowerCase()==='yes'||layer>0)z=heights[heights.length-1];
    else if(String(p.tunnel).toLowerCase()==='yes'||layer<0)z=heights[0];
    else if(finite(preferred)&&heights.some(h=>Math.abs(h-preferred)<8)){
      let best=1e30;z=heights[0];for(const h of heights){const d=Math.abs(h-preferred);if(d<best){best=d;z=h;}}
    }else z=heights[Math.floor((heights.length-1)*.5)];
    if(route&&route.props)route.lastZ=z;
    return z;
  }
  function parseMeters(v){if(v===undefined||v===null)return NaN;const s=String(v).trim().toLowerCase(),m=s.match(/[0-9]+(?:\.[0-9]+)?/);if(!m)return NaN;let n=Number(m[0]);if(/ft|feet|foot|'/i.test(s))n*=.3048;return n;}
  function roadWidth(p){
    const actual=parseMeters(p.width||p['width:carriageway']);if(finite(actual)&&actual>=5&&actual<=42)return actual;
    const one=String(p.oneway||'').toLowerCase(),lanes=parseMeters(p.lanes)||parseMeters(p['lanes:forward'])||((one==='yes'||one==='1'||one==='true')?2:4);
    return clamp(lanes*3.55+2.7,7.5,36);
  }
  function isExpressway(p){
    const h=p&&p.highway;
    if(h==='motorway'||h==='motorway_link')return true;
    if(h==='trunk'||h==='trunk_link')return p.toll==='yes'||/高速|expressway|阪神高速|名神高速/.test([p.name,p.ref,p.destination].filter(Boolean).join(' '));
    return false;
  }
  function geoMeters(a,b){
    const p1=a.lat*RAD,p2=b.lat*RAD,dp=(b.lat-a.lat)*RAD,dl=(b.lon-a.lon)*RAD;
    const q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
  }
  function makeLampRoute(feature,coords){
    const props=feature.properties||{},pts=[];
    for(const c of coords){if(!Array.isArray(c)||!finite(+c[0])||!finite(+c[1]))continue;pts.push({lon:+c[0],lat:+c[1],z:c.length>2&&finite(+c[2])?+c[2]:NaN});}
    if(pts.length<2)return null;
    const cum=new Float64Array(pts.length);let len=0;
    for(let i=1;i<pts.length;i++){len+=geoMeters(pts[i-1],pts[i]);cum[i]=len;}
    if(len<CFG.LAMP_SPACING_M)return null;
    return {id:String(feature.id||props['@id']||'expressway-route'),pts,cum,len,width:roadWidth(props),props,lastZ:NaN};
  }
  function lampRoutePoint(route,d){
    let lo=0,hi=route.cum.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(route.cum[m]<=d)lo=m;else hi=m;}
    const i=Math.min(lo,route.cum.length-2),a=route.pts[i],b=route.pts[i+1],span=Math.max(.001,route.cum[i+1]-route.cum[i]),t=clamp((d-route.cum[i])/span,0,1);
    return {lon:a.lon+(b.lon-a.lon)*t,lat:a.lat+(b.lat-a.lat)*t};
  }
  function tangentGeo(route,d){
    const a=lampRoutePoint(route,Math.max(0,d-8)),b=lampRoutePoint(route,Math.min(route.len,d+8));
    const east=(b.lon-a.lon)*111319.49*Math.cos((a.lat+b.lat)*.5*RAD),north=(b.lat-a.lat)*110574,n=Math.max(.001,Math.hypot(east,north));
    return {east:east/n,north:north/n};
  }
  function routeAtFraction(route,f){return lampRoutePoint(route,clamp(f,0,1)*route.len);}
  function routeTangentAtFraction(route,f){return tangentGeo(route,clamp(f,0,1)*route.len);}
  function corridorKey(route){
    const p=route.props||{},h=String(p.highway||'');
    if(h!=='motorway'&&h!=='motorway_link'&&h!=='trunk'&&h!=='trunk_link')return null;
    const identity=String(p.ref||p.name||p['name:ja']||'').trim();
    if(!identity)return null;
    return h+'|'+identity;
  }
  function pairScore(a,b){
    const a0=a.pts[0],a1=a.pts[a.pts.length-1],b0=b.pts[0],b1=b.pts[b.pts.length-1];
    const same0=geoMeters(a0,b0),same1=geoMeters(a1,b1),rev0=geoMeters(a0,b1),rev1=geoMeters(a1,b0);
    const reverseB=(rev0+rev1)<(same0+same1),e0=reverseB?rev0:same0,e1=reverseB?rev1:same1;
    // Only pair genuinely opposite one-way carriageways; never merge parallel ramps flowing the same way.
    if(!reverseB||Math.max(e0,e1)>CFG.LAMP_PAIR_ENDPOINT_MAX_M)return null;
    const ratio=a.len/b.len;if(ratio<.55||ratio>1.8)return null;
    const separations=[];
    for(const f of [.15,.35,.5,.65,.85]){
      const pa=routeAtFraction(a,f),pb=routeAtFraction(b,reverseB?1-f:f),sep=geoMeters(pa,pb);
      if(sep<CFG.LAMP_PAIR_MIN_SEPARATION_M||sep>CFG.LAMP_PAIR_MAX_SEPARATION_M)return null;
      const ta=routeTangentAtFraction(a,f),tb=routeTangentAtFraction(b,reverseB?1-f:f);
      const dot=ta.east*(tb.east*(reverseB?-1:1))+ta.north*(tb.north*(reverseB?-1:1));
      if(dot<.72)return null;
      separations.push(sep);
    }
    const mean=separations.reduce((x,y)=>x+y,0)/separations.length;
    if(Math.max(...separations)-Math.min(...separations)>Math.max(12,mean*.65))return null;
    return {reverseB,score:e0+e1+Math.abs(a.len-b.len)*.08+mean*.15,separation:mean};
  }
  function makeLampPath(a,b=null,reverseB=false,separation=0){
    const paired=!!b,len=paired?(a.len+b.len)*.5:a.len;
    const count=Math.max(0,Math.floor((len-2*CFG.LAMP_STATION_START_M)/CFG.LAMP_SPACING_M)+1);
    return {id:paired?a.id+'+'+b.id:a.id,a,b,reverseB,paired,len,separation,
      edge:paired?separation*.5+(a.width+b.width)*.25+CFG.LAMP_SIDE_MARGIN_M:a.width*.5+CFG.LAMP_SIDE_MARGIN_M,
      props:a.props,done:new Uint8Array(count),attempts:new Uint8Array(count)};
  }
  function buildLampPaths(routes){
    const buckets=new Map();
    for(let i=0;i<routes.length;i++){
      const key=corridorKey(routes[i]);if(!key)continue;
      let list=buckets.get(key);if(!list)buckets.set(key,list=[]);list.push(i);
    }
    const used=new Uint8Array(routes.length),paths=[];let paired=0;
    for(const [key,indices] of buckets){
      for(const i of indices){
        if(used[i])continue;
        const a=routes[i],pa=a.props||{};
        if(String(pa.oneway||'').toLowerCase()!=='yes'&&String(pa.oneway||'')!=='1')continue;
        let best=-1,bestInfo=null;
        for(const j of indices){
          if(j===i||used[j])continue;
          const pb=routes[j].props||{};
          if(String(pb.oneway||'').toLowerCase()!=='yes'&&String(pb.oneway||'')!=='1')continue;
          const info=pairScore(a,routes[j]);
          if(info&&(!bestInfo||info.score<bestInfo.score)){best=j;bestInfo=info;}
        }
        if(best>=0){used[i]=used[best]=1;paths.push(makeLampPath(a,routes[best],bestInfo.reverseB,bestInfo.separation));paired++;}
      }
    }
    for(let i=0;i<routes.length;i++)if(!used[i])paths.push(makeLampPath(routes[i]));
    console.log('[OSAKA expressway lights v5] 上下線ペア:',paired,'組 / 灯列ルート:',paths.length,'本（ペアの距離基準を共有）');
    return paths;
  }
  function lampPathSamples(path,d){
    const f=clamp(d/path.len,0,1),a=lampRoutePoint(path.a,f*path.a.len);
    if(!path.paired)return {center:a,a,b:null,edge:path.edge};
    const b=lampRoutePoint(path.b,(path.reverseB?1-f:f)*path.b.len);
    const center={lon:(a.lon+b.lon)*.5,lat:(a.lat+b.lat)*.5};
    const edge=geoMeters(a,b)*.5+(path.a.width+path.b.width)*.25+CFG.LAMP_SIDE_MARGIN_M;
    return {center,a,b,edge};
  }
  function lampPathTangent(path,d){
    const a=lampPathSamples(path,Math.max(0,d-8)).center,b=lampPathSamples(path,Math.min(path.len,d+8)).center;
    const east=(b.lon-a.lon)*111319.49*Math.cos((a.lat+b.lat)*.5*RAD),north=(b.lat-a.lat)*110574,n=Math.max(.001,Math.hypot(east,north));
    return {east:east/n,north:north/n};
  }
  function sampleLampPathHeight(path,samples){
    const za=sampleRoadHeight(samples.a.lon,samples.a.lat,path.a);
    if(!path.paired)return za;
    const zb=sampleRoadHeight(samples.b.lon,samples.b.lat,path.b);
    if(finite(za)&&finite(zb))return Math.abs(za-zb)<=6?(za+zb)*.5:NaN;
    return finite(za)?za:finite(zb)?zb:NaN;
  }
  function offsetLL(p,east,north){return {lon:p.lon+east/(111319.49*Math.max(.2,Math.cos(p.lat*RAD))),lat:p.lat+north/110574};}
  const poleMaterial=C.Material.fromType('Color',{color:poleColor});
  state.poleCollection=scene.primitives.add(new C.PolylineCollection());
  state.lampPoints=scene.primitives.add(new C.PointPrimitiveCollection());
  state.lampHalos=scene.primitives.add(new C.PointPrimitiveCollection());
  state.carPoints=scene.primitives.add(new C.PointPrimitiveCollection());
  state.carHalos=scene.primitives.add(new C.PointPrimitiveCollection());
  try{
    state.bloomStage=scene.postProcessStages&&scene.postProcessStages.bloom||null;
    if(state.bloomStage)state.bloomWasEnabled=!!state.bloomStage.enabled;
  }catch(_){}
  const lampHaloFade=new C.NearFarScalar(60,.18,CFG.LAMP_HALO_FADE_M,0);
  const carHaloFade=new C.NearFarScalar(45,.22,CFG.CAR_HALO_FADE_M,0);
  function addNativePoint(collection,position,color,pixelSize,translucency){
    const options={position,color,pixelSize,outlineWidth:0,show:false,disableDepthTestDistance:0};
    if(translucency)options.translucencyByDistance=translucency;
    return collection.add(options);
  }
  function pixelsPerRadian(){
    const camera=viewer.camera,frustum=camera&&camera.frustum;
    let fovy=frustum&&Number(frustum.fovy);
    if(!finite(fovy)||fovy<=0||fovy>=Math.PI){
      const near=frustum&&Number(frustum.near),top=frustum&&Number(frustum.top),bottom=frustum&&Number(frustum.bottom);
      fovy=finite(near)&&near>0&&finite(top)&&finite(bottom)?2*Math.atan((top-bottom)/(2*near)):Math.PI/3;
    }
    const h=Number(scene.drawingBufferHeight)||Number(scene.context&&scene.context.drawingBufferHeight)||Number(viewer.canvas&&viewer.canvas.height)||720;
    return h/(2*Math.tan(fovy*.5));
  }
  function projectedPointSize(position,diameterM,ppr,maxPx){
    const cameraPosition=viewer.camera&&viewer.camera.positionWC;
    if(!cameraPosition)return 0;
    const distance=Math.max(.1,C.Cartesian3.distance(cameraPosition,position));
    return clamp(diameterM*ppr/distance,0, maxPx);
  }
  function addLamp(path,index,side,p,z,d,edge){
    const t=lampPathTangent(path,d),nx=-t.north*side,ny=t.east*side;
    const baseLL=offsetLL(p,nx*edge,ny*edge),headLL=offsetLL(baseLL,-nx*CFG.LAMP_ARM_M,-ny*CFG.LAMP_ARM_M);
    const base=C.Cartesian3.fromDegrees(baseLL.lon,baseLL.lat,z+.15);
    const top=C.Cartesian3.fromDegrees(baseLL.lon,baseLL.lat,z+CFG.LAMP_POLE_HEIGHT_M);
    const head=C.Cartesian3.fromDegrees(headLL.lon,headLL.lat,z+CFG.LAMP_POLE_HEIGHT_M);
    const pole=state.poleCollection.add({positions:[base,top,head],width:1.0,material:poleMaterial,show:false});
    const point=addNativePoint(state.lampPoints,head,warm,2);
    const halo=addNativePoint(state.lampHalos,head,warmHalo,6,lampHaloFade);
    const lamp={x:baseLL.lon*SX,y:baseLL.lat*SY,pole,point,halo};state.lamps.push(lamp);
  }
  function buildLampsNear(f){
    let added=0,misses=0;
    for(const path of state.lampPaths){
      if(state.lamps.length>=CFG.LAMP_MAX_COUNT)break;
      for(let i=0;i<path.done.length;i++){
        if(path.done[i]||path.attempts[i]>=3)continue;
        const d=CFG.LAMP_STATION_START_M+i*CFG.LAMP_SPACING_M,samples=lampPathSamples(path,d),p=samples.center;
        if(distanceXY(f.lat,f.lon,p.lat,p.lon)>CFG.LAMP_BUILD_RADIUS_M)continue;
        const probes=path.paired?[samples.a,samples.b]:[samples.a];
        const tileStates=probes.map(q=>candidateTiles(q.lon,q.lat).filter(t=>distanceXY(q.lat,q.lon,t.lat,t.lon)<=t.radius+25));
        if(tileStates.some(a=>a.length&&a.some(t=>!t.built)))continue;
        if(tileStates.every(a=>!a.length)){path.attempts[i]=3;misses++;state.stats.lampHeightMisses++;continue;}
        path.attempts[i]++;
        const z=sampleLampPathHeight(path,samples);
        if(!finite(z)){if(path.attempts[i]>=3){misses++;state.stats.lampHeightMisses++;}continue;}
        const key=Math.round(p.lon*111319.49*Math.cos(p.lat*RAD)/5)+','+Math.round(p.lat*110574/5)+','+Math.round(z/4);
        if(state.lampStationDedup.has(key)){path.done[i]=1;continue;}
        state.lampStationDedup.set(key,1);
        addLamp(path,i,1,p,z,d,samples.edge);addLamp(path,i,-1,p,z,d,samples.edge);
        path.done[i]=1;added+=2;
      }
    }
    state.stats.lamps=state.lamps.length;
    if(added)console.log('[OSAKA expressway lights v5] 街灯追加:',added,'基 / 合計:',state.lamps.length);
    if(misses)console.log('[OSAKA expressway lights v5] 道路高度未取得:',misses,'地点（地面高度での代用なし）');
  }
  function endpointKey(c){return Math.round(Number(c[0])*1e6)+','+Math.round(Number(c[1])*1e6);}
  function roadSignature(p){
    // OSM way splits often change bridge/layer/lanes tags; keep those out of the chain key.
    return [p.highway||'',p.ref||p.name||p['name:ja']||''].join('|');
  }
  function mergeRoadSegments(segments){
    const nodes=new Map();
    for(let i=0;i<segments.length;i++){
      const s=segments[i],sig=s.sig;
      for(let end=0;end<2;end++){
        const key=sig+'#'+endpointKey(end?s.coords[s.coords.length-1]:s.coords[0]);
        let a=nodes.get(key);if(!a)nodes.set(key,a=[]);a.push({index:i,end});
      }
    }
    const used=new Uint8Array(segments.length),merged=[];
    const extend=(points,atFront,sig)=>{
      for(let guard=0;guard<1000;guard++){
        const endpoint=atFront?points[0]:points[points.length-1],list=nodes.get(sig+'#'+endpointKey(endpoint))||[];
        const next=list.filter(x=>!used[x.index]);if(next.length!==1)break;
        const pick=next[0],seg=segments[pick.index];used[pick.index]=1;
        const coords=pick.end===0?seg.coords:seg.coords.slice().reverse();
        if(atFront)points.unshift(...coords.slice(1).reverse());
        else points.push(...coords.slice(1));
      }
    };
    for(let i=0;i<segments.length;i++){
      if(used[i])continue;
      const s=segments[i];used[i]=1;const points=s.coords.slice();
      extend(points,false,s.sig);extend(points,true,s.sig);
      merged.push({id:s.id,props:s.props,coords:points});
    }
    return merged;
  }
  async function loadRoads(){
    const r=await fetch(ROAD_URL,{cache:'no-store'});if(!r.ok)throw Error('道路GeoJSON HTTP '+r.status);
    const data=await r.json();if(!data||!Array.isArray(data.features))throw Error('道路GeoJSON形式不正');
    const segments=[];let wayIndex=0;
    for(const f of data.features){
      if(!f||!f.geometry||!isExpressway(f.properties||{}))continue;
      const g=f.geometry,props=f.properties||{},fallbackId='expressway-way-'+(wayIndex++),id=String(f.id||props['@id']||fallbackId),sig=roadSignature(props);
      const add=coords=>{if(Array.isArray(coords)&&coords.length>=2)segments.push({id,props,sig,coords});};
      if(g.type==='LineString')add(g.coordinates);
      else if(g.type==='MultiLineString')for(let i=0;i<g.coordinates.length;i++)add(g.coordinates[i]);
    }
    const merged=mergeRoadSegments(segments);
    for(const f of merged){const route=makeLampRoute(f,f.coords);if(route)state.lampRoutes.push(route);}
    state.stats.roads=state.lampRoutes.length;
    state.lampPaths=buildLampPaths(state.lampRoutes);
    state.stats.lampPaths=state.lampPaths.length;
    console.log('[OSAKA expressway lights v5] 街灯対象道路:',state.lampRoutes.length,'連結way / ペア化灯列:',state.lampPaths.length,'元セグメント:',segments.length);
  }
  function interpRoute(route,s){
    s=clamp(s,0,route.len);const c=route.cum;let lo=0,hi=c.length-1;
    while(lo+1<hi){const m=(lo+hi)>>1;if(c[m]<=s)lo=m;else hi=m;}
    const i=Math.min(lo,route.n-2),d=Math.max(.001,c[i+1]-c[i]),t=clamp((s-c[i])/d,0,1),o=route.p;
    const i0=Math.max(0,i-1),i3=Math.min(route.n-1,i+2),t2=t*t,t3=t2*t;
    const h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2,out=new Array(3);
    for(let k=0;k<3;k++){
      const p0=o[i0*3+k],p1=o[i*3+k],p2=o[(i+1)*3+k],p3=o[i3*3+k];
      const den1=Math.max(.001,c[i+1]-c[i0]),den2=Math.max(.001,c[i3]-c[i]);
      const m1=(p2-p0)/den1*d,m2=(p3-p1)/den2*d;
      let v=h00*p1+h10*m1+h01*p2+h11*m2;if(k===2)v=clamp(v,Math.min(p1,p2)-.2,Math.max(p1,p2)+.2);out[k]=v;
    }
    return out;
  }
  function routeDistLL(a,b){return Math.hypot((a.lon-b.lon)*SX,(a.lat-b.lat)*SY);}
  function locateTrafficRoute(route,s){const c=route.cum;let lo=0,hi=c.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(c[m]<=s)lo=m;else hi=m;}return Math.min(lo,route.n-2);}
  function trafficPose(car,progress){
    const r=car.route,s=car.dir>0?progress:r.len-progress,L=24;
    const a=interpRoute(r,clamp(s-L,0,r.len)),b=interpRoute(r,clamp(s+L,0,r.len)),p=interpRoute(r,s);
    const east=b[0]-a[0],north=b[1]-a[1],horizontal=Math.max(.01,Math.hypot(east,north));
    let heading=Math.atan2(east,north),pitch=Math.atan2(b[2]-a[2],horizontal);
    if(car.dir<0){heading+=Math.PI;pitch=-pitch;}
    const off=car.lane===0?2.1:5.7,x=p[0]+Math.cos(heading)*off,y=p[1]-Math.sin(heading)*off;
    return {lon:x/SX,lat:y/SY,alt:p[2],heading,pitch};
  }
  function hourlyFactor(){
    const p=state.traffic&&state.traffic.hourly_profile&&state.traffic.hourly_profile.estimated_thousand_vehicles_per_hour;
    if(!p||p.length!==24)return 1;
    let h=0;try{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const get=t=>Number(parts.find(x=>x.type===t)?.value||0);h=get('hour')+get('minute')/60;}catch(_){const d=new Date();h=d.getHours()+d.getMinutes()/60;}
    const h0=Math.floor(h)%24,h1=(h0+1)%24,t=h-Math.floor(h),now=p[h0]*(1-t)+p[h1]*t;let base=0;for(let i=7;i<19;i++)base+=p[i]/12;
    return clamp(now/Math.max(1,base),.08,1.25);
  }
  async function loadTraffic(){
    if(typeof DecompressionStream==='undefined')throw Error('gzip DecompressionStream 非対応');
    const r=await fetch(TRAFFIC_URL,{cache:'no-store'});if(!r.ok)throw Error('交通ルートHTTP '+r.status);
    const stream=r.body.pipeThrough(new DecompressionStream('gzip')),data=await new Response(stream).json();
    if(!data||data.version!==2||!Array.isArray(data.routes))throw Error('交通ルートJSON形式不正');
    state.traffic=data.traffic||null;state.zoneMap=new Map((data.traffic_zones||[]).map(z=>[z.id,z]));
    for(const src of data.routes){
      if(!src.tz||!state.zoneMap.has(src.tz)||!Array.isArray(src.p)||src.p.length<5||Number(src.m)<250)continue;
      const xyz=new Float64Array(src.p.length*3),cum=new Float64Array(src.p.length);
      for(let i=0;i<src.p.length;i++){
        const p=src.p[i];xyz[i*3]=Number(p[0])*SX;xyz[i*3+1]=Number(p[1])*SY;xyz[i*3+2]=finite(+p[2])?+p[2]:NaN;
        if(i){const dx=xyz[i*3]-xyz[(i-1)*3],dy=xyz[i*3+1]-xyz[(i-1)*3+1];cum[i]=cum[i-1]+Math.hypot(dx,dy);}
      }
      const len=cum[cum.length-1];if(len<250)continue;
      state.routes.push({id:src.id,zoneId:src.tz,p:xyz,cum,n:src.p.length,len,groups:[],lastZ:NaN});
    }
    console.log('[OSAKA expressway lights v5] 交通ルート:',state.routes.length,'本 / zones:',state.zoneMap.size);
  }
  function buildCars(){
    const factor=hourlyFactor();let id=0;
    for(const route of state.routes){
      const z=state.zoneMap.get(route.zoneId);if(!z)continue;
      const flow=(Number(z.vehicles_12h)||0)/12*factor*.5;
      const density=flow/CFG.AVG_FLOW_SPEED_KMH/CFG.LANES_PER_DIRECTION;
      const usable=route.len-36,maxLane=Math.max(0,Math.floor(usable/CFG.CAR_SPACING_M));
      const count=Math.min(maxLane,Math.max(0,Math.round(density*route.len/1000)));
      if(!count)continue;
      for(const dir of [-1,1])for(let lane=0;lane<2;lane++){
        const group=[];route.groups.push(group);state.groups.push(group);
        for(let j=0;j<count;j++){
          if(state.cars.length>=CFG.CAR_MAX_COUNT)break;
          const spacing=usable/count,progress=18+(j+.5)*spacing+(Math.random()-.5)*Math.min(3,spacing*.03),speed=clamp(CFG.MIN_SPEED_MPS+Math.random()*(CFG.MAX_SPEED_MPS-CFG.MIN_SPEED_MPS),CFG.MIN_SPEED_MPS,CFG.MAX_SPEED_MPS);
          const car={id:id++,route,dir,lane,progress,prevProgress:progress,speed,targetSpeed:speed,cruiseSpeed:speed,nextSpeedChange:performance.now()+rand(4000,9000),height:NaN,lastHeightAt:0,body:null,front:null,rear:null,sleeping:false,respawnAt:0};
          state.cars.push(car);group.push(car);
        }
        group.sort((a,b)=>a.progress-b.progress);
      }
    }
    state.stats.cars=state.cars.length;
    console.log('[OSAKA expressway lights v5] 走行車両:',state.cars.length.toLocaleString(),'台（GLBなし・小さな車体点＋前白灯＋後赤灯） / 時間係数:',factor.toFixed(2));
  }
  function rand(a,b){return a+Math.random()*(b-a);}
  function updateMotion(dt,now){
    for(const group of state.groups){
      let resort=false;
      for(let i=group.length-1;i>=0;i--){
        const car=group[i];
        if(car.sleeping){
          if(now>=car.respawnAt){car.progress=rand(18,38);car.prevProgress=car.progress;car.speed=rand(CFG.MIN_SPEED_MPS,CFG.MAX_SPEED_MPS);car.targetSpeed=car.speed;car.cruiseSpeed=car.speed;car.nextSpeedChange=now+rand(4000,9000);car.sleeping=false;resort=true;}else continue;
        }
        car.prevProgress=car.progress;
        if(now>=car.nextSpeedChange){car.targetSpeed=clamp(car.cruiseSpeed+rand(-1.1,1.1),CFG.MIN_SPEED_MPS,CFG.MAX_SPEED_MPS);car.nextSpeedChange=now+rand(6500,12000);}
        const leader=i===group.length-1?null:group[i+1];let target=car.targetSpeed;
        if(leader&&!leader.sleeping){const gap=leader.progress-car.progress,safe=CFG.SAFE_GAP_M+car.speed*CFG.HEADWAY_S;if(gap>0&&gap<safe)target=Math.min(target,Math.max(3,(gap-CFG.SAFE_GAP_M)/CFG.HEADWAY_S));}
        car.speed+=clamp(target-car.speed,-CFG.BRAKE_MPS2*dt,CFG.ACCEL_MPS2*dt);car.progress+=car.speed*dt;
        if(car.progress>=car.route.len-12){car.sleeping=true;car.respawnAt=now+rand(1800,3200);for(const q of [car.body,car.frontL,car.frontR,car.rearL,car.rearR,car.frontGlowL,car.frontGlowR,car.rearGlowL,car.rearGlowR])if(q)q.show=false;resort=true;}
      }
      if(resort)group.sort((a,b)=>a.progress-b.progress);
    }
  }
  function pointForCar(pose,z,forwardM,sideM){
    const h=pose.heading,e=Math.sin(h)*forwardM+Math.cos(h)*sideM,n=Math.cos(h)*forwardM-Math.sin(h)*sideM;
    return C.Cartesian3.fromDegrees(pose.lon+e/(111319.49*Math.max(.2,Math.cos(pose.lat*RAD))),pose.lat+n/110574,z);
  }
  function ensureCarPoint(car,key,collection,pos,color,diameterM,ppr,visible,maxPx,translucency){
    const size=projectedPointSize(pos,diameterM,ppr,maxPx);
    if(!car[key])car[key]=addNativePoint(collection,pos,color,size,translucency);
    else{car[key].position=pos;car[key].color=color;car[key].pixelSize=size;car[key].show=visible;}
    car[key].show=visible;
  }
  function updateCars(now,dt,f){
    const limit2=CFG.CAR_VISIBLE_RADIUS_M*CFG.CAR_VISIBLE_RADIUS_M,night=state.nightFactor>.025,alpha=clamp(dt/(CFG.CAR_UPDATE_MS/1000),0,1),ppr=pixelsPerRadian();
    for(const car of state.cars){
      if(car.sleeping)continue;
      const progress=car.prevProgress+(car.progress-car.prevProgress)*alpha,pose=trafficPose(car,progress);
      const dx=(pose.lon-f.lon)*SX,dy=(pose.lat-f.lat)*SY,d2=dx*dx+dy*dy;
      if(d2>limit2){
        for(const q of [car.body,car.frontL,car.frontR,car.rearL,car.rearR,car.frontGlowL,car.frontGlowR,car.rearGlowL,car.rearGlowR])if(q)q.show=false;
        continue;
      }
      if(now-car.lastHeightAt>=CFG.CAR_HEIGHT_REFRESH_MS){
        car.lastHeightAt=now;
        const z=sampleRoadHeight(pose.lon,pose.lat,car.route,car.height);
        car.height=finite(z)?z:(finite(pose.alt)?pose.alt:NaN);
      }
      if(!finite(car.height)){
        for(const q of [car.body,car.frontL,car.frontR,car.rearL,car.rearR,car.frontGlowL,car.frontGlowR,car.rearGlowL,car.rearGlowR])if(q)q.show=false;
        continue;
      }
      const z=car.height+CFG.CAR_LIGHT_HEIGHT_M;
      const center=C.Cartesian3.fromDegrees(pose.lon,pose.lat,z);
      const fl=pointForCar(pose,z,CFG.CAR_FRONT_M,-CFG.CAR_SIDE_M),fr=pointForCar(pose,z,CFG.CAR_FRONT_M,CFG.CAR_SIDE_M);
      const rl=pointForCar(pose,z,-CFG.CAR_REAR_M,-CFG.CAR_SIDE_M),rr=pointForCar(pose,z,-CFG.CAR_REAR_M,CFG.CAR_SIDE_M);
      ensureCarPoint(car,'body',state.carPoints,center,bodyColor,CFG.CAR_BODY_DIAMETER_M,ppr,true,4);
      ensureCarPoint(car,'frontL',state.carPoints,fl,white,CFG.CAR_LIGHT_DIAMETER_M,ppr,night,3);
      ensureCarPoint(car,'frontR',state.carPoints,fr,white,CFG.CAR_LIGHT_DIAMETER_M,ppr,night,3);
      ensureCarPoint(car,'rearL',state.carPoints,rl,red,CFG.CAR_LIGHT_DIAMETER_M,ppr,night,3);
      ensureCarPoint(car,'rearR',state.carPoints,rr,red,CFG.CAR_LIGHT_DIAMETER_M,ppr,night,3);
      ensureCarPoint(car,'frontGlowL',state.carHalos,fl,whiteHalo,CFG.CAR_HALO_DIAMETER_M,ppr,night,10,carHaloFade);
      ensureCarPoint(car,'frontGlowR',state.carHalos,fr,whiteHalo,CFG.CAR_HALO_DIAMETER_M,ppr,night,10,carHaloFade);
      ensureCarPoint(car,'rearGlowL',state.carHalos,rl,redHalo,CFG.CAR_HALO_DIAMETER_M,ppr,night,10,carHaloFade);
      ensureCarPoint(car,'rearGlowR',state.carHalos,rr,redHalo,CFG.CAR_HALO_DIAMETER_M,ppr,night,10,carHaloFade);
    }
  }
  function refreshLampVisibility(f){
    const r2=CFG.LAMP_VISIBLE_RADIUS_M*CFG.LAMP_VISIBLE_RADIUS_M,night=state.nightFactor>.025,ppr=pixelsPerRadian();
    for(const l of state.lamps){
      const dx=l.x-f.x,dy=l.y-f.y,show=dx*dx+dy*dy<=r2;
      l.point.pixelSize=projectedPointSize(l.point.position,CFG.LAMP_BULB_DIAMETER_M,ppr,4);
      l.halo.pixelSize=projectedPointSize(l.halo.position,CFG.LAMP_HALO_DIAMETER_M,ppr,12);
      l.pole.show=show;l.point.show=show&&night;l.halo.show=show&&night;
    }
  }
  function hideAll(){
    for(const l of state.lamps){l.pole.show=false;l.point.show=false;l.halo.show=false;}
    for(const c of state.cars){for(const q of [c.body,c.frontL,c.frontR,c.rearL,c.rearR,c.frontGlowL,c.frontGlowR,c.rearGlowL,c.rearGlowR])if(q)q.show=false;}
  }
  state.setNightMode=(mode)=>{
    state.forceNight=mode===null?null:mode===true?true:mode===false?false:clamp(Number(mode)||0,0,1);
    state.lastNight=0;
    const f=focus();if(f){updateNight(performance.now(),f);refreshLampVisibility(f);updateCars(performance.now(),CFG.CAR_UPDATE_MS/1000,f);}
    return state.nightFactor;
  };
  state.stop=()=>{
    if(!state.active)return;state.active=false;
    try{if(g.api.removeFrameCallback&&state.callback)g.api.removeFrameCallback(state.callback);else if(scene.preRender&&state.callback)scene.preRender.removeEventListener(state.callback);}catch(_){}
    hideAll();
    try{if(state.bloomStage)state.bloomStage.enabled=state.bloomWasEnabled;}catch(_){}
    for(const p of [state.poleCollection,state.lampPoints,state.lampHalos,state.carPoints,state.carHalos])try{if(p)scene.primitives.remove(p);}catch(_){}
    state.tileQueue.length=0;state.lamps.length=0;state.lampPaths.length=0;state.cars.length=0;state.groups.length=0;state.tiles.length=0;state.buffer=null;
    if(window.__osakaExpresswayNightTraffic===state)window.__osakaExpresswayNightTraffic=null;
    console.log('[OSAKA expressway lights v5] 停止しました');
  };

  try{
    const f=focus();if(!f)throw Error('航空機位置が取得できません');
    console.log('[OSAKA expressway lights v5] データ読み込み中...');
    await Promise.all([loadCollision(),loadRoads(),loadTraffic()]);if(!state.active)return;
    queueNearbyTiles(f);
    while(state.tilePump||state.tileQueue.length){await sleep(100);if(!state.active)return;}
    buildCars();buildLampsNear(f);
    const now=performance.now();state.lastNight=0;state.lastTileScan=now;state.lastLampScan=now;state.lastCarUpdate=now;state.lastVisibility=0;
    let lastMotion=now;
    state.callback=()=>{
      if(!state.active)return;const t=performance.now(),p=focus();if(!p)return;
      updateNight(t,p);
      if(t-state.lastTileScan>=CFG.TILE_SCAN_MS){state.lastTileScan=t;queueNearbyTiles(p);}
      if(t-state.lastLampScan>=CFG.LAMP_SCAN_MS){state.lastLampScan=t;buildLampsNear(p);}
      if(t-state.lastVisibility>=900){state.lastVisibility=t;refreshLampVisibility(p);}
      if(t-state.lastCarUpdate>=CFG.CAR_UPDATE_MS){const dt=clamp((t-lastMotion)/1000,.06,.24);lastMotion=t;state.lastCarUpdate=t;updateMotion(dt,t);updateCars(t,dt,p);}
    };
    if(g.api.addFrameCallback)g.api.addFrameCallback(state.callback);else if(scene.preRender&&scene.preRender.addEventListener)scene.preRender.addEventListener(state.callback);else throw Error('frame callback APIなし');
    refreshLampVisibility(f);state.callback();
    console.log('[OSAKA expressway lights v5] 夜間表示テスト: window.__osakaExpresswayNightTraffic.setNightMode(true) / 自動に戻す: setNightMode(null)');
    console.log('[OSAKA expressway lights v5] 起動完了:',{roads:state.stats.roads,streetLamps:state.stats.lamps,cars:state.stats.cars,collisionTiles:state.stats.tilesBuilt,triangles:state.stats.triangles,streetLampSpacing:CFG.LAMP_SPACING_M,pairedCarriagewayGroups:state.lampPaths.filter(x=>x.paired).length,lightHeightAboveRoad:CFG.LAMP_POLE_HEIGHT_M,vehicleModels:false,renderer:'Cesium PointPrimitiveCollection + native Bloom; no PNG/Canvas/Billboard',sizeModel:'projected physical diameter (meter size -> screen pixels)',nightFactor:state.nightFactor});
  }catch(e){console.error('[OSAKA expressway lights v5] 起動失敗:',e);state.stop();}
})().catch(e=>console.error('[OSAKA expressway lights v5] fatal:',e));
