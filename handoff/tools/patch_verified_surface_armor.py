#!/usr/bin/env python3
"""Stage content-pinned authored armor associations; never modify ROOT's app in place."""
import argparse
import hashlib
import json
from pathlib import Path
HERE = Path(__file__).resolve().parent
APP = HERE.parent / 'bundle/app.js.html'
START = '  // BEGIN VERIFIED SOURCE SURFACE ARMOR\n'
END = '  // END VERIFIED SOURCE SURFACE ARMOR\n'
def apply(text, registry, helper):
    block = START + '  var VERIFIED_SURFACE_ARMOR_REGISTRY = ' + json.dumps(registry, ensure_ascii=True, separators=(',', ':')) + ';\n' + helper + '\n' + '''  var VERIFIED_NORMALIZED_PACKET_CACHE = new WeakMap();
  function normalizeSurfacePacket(packet) {
    if (!packet || typeof packet !== "object") return packet;
    const prior = VERIFIED_NORMALIZED_PACKET_CACHE.get(packet);
    if (prior && prior.manifest === packet.manifest && prior.catalog === packet.catalog && prior.variants === packet.variants) return prior.value;
    const value = normalizeVerifiedSurfacePacket(packet, VERIFIED_SURFACE_ARMOR_REGISTRY, sha256Text, canonicalJson);
    VERIFIED_NORMALIZED_PACKET_CACHE.set(packet, { manifest:packet.manifest, catalog:packet.catalog, variants:packet.variants, value });
    return value;
  }
''' + END
    if START in text:
        a=text.index(START); b=text.index(END,a)+len(END)
    else:
        a=text.index('  function declareUnauditedSurfaces('); b=text.index('  function nodesOf(',a)
    return text[:a]+block+text[b:]
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,default=APP);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.resolve() in {APP.resolve(),a.input.resolve()}:p.error('ROOT owns the app; use a separate candidate path')
    registry=json.loads((HERE.parent/'qa/verified-surface-armor-registry-20261026.json').read_text(encoding='utf8'))
    if registry['schema']!='VerifiedSourceSurfaceArmorRegistryV1' or len(registry['specs'])!=26:raise ValueError('reviewed registry schema/spec count differs')
    source=a.input.read_text(encoding='utf8');candidate=apply(source,registry,(HERE/'verified_surface_armor.js').read_text(encoding='utf8'))
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(candidate.encode())
    print(json.dumps({'inputSha256':hashlib.sha256(source.encode()).hexdigest(),'outputSha256':hashlib.sha256(candidate.encode()).hexdigest(),'scope':'candidate only;26 original pinned packets;verified authored refs and explicit unresolved quarantine'}))
if __name__=='__main__':main()
