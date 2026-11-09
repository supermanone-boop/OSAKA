"use strict";
(async()=>{
const C=window.Cesium,g=window.geofs,v=g?.api?.viewer;
if(!C||!v){alert("GeoFSのCesium viewerが見つかりません");return;}
if(typeof DecompressionStream==="undefined"){
 alert("Chromeを最新版にしてください");return;
}
window.__hankyuNetworkModel?.destroy?.();
const URL_GZ="https://huggingface.co/supermanone-boop/hankyu/resolve/main/Hankyu_All_Lines_GeoFS_v5.glb.gz";
const LON=135.4720872499998,LAT=34.844529300001334,HEIGHT=0;
let blobURL=null,model=null,dead=false;
const state={model:null,blobURL:null,destroy(){
 if(dead)return;
 dead=true;
 try{if(model)v.scene.primitives.remove(model);}catch(e){}
 try{if(model&&!model.isDestroyed?.())model.destroy();}catch(e){}
 try{if(blobURL)URL.revokeObjectURL(blobURL);}catch(e){}
 if(window.__hankyuNetworkModel===state)delete window.__hankyuNetworkModel;
}};
window.__hankyuNetworkModel=state;
try{
 console.log("Hankyu v5 downloading...");
 const r=await fetch(URL_GZ,{cache:"no-store"});
 if(!r.ok)throw new Error("HTTP "+r.status);
 if(!r.body)throw new Error("ReadableStream unavailable");
 console.log("Hankyu v5 decompressing...");
 const stream=r.body.pipeThrough(new DecompressionStream("gzip"));
 const blob=await new Response(stream).blob();
 if(blob.size<20||await blob.slice(0,4).text()!=="glTF")throw new Error("Invalid GLB");
 blobURL=URL.createObjectURL(new Blob([blob],{type:"model/gltf-binary"}));
 state.blobURL=blobURL;
 const matrix=C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(LON,LAT,HEIGHT));
 model=C.Model.fromGltf({url:blobURL,modelMatrix:matrix,scale:1,asynchronous:true,allowPicking:false,shadows:C.ShadowMode.ENABLED});
 state.model=model;
 v.scene.primitives.add(model);
 console.log("Hankyu v5 loading in Cesium...");
 Promise.resolve(model.readyPromise).then(()=>{
  if(!dead)console.log("Hankyu v5 ready",{anchor:[LON,LAT,HEIGHT],scale:1,expandedBytes:blob.size,concreteParapets:true});
 }).catch(e=>{
  console.error("Hankyu v5 Cesium error",e);
  if(!dead)state.destroy();
 });
}catch(e){
 console.error("Hankyu v5 gzip loader error",e);
 state.destroy();
 alert("読み込みに失敗しました。コンソールを確認してください。");
}
})();
