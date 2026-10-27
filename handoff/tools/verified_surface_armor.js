// Reviewed source-constructor associations only. Geometry and engineering are immutable.
function normalizeVerifiedSurfacePacket(packet, registry, hash, canonical) {
  if (!packet?.manifest || !packet.catalog) return packet;
  const m = JSON.parse(packet.manifest), c = JSON.parse(packet.catalog);
  const before = c.declarations.filter(d => d.resistancePolicy === "unsupported").length;
  const review = registry.specs[m.specId];
  const pinned = review && c.specId === m.specId && hash(packet.manifest) === review.manifestHash && hash(packet.catalog) === review.catalogHash;
  const diagnostics = { sourcePinned: !!pinned, unknownBefore: before, mappedDeclarations: 0, mappedTriangles: 0, quarantinedDeclarations: before, status: "unresolved_surface_resistance_quarantined" };
  if (!pinned || !review.overrides.length) return { ...packet, armorBindingReview: diagnostics, quarantinedSurfaces: before };
  const overrides = new Map(review.overrides.map(d => [d.declarationKey, d]));
  const meshes = new Map(m.meshes.map(d => [d.key, d]));
  const surfaces = new Map(m.surfaces.map(d => [d.key, d]));
  const layers = new Map(c.layers.map(d => [d.armorRef, d]));
  const next = [], removed = new Set();
  function rekey(d) {
    d.declaration = { basis: "verified_source_constructor_feature", revision: registry.revision };
    const body = { ...d }; delete body.key;
    const contentHash = hash(canonical(body));
    d.declaration.contentHash = contentHash; d.key = "decl:" + contentHash;
  }
  for (const d of c.declarations) {
    const rule = overrides.get(d.key);
    if (!rule || d.resistancePolicy !== "unsupported") { next.push(d); continue; }
    if (d.meshKey !== rule.meshKey || d.first !== rule.first || d.count !== rule.count || d.sourceKey !== rule.sourceKey) throw Error("verified armor source range identity changed");
    const mesh = meshes.get(d.meshKey), rangeIndex = mesh?.ranges.findIndex(r => r.first === d.first && r.count === d.count);
    const range = mesh?.ranges[rangeIndex], surface = range && surfaces.get(range.surfaceKey);
    if (!range || !surface) throw Error("verified armor manifest range missing");
    let cursor = d.first;
    const replacements = [];
    for (const [ordinal, run] of rule.runs.entries()) {
      if (run.first !== cursor || run.count <= 0 || run.first + run.count > d.first + d.count) throw Error("verified armor coverage differs");
      cursor += run.count;
      const sd = structuredClone(d), ss = { ...surface, key: surface.key + ":verified:" + ordinal };
      const sr = { ...range, first: run.first, count: run.count, sourceTriangleFirst: (range.sourceTriangleFirst ?? range.first) + run.first - range.first, surfaceKey: ss.key };
      sd.first = run.first; sd.count = run.count;
      if (sd.material?.renderMaterialSampleTriangle != null) sd.material.renderMaterialSampleTriangle = run.first;
      if (run.armorRef) {
        const candidates = c.acceptedAnatomy.armor.filter(p => p.id === run.armorRef);
        if (candidates.length !== 1) throw Error("verified authored engineering reference missing");
        const p = candidates[0];
        let layer = layers.get(p.id);
        if (!layer) {
          layer = { armorRef:p.id, authoredEngineeringHash:hash(canonical(p)), authoredMaterial:p.material, authoredThicknessMm:p.thickness_mm, chargePolicy:"once_per_material_region", declarationKeys:[], historicalMeasurement:false, key:"layer:" + rule.assetKey + ":" + p.id, materialRegionKey:"region:" + rule.assetKey + ":" + p.id, thicknessSource:"authored_engineering" };
          c.layers.push(layer); layers.set(p.id, layer);
          m.bindings.push({ armorId:p.id, authoredEngineeringHash:layer.authoredEngineeringHash, key:layer.key, kind:"armor", status:"tankforge_verified_source_constructor_association" });
        }
        sd.role = "armor"; sd.resistancePolicy = "authored_thickness"; sd.fuseEligible = true;
        sd.partId = d.sourceKey + ":feature:" + run.feature;
        sd.owners = [{ kind:"source_constructor", sourceKey:d.sourceKey, featureKey:run.feature, weaponKey:null, reason:null }];
        sd.armorBinding = { armorRefs:[p.id], boundarySide:run.boundarySide, layerKey:layer.key, materialRegionKey:layer.materialRegionKey, pairing:"same_material_region", status:"declared", thicknessSource:"authored_engineering" };
        sd.topology = { status:"declared", kind:"boundary_shell", solidKey:null };
        rekey(sd); layer.declarationKeys.push(sd.key);
        Object.assign(ss, { role:"armor", topology:"boundary_shell", contactEligible:true, fuseEligible:true, armorLayerKey:layer.key, moduleKey:null, crewKey:null, responseRef:sd.key });
        sr.bindingKey = layer.key;
        diagnostics.mappedTriangles += run.count;
      } else if (run.moduleRef || run.decoration === true) {
        // Only a content-pinned, explicitly reviewed constructor feature may
        // receive this policy. Unreviewed surfaces retain the barrier below.
        const module = run.moduleRef && c.acceptedAnatomy.modules.find(p => p.id === run.moduleRef);
        if (run.moduleRef && !module) throw Error("verified registered module reference missing");
        if (!run.reason) throw Error("verified nonarmor source explanation missing");
        sd.role = module ? "module" : "decoration";
        sd.moduleRef = module ? module.id : null; sd.crewSlot = null;
        sd.resistancePolicy = "no_authored_armor"; sd.fuseEligible = false;
        sd.partId = d.sourceKey + ":feature:" + run.feature;
        sd.owners = [{ kind:"source_constructor", sourceKey:d.sourceKey, featureKey:run.feature, weaponKey:module?.weapon_group ?? null, reason:run.reason }];
        sd.armorBinding = { armorRefs:[], boundarySide:null, layerKey:null, materialRegionKey:null, pairing:"none", status:"none", thicknessSource:"none" };
        sd.topology = { status:"declared", kind:"decorative_surface", solidKey:null };
        rekey(sd);
        Object.assign(ss, { role:sd.role, topology:"decorative_surface", contactEligible:true, fuseEligible:false, armorLayerKey:null, moduleKey:module ? "module:" + module.id : null, crewKey:null, responseRef:sd.key });
        sr.bindingKey = module ? "module:" + module.id : null;
        diagnostics.mappedTriangles += run.count;
      } else {
        // An unresolved bottom/join stays unsupported; even a split cannot grant zero armor.
        rekey(sd); ss.responseRef = null;
      }
      next.push(sd); m.surfaces.push(ss); replacements.push(sr);
    }
    if (cursor !== d.first + d.count) throw Error("verified armor source partition incomplete");
    mesh.ranges.splice(rangeIndex, 1, ...replacements); removed.add(surface.key);
    diagnostics.mappedDeclarations++;
  }
  if (!diagnostics.mappedDeclarations) return { ...packet, armorBindingReview:diagnostics, quarantinedSurfaces:before };
  c.declarations = next;
  const unknown = next.filter(d => d.resistancePolicy === "unsupported");
  c.audit.unknownTriangles = unknown.reduce((n,d) => n+d.count,0);
  c.audit.declaredTriangles = c.audit.physicalTriangles - c.audit.unknownTriangles;
  c.audit.ambiguousTriangles = next.filter(d => d.owners.length > 1).reduce((n,d) => n+d.count,0);
  c.audit.missingSemantics = unknown.map(d => d.partId);
  m.audits.missingBindings = c.audit.unknownTriangles;
  m.audits.unclassifiedPhysicalTriangles = c.audit.unknownTriangles;
  const used = new Set(m.meshes.flatMap(mesh => mesh.ranges.map(range => range.surfaceKey)));
  m.surfaces = m.surfaces.filter(s => !removed.has(s.key) || used.has(s.key));
  const mi = { ...m }; delete mi.manifestHash; m.manifestHash = hash(canonical(mi));
  const manifest = canonical(m), manifestHash = hash(manifest); c.manifestHash = manifestHash;
  const ci = { ...c }; delete ci.catalogHash; c.catalogHash = hash(canonical(ci));
  const catalog = canonical(c);
  diagnostics.quarantinedDeclarations = c.declarations.filter(d => d.resistancePolicy === "unsupported").length;
  diagnostics.status = "verified_source_armor_with_unresolved_surfaces_quarantined";
  return { ...packet, manifest, manifestHash, catalog, catalogHash:hash(catalog), variants:[], droppedVariants:(packet.variants || []).length, disabledVariantReason:"modified_catalog_has_no_trusted_barrel_variant_parent", sourceManifestHash:packet.manifestHash, sourceCatalogHash:packet.catalogHash, armorBindingReview:diagnostics, quarantinedSurfaces:diagnostics.quarantinedDeclarations };
}
