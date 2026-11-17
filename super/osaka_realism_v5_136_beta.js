(()=>{
'use strict';
const KEY='__OSAKA_REALISM_BETA_V5_136_1__';
try{window.__OSAKA_REALISM_BETA_V4__?.stop?.();}catch(_){}
if(window[KEY]?.stop)window[KEY].stop();
const C=window.Cesium,G=window.geofs,V=G?.api?.viewer;
const SC=V?.scene;
const MIN_VERSION=136;
const parseVersion=s=>{const m=String(s||'').match(/^(\d+)\.(\d+)/);return m?{major:+m[1],minor:+m[2]}:{major:0,minor:0};};
const ver=parseVersion(C?.VERSION);
if(!C||!G||!V||!SC){console.error('[OSAKA beta v5.136.1] GeoFS/Cesium viewerが見つかりません');return;}
if(ver.major<1||(ver.major===1&&ver.minor<MIN_VERSION)){
 console.error(`[OSAKA beta v5.136.1] CesiumJS 1.136+ が必要です。現在: ${C.VERSION||'version unknown'}。既に起動したGeoFS viewerのCesiumを後から差し替えることはできません。beta側のviewer自体を新しいCesiumで起動してください。`);
 return;
}
if(!C.CustomShader||!C.CustomShaderMode?.MODIFY_MATERIAL||!C.LightingModel?.PBR||!C.Model?.fromGltfAsync||!C.Cesium3DTileset?.fromUrl||!C.PostProcessStageLibrary){console.error('[OSAKA beta v5.136.1] CesiumJS 1.136に必要な公開APIが不足しています。VERSIONとビルド構成を確認してください');return;}
const REPO='supermanone-boop/OSAKA',BRANCH='main';
const RAW=`https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const TREE=`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const PLATEAU='https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/';
const AREA='27';
const LIGHTS=16;
const EXPRESSWAY={path:'Osaka_Expressways_Realistic_v4.glb.gz',url:'https://huggingface.co/supermanone-boop/OSAKA/resolve/main/Osaka_Expressways_Realistic_v4.glb.gz',lon:135.51052305,lat:34.74052680,alt:0};
const S={active:false,stopped:false,generation:0,tiles:[],models:[],shaders:[],blobUrls:[],tileListeners:[],lampData:[],lampEntities:[],glowEntities:[],pointCollection:null,postStages:[],preUpdate:null,mouseHandler:null,placing:false,tree:null,treeAt:0,loaded:{buildings:0,roads:0,rails:0},failed:[],sceneOriginal:null,loads:new Set(),lastLampCenter:null,lastLampFetch:0,activeLampSet:[],lastLampSelectionAt:0};
const css=`#osakaBeta5{position:fixed;z-index:999999;left:10px;top:82px;width:286px;max-height:78vh;overflow:auto;background:rgba(12,19,26,.97);color:#edf5fa;border:1px solid #657985;border-radius:9px;padding:10px;font:13px/1.45 Arial,sans-serif;box-shadow:0 5px 24px #000b}#osakaBeta5 *{box-sizing:border-box}#osakaBeta5 header{display:flex;align-items:center;justify-content:space-between;font-weight:700;margin-bottom:7px}#osakaBeta5 button{background:#344d5c;color:#fff;border:1px solid #8299a6;border-radius:5px;padding:6px 8px;font-size:12px}#osakaBeta5 label{display:flex;align-items:center;gap:7px;margin:7px 0}#osakaBeta5 input[type=checkbox]{accent-color:#e5b86d}#osakaBeta5 input[type=range],#osakaBeta5 select{width:100%}#osakaBeta5 select{background:#1d2d37;color:#fff;border:1px solid #667e8c;border-radius:5px;padding:6px;margin:4px 0 7px}#osakaBeta5 .small{font-size:11px;color:#b9c9d1}#osakaBeta5 .row{display:flex;gap:6px;align-items:center}#osakaBeta5 .row button{flex:1}#osakaBeta5 .rangeLine{display:block;margin-top:7px}#osakaBeta5 .rangeLine span{display:flex;justify-content:space-between}#osakaBeta5 #ob5Status{margin-top:8px;min-height:38px;overflow-wrap:anywhere;color:#d4e9f4}#osakaBetaReopen5{position:fixed;z-index:999999;left:10px;top:82px;display:none;background:#202c34;color:#fff;border:1px solid #8299a6;border-radius:6px;padding:7px 10px;font:12px Arial}`;
['osakaBeta4','osakaBetaReopen4','osakaBeta4Style','osakaBeta5','osakaBetaReopen5','osakaBeta5Style'].forEach(id=>document.getElementById(id)?.remove());
const style=document.createElement('style');style.id='osakaBeta5Style';style.textContent=css;document.head.appendChild(style);
const panel=document.createElement('div');panel.id='osakaBeta5';
panel.innerHTML=`<header><span>OSAKA Realism BETA v5.136.1</span><button id="ob5Close">×</button></header>
<div class="small">CesiumJS ${C.VERSION} / Sampler-free Procedural PBR</div>
<label><input type="checkbox" id="ob5Buildings" checked>PLATEAU建物（大阪府）</label>
<select id="ob5Lod"><option value="maxlod3">LOD3優先（公開LODで補完）</option><option value="lod3">LOD3のみ</option></select>
<label><input type="checkbox" id="ob5Roads">OSAKA高速道路GLB</label>
<label><input type="checkbox" id="ob5Rails">OSAKA鉄道・線路GLB</label>
<label><input type="checkbox" id="ob5Lamps">街灯＋周囲への局所照明</label>
<label><input type="checkbox" id="ob5Bloom">ブルーム（任意・描画負荷あり）</label>
<label><input type="checkbox" id="ob5AO">SSAO（任意・描画負荷あり）</label>
<div class="small">点灯モード</div><select id="ob5Mode"><option value="on">常時点灯（表示テスト向け）</option><option value="auto">昼夜自動</option><option value="off">消灯</option></select>
<label class="rangeLine"><span><b>照明強度</b><span id="ob5PowerVal">1.8×</span></span><input id="ob5Power" type="range" min="0.3" max="3.5" value="1.8" step="0.1"></label>
<label class="rangeLine"><span><b>照明半径</b><span id="ob5RadiusVal">42 m</span></span><input id="ob5Radius" type="range" min="18" max="85" value="42" step="1"></label>
<label class="rangeLine"><span><b>同時計算する光源</b><span id="ob5BudgetVal">12灯</span></span><input id="ob5Budget" type="range" min="4" max="16" value="12" step="1"></label>
<div class="row" style="margin-top:9px"><button id="ob5Start">大阪を読み込む</button><button id="ob5Stop">停止・削除</button></div>
<div class="row" style="margin-top:6px"><button id="ob5Place">タップで照明を追加</button></div>
<div id="ob5Status">待機中</div>
<div class="small">街灯・高速道路・線路は最初OFF。建物のみで起動確認後、停止して機能を1つずつ追加してください。局所照明はSamplerを使わず材質へ計算加算します。</div>`;
document.body.appendChild(panel);
const reopen=document.createElement('button');reopen.id='osakaBetaReopen5';reopen.textContent='OSAKA BETA';document.body.appendChild(reopen);
const $=id=>document.getElementById(id);
const ui={buildings:$('ob5Buildings'),lod:$('ob5Lod'),roads:$('ob5Roads'),rails:$('ob5Rails'),lamps:$('ob5Lamps'),bloom:$('ob5Bloom'),ao:$('ob5AO'),mode:$('ob5Mode'),power:$('ob5Power'),radius:$('ob5Radius'),budget:$('ob5Budget'),status:$('ob5Status')};
const say=t=>{ui.status.textContent=t;console.log('[OSAKA beta v5.136.1]',t);};
$('ob5Close').onclick=()=>{panel.style.display='none';reopen.style.display='block';};
reopen.onclick=()=>{panel.style.display='block';reopen.style.display='none';};
ui.power.addEventListener('input',()=>{$('ob5PowerVal').textContent=Number(ui.power.value).toFixed(1)+'×';requestRender();});
ui.radius.addEventListener('input',()=>{$('ob5RadiusVal').textContent=ui.radius.value+' m';requestRender();});
ui.budget.addEventListener('input',()=>{$('ob5BudgetVal').textContent=ui.budget.value+'灯';updateShaderLights(true);requestRender();});
function requestRender(){try{SC.requestRender();}catch(_){}}
function aircraftLLA(){try{const a=G.aircraft?.instance?.llaLocation;if(a&&a.length>=2){let lon=+a[0],lat=+a[1];if(Math.abs(lon)<=90&&Math.abs(lat)>90)[lon,lat]=[lat,lon];if(Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=90)return{lon,lat,alt:+a[2]||0};}}catch(_){}return cameraLLA();}
function cameraLLA(){try{const p=C.Cartographic.fromCartesian(SC.camera.positionWC,C.Ellipsoid.WGS84);if(p)return{lon:C.Math.toDegrees(p.longitude),lat:C.Math.toDegrees(p.latitude),alt:p.height};}catch(_){}return null;}
function rad(x){return x*Math.PI/180;}
function haversine(a,b){const R=6371000,dl=rad(b.lat-a.lat),dn=rad(b.lon-a.lon),q=Math.sin(dl/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(q));}
function inOsaka(o){return o&&o.lon>134.65&&o.lon<136.25&&o.lat>34.15&&o.lat<35.25;}
function plateauUrl(lod){return `${PLATEAU}${AREA}-bldg-${lod}-latest/tileset.json`;}
function makeUniforms(withFacade,kind){
 const U=C.UniformType,u={};
 u.uNightFactor={type:U.FLOAT,value:1.0};
 u.uSurfaceKind={type:U.FLOAT,value:kind==='roads'?1.0:(kind==='rails'?2.0:0.0)};
 for(let i=0;i<LIGHTS;i++){
  u[`uLampPR${i}`]={type:U.VEC4,value:new C.Cartesian4(0,0,0,1)};
  u[`uLampCP${i}`]={type:U.VEC4,value:new C.Cartesian4(0,0,0,0)};
 }
 return u;
}
function lightShaderText(){
 let body='';
 for(let i=0;i<LIGHTS;i++)body+=`
  {
   vec3 toLamp${i}=uLampPR${i}.xyz-pEC;
   float dist${i}=length(toLamp${i});
   float range${i}=max(uLampPR${i}.w,0.001);
   if(dist${i}<range${i} && uLampCP${i}.w>0.0001){
    vec3 L${i}=toLamp${i}/max(dist${i},0.001);
    float edge${i}=clamp(1.0-dist${i}/range${i},0.0,1.0);
    float fall${i}=edge${i}*edge${i}/(1.0+0.055*dist${i}+0.0018*dist${i}*dist${i});
    float NoL${i}=max(dot(N,L${i}),0.0);
    float NoV${i}=max(dot(N,viewDir),0.001);
    if(NoL${i}>0.0){
     vec3 H${i}=normalize(L${i}+viewDir);
     float NoH${i}=max(dot(N,H${i}),0.001);
     float VoH${i}=max(dot(viewDir,H${i}),0.001);
     float r${i}=clamp(material.roughness,0.045,1.0);
     float a${i}=r${i}*r${i};
     float a2${i}=a${i}*a${i};
     float den${i}=NoH${i}*NoH${i}*(a2${i}-1.0)+1.0;
     float D${i}=a2${i}/max(3.14159265*den${i}*den${i},0.0001);
     float k${i}=(r${i}+1.0);k${i}=k${i}*k${i}*0.125;
     float Gv${i}=NoV${i}/(NoV${i}*(1.0-k${i})+k${i});
     float Gl${i}=NoL${i}/(NoL${i}*(1.0-k${i})+k${i});
     vec3 F0${i}=clamp(material.specular,vec3(0.02),vec3(0.98));
     vec3 F${i}=F0${i}+(vec3(1.0)-F0${i})*pow(1.0-VoH${i},5.0);
     vec3 spec${i}=D${i}*Gv${i}*Gl${i}*F${i}/max(4.0*NoV${i}*NoL${i},0.001);
     vec3 diff${i}=(vec3(1.0)-F${i})*material.diffuse*0.318309886;
     vec3 radiance${i}=uLampCP${i}.rgb*uLampCP${i}.w*fall${i}*3.2;
     lampRadiance += radiance${i}*(diff${i}+spec${i})*NoL${i};
    }
   }
  }
 `;
 return `
  vec3 lampRadiance=vec3(0.0);
  ${body}
  material.emissive += lampRadiance*uNightFactor;
 `;
}
function facadeShaderBody(){return `
  vec3 base=material.diffuse;
  float lo=min(base.r,min(base.g,base.b));
  float hi=max(base.r,max(base.g,base.b));
  float chroma=hi-lo;
  float whiteMask=smoothstep(0.56,0.82,lo)*(1.0-smoothstep(0.055,0.20,chroma));
  vec3 cell=floor(vFacadePosMC/vec3(47.0));
  float materialId=mod(abs(dot(cell,vec3(1.0,3.0,5.0))),6.0);
  vec3 nn=abs(normalize(vFacadeNormalMC));
  vec2 uv;
  if(nn.y>=nn.x && nn.y>=nn.z) uv=vFacadePosMC.xz;
  else if(nn.x>=nn.z) uv=vFacadePosMC.zy;
  else uv=vFacadePosMC.xy;
  vec3 facade=vec3(0.66,0.64,0.59);
  float rough=0.78;
  float metal=0.0;
  float relief=0.0;
  if(materialId<0.5){
   vec2 q=uv*0.72; vec2 f=fract(q); vec2 id=floor(q);
   float grout=1.0-smoothstep(0.018,0.045,min(min(f.x,1.0-f.x),min(f.y,1.0-f.y)));
   float v=fract(sin(dot(id,vec2(12.9898,78.233)))*43758.5453);
   facade=mix(vec3(0.70,0.68,0.62),vec3(0.84,0.81,0.74),v*0.28);
   facade*=1.0-grout*0.34; rough=0.48+v*0.13; relief=grout*0.10;
  }else if(materialId<1.5){
   vec2 q=uv*0.20; vec2 f=fract(q); vec2 id=floor(q);
   float n=fract(sin(dot(floor(uv*5.0),vec2(37.1,91.7)))*143758.5453);
   float seam=1.0-smoothstep(0.006,0.018,min(min(f.x,1.0-f.x),min(f.y,1.0-f.y)));
   float stain=0.94+0.08*n;
   facade=vec3(0.48,0.49,0.47)*stain*(1.0-seam*0.12);
   rough=0.91; relief=(n-0.5)*0.055-seam*0.04;
  }else if(materialId<2.5){
   vec2 q=uv*0.34; vec2 f=fract(q); vec2 id=floor(q);
   float mullion=1.0-smoothstep(0.012,0.035,min(min(f.x,1.0-f.x),min(f.y,1.0-f.y)));
   float variation=fract(sin(dot(id,vec2(17.17,41.31)))*16731.17);
   float fres=pow(1.0-max(dot(normalize(vFacadeNormalMC),normalize(vec3(0.3,0.8,0.5))),0.0),4.0);
   facade=mix(vec3(0.075,0.15,0.22),vec3(0.19,0.29,0.37),variation*0.52+fres*0.35);
   facade=mix(facade,vec3(0.025,0.035,0.045),mullion*0.92);
   rough=0.19+variation*0.09; metal=0.18; relief=mullion*0.025;
  }else if(materialId<3.5){
   vec2 q=uv*0.34; vec2 row=floor(q); vec2 f=fract(q); f.x=fract(q.x+mod(row.y,2.0)*0.5);
   float mortar=1.0-smoothstep(0.018,0.042,min(min(f.x,1.0-f.x),min(f.y,1.0-f.y)));
   float v=fract(sin(dot(row,vec2(27.1,61.7)))*43758.5453);
   facade=mix(vec3(0.25,0.095,0.055),vec3(0.43,0.19,0.105),v*0.72);
   facade*=1.0-mortar*0.48; rough=0.84; relief=mortar*0.09+(v-0.5)*0.02;
  }else if(materialId<4.5){
   float ribs=0.5+0.5*cos(uv.x*5.6*6.2831853);
   float groove=smoothstep(0.78,0.96,ribs);
   float v=fract(sin(dot(floor(uv*vec2(0.2,0.7)),vec2(19.19,73.73)))*9182.17);
   facade=mix(vec3(0.075,0.083,0.09),vec3(0.19,0.20,0.205),groove*0.72);
   facade*=0.95+v*0.07; rough=0.34; metal=0.68; relief=(groove-0.5)*0.10;
  }else{
   vec2 q=uv*0.27; vec2 f=fract(q); vec2 id=floor(q);
   float seam=1.0-smoothstep(0.012,0.032,min(min(f.x,1.0-f.x),min(f.y,1.0-f.y)));
   float v=fract(sin(dot(id,vec2(31.4,17.8)))*21931.73);
   float fleck=fract(sin(dot(floor(uv*vec2(5.0,8.0)),vec2(17.3,59.1)))*7141.1);
   facade=mix(vec3(0.48,0.43,0.35),vec3(0.68,0.61,0.50),v*0.65+fleck*0.12);
   facade*=1.0-seam*0.25; rough=0.73; relief=seam*0.065+(fleck-0.5)*0.015;
  }
  float micro=fract(sin(dot(floor(uv*vec2(31.0,47.0)),vec2(12.9898,78.233)))*43758.5453);
  facade*=0.975+micro*0.05;
  material.diffuse=mix(base,facade,whiteMask);
  material.roughness=mix(material.roughness,rough,whiteMask);
  vec3 f0=mix(vec3(0.04),facade,metal);
  material.specular=mix(material.specular,f0,whiteMask);
  vec3 bump=vec3(dFdx(relief),dFdy(relief),0.0);
  material.normalEC=normalize(material.normalEC+vec3(bump.xy*whiteMask*0.22,0.0));
 `;}
function ownSurfaceShaderBody(){return `
  if(uSurfaceKind>0.5 && uSurfaceKind<1.5){
   // Road deck: restrained mineral grain, broad rough highlights, no plastic sheen.
   vec2 grainCell=floor(fsInput.attributes.positionMC.xz*2.1);
   float grain=fract(sin(dot(grainCell,vec2(12.9898,78.233)))*43758.5453);
   material.diffuse*=0.986+grain*0.028;
   material.roughness=max(material.roughness,0.72);
   material.specular*=0.72;
  }else if(uSurfaceKind>1.5){
   // Rail assets: preserve imported ballast/sleeper colors while giving steel a restrained F0 lift.
   float brushed=0.5+0.5*sin(fsInput.attributes.positionMC.x*0.17+fsInput.attributes.positionMC.z*0.11);
   material.specular=mix(material.specular,vec3(0.20+0.04*brushed),0.12);
   material.roughness=clamp(material.roughness*0.94,0.16,0.98);
  }
 `;}
function createSurfaceShader(config){
 const opts=typeof config==='boolean'?{facade:config,kind:config?'building':'generic'}:(config||{});
 const withFacade=!!opts.facade,kind=opts.kind||'generic';
 const uniforms=makeUniforms(withFacade,kind);
 const varyings=withFacade?{vFacadePosMC:C.VaryingType.VEC3,vFacadeNormalMC:C.VaryingType.VEC3}:undefined;
 const vertexShaderText=withFacade?`
  void vertexMain(VertexInput vsInput,inout czm_modelVertexOutput vsOutput){
    vFacadePosMC=vsInput.attributes.positionMC;
    vFacadeNormalMC=vsInput.attributes.normalMC;
  }
 `:undefined;
 const fragmentShaderText=`
  void fragmentMain(FragmentInput fsInput,inout czm_modelMaterial material){
    vec3 pEC=fsInput.attributes.positionEC;
    vec3 N=normalize(fsInput.attributes.normalEC);
    vec3 viewDir=normalize(-pEC);
    ${withFacade?facadeShaderBody():ownSurfaceShaderBody()}
    ${lightShaderText()}
  }
 `;
 return new C.CustomShader({mode:C.CustomShaderMode.MODIFY_MATERIAL,lightingModel:C.LightingModel.PBR,uniforms,varyings,vertexShaderText,fragmentShaderText});
}
function saveSceneSettings(){
 const sm=SC.shadowMap;
 S.sceneOriginal={hdr:SC.highDynamicRange,shadows:SC.shadows,globeLighting:SC.globe?.enableLighting,groundAtmosphere:SC.globe?.showGroundAtmosphere,shadowEnabled:sm?.enabled,softShadows:sm?.softShadows,shadowSize:sm?.size,shadowMax:sm?.maximumDistance,shadowDarkness:sm?.darkness};
 try{SC.highDynamicRange=!!SC.highDynamicRangeSupported;}catch(_){}
 try{SC.shadows=true;}catch(_){}
 try{if(SC.globe){SC.globe.enableLighting=true;SC.globe.showGroundAtmosphere=true;}}catch(_){}
 try{if(sm){sm.enabled=true;sm.softShadows=true;sm.size=2048;sm.maximumDistance=7000;sm.darkness=0.38;}}catch(_){}
 // Post-process stages are opt-in. This prevents uninitialized framebuffer samplers from stopping GeoFS rendering.
}
function restoreSceneSettings(){
 if(!S.sceneOriginal)return;const o=S.sceneOriginal;try{SC.highDynamicRange=o.hdr;SC.shadows=o.shadows;if(SC.globe){SC.globe.enableLighting=o.globeLighting;SC.globe.showGroundAtmosphere=o.groundAtmosphere;}const sm=SC.shadowMap;if(sm){sm.enabled=o.shadowEnabled;sm.softShadows=o.softShadows;sm.size=o.shadowSize;sm.maximumDistance=o.shadowMax;sm.darkness=o.shadowDarkness;}}catch(e){console.warn(e);}S.sceneOriginal=null;
}
function syncPostStages(){
 const want={bloom:!!ui.bloom.checked,ao:!!ui.ao.checked};
 for(const entry of [...S.postStages]){if(!want[entry.kind]){try{SC.postProcessStages.remove(entry.stage);}catch(_){}S.postStages.splice(S.postStages.indexOf(entry),1);}}
 const lib=C.PostProcessStageLibrary;
 if(want.bloom&&!S.postStages.some(x=>x.kind==='bloom')){try{if(typeof lib.createBloomStage==='function'){const stage=lib.createBloomStage();stage.enabled=true;SC.postProcessStages.add(stage);S.postStages.push({kind:'bloom',stage});}}catch(e){ui.bloom.checked=false;console.warn('[OSAKA beta v5.136.1] Bloom disabled',e);}}
 if(want.ao&&!S.postStages.some(x=>x.kind==='ao')){try{if(typeof lib.createAmbientOcclusionStage==='function'&&typeof lib.isAmbientOcclusionSupported==='function'&&lib.isAmbientOcclusionSupported(SC)){const stage=lib.createAmbientOcclusionStage();stage.enabled=true;SC.postProcessStages.add(stage);S.postStages.push({kind:'ao',stage});}else{ui.ao.checked=false;say('このGPU/ブラウザではSSAOを利用できません');}}catch(e){ui.ao.checked=false;console.warn('[OSAKA beta v5.136.1] SSAO disabled',e);}}
 requestRender();
}
function solarNightFactor(){
 if(ui.mode.value==='off'||!ui.lamps.checked)return 0;
 if(ui.mode.value==='on')return 1;
 const p=aircraftLLA();if(!p)return 0.5;
 const now=new Date(),day=Math.floor((Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-Date.UTC(now.getUTCFullYear(),0,0))/86400000);
 const gamma=2*Math.PI/365*(day-1+(now.getUTCHours()-12)/24);
 const dec=0.006918-0.399912*Math.cos(gamma)+0.070257*Math.sin(gamma)-0.006758*Math.cos(2*gamma)+0.000907*Math.sin(2*gamma)-0.002697*Math.cos(3*gamma)+0.00148*Math.sin(3*gamma);
 const solarHours=now.getUTCHours()+now.getUTCMinutes()/60+p.lon/15;
 const ha=rad((solarHours-12)*15);
 const sinAlt=Math.sin(rad(p.lat))*Math.sin(dec)+Math.cos(rad(p.lat))*Math.cos(dec)*Math.cos(ha);
 return Math.max(0,Math.min(1,(0.10-sinAlt)/0.16));
}
function updateShaderLights(forceSelection=false){
 if(!S.shaders.length&&!S.pointCollection)return;
 const night=solarNightFactor();
 if(S.pointCollection)S.pointCollection.show=night>0.015;
 for(const id of S.glowEntities){const e=V.entities.getById(id);if(e)e.show=night>0.015;}
 const center=aircraftLLA();
 const now=Date.now();
 if(forceSelection||!S.activeLampSet.length||now-S.lastLampSelectionAt>650||(!S.lastLampSelectionCenter&&!!center)||(!!center&&!!S.lastLampSelectionCenter&&haversine(center,S.lastLampSelectionCenter)>18)){
  const budget=Math.max(4,Math.min(LIGHTS,Number(ui.budget?.value)||12));
  S.activeLampSet=S.lampData.map(l=>({l,d:center?haversine(center,{lon:l.lon,lat:l.lat}):Infinity})).sort((a,b)=>a.d-b.d).slice(0,budget);
  S.lastLampSelectionCenter=center?{lon:center.lon,lat:center.lat}:null;
  S.lastLampSelectionAt=now;
 }
 const view=SC.camera.viewMatrix;
 for(const shader of S.shaders){
  try{
   shader.setUniform('uNightFactor',night);
   for(let i=0;i<LIGHTS;i++){
    const item=S.activeLampSet[i];
    if(item&&item.l.ecef){
     const eye=C.Matrix4.multiplyByPoint(view,item.l.ecef,new C.Cartesian3());
     shader.setUniform(`uLampPR${i}`,new C.Cartesian4(eye.x,eye.y,eye.z,Number(ui.radius.value)));
     const k=item.l.color||new C.Cartesian3(1.0,0.68,0.42);
     const power=Number(ui.power.value)*item.l.power;
     shader.setUniform(`uLampCP${i}`,new C.Cartesian4(k.x,k.y,k.z,power));
    }else{
     shader.setUniform(`uLampPR${i}`,new C.Cartesian4(0,0,0,1));
     shader.setUniform(`uLampCP${i}`,new C.Cartesian4(0,0,0,0));
    }
   }
  }catch(e){console.warn('[OSAKA beta v5.136.1] light uniform',e);}
 }
}
function glowColor(alpha){return new C.Color(1.0,0.58,0.25,alpha);}
function clearLampVisuals(){
 for(const id of S.lampEntities){try{V.entities.removeById(id);}catch(_){}}S.lampEntities=[];S.glowEntities=[];
 if(S.pointCollection){try{SC.primitives.remove(S.pointCollection);}catch(_){}S.pointCollection=null;}
}
function localEnuPoint(base,east,north,up){
 const enu=C.Transforms.eastNorthUpToFixedFrame(base);
 return C.Matrix4.multiplyByPoint(enu,new C.Cartesian3(east,north,up),new C.Cartesian3());
}
function addLampVisual(lamp){
 const base=C.Cartesian3.fromDegrees(lamp.lon,lamp.lat,lamp.ground);
 const top=localEnuPoint(base,0,0,lamp.height);
 const arm0=localEnuPoint(base,0,0,lamp.height-0.35);
 const arm1=localEnuPoint(base,0.55,0,lamp.height-0.35);
 const head=localEnuPoint(base,1.05,0,lamp.height-0.35);
 lamp.ecef=head;
 const prefix='osaka_lamp_'+Math.round(lamp.lon*1e6)+'_'+Math.round(lamp.lat*1e6)+'_'+S.lampEntities.length;
 try{
  const pole=V.entities.add({id:prefix+'_pole',polyline:{positions:[base,top],width:2.2,arcType:C.ArcType.NONE,material:C.Color.fromCssColorString('#34383b')}});S.lampEntities.push(pole.id);
  const arm=V.entities.add({id:prefix+'_arm',polyline:{positions:[arm0,arm1,head],width:1.8,arcType:C.ArcType.NONE,material:C.Color.fromCssColorString('#30363a')}});S.lampEntities.push(arm.id);
  const hood=V.entities.add({id:prefix+'_hood',position:head,ellipsoid:{radii:new C.Cartesian3(0.30,0.15,0.085),material:C.Color.fromCssColorString('#3b4145'),outline:false}});S.lampEntities.push(hood.id);
  const poolRadius=Math.min(34,Math.max(12,Number(ui.radius.value)*0.52));
  const rings=[{r:1.00,a:0.045},{r:0.78,a:0.060},{r:0.55,a:0.075},{r:0.31,a:0.095}];
  for(let ri=0;ri<rings.length;ri++){
   const ring=rings[ri],pool=V.entities.add({id:prefix+'_pool_'+ri,position:C.Cartesian3.fromDegrees(lamp.lon,lamp.lat,lamp.ground+0.15+ri*0.002),ellipse:{semiMajorAxis:poolRadius*ring.r,semiMinorAxis:poolRadius*0.78*ring.r,height:lamp.ground+0.15+ri*0.002,material:glowColor(ring.a),outline:false,granularity:C.Math.toRadians(3)}});
   S.lampEntities.push(pool.id);S.glowEntities.push(pool.id);
  }
 }catch(e){console.warn('[OSAKA beta v5.136.1] lamp fixture entity',e);}
 if(S.pointCollection)S.pointCollection.add({position:head,pixelSize:10,color:new C.Color(1.0,0.82,0.58,0.98),outlineColor:new C.Color(0.18,0.12,0.06,0.9),outlineWidth:1,scaleByDistance:new C.NearFarScalar(80,1.0,5500,0.25),disableDepthTestDistance:0});
}
function cameraOrAircraftCenter(){return aircraftLLA()||cameraLLA();}
async function fetchOverpass(endpoint,query){
 const r=await fetch(endpoint,{method:'POST',mode:'cors',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','Accept':'application/json'},body:'data='+encodeURIComponent(query),cache:'no-store'});
 if(!r.ok)throw new Error(`Overpass HTTP ${r.status}`);return await r.json();
}
async function loadStreetLamps(gen){
 if(!ui.lamps.checked)return;
 const center=cameraOrAircraftCenter();if(!center||!inOsaka(center)){say('街灯取得待ち：大阪上空で飛行位置を取得できていません');return;}
 const radius=6500,dy=radius/111320,dx=radius/(111320*Math.max(.15,Math.cos(rad(center.lat))));
 const s=center.lat-dy,w=center.lon-dx,n=center.lat+dy,e=center.lon+dx;
 const q=`[out:json][timeout:30];(node["highway"="street_lamp"](${s},${w},${n},${e});node["man_made"="street_lamp"](${s},${w},${n},${e}););out body;`;
 let data,last;
 for(const endpoint of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']){try{data=await fetchOverpass(endpoint,q);break;}catch(err){last=err;}}
 if(gen!==S.generation||S.stopped)return;
 if(!data?.elements?.length)throw last||new Error('周辺の街灯データが見つかりません');
 const nodes=new Map();for(const el of data.elements){if(el.type!=='node'||!Number.isFinite(el.lat)||!Number.isFinite(el.lon))continue;nodes.set(el.id,el);}
 let list=[...nodes.values()].map(el=>{
  const tags=el.tags||{},h=Math.max(3,Math.min(14,parseFloat(tags.height)||parseFloat(tags['light:height'])||6.5));
  const rawColor=tags['light:colour']||tags.colour||'';let color=new C.Cartesian3(1.0,0.68,0.42);
  if(rawColor){try{const cc=C.Color.fromCssColorString(rawColor);if(cc)color=new C.Cartesian3(Math.pow(cc.red,2.2),Math.pow(cc.green,2.2),Math.pow(cc.blue,2.2));}catch(_){}}
  const watts=parseFloat(tags.wattage)||parseFloat(tags['light:wattage'])||100;
  const power=Math.max(0.55,Math.min(2.2,watts/100));
  return{id:el.id,lat:el.lat,lon:el.lon,tags,height:h,power,color};
 });
 list.sort((a,b)=>haversine(center,a)-haversine(center,b));list=list.slice(0,520);
 const cartos=list.map(l=>C.Cartographic.fromDegrees(l.lon,l.lat));
 try{if(C.sampleTerrainMostDetailed&&V.terrainProvider){const sampled=await C.sampleTerrainMostDetailed(V.terrainProvider,cartos);for(let i=0;i<list.length;i++)if(Number.isFinite(sampled[i]?.height))list[i].ground=sampled[i].height;}}catch(e){console.warn('[OSAKA beta v5.136.1] terrain sample fallback',e);}
 for(let i=0;i<list.length;i++)if(!Number.isFinite(list[i].ground)){const h=SC.globe.getHeight?.(cartos[i]);list[i].ground=Number.isFinite(h)?h:0;}
 for(const lamp of list)lamp.ecef=C.Cartesian3.fromDegrees(lamp.lon,lamp.lat,lamp.ground+lamp.height,C.Ellipsoid.WGS84);
 if(gen!==S.generation||S.stopped)return;
 clearLampVisuals();S.lampData=list;S.activeLampSet=[];S.lastLampSelectionAt=0;
 S.pointCollection=new C.PointPrimitiveCollection();SC.primitives.add(S.pointCollection);
 for(const lamp of list.slice(0,110))addLampVisual(lamp);
 S.lastLampCenter={lon:center.lon,lat:center.lat};S.lastLampFetch=Date.now();
 say(`街灯 ${list.length}基を取得。周囲の最大${LIGHTS}灯で局所照明中（表示灯具 ${Math.min(110,list.length)}基）`);requestRender();
}
function addManualLamp(cartographic){
 const lon=C.Math.toDegrees(cartographic.longitude),lat=C.Math.toDegrees(cartographic.latitude),ground=cartographic.height||0;
 const l={id:'manual-'+Date.now()+'-'+Math.random(),lon,lat,ground,height:6.5,power:1.0,color:new C.Cartesian3(1.0,0.68,0.42)};l.ecef=C.Cartesian3.fromDegrees(lon,lat,ground+l.height,C.Ellipsoid.WGS84);
 S.lampData.push(l);if(!S.pointCollection){S.pointCollection=new C.PointPrimitiveCollection();SC.primitives.add(S.pointCollection);}addLampVisual(l);say(`テスト照明を追加：${lat.toFixed(6)}, ${lon.toFixed(6)}`);requestRender();
}
function activateManualPlacement(){
 S.placing=!S.placing;$('ob5Place').textContent=S.placing?'配置モード終了':'タップで照明を追加';
 say(S.placing?'照明を置く地面をタップしてください。':'照明配置モードを終了しました');
}
function setupInput(){
 try{S.mouseHandler=new C.ScreenSpaceEventHandler(SC.canvas);S.mouseHandler.setInputAction(m=>{if(!S.placing)return;let p=null;try{if(SC.pickPositionSupported)p=SC.pickPosition(m.position);}catch(_){}if(!p){const ray=SC.camera.getPickRay(m.position);if(ray)p=SC.globe.pick(ray,SC);}if(!p)return;const c=C.Cartographic.fromCartesian(p);if(c)addManualLamp(c);},C.ScreenSpaceEventType.LEFT_CLICK);}catch(e){console.warn('[OSAKA beta v5.136.1] manual lamp picker',e);}
}
function aircraftDistanceToModel(origin){const p=aircraftLLA();return p?haversine(p,origin):0;}
async function fetchTree(){if(S.tree&&Date.now()-S.treeAt<300000)return S.tree;const r=await fetch(TREE,{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});if(!r.ok)throw new Error('OSAKA GitHub tree HTTP '+r.status);const j=await r.json();if(!Array.isArray(j.tree)||j.truncated)throw new Error('OSAKA GitHub treeが不完全です');S.tree=j.tree;S.treeAt=Date.now();return j.tree;}
function isTrackPath(p){return /^super\/(tracks?|rails?|railway)\//i.test(p)&&/\.glb(?:\.gz)?$/i.test(p);}
function getOrigin(doc){
 const roots=[doc?.asset?.extras,doc?.extras,doc?.scenes?.[0]?.extras,...(doc?.nodes||[]).slice(0,10000).map(n=>n.extras)].filter(Boolean),keys=['origin','georeference','geoReference','geographic','geolocation','geoOrigin','worldOrigin','referencePoint','placement','location','anchor','lla','originLLA','positionLLA'];
 const queue=roots.map(v=>({v,d:0})),seen=new Set();
 while(queue.length){const {v,d}=queue.shift();if(!v||typeof v!=='object'||seen.has(v)||d>6)continue;seen.add(v);
  if(!Array.isArray(v)){
   let lon=null,lat=null,alt=0;for(const k of ['lon','lng','longitude','originLon','originLongitude','origin_longitude'])if(Number.isFinite(+v[k])){lon=+v[k];break;}for(const k of ['lat','latitude','originLat','originLatitude','origin_latitude'])if(Number.isFinite(+v[k])){lat=+v[k];break;}for(const k of ['alt','altitude','elevation','originAlt','originAltitude','origin_altitude'])if(Number.isFinite(+v[k])){alt=+v[k];break;}
   if(lon!==null&&lat!==null&&Math.abs(lon)<=180&&Math.abs(lat)<=90)return{lon,lat,alt,meta:v};for(const k of keys)if(v[k]&&typeof v[k]==='object')queue.push({v:v[k],d:d+1});
  }else if(v.length>=2&&Number.isFinite(+v[0])&&Number.isFinite(+v[1])){let lon=+v[0],lat=+v[1];if(Math.abs(lon)<=90&&Math.abs(lat)>90)[lon,lat]=[lat,lon];if(Math.abs(lon)<=180&&Math.abs(lat)<=90)return{lon,lat,alt:+v[2]||0,meta:{}};}
 }
 return null;
}
function readGlbJson(buf){try{const d=new DataView(buf);if(d.getUint32(0,true)!==0x46546c67||d.getUint32(4,true)!==2)return null;let p=12;while(p+8<=d.byteLength){const n=d.getUint32(p,true),t=d.getUint32(p+4,true);p+=8;if(p+n>d.byteLength)return null;if(t===0x4e4f534a)return JSON.parse(new TextDecoder().decode(new Uint8Array(buf,p,n)).replace(/[\0 ]+$/,''));p+=n;}return null;}catch(_){return null;}}
async function decompressGzip(buf){if(buf.byteLength<2)return buf;const b=new Uint8Array(buf,0,2);if(b[0]===0x1f&&b[1]===0x8b){if(!window.DecompressionStream)throw new Error('gzip展開に対応したブラウザが必要です');return await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}return buf;}
async function fetchSidecar(path){const stem=path.replace(/\.glb(?:\.gz)?$/i,'');for(const suffix of ['.json','.meta.json','.metadata.json'])try{const r=await fetch(RAW+stem+suffix,{cache:'force-cache'});if(r.ok){const origin=getOrigin(await r.json());if(origin)return origin;}}catch(_){}return null;}
function makeModelMatrix(origin){const p=C.Cartesian3.fromDegrees(origin.lon,origin.lat,origin.alt,C.Ellipsoid.WGS84);const m=origin.meta||{};const deg=x=>Number.isFinite(+x)?+x*Math.PI/180:0;const hpr=new C.HeadingPitchRoll(deg(m.headingDeg??m.heading),deg(m.pitchDeg??m.pitch),deg(m.rollDeg??m.roll));return C.Transforms.headingPitchRollToFixedFrame(p,hpr,C.Ellipsoid.WGS84);}
async function addOwnGlb(file,kind,gen){if(S.loads.has(file.path))return;S.loads.add(file.path);let model=null,shader=null,url=null;try{
 const src=file.url||RAW+file.path.split('/').map(encodeURIComponent).join('/');const r=await fetch(src,{cache:'force-cache'});if(!r.ok)throw new Error('GLB HTTP '+r.status);const buffer=await decompressGzip(await r.arrayBuffer());if(gen!==S.generation||S.stopped)return;
 const json=readGlbJson(buffer);if(!json)throw new Error('GLB v2 header/JSON不正');let origin=getOrigin(json);if(!origin)origin=await fetchSidecar(file.path);
 if(!origin&&file.path.toLowerCase().endsWith(EXPRESSWAY.path.toLowerCase()))origin={lon:EXPRESSWAY.lon,lat:EXPRESSWAY.lat,alt:EXPRESSWAY.alt,meta:{}};
 if(!origin){S.failed.push(file.path+'：原点extras/sidecarがないため配置を保留');return;}
 if(!inOsaka(origin)){S.failed.push(file.path+'：大阪範囲外のためskip');return;}
 if(aircraftDistanceToModel(origin)>50000){S.failed.push(file.path+'：航空機から50km超のためskip');return;}
 url=URL.createObjectURL(new Blob([buffer],{type:'model/gltf-binary'}));S.blobUrls.push(url);shader=createSurfaceShader({kind});S.shaders.push(shader);
 const m=json.asset?.extras||{};const opts={url,modelMatrix:makeModelMatrix(origin),customShader:shader,allowPicking:true,incrementallyLoadTextures:true,asynchronous:true,shadows:C.ShadowMode.ENABLED,enableVerticalExaggeration:false};
 if(m.upAxis==='Z')opts.upAxis=C.Axis.Z;else if(m.upAxis==='X')opts.upAxis=C.Axis.X;
 model=await C.Model.fromGltfAsync(opts);if(gen!==S.generation||S.stopped){try{model.destroy();}catch(_){}return;}SC.primitives.add(model);S.models.push({obj:model,kind,path:file.path});
 if(model.imageBasedLighting?.imageBasedLightingFactor)model.imageBasedLighting.imageBasedLightingFactor=new C.Cartesian2(0.9,0.65);
 model.shadows=C.ShadowMode.ENABLED;S.loaded[kind]++;say(`${kind==='roads'?'高速道路':'線路'} Procedural PBRモデル読込：${file.path}`);requestRender();
 }catch(e){if(shader&&!S.shaders.includes(shader)){try{shader.destroy();}catch(_){}}S.failed.push(file.path+'：'+(e.message||e));console.warn('[OSAKA beta v5.136.1] GLB',file.path,e);}
}
async function loadOwnModels(gen){
 if(ui.roads.checked)await addOwnGlb(EXPRESSWAY,'roads',gen);
 if(ui.rails.checked){const tree=await fetchTree();const tracks=tree.filter(x=>x.type==='blob'&&isTrackPath(x.path));if(!tracks.length)S.failed.push('super/tracks等の下にGLBがありません');for(const f of tracks){if(gen!==S.generation||S.stopped)return;await addOwnGlb({path:f.path},'rails',gen);}}
}
async function loadBuildings(gen){
 if(!ui.buildings.checked)return;
 if(gen!==S.generation||S.stopped)return;
 const shader=createSurfaceShader({facade:true,kind:'building'});S.shaders.push(shader);
 let last;
 for(const lod of [ui.lod.value]){
  let tileset=null;try{
   tileset=await C.Cesium3DTileset.fromUrl(plateauUrl(lod),{customShader:shader,maximumScreenSpaceError:12,cacheBytes:256*1024*1024,maximumCacheOverflowBytes:64*1024*1024,dynamicScreenSpaceError:true,cullRequestsWhileMoving:true,preloadWhenHidden:false,preloadFlightDestinations:false,shadows:C.ShadowMode.ENABLED});
   if(gen!==S.generation||S.stopped){try{tileset.destroy();}catch(_){}return;}
   const onTileFailed=(e)=>{const msg=e?.message||e?.url||'tile error';if(S.failed.length<80)S.failed.push('PLATEAU tile: '+String(msg).slice(0,180));};
   const onTileLoad=()=>{S.tileLoadCount=(S.tileLoadCount||0)+1;};
   try{tileset.tileFailed.addEventListener(onTileFailed);S.tileListeners.push(()=>tileset.tileFailed.removeEventListener(onTileFailed));}catch(_){}
   try{tileset.tileLoad.addEventListener(onTileLoad);S.tileListeners.push(()=>tileset.tileLoad.removeEventListener(onTileLoad));}catch(_){}
   SC.primitives.add(tileset);S.tiles.push({obj:tileset,kind:'buildings'});tileset.shadows=C.ShadowMode.ENABLED;S.loaded.buildings++;say(`PLATEAU大阪府 建物 ${lod} 読み込み完了。タイル読込イベント監視中`);requestRender();return;
  }catch(e){last=e;if(tileset){try{SC.primitives.remove(tileset);}catch(_){}}console.warn('[OSAKA beta v5.136.1] PLATEAU',lod,e);}
 }
 throw last||new Error('PLATEAU tilesetを読み込めません');
}
async function start(){
 if(S.active){say('読み込み中です');return;}if(S.tiles.length||S.models.length||S.shaders.length){say('既にモデルがあります。「停止・削除」してから再読み込みしてください');return;}S.active=true;S.stopped=false;S.generation++;const gen=S.generation;S.failed=[];S.loads.clear();S.loaded={buildings:0,roads:0,rails:0};say('照明点・手続き生成PBR・PLATEAUを準備中…');
 saveSceneSettings();
 if(!S.preUpdate){S.preUpdate=()=>{updateShaderLights();if(ui.lamps.checked){const c=cameraOrAircraftCenter();if(c&&S.lastLampCenter&&haversine(c,S.lastLampCenter)>2200&&Date.now()-S.lastLampFetch>45000&&!S.fetchingLamps){S.fetchingLamps=true;loadStreetLamps(S.generation).catch(e=>console.warn(e)).finally(()=>S.fetchingLamps=false);}}};SC.preUpdate.addEventListener(S.preUpdate);}
 try{setupInput();if(ui.lamps.checked){S.fetchingLamps=true;try{await loadStreetLamps(gen);}catch(e){S.failed.push('街灯：'+(e.message||e));say('街灯取得失敗。手動の照明配置も使用できます');}finally{S.fetchingLamps=false;}}
  const tasks=[];if(ui.buildings.checked)tasks.push(loadBuildings(gen).catch(e=>{S.failed.push('PLATEAU建物：'+(e.message||e));}));if(ui.roads.checked||ui.rails.checked)tasks.push(loadOwnModels(gen).catch(e=>{S.failed.push('OSAKAモデル：'+(e.message||e));}));await Promise.all(tasks);
 }catch(e){S.failed.push(e.message||String(e));}if(gen!==S.generation||S.stopped)return;S.active=false;
 say(`完了：PLATEAU建物 ${S.loaded.buildings} / 高速道路 ${S.loaded.roads} / 線路 ${S.loaded.rails} / 街灯 ${S.lampData.length}。失敗・除外 ${S.failed.length}件`);if(S.failed.length)console.warn('[OSAKA beta v5.136.1] 詳細',S.failed);requestRender();
}
function stop(){
 S.stopped=true;S.active=false;S.generation++;S.placing=false;$('ob5Place').textContent='タップで照明を追加';for(const off of S.tileListeners){try{off();}catch(_){}}S.tileListeners=[];
 for(const x of S.tiles){try{SC.primitives.remove(x.obj);}catch(_){}}for(const x of S.models){try{SC.primitives.remove(x.obj);}catch(_){}}S.tiles=[];S.models=[];
 if(S.preUpdate){try{SC.preUpdate.removeEventListener(S.preUpdate);}catch(_){}S.preUpdate=null;}
 if(S.mouseHandler){try{S.mouseHandler.destroy();}catch(_){}S.mouseHandler=null;}
 clearLampVisuals();S.lampData=[];
 for(const sh of S.shaders){try{if(!sh.isDestroyed?.())sh.destroy();}catch(_){}}S.shaders=[];
 for(const entry of S.postStages){try{SC.postProcessStages.remove(entry.stage);}catch(_){}}S.postStages=[];ui.bloom.checked=false;ui.ao.checked=false;
 for(const u of S.blobUrls){try{URL.revokeObjectURL(u);}catch(_){}}S.blobUrls=[];S.loads.clear();S.lastLampCenter=null;S.lastLampFetch=0;S.activeLampSet=[];S.lastLampSelectionCenter=null;S.lastLampSelectionAt=0;restoreSceneSettings();say('追加したPLATEAU・OSAKAモデル・照明を削除しました');requestRender();
}
$('ob5Start').onclick=start;$('ob5Stop').onclick=stop;$('ob5Place').onclick=activateManualPlacement;
ui.lamps.addEventListener('change',()=>{if(!ui.lamps.checked){S.lampData=[];S.activeLampSet=[];S.lastLampSelectionAt=0;clearLampVisuals();}else if(S.active){loadStreetLamps(S.generation).catch(e=>say('街灯取得失敗：'+e.message));}requestRender();});
ui.mode.addEventListener('change',requestRender);ui.bloom.addEventListener('change',syncPostStages);ui.ao.addEventListener('change',syncPostStages);
ui.buildings.addEventListener('change',()=>S.tiles.filter(x=>x.kind==='buildings').forEach(x=>x.obj.show=ui.buildings.checked));
ui.roads.addEventListener('change',()=>S.models.filter(x=>x.kind==='roads').forEach(x=>x.obj.show=ui.roads.checked));
ui.rails.addEventListener('change',()=>S.models.filter(x=>x.kind==='rails').forEach(x=>x.obj.show=ui.rails.checked));
S.stop=stop;S.start=start;S.state=S;window[KEY]=S;
say(`準備完了。CesiumJS ${C.VERSION} / fromUrl・fromGltfAsync・Samplerなし手続きPBR CustomShader確認済み。Bloom/SSAOは任意。建物PLATEAU / 道路・線路OSAKA`);
})();
