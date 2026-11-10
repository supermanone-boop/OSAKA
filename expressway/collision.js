"use strict";
(async () => {
  const g = window.geofs;
  const C = window.Cesium;
  if (!g || !C || !g.objects) {
    alert("GeoFSのobjects APIが見つかりません。GeoFSの読み込み後に実行してください。");
    return;
  }
  if (!Array.isArray(g.objects.objectList) || typeof g.objects.loadModels !== "function") {
    console.error("GeoFS objects API:", g.objects);
    alert("geofs.objects.objectList / loadModels が見つかりません。");
    return;
  }
  if (typeof DecompressionStream === "undefined") {
    alert("gzip展開に対応した最新版Chromeが必要です。");
    return;
  }

  // v7で作成した道路三角形データを再利用する。
  // 変更点はGeoFSのcollisionTriangles形式とobject定義。
  const DATA_URL =
    "https://huggingface.co/supermanone-boop/hankyu/resolve/main/Osaka_Expressways_RoadCollision_v7.bin.gz";
  const LOAD_RADIUS_M = 2200;
  const UPDATE_INTERVAL_MS = 1500;
  const TAG = "__osakaExpresswayRoadCollisionV9";
  const ID_PREFIX = "osaka-expressway-collision-";
  const OLD_TAGS = [
    "__osakaExpresswayRoadCollisionV7",
    "__osakaExpresswayRoadCollisionV8",
    "__osakaExpresswayRoadCollisionV9"
  ];

  // Previous versions are stopped and their objects removed before rebuilding.
  for (const tag of OLD_TAGS) {
    const old = window[tag];
    if (old) {
      try { old.stopped = true; } catch (_) {}
      try { if (old.timer) clearInterval(old.timer); } catch (_) {}
      try {
        if (Array.isArray(old.objects)) {
          for (const obj of old.objects) {
            const i = g.objects.objectList.indexOf(obj);
            if (i !== -1) g.objects.objectList.splice(i, 1);
          }
        }
      } catch (_) {}
      try { delete window[tag]; } catch (_) {}
    }
  }
  for (let i = g.objects.objectList.length - 1; i >= 0; i--) {
    const obj = g.objects.objectList[i];
    if (typeof obj?.id === "string" && obj.id.startsWith(ID_PREFIX)) {
      g.objects.objectList.splice(i, 1);
    }
  }
  try { g.objects.loadModels(); } catch (e) {
    console.warn("GeoFS collision index rebuild after old-version cleanup:", e);
  }

  const state = {
    tiles: [],
    loaded: new Set(),
    objects: [],
    timer: null,
    busy: false,
    stopped: false,
    buffer: null,
    destroy() {
      if (this.stopped) return;
      this.stopped = true;
      if (this.timer) clearInterval(this.timer);
      const list = g.objects.objectList;
      for (const obj of this.objects) {
        const i = list.indexOf(obj);
        if (i !== -1) list.splice(i, 1);
      }
      this.objects.length = 0;
      this.loaded.clear();
      this.buffer = null;
      try { g.objects.loadModels(); } catch (e) { console.warn("Collision rebuild:", e); }
      if (window[TAG] === this) delete window[TAG];
      console.log("[Osaka Road Collision v9] removed");
    }
  };
  window[TAG] = state;

  function waitForLocation() {
    return new Promise((resolve, reject) => {
      let count = 0;
      const timer = setInterval(() => {
        const p = g.aircraft?.instance?.llaLocation;
        if (Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) {
          clearInterval(timer);
          resolve(p);
        } else if (++count >= 120) {
          clearInterval(timer);
          reject(new Error("Aircraft llaLocation unavailable"));
        }
      }, 500);
    });
  }

  function distanceMeters(lat1, lon1, lat2, lon2) {
    const latMid = (lat1 + lat2) * 0.5 * Math.PI / 180;
    const dx = (lon2 - lon1) * 111319.49 * Math.cos(latMid);
    const dy = (lat2 - lat1) * 110574.0;
    return Math.hypot(dx, dy);
  }

  // GeoFSが参照する三角形の付加情報 u/v/n を、提示された作例と
  // 同じ計算・同じ配列へのプロパティ追加で構築する。
  function tri(p0, p1, p2) {
    const u = [
      p1[0] - p0[0],
      p1[1] - p0[1],
      p1[2] - p0[2]
    ];
    const v = [
      p2[0] - p0[0],
      p2[1] - p0[1],
      p2[2] - p0[2]
    ];
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    ];
    return Object.assign([p0, p1, p2], { u, v, n });
  }

  function makeCollisionObject(tile) {
    const values = new Float32Array(
      state.buffer,
      tile.dataOffset,
      tile.triangleCount * 9
    );
    const triangles = new Array(tile.triangleCount);

    for (let i = 0, t = 0; i < values.length; i += 9, t++) {
      const a = [values[i], values[i + 1], values[i + 2]];
      const b = [values[i + 3], values[i + 4], values[i + 5]];
      const c = [values[i + 6], values[i + 7], values[i + 8]];
      triangles[t] = tri(a, b, c);
    }

    // Verify both vertex arrays and the u/v/n fields before GeoFS receives them.
    const first = triangles[0];
    if (!Array.isArray(first) || first.length !== 3 ||
        first.some(p => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) ||
        !Array.isArray(first.u) || first.u.length !== 3 || !first.u.every(Number.isFinite) ||
        !Array.isArray(first.v) || first.v.length !== 3 || !first.v.every(Number.isFinite) ||
        !Array.isArray(first.n) || first.n.length !== 3 || !first.n.every(Number.isFinite)) {
      throw new Error(`Invalid GeoFS triangle record in tile ${tile.ix}/${tile.iy}`);
    }

    return {
      id: `${ID_PREFIX}${tile.ix}-${tile.iy}`,
      name: `Osaka Expressway Road Collision ${tile.ix},${tile.iy}`,
      type: 100,
      location: [tile.lat, tile.lon, 0],
      htr: [0, 0, 0],
      rotateModelOnly: false,
      scale: 1,
      metricOffset: [0, 0, 0],
      collisionRadius: tile.radius,
      collisionTriangles: triangles,
      options: {}
    };
  }

  function readBinary(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 12 ||
        view.getUint8(0) !== 79 || view.getUint8(1) !== 83 ||
        view.getUint8(2) !== 67 || view.getUint8(3) !== 82) {
      throw new Error("Invalid OSCR collision file header");
    }
    const version = view.getUint16(4, true);
    const tileCount = view.getUint32(8, true);
    if (version !== 1 || tileCount < 1 || tileCount > 2000) {
      throw new Error(`Unsupported collision data version/count: ${version}/${tileCount}`);
    }

    const tiles = [];
    let offset = 12;
    for (let i = 0; i < tileCount; i++) {
      if (offset + 32 > view.byteLength) throw new Error("Truncated tile header");
      const ix = view.getInt32(offset, true); offset += 4;
      const iy = view.getInt32(offset, true); offset += 4;
      const lon = view.getFloat64(offset, true); offset += 8;
      const lat = view.getFloat64(offset, true); offset += 8;
      const radius = view.getFloat32(offset, true); offset += 4;
      const triangleCount = view.getUint32(offset, true); offset += 4;
      const bytes = triangleCount * 9 * 4;
      if (!triangleCount || offset + bytes > view.byteLength) {
        throw new Error(`Invalid triangle block for tile ${ix},${iy}`);
      }
      tiles.push({ ix, iy, lon, lat, radius, triangleCount, dataOffset: offset });
      offset += bytes;
    }
    if (offset !== view.byteLength) throw new Error("Collision file has trailing or missing bytes");
    return tiles;
  }

  async function loadNearby() {
    if (state.busy || state.stopped) return;
    state.busy = true;
    try {
      const p = g.aircraft?.instance?.llaLocation;
      if (!Array.isArray(p) || !Number.isFinite(+p[0]) || !Number.isFinite(+p[1])) return;
      const playerLat = +p[0];
      const playerLon = +p[1];
      let added = 0;

      for (const tile of state.tiles) {
        const key = `${tile.ix}/${tile.iy}`;
        if (state.loaded.has(key)) continue;
        if (distanceMeters(playerLat, playerLon, tile.lat, tile.lon) > LOAD_RADIUS_M + tile.radius) continue;
        const obj = makeCollisionObject(tile);
        g.objects.objectList.push(obj);
        state.objects.push(obj);
        state.loaded.add(key);
        added++;
      }

      if (added) {
        g.objects.loadModels();
        console.log(`[Osaka Road Collision v9] +${added} tile(s), ${state.loaded.size}/${state.tiles.length} loaded`);
      }
    } finally {
      state.busy = false;
    }
  }

  try {
    console.log("[Osaka Road Collision v9] downloading collision data...");
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error("ReadableStream unavailable");

    const expanded = await new Response(
      response.body.pipeThrough(new DecompressionStream("gzip"))
    ).arrayBuffer();

    state.buffer = expanded;
    state.tiles = readBinary(expanded);
    console.log("[Osaka Road Collision v9] data ready", {
      tiles: state.tiles.length,
      expandedMB: (expanded.byteLength / 1048576).toFixed(1),
      loadRadiusM: LOAD_RADIUS_M,
      triangleCount: state.tiles.reduce((sum, t) => sum + t.triangleCount, 0),
      triangleFormat: "[p0,p1,p2] with array properties u/v/n"
    });

    await waitForLocation();
    await loadNearby();
    state.timer = setInterval(loadNearby, UPDATE_INTERVAL_MS);
    console.log("[Osaka Road Collision v9] active. Triangle records now match the supplied tri() implementation.");
  } catch (error) {
    state.destroy();
    console.error("[Osaka Road Collision v9] failed:", error);
    alert("道路コリジョンの読み込みに失敗しました。コンソールを確認してください。");
  }
})();
