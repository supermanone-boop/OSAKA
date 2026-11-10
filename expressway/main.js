"use strict";
(async()=>{
  const C=window.Cesium;
  const g=window.geofs;
  const viewer=g?.api?.viewer;
  const scene=viewer?.scene;

  if(!C||!viewer||!scene){
    alert("GeoFSのCesium viewerが見つかりません");
    return;
  }
  if(typeof DecompressionStream==="undefined"){
    alert("gzip展開に対応した最新版Chromeが必要です");
    return;
  }

  const MODEL_GZ="https://huggingface.co/supermanone-boop/hankyu/resolve/main/Osaka_Expressways_Realistic_v7.glb.gz";

  const ANCHOR_LON=135.51052305;
  const ANCHOR_LAT=34.74052680;

  const previous=window.__osakaExpresswaysModel;
  const token={};
  window.__osakaExpresswaysLoadToken=token;

  let model=null;
  let blobURL=null;
  let added=false;
  let dead=false;

  const state={
    model:null,
    blobURL:null,

    destroy(){
      if(dead)return;
      dead=true;

      try{
        if(model&&!model.isDestroyed?.()){
          const removed=added?scene.primitives.remove(model):false;
          if(!removed&&!model.isDestroyed?.())model.destroy?.();
        }
      }catch(e){
        console.warn("Model cleanup:",e);
      }

      try{
        if(blobURL)URL.revokeObjectURL(blobURL);
      }catch(e){}

      if(window.__osakaExpresswaysModel===state)
        delete window.__osakaExpresswaysModel;

      if(window.__osakaExpresswaysObjectURL===blobURL)
        delete window.__osakaExpresswaysObjectURL;
    }
  };

  function ensureLatest(){
    if(window.__osakaExpresswaysLoadToken!==token){
      const e=new Error("A newer load has replaced this one");
      e.superseded=true;
      throw e;
    }
  }

  try{
    console.log("Osaka Expressways v5: downloading compressed GLB...");

    const response=await fetch(MODEL_GZ,{
      cache:"no-store"
    });

    ensureLatest();

    if(!response.ok)
      throw new Error("HTTP "+response.status);

    if(!response.body)
      throw new Error("ReadableStream unavailable");

    console.log("Osaka Expressways v5: decompressing...");

    const expanded=await new Response(
      response.body.pipeThrough(
        new DecompressionStream("gzip")
      )
    ).blob();

    ensureLatest();

    if(
      expanded.size<20||
      await expanded.slice(0,4).text()!=="glTF"
    ){
      throw new Error("Invalid GLB data");
    }

    console.log(
      "Expanded GLB:",
      (expanded.size/1048576).toFixed(1),
      "MiB"
    );

    blobURL=URL.createObjectURL(
      new Blob([expanded],{
        type:"model/gltf-binary"
      })
    );

    state.blobURL=blobURL;

    // GLB内部にENU→ECEF変換を格納済み
    // ここでは原点の平行移動だけを適用
    const anchor=C.Cartesian3.fromDegrees(
      ANCHOR_LON,
      ANCHOR_LAT,
      0,
      C.Ellipsoid.WGS84
    );

    const modelMatrix=C.Matrix4.fromTranslation(anchor);

    // Z-up / X-forward
    model=C.Model.fromGltf({
      url:blobURL,
      modelMatrix,
      scale:1,
      asynchronous:true,
      allowPicking:false,
      upAxis:C.Axis.Z,
      forwardAxis:C.Axis.X,
      releaseGltfJson:true,
      shadows:C.ShadowMode.ENABLED
    });

    state.model=model;

    scene.primitives.add(model);
    added=true;

    console.log(
      "Osaka Expressways v5: Cesium is building the model..."
    );

    await model.readyPromise;

    ensureLatest();

    // 新モデルの読み込み成功後に旧モデルを削除
    if(previous&&previous!==state){
      try{
        if(typeof previous.destroy==="function"){
          previous.destroy();
        }else{
          const oldModel=previous.model||previous;

          if(oldModel&&!oldModel.isDestroyed?.()){
            const removed=scene.primitives.remove(oldModel);

            if(!removed&&!oldModel.isDestroyed?.())
              oldModel.destroy?.();
          }

          if(previous.blobURL)
            URL.revokeObjectURL(previous.blobURL);
        }
      }catch(e){
        console.warn("Previous model cleanup:",e);
      }
    }

    const oldURL=window.__osakaExpresswaysObjectURL;

    if(oldURL&&oldURL!==blobURL){
      try{
        URL.revokeObjectURL(oldURL);
      }catch(e){}
    }

    window.__osakaExpresswaysModel=state;
    window.__osakaExpresswaysObjectURL=blobURL;

    scene.requestRender?.();

    console.log("Osaka Expressways v5 READY",{
      uniqueWays:4117,
      centerlineKm:1641.82,
      geoTiles:712,
      meshGroups:2639,
      supports:25449,
      anchor:[ANCHOR_LON,ANCHOR_LAT],
      coordinateSystem:"WGS84 / UTM53N → local ENU → ECEF",
      glbBytes:170011640
    });

  }catch(e){
    state.destroy();

    if(e?.superseded){
      console.log("Older Osaka Expressways load cancelled");
      return;
    }

    console.error(
      "Osaka Expressways v5 loader error:",
      e
    );

    if(window.__osakaExpresswaysLoadToken===token){
      alert(
        "読み込みに失敗しました。コンソールを確認してください。"
      );
    }
  }
})();
