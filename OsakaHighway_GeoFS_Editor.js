/*
 * Osaka Highway GeoFS Editor + OSM rebuild prototype
 * Run on the GeoFS page from the browser console.
 * Cesium 1.96 compatible target. Uses OpenStreetMap / Overpass for the rebuild prototype.
 * Generated elevations for bridges are estimates and must be checked in GeoFS.
 */
"use strict";
(async()=>{
  const C=window.Cesium, g=window.geofs;
  if(!C||!g?.api?.viewer){alert("GeoFSが読み込まれていません。GeoFSの画面で実行してください。");return;}
  window.__osakaHighwayEditor?.destroy?.();
  const viewer=g.api.viewer, scene=viewer.scene;
  const ORIGIN={lon:135.50,lat:34.70,height:0};
  const state={bytes:null,parsed:null,fileName:"Osaka_Highway.glb",model:null,blobUrl:null,nodeIndex:-1,original:null,anchor:{...ORIGIN},destroyed:false,busy:false};
  const $=(id)=>document.getElementById("ohw-"+id);
  const panel=document.createElement("div");
  panel.id="ohw-panel";
  panel.innerHTML=`
  <style>
  #ohw-panel{position:fixed;z-index:2147483646;right:10px;top:10px;width:min(430px,calc(100vw - 20px));max-height:calc(100vh - 20px);overflow:auto;background:rgba(17,22,29,.97);color:#eef3f8;border:1px solid #526170;border-radius:12px;box-shadow:0 8px 30px #0009;font:13px/1.45 system-ui,sans-serif;padding:12px;box-sizing:border-box}
  #ohw-panel *{box-sizing:border-box}#ohw-panel h3{font-size:16px;margin:0 0 8px}#ohw-panel h4{font-size:13px;margin:12px 0 6px;color:#a9d2ff}
  #ohw-panel button,#ohw-panel input,#ohw-panel select{font:inherit;border-radius:6px;border:1px solid #64748b;padding:7px;background:#202a36;color:#f8fafc;min-width:0}
  #ohw-panel button{cursor:pointer;background:#29435c}#ohw-panel button:disabled{opacity:.45;cursor:default}
  #ohw-panel input[type=number]{width:100%}#ohw-panel .row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:6px 0}
  #ohw-panel .three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
  #ohw-panel label{display:block;color:#b9c5d2;font-size:11px;margin-bottom:3px}#ohw-panel .muted{color:#aab6c2;font-size:11px}
  #ohw-panel .status{padding:7px;background:#111923;border-radius:6px;margin:8px 0;white-space:pre-wrap;word-break:break-word;min-height:30px}
  #ohw-panel .line{height:1px;background:#3b4652;margin:10px 0}#ohw-panel .actions{display:flex;gap:6px;flex-wrap:wrap}#ohw-panel .actions button{flex:1}
  #ohw-panel .warn{color:#ffd18a}#ohw-panel .good{color:#9ce6b0}#ohw-panel .small{font-size:10px}
  </style>
  <div style="display:flex;align-items:center;gap:8px"><h3 style="flex:1">大阪高速道路 GeoFS エディター</h3><button id="ohw-close" title="閉じる">×</button></div>
  <div class="muted">GLBのノード単位で位置・回転・倍率を調整し、編集後のGLBを書き出します。</div>
  <h4>1. モデルを読み込む</h4>
  <div class="row"><input id="ohw-file" type="file" accept=".glb,model/gltf-binary"/><button id="ohw-loadfile">ファイル読込</button></div>
  <div class="row"><input id="ohw-url" placeholder="GLBのCORS対応URL"/><button id="ohw-loadurl">URL読込</button></div>
  <div class="muted">ローカルGLBまたはHugging Face等の直接URL。URL読込にはCORS許可が必要です。</div>
  <div class="line"></div>
  <h4>2. 表示位置（GeoFS上の配置アンカー）</h4>
  <div class="three">
    <div><label>経度</label><input id="ohw-lon" type="number" step="0.000001" value="135.5"></div>
    <div><label>緯度</label><input id="ohw-lat" type="number" step="0.000001" value="34.7"></div>
    <div><label>標高 m</label><input id="ohw-alt" type="number" step="0.1" value="0"></div>
  </div>
  <div class="row"><button id="ohw-anchor">アンカーを適用</button><select id="ohw-upaxis"><option value="Z">GLBはZ-up</option><option value="Y">GLBはY-up</option></select></div>
  <div class="line"></div>
  <h4>3. 編集するノード</h4>
  <input id="ohw-filter" placeholder="ノード名・way IDで絞り込み" style="width:100%;margin-bottom:6px"/>
  <select id="ohw-node" style="width:100%"><option value="">先にGLBを読み込んでください</option></select>
  <div class="muted" id="ohw-nodeinfo">ノードを選択すると変換値を編集できます。</div>
  <h4>位置（GLBローカル座標 m）</h4>
  <div class="three">
    <div><label>X</label><input id="ohw-tx" type="number" step="0.1" value="0"></div><div><label>Y</label><input id="ohw-ty" type="number" step="0.1" value="0"></div><div><label>Z</label><input id="ohw-tz" type="number" step="0.1" value="0"></div>
  </div>
  <h4>回転（度）</h4>
  <div class="three">
    <div><label>X</label><input id="ohw-rx" type="number" step="1" value="0"></div><div><label>Y</label><input id="ohw-ry" type="number" step="1" value="0"></div><div><label>Z</label><input id="ohw-rz" type="number" step="1" value="0"></div>
  </div>
  <h4>倍率</h4>
  <div class="three">
    <div><label>X</label><input id="ohw-sx" type="number" step="0.01" value="1"></div><div><label>Y</label><input id="ohw-sy" type="number" step="0.01" value="1"></div><div><label>Z</label><input id="ohw-sz" type="number" step="0.01" value="1"></div>
  </div>
  <div class="actions"><button id="ohw-apply">このノードに適用</button><button id="ohw-reset">選択ノードを元に戻す</button></div>
  <div class="line"></div>
  <h4>4. 大阪府の道路データから試作モデルを生成</h4>
  <div class="muted">OverpassのOSM実データを取得し、道路面・車線区画線・橋梁欄干・簡易照明・橋脚を作成します。橋面高は地形とOSMのbridge/layerタグからの推定で、測量値ではありません。</div>
  <div class="row"><button id="ohw-build">大阪府の道路を取得して生成</button><button id="ohw-export">編集GLBを書き出す</button></div>
  <div class="actions"><button id="ohw-manifest">編集値JSON</button><button id="ohw-destroy">モデルを非表示</button></div>
  <div class="status" id="ohw-status">待機中。GLBを読み込むか、道路モデルを生成してください。</div>
  <div class="muted">道路形状データ：© OpenStreetMap contributors（ODbL）。</div>
  <div class="muted warn">注意：現在の生成版は道路ネットワークの初版です。N06公式データとの照合、JCTの階層別標高、現地写真による標識・構造物確認は未完了です。</div>
  `;
  document.body.appendChild(panel);
  const status=(s)=>{const el=$("status");if(el)el.textContent=s;};
  const setBusy=(v)=>{state.busy=v;["loadfile","loadurl","build","export","apply"].forEach(id=>{const e=$(id);if(e)e.disabled=v;});};
  const readNumber=(id)=>{const n=Number($(id).value);if(!Number.isFinite(n))throw new Error("数値が正しくありません: "+id);return n;};
  const bytesFromGLB=(buf)=>{
    const dv=new DataView(buf);if(buf.byteLength<20||dv.getUint32(0,true)!==0x46546c67)throw new Error("GLB形式ではありません");
    if(dv.getUint32(4,true)!==2)throw new Error("GLB version 2 のみ対応です");
    let p=12,json=null,chunks=[];
    while(p+8<=buf.byteLength){const len=dv.getUint32(p,true),type=dv.getUint32(p+4,true);p+=8;if(p+len>buf.byteLength)throw new Error("GLBチャンク長が不正です");const data=buf.slice(p,p+len);p+=len;if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(data).replace(/[\s\u0000]+$/,""));else chunks.push({type,data});}
    if(!json)throw new Error("GLB JSONチャンクがありません");return {json,chunks};
  };
  const packGLB=(parsed)=>{
    const enc=new TextEncoder();let j=enc.encode(JSON.stringify(parsed.json));const jp=(4-j.length%4)%4;const jsonBytes=new Uint8Array(j.length+jp);jsonBytes.fill(0x20);jsonBytes.set(j);
    const chunks=[{type:0x4e4f534a,data:jsonBytes},...parsed.chunks];let total=12;for(const c of chunks)total+=8+c.data.byteLength;
    const out=new ArrayBuffer(total),dv=new DataView(out);dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,total,true);let p=12;
    for(const c of chunks){dv.setUint32(p,c.data.byteLength,true);dv.setUint32(p+4,c.type,true);p+=8;new Uint8Array(out,p,c.data.byteLength).set(new Uint8Array(c.data));p+=c.data.byteLength;}return out;
  };
  const quatToEuler=(q)=>{const [x,y,z,w]=q;const sinr=2*(w*x+y*z),cosr=1-2*(x*x+y*y);const rx=Math.atan2(sinr,cosr);const sinp=2*(w*y-z*x);const ry=Math.abs(sinp)>=1?Math.sign(sinp)*Math.PI/2:Math.asin(sinp);const siny=2*(w*z+x*y),cosy=1-2*(y*y+z*z);const rz=Math.atan2(siny,cosy);return [rx*180/Math.PI,ry*180/Math.PI,rz*180/Math.PI];};
  const eulerToQuat=(a,b,c)=>{a*=Math.PI/360;b*=Math.PI/360;c*=Math.PI/360;const c1=Math.cos(a),s1=Math.sin(a),c2=Math.cos(b),s2=Math.sin(b),c3=Math.cos(c),s3=Math.sin(c);return [s1*c2*c3-c1*s2*s3,c1*s2*c3+s1*c2*s3,c1*c2*s3-s1*s2*c3,c1*c2*c3+s1*s2*s3];};
  const decomposeMatrix=(m)=>{const sx=Math.hypot(m[0],m[1],m[2])||1,sy=Math.hypot(m[4],m[5],m[6])||1,sz=Math.hypot(m[8],m[9],m[10])||1;let a=m[0]/sx,b=m[1]/sx,c=m[2]/sx,d=m[4]/sy,e=m[5]/sy,f=m[6]/sy,h=m[8]/sz,i=m[9]/sz,j=m[10]/sz;const trace=a+e+j;let q;
    if(trace>0){const s=Math.sqrt(trace+1)*2;q=[(f-i)/s,(h-c)/s,(b-d)/s,.25*s];}
    else if(a>e&&a>j){const s=Math.sqrt(1+a-e-j)*2;q=[.25*s,(d+b)/s,(h+c)/s,(f-i)/s];}
    else if(e>j){const s=Math.sqrt(1+e-a-j)*2;q=[(d+b)/s,.25*s,(i+f)/s,(h-c)/s];}
    else{const s=Math.sqrt(1+j-a-e)*2;q=[(h+c)/s,(i+f)/s,.25*s,(b-d)/s];}
    return {t:[m[12],m[13],m[14]],r:q,s:[sx,sy,sz]};};
  const nodeTRS=(node)=>{let t=node.translation||[0,0,0],r=node.rotation||[0,0,0,1],s=node.scale||[1,1,1];if(node.matrix){const d=decomposeMatrix(node.matrix);t=d.t;r=d.r;s=d.s;}return {t:[...t],r:[...r],s:[...s]};};
  const refreshNodes=()=>{const sel=$("node");sel.innerHTML="";const nodes=state.parsed?.json.nodes||[];if(!nodes.length){sel.add(new Option("ノードなし",""));return;}const q=($("filter")?.value||"").trim().toLowerCase();let count=0;nodes.forEach((n,i)=>{const title=(n.name||("Node "+i))+"  ["+i+"]";if(!q||title.toLowerCase().includes(q)){sel.add(new Option(title,String(i)));count++;}});if(!count)sel.add(new Option("一致するノードなし",""));};
  const fillNode=(idx)=>{const nodes=state.parsed.json.nodes,n=nodes[idx];if(!n)return;state.nodeIndex=idx;state.original=JSON.parse(JSON.stringify(nodeTRS(n)));const tr=nodeTRS(n),e=quatToEuler(tr.r);["tx","ty","tz"].forEach((k,i)=>$(k).value=tr.t[i]);["rx","ry","rz"].forEach((k,i)=>$(k).value=e[i]);["sx","sy","sz"].forEach((k,i)=>$(k).value=tr.s[i]);$("nodeinfo").textContent=`index ${idx} / ${n.mesh===undefined?"meshなし":"mesh="+n.mesh} / children=${(n.children||[]).length}`;};
  const blobURL=()=>{if(state.blobUrl)URL.revokeObjectURL(state.blobUrl);const blob=new Blob([packGLB(state.parsed)],{type:"model/gltf-binary"});state.blobUrl=URL.createObjectURL(blob);return state.blobUrl;};
  const anchorMatrix=()=>{const lon=readNumber("lon"),lat=readNumber("lat"),alt=readNumber("alt");state.anchor={lon,lat,height:alt};const p=C.Cartesian3.fromDegrees(lon,lat,alt);return C.Transforms.eastNorthUpToFixedFrame(p);};
  const removePreview=()=>{if(state.model){try{scene.primitives.remove(state.model);}catch(e){}state.model=null;}};
  const preview=async()=>{if(!state.parsed)return;removePreview();const url=blobURL();const axis=$("upaxis").value==="Z"?C.Axis.Z:C.Axis.Y;const model=await C.Model.fromGltf({url,modelMatrix:anchorMatrix(),scale:1,minimumPixelSize:0,upAxis:axis,forwardAxis:C.Axis.X,asynchronous:true});state.model=scene.primitives.add(model);await (model.readyPromise||Promise.resolve());scene.requestRender();status("GLBをGeoFS上に表示しました。ノードを選択して調整できます。");};
  const applyNode=async()=>{if(state.nodeIndex<0)throw new Error("編集するノードを選択してください");const n=state.parsed.json.nodes[state.nodeIndex];const t=[readNumber("tx"),readNumber("ty"),readNumber("tz")],r=eulerToQuat(readNumber("rx"),readNumber("ry"),readNumber("rz")),s=[readNumber("sx"),readNumber("sy"),readNumber("sz")];if(s.some(x=>x<=0))throw new Error("倍率は0より大きくしてください");delete n.matrix;n.translation=t;n.rotation=r;n.scale=s;await preview();};
  const loadBytes=async(buf,name)=>{const parsed=bytesFromGLB(buf);state.bytes=buf;state.parsed=parsed;state.fileName=(name||"Osaka_Highway.glb").replace(/\.glb$/i,"")+"_edited.glb";refreshNodes();if(parsed.json.nodes?.length){$("node").value="0";fillNode(0);}await preview();};
  const download=(blob,name)=>{const a=document.createElement("a");const u=URL.createObjectURL(blob);a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),5000);};
  $("close").onclick=()=>{state.destroy?.();};
  $("loadfile").onclick=async()=>{try{const f=$("file").files?.[0];if(!f)throw new Error("GLBファイルを選択してください");setBusy(true);status("GLBを読み込み中…");await loadBytes(await f.arrayBuffer(),f.name);}catch(e){status("エラー: "+e.message);}finally{setBusy(false);}};
  $("loadurl").onclick=async()=>{try{const u=$("url").value.trim();if(!u)throw new Error("URLを入力してください");setBusy(true);status("URLからGLBを取得中…");const r=await fetch(u);if(!r.ok)throw new Error("HTTP "+r.status);await loadBytes(await r.arrayBuffer(),u.split("/").pop().split("?")[0]||"remote.glb");}catch(e){status("読込失敗: "+e.message+"（CORS非対応URLの可能性があります）");}finally{setBusy(false);}};
  $("node").onchange=()=>{const i=Number($("node").value);if(Number.isInteger(i))fillNode(i);};
  $("filter").oninput=()=>refreshNodes();
  $("anchor").onclick=async()=>{try{if(state.parsed)await preview();else anchorMatrix();}catch(e){status("エラー: "+e.message);}};
  $("apply").onclick=async()=>{try{setBusy(true);status("ノード変換を適用しています…");await applyNode();}catch(e){status("エラー: "+e.message);}finally{setBusy(false);}};
  $("reset").onclick=async()=>{try{if(state.nodeIndex<0||!state.original)return;const n=state.parsed.json.nodes[state.nodeIndex];delete n.matrix;n.translation=state.original.t;n.rotation=state.original.r;n.scale=state.original.s;fillNode(state.nodeIndex);await preview();}catch(e){status("エラー: "+e.message);}};
  $("export").onclick=()=>{if(!state.parsed){status("先にGLBを読み込んでください。");return;}const ab=packGLB(state.parsed);download(new Blob([ab],{type:"model/gltf-binary"}),state.fileName);status("編集後GLBを書き出しました: "+state.fileName);};
  $("manifest").onclick=()=>{if(!state.parsed)return;const out={file:state.fileName,anchor:state.anchor,nodes:state.parsed.json.nodes.map((n,i)=>({index:i,name:n.name||"Node "+i,mesh:n.mesh,translation:n.translation||null,rotation:n.rotation||null,scale:n.scale||null,extras:n.extras||null}))};download(new Blob([JSON.stringify(out,null,2)],{type:"application/json"}),"Osaka_Highway_EditManifest.json");};
  $("destroy").onclick=()=>{removePreview();status("プレビューを非表示にしました。読み込んだGLBデータは保持しています。");};
  const setBox=(arr,x,y,z)=>{const faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];for(const f of faces){const p=f.map(i=>arr[i]);addQuad(p[0],p[1],p[2],p[3]);}};
  const makeGeo=(cx,cy)=>({pos:[],nor:[],idx:[]});
  let activeGeo=null;
  const addTri=(a,b,c)=>{const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];let nx=ab[1]*ac[2]-ab[2]*ac[1],ny=ab[2]*ac[0]-ab[0]*ac[2],nz=ab[0]*ac[1]-ab[1]*ac[0];const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;for(const p of [a,b,c]){activeGeo.pos.push(p[0],p[1],p[2]);activeGeo.nor.push(nx,ny,nz);activeGeo.idx.push(activeGeo.idx.length);}};
  const addQuad=(a,b,c,d)=>{addTri(a,b,c);addTri(a,c,d);};
  const box=(cx,cy,cz,sx,sy,sz)=>{const x=cx,y=cy,z=cz,X=x+sx,Y=y+sy,Z=z+sz;const v=[[x,y,z],[X,y,z],[X,Y,z],[x,Y,z],[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]];setBox(v);};
  const parseWidth=(s)=>{if(!s)return null;const v=parseFloat(String(s).replace(",","."));return Number.isFinite(v)&&v>2&&v<100?v:null;};
  const parseLanes=(t)=>{let v=parseInt(t.lanes,10);if(!Number.isFinite(v)){const f=parseInt(t["lanes:forward"],10)||0,b=parseInt(t["lanes:backward"],10)||0;v=f+b||((t.highway||"").includes("_link")?1:4);}return Math.max(1,Math.min(12,v));};
  const matDefs=[
    {name:"Asphalt",pbrMetallicRoughness:{baseColorFactor:[0.105,0.115,0.12,1],metallicFactor:0,roughnessFactor:.96}},
    {name:"White road markings",pbrMetallicRoughness:{baseColorFactor:[.9,.91,.88,1],metallicFactor:0,roughnessFactor:.75}},
    {name:"Yellow road markings",pbrMetallicRoughness:{baseColorFactor:[.95,.68,.08,1],metallicFactor:0,roughnessFactor:.75}},
    {name:"Concrete",doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.48,.49,.47,1],metallicFactor:0,roughnessFactor:.9}},
    {name:"Metal",pbrMetallicRoughness:{baseColorFactor:[.32,.35,.38,1],metallicFactor:.7,roughnessFactor:.45}}
  ];
  const createGLB=(nodes,meshes,bufferViews,accessors,bin,mats)=>{
    const json={asset:{version:"2.0",generator:"Osaka Highway GeoFS Editor"},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes,meshes,materials:mats,buffers:[{byteLength:bin.length}],bufferViews,accessors};
    const parsed={json,chunks:[{type:0x004e4942,data:bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)}]};return packGLB(parsed);
  };
  const buildFromOverpass=async()=>{
    if(state.busy)return;setBusy(true);removePreview();
    try{
      status("Overpassから大阪府の高速道路データを取得中…（混雑時は数分かかります）");
      const q=`[out:json][timeout:900];\narea["boundary"="administrative"]["admin_level"="4"]["name"="大阪府"]->.osaka;\n(\n way(area.osaka)["highway"~"^(motorway|motorway_link)$"];\n way(area.osaka)["highway"~"^(trunk|trunk_link)$"]["toll"="yes"];\n way(area.osaka)["highway"~"^(trunk|trunk_link)$"]["motorroad"="yes"];\n way(area.osaka)["highway"~"^(trunk|trunk_link)$"]["expressway"="yes"];\n);\nout body;\n>;\nout skel qt;`;
      let data=null,lastError=null;
      for(const endpoint of ["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter","https://overpass.nchc.org.tw/api/interpreter"]){try{const res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(q)});if(!res.ok)throw new Error("HTTP "+res.status);data=await res.json();break;}catch(e){lastError=e;}}
      if(!data)throw new Error("Overpass接続失敗: "+(lastError?.message||"unknown"));
      const ways=data.elements.filter(e=>e.type==="way"&&e.nodes?.length>=2),osmNodes=new Map(data.elements.filter(e=>e.type==="node").map(n=>[n.id,n]));
      if(!ways.length)throw new Error("道路wayが0件でした。Overpassのarea検索結果を確認してください。");
      status(`道路取得完了: way ${ways.length.toLocaleString()}本。地形標高を取得中…`);
      const needed=new Set();for(const w of ways)for(const id of w.nodes)needed.add(id);
      const nodeList=[...needed].map(id=>osmNodes.get(id)).filter(n=>n&&Number.isFinite(n.lon)&&Number.isFinite(n.lat));
      const terrain=new Map();
      const fallbackEle=(n)=>{const e=parseFloat(n.tags?.ele);return Number.isFinite(e)?e:0;};
      if(C.sampleTerrainMostDetailed&&viewer.terrainProvider){
        for(let i=0;i<nodeList.length;i+=250){const batch=nodeList.slice(i,i+250);try{const carts=batch.map(n=>C.Cartographic.fromDegrees(n.lon,n.lat));const sampled=await C.sampleTerrainMostDetailed(viewer.terrainProvider,carts);sampled.forEach((p,j)=>terrain.set(batch[j].id,Number.isFinite(p.height)?p.height:fallbackEle(batch[j])));}catch(e){batch.forEach(n=>terrain.set(n.id,fallbackEle(n)));}if(i%2500===0)status(`地形標高取得中… ${Math.min(i+250,nodeList.length).toLocaleString()} / ${nodeList.length.toLocaleString()}`);}
      }else nodeList.forEach(n=>terrain.set(n.id,fallbackEle(n)));
      const lon0=ORIGIN.lon,lat0=ORIGIN.lat,cos=Math.cos(lat0*Math.PI/180),toXY=(n)=>[(n.lon-lon0)*111319.490793*cos,(n.lat-lat0)*111132.954];
      const nodes=[],meshes=[],views=[],accessors=[],binParts=[];let byteOffset=0;
      const addBin=(typed,target)=>{const pad=(4-byteOffset%4)%4;if(pad){binParts.push(new Uint8Array(pad));byteOffset+=pad;}const u8=new Uint8Array(typed.buffer,typed.byteOffset,typed.byteLength);const idx=views.push({buffer:0,byteOffset,byteLength:u8.byteLength,target})-1;binParts.push(new Uint8Array(u8));byteOffset+=u8.byteLength;return idx;};
      const addAccessor=(view,componentType,count,type,min,max)=>accessors.push({bufferView:view,componentType,count,type,min,max})-1;
      const materialFor={road:0,white:1,yellow:2,concrete:3,metal:4};
      
      let built=0,skipped=0;
      for(let wi=0;wi<ways.length;wi++){
        const w=ways[wi],t=w.tags||{};if(t.tunnel&&t.tunnel!=="no"){skipped++;continue;}
        const pts=[];for(const id of w.nodes){const n=osmNodes.get(id);if(!n)continue;const xy=toXY(n);pts.push({id,x:xy[0],y:xy[1],ground:terrain.get(id)||fallbackEle(n)});}
        if(pts.length<2){skipped++;continue;}
        const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y));const total=cum[cum.length-1];if(total<5){skipped++;continue;}
        const lanes=parseLanes(t),width=parseWidth(t.width)||Math.max(5,lanes*3.5+2.5),half=width/2;
        const layer=parseInt(t.layer||"0",10)||0,bridge=(t.bridge&&t.bridge!=="no")||layer>0;const deckOff=bridge?Math.max(5.5,layer*5.5):Math.max(0,layer*5.5);
        const cx=pts.reduce((s,p)=>s+p.x,0)/pts.length,cy=pts.reduce((s,p)=>s+p.y,0)/pts.length;
        const geos=[0,1,2,3,4].map(()=>makeGeo(cx,cy));
        const fade=Math.max(12,Math.min(40,total*.22));
        pts.forEach((p,i)=>{const ramp=bridge?Math.max(0,Math.min(1,cum[i]/fade,(total-cum[i])/fade)):Math.max(0,layer*5.5)/Math.max(deckOff,1);p.lift=deckOff*ramp;});
        const offsetPt=(p,norm,d,zAdd=0)=>[p.x+norm[0]*d-cx,p.y+norm[1]*d-cy,p.ground+p.lift+zAdd];
        const dirs=pts.map((p,i)=>{const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;return [-dy/l,dx/l];});
        // Asphalt ribbon, with bevelled per-point normals.
        activeGeo=geos[0];for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],na=dirs[i],nb=dirs[i+1];const al=offsetPt(a,na,half),ar=offsetPt(a,na,-half),bl=offsetPt(b,nb,half),br=offsetPt(b,nb,-half);addQuad(al,ar,br,bl);}
        // Solid edge lines.
        activeGeo=geos[1];for(const sign of [-1,1])for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],na=dirs[i],nb=dirs[i+1],wline=.16;const p1=offsetPt(a,na,sign*(half-.55)),p2=offsetPt(b,nb,sign*(half-.55));const q1=offsetPt(a,na,sign*(half-.55-wline)),q2=offsetPt(b,nb,sign*(half-.55-wline));addQuad(p1,q1,q2,p2);}
        // Dashed lane separators, 6 m dash / 9 m gap.
        const addDash=(d)=>{const dash=6,gap=9;for(let start=2;start<total-1;start+=dash+gap){const end=Math.min(total-1,start+dash);const pointAt=(dist)=>{let k=1;while(k<cum.length&&cum[k]<dist)k++;const a=pts[k-1],b=pts[k],f=(dist-cum[k-1])/(cum[k]-cum[k-1]||1),norm=dirs[k-1].map((v,j)=>v*(1-f)+dirs[k][j]*f),nl=Math.hypot(norm[0],norm[1])||1;return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,ground:a.ground+(b.ground-a.ground)*f,lift:a.lift+(b.lift-a.lift)*f,norm:[norm[0]/nl,norm[1]/nl]};};const a=pointAt(start),b=pointAt(end);const wline=.14;const p1=offsetPt(a,a.norm,d+wline/2),p2=offsetPt(b,b.norm,d+wline/2),q1=offsetPt(a,a.norm,d-wline/2),q2=offsetPt(b,b.norm,d-wline/2);addQuad(p1,q1,q2,p2);}};
        activeGeo=geos[1];for(let lane=1;lane<lanes;lane++)addDash(-half+width*lane/lanes);
        // Concrete parapets on tagged elevated structures.
        if(bridge){activeGeo=geos[3];for(const sign of [-1,1])for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],na=dirs[i],nb=dirs[i+1],d=sign*(half-.08);const p1=offsetPt(a,na,d),p2=offsetPt(b,nb,d),q2=offsetPt(b,nb,d),q1=offsetPt(a,na,d);p1[2]+=.15;p2[2]+=.15;q1[2]+=1.15;q2[2]+=1.15;addQuad(p1,p2,q2,q1);}}
        // Simple service-light poles on motorways, spaced about 80 m.
        if(t.highway==="motorway"||t.highway==="trunk") {activeGeo=geos[4];for(let dist=35;dist<total-15;dist+=80){let k=1;while(k<cum.length&&cum[k]<dist)k++;if(k>=pts.length)break;const f=(dist-cum[k-1])/(cum[k]-cum[k-1]||1),p=pts[k-1],r=pts[k],x=p.x+(r.x-p.x)*f,y=p.y+(r.y-p.y)*f,z=p.ground+(r.ground-p.ground)*f+(p.lift+(r.lift-p.lift)*f),n=dirs[k-1],side=(Math.floor(dist/80)%2?1:-1);const bx=x+n[0]*(half+2.2)*side,by=y+n[1]*(half+2.2)*side;activeGeo=geos[4];box(bx-cx-.11,by-cy-.11,z,.22,.22,8.5);const armX=bx+n[0]*(-side*2.6),armY=by+n[1]*(-side*2.6);box(Math.min(bx,armX)-cx,Math.min(by,armY)-cy,z+8.2,Math.abs(armX-bx)+.12,Math.abs(armY-by)+.12,.16);box(armX-cx-.22,armY-cy-.22,z+8.2,.44,.44,.12);}}
        // Approximate piers under bridges; spacing 35 m. Height derives from sampled terrain.
        if(bridge){activeGeo=geos[3];for(let dist=12;dist<total-8;dist+=35){let k=1;while(k<cum.length&&cum[k]<dist)k++;if(k>=pts.length)break;const f=(dist-cum[k-1])/(cum[k]-cum[k-1]||1),p=pts[k-1],r=pts[k],x=p.x+(r.x-p.x)*f,y=p.y+(r.y-p.y)*f,ground=p.ground+(r.ground-p.ground)*f,lift=p.lift+(r.lift-p.lift)*f,z=ground+lift;box(x-cx-.42,y-cy-.42,ground,.84,.84,Math.max(.8,z-ground-.35));}}
        const primitives=[];for(let mi=0;mi<geos.length;mi++){const geo=geos[mi];if(!geo.idx.length)continue;const pos=new Float32Array(geo.pos),nor=new Float32Array(geo.nor),ind=geo.pos.length/3>65535?new Uint32Array(geo.idx):new Uint16Array(geo.idx);let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<pos.length;i+=3)for(let j=0;j<3;j++){min[j]=Math.min(min[j],pos[i+j]);max[j]=Math.max(max[j],pos[i+j]);}
          const pv=addBin(pos,34962),nv=addBin(nor,34962),iv=addBin(ind,34963),pa=addAccessor(pv,5126,pos.length/3,"VEC3",min,max),na=addAccessor(nv,5126,nor.length/3,"VEC3"),ia=addAccessor(iv,ind instanceof Uint32Array?5125:5123,ind.length,"SCALAR");primitives.push({attributes:{POSITION:pa,NORMAL:na},indices:ia,material:mi,mode:4});}
        if(!primitives.length){skipped++;continue;}const meshIndex=meshes.push({name:`OSM way ${w.id}`,primitives})-1;nodes.push({name:`${t.ref||t.name||t.highway||"Highway"} | way ${w.id}`,mesh:meshIndex,translation:[cx,cy,0],extras:{osmWayId:w.id,highway:t.highway||"",ref:t.ref||"",name:t.name||"",lanes:t.lanes||"estimated",bridge:t.bridge||"no",layer:t.layer||"0",elevation:"terrain + tagged bridge/layer estimate"}});built++;
        if(built%400===0)status(`道路メッシュ作成中… ${built.toLocaleString()} / ${ways.length.toLocaleString()} ways`);
      }
      if(!built)throw new Error("メッシュを生成できる道路がありませんでした。");
      const totalLen=binParts.reduce((s,a)=>s+a.length,0),bin=new Uint8Array((totalLen+3)&~3);let bp=0;for(const a of binParts){bin.set(a,bp);bp+=a.length;}
      const glb=createGLB(nodes,meshes,views,accessors,bin,matDefs);await loadBytes(glb,"Osaka_Highway_OSM_Prototype.glb");
      const mb=glb.byteLength/1048576;status(`生成完了: ${built.toLocaleString()} ways / 除外 ${skipped.toLocaleString()} ways / GLB ${mb.toFixed(1)} MB${mb>100?"（100MB目標超過）":""}。プレビューを確認し、必要なノードを選んで修正後に書き出してください。\n※橋面高・JCTランプ高は推定値です。N06公式データとの照合と現地確認は未実施。`);
    }catch(e){status("生成エラー: "+(e?.message||e));console.error(e);}finally{setBusy(false);}
  };
  $("build").onclick=buildFromOverpass;
  const pickHandler=new C.ScreenSpaceEventHandler(viewer.canvas);
  pickHandler.setInputAction((movement)=>{try{if(!state.model||!state.parsed)return;const picked=scene.pick(movement.position);if(!picked||picked.primitive!==state.model||!picked.node)return;const name=picked.node.name;const idx=state.parsed.json.nodes.findIndex(n=>n.name===name);if(idx>=0){$("filter").value="";refreshNodes();$("node").value=String(idx);fillNode(idx);status("GeoFS上で選択したノード: "+(name||idx));}}catch(e){}},C.ScreenSpaceEventType.LEFT_CLICK);
  state.destroy=()=>{state.destroyed=true;removePreview();if(state.blobUrl)URL.revokeObjectURL(state.blobUrl);try{pickHandler.destroy();}catch(e){}panel.remove();};
  window.__osakaHighwayEditor=state;
  window.__osakaHighwayEditor.destroy=state.destroy;
  status("エディターを起動しました。GLBを読み込むか「大阪府の道路を取得して生成」を押してください。");
})();
