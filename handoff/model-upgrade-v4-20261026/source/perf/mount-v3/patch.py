from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[2]
def patch(source):
    assert 'TF_MOUNTED_DETAILS_BEGIN' not in source
    compiled=subprocess.check_output([str(ROOT/'perf/node_modules/.bin/esbuild'),str(ROOT/'perf/mount-v3/details.mjs'),'--bundle','--format=iife','--global-name=TFMountedDetails','--target=es2020','--log-level=warning'],text=True)
    marker='  var aircraftGeometry = (() => {';assert source.count(marker)==1
    source=source.replace(marker,'  /* TF_MOUNTED_DETAILS_BEGIN */\n'+compiled+'\n  /* TF_MOUNTED_DETAILS_END */\n'+marker,1)
    old='        m = sightCorrection.model;';assert source.count(old)==1
    source=source.replace(old,old+'\n        m = TFMountedDetails.normalizeModel(id2, m);',1)
    start=source.index('    build.imported = function importedGeometry(id, spec) {');end=source.index('    // The existing aircraft damage model uses component envelopes.',start)
    scope=source[start:end];old='      return {\n        body: verts(of("body"))';assert scope.count(old)==1
    scope=scope.replace(old,'      return TFMountedDetails.airframe(id, M, {\n        body: verts(of("body"))',1)
    old='      };\n    };';assert scope.count(old)==1;scope=scope.replace(old,'      });\n    };',1)
    source=source[:start]+scope+source[end:]
    old='    const WEAPON_STATUS = {};';assert source.count(old)==1
    source=source.replace(old,'    TFMountedDetails.register(AIR_STORE_DEFS, data.storeModels);\n'+old,1)
    old='      const socket = def.model && storeSocket(data.storeModels?.[def.model], "socket_mount");';assert source.count(old)==1
    source=source.replace(old,'      const model = TFMountedDetails.modelId(def);\n      const socket = model && storeSocket(data.storeModels?.[model], "socket_mount");',1)
    old='      return TFModelHardpoints.rebind(T, out, { storeMountPosition });';assert source.count(old)==1
    source=source.replace(old,'      return TFMountedDetails.fitItems(T, TFMountedDetails.rebind(T, TFModelHardpoints.rebind(T, out, { storeMountPosition }), { storeMountPosition }));',1)
    old='      const model = data.storeModels?.[rack || def?.model];';assert source.count(old)==1
    source=source.replace(old,'      const model = data.storeModels?.[rack || TFMountedDetails.modelId(def)];',1)
    old='      const m = renderer.mesh(v || aircraftGeometry.store(def));';assert source.count(old)==1
    source=source.replace(old,'      const m = renderer.mesh(v || TFMountedDetails.store(def, lod) || aircraftGeometry.store(def));',1)
    # Keep the physical lug oriented towards lateral wingtip rails in the
    # garage, accepted native aircraft, and externally sensed presentation.
    for old,new in [
        ('n.local = quatMatrix(it.p, [0, 0, 0, 1]);','n.local = quatMatrix(it.p, TFModelHardpoints.storeRotation(it));'),
        ('item.node.local = quatMatrix(item.p, [0, 0, 0, 1]);','item.node.local = quatMatrix(item.p, TFModelHardpoints.storeRotation(item));'),
        ('node.local=quatMatrix(store.p,[0,0,0,1]);','node.local=quatMatrix(store.p,TFModelHardpoints.storeRotation(store,plane.type));')
    ]:
        assert source.count(old)==1, 'Store orientation hook is ambiguous: '+old
        source=source.replace(old,new,1)
    old='      this.cam = null;\n      TFAllAircraftInteriors.install(this, { Node, engineLayout: TFEngineLayout, mechanismFit: TFMechanismFit });';assert source.count(old)==1
    source=source.replace(old,old+'\n      TFMountedDetails.install(this, { Node, geometry: geo });',1)
    old='      TFAllAircraftInteriors.show(this);';assert source.count(old)==1
    source=source.replace(old,old+'\n      TFMountedDetails.show(this);',1)
    old='      return this._alive = Uint8Array.from(hb.pieces, (pc) => this.gone(pc.part) || pc.carrier && this.gone(pc.carrier) ? 0 : 1);';assert source.count(old)==1
    source=source.replace(old,'      return this._alive = TFMountedDetails.maskAlive(hb, Uint8Array.from(hb.pieces, (pc) => this.gone(pc.part) || pc.carrier && this.gone(pc.carrier) ? 0 : 1));',1)
    old='      const groups = [...new Set(items.filter((it) => AIR_WEAPON_KINDS.has(it.def.kind)).map((it) => it.id))];';assert source.count(old)==1
    source=source.replace(old,'      TFMountedDetails.attach(plane, items);\n'+old,1)
    for name,fn,extra in [('AIR_STORE_DEFS','catalogDefinitions',', AIRCRAFT_TYPES'),('WEAPON_COMPAT','compatibility',''),('AIR_EQUIP','equipment',''),('AIR_RADARS','radars',''),('AIR_PODS','pods','')]:
        start=source.index('    const '+name+' = {');end=source.index('\n    };',start)+len('\n    };')
        scope=source[start:end];scope=scope.replace(' = {',' = TFMountedDetails.'+fn+'({',1);scope=scope[:-1]+extra+');';source=source[:start]+scope+source[end:]
    old='      const wing = sp ? sp.wing : [[';assert source.count(old)==1
    source=source.replace(old,'      const wing = sp ? sp.wing : TFMountedDetails.prototypeWing(T.id) || [[',1)
    old='      const fus = sp ? sp.fuselage : [[';assert source.count(old)==1
    source=source.replace(old,'      const fus = sp ? sp.fuselage : TFMountedDetails.prototypeFuselage(T.id) || [[',1)
    start=source.index('    function airStations(T) {');end=source.index('    /**',start);scope=source[start:end]
    old='      return {\n        tip:';assert scope.count(old)==1;scope=scope.replace(old,'      return TFMountedDetails.stations(T, {\n        tip:',1)
    old='      };\n    }';assert scope.count(old)==1;scope=scope.replace(old,'      });\n    }',1);source=source[:start]+scope+source[end:]
    old='const r = def.d / 2, wing = station !== "center" && station !== "belly", placed = [];';assert source.count(old)==1
    source=source.replace(old,'const r = def.d / 2, wing = S[station].wing ?? (station !== "center" && station !== "belly"), placed = [];',1)
    old='return TFModelHardpoints.decorateSlots(AIRCRAFT_TYPES[typeId], [...slots.values()].sort((a, b) => rank(a) - rank(b)));';assert source.count(old)==1
    source=source.replace(old,'return TFModelHardpoints.decorateSlots(AIRCRAFT_TYPES[typeId], TFMountedDetails.slots(AIRCRAFT_TYPES[typeId], [...slots.values()].sort((a, b) => rank(a) - rank(b))));',1)
    old='st.compat = st.compat === "secondary" || ev === "secondary" ? "secondary" : "game_test_platform";';assert source.count(old)==1
    source=source.replace(old,'st.compat = st.compat === "primary" || ev === "primary" ? "primary" : st.compat === "secondary" || ev === "secondary" ? "secondary" : "game_test_platform";',1)
    # Two code-built aircraft have measured source-geometry fingerprints and
    # fitted support profiles; other code-built IDs have no applicable profile.
    old='geometry: () => aircraftGeometry(),';assert source.count(old)==1
    source=source.replace(old,'geometry: () => TFMountedDetails.airframe("nf01", null, aircraftGeometry()),',1)
    old=': aircraftGeometry.fighter(f.spec), airframe: f.airframe';assert source.count(old)==1
    source=source.replace(old,': TFMountedDetails.airframe(id2, null, aircraftGeometry.fighter(f.spec)), airframe: f.airframe',1)
    old='geometry: () => aircraftGeometry.jet(),';assert source.count(old)==1
    source=source.replace(old,'geometry: () => TFMountedDetails.airframe("nf02", null, aircraftGeometry.jet()),',1)
    old='const slotsClash = (a, b, aId, bId) => TFModelHardpoints.slotsClash(a, b, aId, bId)';assert source.count(old)==1
    source=source.replace(old,'const slotsClash = (a, b, aId, bId, aN, bN) => TFMountedDetails.catalogClash(a,b,aId,bId) || TFModelHardpoints.slotsClash(a, b, aId, bId, aN, bN)',1)
    old='        const id2 = pick[sl.key], n = id2 && sl.options.get(id2);';assert source.count(old)==1
    source=source.replace(old,'        const id2 = pick[sl.key], n = id2 && TFMountedDetails.quantity(G4, typeId, sl, id2);',1)
    old='    G4.airCustom = G4.airCustom || {};';assert source.count(old)==1
    source=source.replace(old,old+'\n    G4.airCustomCounts = G4.airCustomCounts || {};',1)
    old='      Object.assign(G4.airCustom, JSON.parse(localStorage.getItem("tf.airCustom") || "{}"));';assert source.count(old)==1
    source=source.replace(old,old+'\n      Object.assign(G4.airCustomCounts, JSON.parse(localStorage.getItem("tf.airCustomCounts") || "{}"));',1)
    old='        localStorage.setItem("tf.airCustom", JSON.stringify(G4.airCustom));';assert source.count(old)==1
    source=source.replace(old,old+'\n        localStorage.setItem("tf.airCustomCounts", JSON.stringify(G4.airCustomCounts));',1)
    old='          pick[t.key] = sid;\n          for (const o of slots) if (slotsClash(o, t, pick[o.key], sid)) delete pick[o.key];';assert source.count(old)==1
    source=source.replace(old,'          pick[t.key] = sid;\n          TFMountedDetails.startCount(G4, id2, t.key, t.options.get(sid));\n          for (const o of slots) if (slotsClash(o, t, pick[o.key], sid, TFMountedDetails.quantity(G4,id2,o,pick[o.key]), TFMountedDetails.quantity(G4,id2,t,sid))) delete pick[o.key];',1)
    old='          return `<td><button type="button" class="air-arm-cell k-${KIND_CLASS[d.kind]}" data-slot="${sl.key}" data-store="${sid}" aria-pressed="${pick[sl.key] === sid}" title="${d.name} ×${n}">${n > 1 ? `<small>${n}</small>` : ""}</button></td>`;';assert source.count(old)==1
    new='''          const selected=pick[sl.key]===sid, count=selected?TFMountedDetails.quantity(G4,id2,sl,sid):n;
          const quantity=selected&&n>1&&TFMountedDetails.quantityEnabled(id2,sl,sid)?`<select class="air-arm-count" data-slot="${sl.key}" aria-label="${d.name} 数量" style="max-width:52px;background:#18262b;color:#e6efed;border:1px solid #52766d">${Array.from({length:n},(_,i)=>`<option value="${i+1}"${count===i+1?' selected':''}>${i+1}</option>`).join('')}</select>`:'';
          return `<td><button type="button" class="air-arm-cell k-${KIND_CLASS[d.kind]}" data-slot="${sl.key}" data-store="${sid}" aria-pressed="${selected}" title="${d.name} ×${count}">${count > 1 ? `<small>${count}</small>` : ""}</button>${quantity}</td>`;'''
    source=source.replace(old,new,1)
    old='      if (e.target.classList.contains("air-arm-mirror")) G4.airArmMirror = e.target.checked;';assert source.count(old)==1
    source=source.replace(old,old+'''
      if(e.target.classList.contains("air-arm-count")){
        const id2=armEd.dataset.air;
        TFMountedDetails.countPick(G4,airSlots(id2),id2,e.target.dataset.slot,Number(e.target.value),slotsClash);
        G4.airLoadout[id2]=airLoadouts(id2).length-1;saveAirArms();renderArmEditor();renderAirInfo(id2);
        if(airGarage.plane?.type.id===id2)mountStores(airGarage.plane,id2,G4.airLoadout[id2]);
      }''',1)
    old='center: "中線" };';assert source.count(old)==1
    source=source.replace(old,'center: "中線", chin: "瞄准吊舱" };',1)
    old='gunpod: "rocket" };';assert source.count(old)==1
    source=source.replace(old,'gunpod: "rocket", sensorpod: "agm" };',1)
    old='      if (G4.airArmMirror && sl.side !== 0) {';assert source.count(old)==1
    source=source.replace(old,'      if (G4.airArmMirror && sl.side !== 0 && AIR_STORE_DEFS[sid]?.kind !== "sensorpod") {',1)
    old='return ["自訂", TFModelHardpoints.customEntries(AIRCRAFT_TYPES[typeId], items)];';assert source.count(old)==1
    source=source.replace(old,'return ["自訂", TFMountedDetails.catalogEntries(TFModelHardpoints.customEntries(AIRCRAFT_TYPES[typeId], items))];',1)
    old='const own = d.model === id2, pkg = d.model && data.storeModels?.[d.model];';assert source.count(old)==1
    source=source.replace(old,'const modelId=TFMountedDetails.modelId(d), own = modelId === id2, pkg = modelId && data.storeModels?.[modelId];',1)
    old='`package_shared:${d.model}`';assert source.count(old)==1
    source=source.replace(old,'`package_shared:${modelId}`',1)
    return source
