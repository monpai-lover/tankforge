#!/usr/bin/env python3
"""Stage two source-reviewed exact-surface packets and preserve their rest engineering."""
import argparse
import base64
import hashlib
import json
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent / 'bundle/app.js.html'
PACKETS = HERE.parent / 'qa/foldable-surface-packets-20261026.json'
START = '  // BEGIN REVIEWED FOLDABLE SURFACE PACKETS\n'
END = '  // END REVIEWED FOLDABLE SURFACE PACKETS\n'
EXPECTED = {
    'de_flakpz38t': ('fa4e5b85ff9800962a06cda53013eaa1788912472d04205a73b5b3ad797b0695', '78331426af2fcd023c7983fa67f1c05609e6f7917367b0123213058047e255fd'),
    'de_rso_pak40': ('f24a5c04d02ded1a125b9efb43f50e34c9baf470b47fe5c6fa45676c4eae0ed4', '28231e5b0f2bec7a56849620049433048c4bc835d5c90592412013b3213c24dd'),
}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def validated_packets(file):
    packets = json.loads(file.read_text(encoding='utf8'))
    if set(packets) != set(EXPECTED):
        raise ValueError('Only the two reviewed folding stock specifications are admitted')
    for spec, packet in packets.items():
        manifest, catalog = packet['manifest'].encode(), packet['catalog'].encode()
        if (sha(manifest), sha(catalog)) != EXPECTED[spec] or (packet['manifestHash'], packet['catalogHash']) != EXPECTED[spec]:
            raise ValueError('Reviewed manifest/catalog bytes changed: ' + spec)
        m, c = json.loads(manifest), json.loads(catalog)
        if m['specId'] != spec or c['specId'] != spec or c['manifestHash'] != packet['manifestHash']:
            raise ValueError('Reviewed packet identity differs')
        for mesh in m['meshes']:
            payload = base64.b64decode(packet['payloads'][mesh['payloadHash']], validate=True)
            if sha(payload) != mesh['payloadHash'] or payload[:8] != b'THMESH1\0':
                raise ValueError('Triangle payload content identity differs')
            version, vertices, triangles, positions, indices, reserved = struct.unpack('<6I', payload[8:32])
            if version != 1 or vertices != mesh['vertexCount'] or triangles != mesh['triangleCount'] or vertices != triangles * 3 or positions != vertices * 12 or indices != vertices * 4 or reserved or len(payload) != 32 + positions + indices:
                raise ValueError('Triangle payload structural header differs')
        if len(packet.get('variants', [])) != 1:
            raise ValueError('Preserve the reviewed physical barrel fracture variant')
        for variant in packet['variants']:
            for field, expected in [('record', 'recordHash'), ('manifest', 'manifestHash'), ('catalog', 'catalogHash')]:
                if sha(variant[field].encode()) != variant[expected]:
                    raise ValueError('Barrel derivative source bytes changed')
            record = json.loads(variant['record'])
            if record['parentStockManifestHash'] != packet['manifestHash'] or record['parentStockCatalogHash'] != packet['catalogHash']:
                raise ValueError('Barrel derivative parent differs')
            for digest, value in variant['payloads'].items():
                if sha(base64.b64decode(value, validate=True)) != digest:
                    raise ValueError('Barrel collision payload differs')
            for digest, value in variant['rendererUploads'].items():
                if sha(base64.b64decode(value, validate=True)) != digest:
                    raise ValueError('Barrel rendered upload differs')
    return packets


def once(text, old, new):
    if text.count(new) == 1:
        return text
    if text.count(old) != 1:
        raise ValueError('Expected one actual source anchor: ' + old[:100])
    return text.replace(old, new, 1)


def apply_patch(text, packets):
    block = START + '  var TF_FOLDABLE_SURFACE_PACKETS = ' + json.dumps(packets, ensure_ascii=True, separators=(',', ':')) + ';\n' + '''  var TF_FOLDABLE_SURFACE_SOURCES = new WeakMap();
  function installReviewedFoldableSurfacePackets(data) {
    if (!data.surfaceCatalog || !data.vehicles) throw Error("reviewed surface catalog unavailable");
    for (const [spec, packet] of Object.entries(TF_FOLDABLE_SURFACE_PACKETS)) {
      const source = data.vehicles[spec], current = data.surfaceCatalog[spec];
      if (!source || source.vehicle?.id !== spec || current && (current.manifestHash !== packet.manifestHash || current.catalogHash !== packet.catalogHash))
        throw Error("reviewed folding source identity changed: " + spec);
      data.surfaceCatalog[spec] ||= packet;
      TF_FOLDABLE_SURFACE_SOURCES.set(source, spec);
    }
  }
''' + END
    if START in text:
        a = text.index(START); b = text.index(END, a) + len(END)
        text = text[:a] + block + text[b:]
    else:
        text = once(text, '  var LocalSurfaceCombat = class {', block + '  var LocalSurfaceCombat = class {')
    # Keep the combat-core composer's adjacent boot assignments intact.
    # Accept the earlier staged location when refreshing a reviewed candidate.
    old_boot = '    const data = JSON.parse(document.getElementById("tf-data").textContent);\n    installReviewedFoldableSurfacePackets(data);'
    if old_boot in text:
        text = text.replace(old_boot, old_boot.split('\n')[0], 1)
    text = once(text,
        '    if (data.surfaceCore) data.surfaceCore = TF_APHE_SURFACE_CORE;',
        '    if (data.surfaceCore) data.surfaceCore = TF_APHE_SURFACE_CORE;\n    installReviewedFoldableSurfacePackets(data);')
    text = once(text, '''    _definition(id2, bundle, fold) {
      const definition = targetDef(id2, bundle, fold, this._catalog());''', '''    _definition(id2, bundle, fold) {
      const exact = this.surfaceOwner?.actors.get(id2), spec = TF_FOLDABLE_SURFACE_SOURCES.get(bundle);
      const engineeringFold = spec && exact?.registered === true && exact.spec === spec ? 0 : fold;
      const definition = targetDef(id2, bundle, engineeringFold, this._catalog());''')
    text = once(text, '''      this.catalogStamps.set(id2, stamp);
      this.appliedFold.set(id2, fold);''', '''      this.catalogStamps.set(id2, stamp);
      const exactActor = this.surfaceOwner?.actors.get(id2), foldSourceSpec = TF_FOLDABLE_SURFACE_SOURCES.get(bundle);
      // Cache the engineering actually registered, so retirement cannot mistake
      // an open visual pose for already-applied legacy plate coordinates.
      this.appliedFold.set(id2, foldSourceSpec && exactActor?.registered === true && exactActor.spec === foldSourceSpec ? 0 : fold);''')
    old = '''    registerSurfaceActor(key4, spec, actor3, model, body) {
      return this.surfaceOwner?.register(key4, spec, actor3, model, body) || null;
    }'''
    new = '''    registerSurfaceActor(key4, spec, actor3, model, body) {
      const source = this.bundles.get(key4);
      if (TF_FOLDABLE_SURFACE_SOURCES.get(source) === spec && this.surfaceOwner?.supports(spec)) {
        // The packet binds immutable authored engineering. A saved visual fold
        // can exist before first registration; pose matrices own that motion.
        const definition = this._definition(key4, source, 0);
        this.coreOf(key4).combatTarget(definition);
        this.registrations.set(key4, structuredClone(definition));
        this.appliedFold.set(key4, 0);
      }
      return this.surfaceOwner?.register(key4, spec, actor3, model, body) || null;
    }'''
    text = once(text, old, new)
    old = '''      const bundle = this.bundles.get(id2);
      if (!bundle) return;
      const definition = this._definition(id2, bundle, fold);'''
    new = '''      const bundle = this.bundles.get(id2);
      if (!bundle) return;
      const exact = this.surfaceOwner?.actors.get(id2), spec = TF_FOLDABLE_SURFACE_SOURCES.get(bundle);
      // Keep appliedFold at the rest value. If this actor retires, the next
      // legacy query must reapply the actual fold rather than retain rest plates.
      if (spec && exact?.registered === true && exact.spec === spec) return;
      const definition = this._definition(id2, bundle, fold);'''
    return once(text, old, new)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, default=APP)
    p.add_argument('--packets', type=Path, default=PACKETS)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if a.output.resolve() in {APP.resolve(), a.input.resolve()}:
        p.error('ROOT owns the app; a separate candidate path is required')
    before = a.input.read_text(encoding='utf8'); packets = validated_packets(a.packets)
    after = apply_patch(before, packets)
    a.output.parent.mkdir(parents=True, exist_ok=True); a.output.write_bytes(after.encode())
    print(json.dumps({'inputSha256': sha(before.encode()), 'outputSha256': sha(after.encode()),
        'packetFileSha256': sha(a.packets.read_bytes()), 'specs': list(packets),
        'scope': 'source-reviewed local stock exact surfaces; rest engineering plus actual folding pose; no native authority migration'}))


if __name__ == '__main__':
    main()
