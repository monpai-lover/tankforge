#!/usr/bin/env python3
"""Add shared shell-fitted fallback engines to either C213 or Rust301 app JS.
Only the fallback engine/duct construction changes. Authored internals and
all airframe/flight/damage records stay byte-identical.
"""
from pathlib import Path
import argparse, hashlib, json
ROOT=Path(__file__).resolve().parent
HELPER=(ROOT/'engine-layout-helper.js').read_text()
def patch_app(source:str)->str:
    marker='  var aircraftGeometry = (() => {'
    if 'var TFEngineLayout = (()=>' not in source:
        assert source.count(marker)==1,'aircraft geometry hook is ambiguous'
        source=source.replace(marker,HELPER+'\n'+marker,1)
    start=source.index('    build.rebuiltExtras = function rebuiltExtras(spec, rec, T) {')
    end=source.index('    build.imported = function importedGeometry(',start)
    scope=source[start:end]
    old='      const jet = spec.jet || {};\n      if (eng) {'
    new='''      const jet = spec.jet || {};
      // Fitted only for known static-body signatures without authored internals.
      const fittedEngine = TFEngineLayout.build(T.id,T.model || AIRCRAFT_MODELS[T.id],{palette:"gray"});
      if (eng && !fittedEngine) {'''
    assert scope.count(old)==1,'fallback engine hook changed'
    scope=scope.replace(old,new,1)
    old='      out.internal = b.finish();'
    new='''      const baseInternal=b.finish();
      if (fittedEngine) {
        const count=fittedEngine.modules.reduce((n,m)=>n+m.data.length,baseInternal.length);
        out.internal=new Float32Array(count);out.internal.set(baseInternal);
        let offset=baseInternal.length;for(const m of fittedEngine.modules){out.internal.set(m.data,offset);offset+=m.data.length;}
      } else out.internal=baseInternal;'''
    assert scope.count(old)==1,'internal merge hook changed'
    scope=scope.replace(old,new,1)
    source=source[:start]+scope+source[end:]
    # Legacy O view also draws a solid damage proxy over its rebuilt internals.
    # Hide only the known fitted engine proxies from display. Damage records,
    # collision queries and every other internal proxy keep their original path.
    old='      for (const n of this.partNodes) n.visible = this.xray && !n.part.detached && !this.hitbox?.surface.has(n.part.id);'
    if old in source:
        assert source.count(old)==1,'legacy internal proxy hook is ambiguous'
        source=source.replace(old,'''      const fittedEngineLayout = TFEngineLayout.describe(this.type.id, this.type.model);
      for (const n of this.partNodes) n.visible = this.xray && !n.part.detached && !this.hitbox?.surface.has(n.part.id) && !(fittedEngineLayout && /^engine(?:_[lr])?$/.test(n.part.id));''',1)
    else:
        assert source.count('      for (const n of this.partNodes) n.visible = !this.detailedInterior && this.xray && !n.part.detached && !this.hitbox?.surface.has(n.part.id);')==1,'unknown internal proxy path'
    return source
def patch_interior(source:str)->str:
    old='export function buildAircraftInterior(plane,{Node,preserveCockpit=true}={}){'
    new='export function buildAircraftInterior(plane,{Node,preserveCockpit=true,engineLayout=null}={}){'
    assert source.count(old)==1,'detailed interior signature changed'
    source=source.replace(old,new,1)
    old="  if(jet){\n    const pods=sp?.jet?.pods;"
    new='''  const fittedEngine=engineLayout?.build(type.id,type.model,{palette:'green'});
  if(fittedEngine){
    // Two render engines may share the existing single engine HP record.
    // Geometry repair never creates or renames accepted damage parts.
    for(const m of fittedEngine.modules){
      const sideId=`engine_${m.side<0?'l':'r'}`;
      const id=m.side&&byId.has(sideId)?sideId:'engine';
      uploadPart(id,m.instanceId,'engine',def(id)?.parent||null,m.data);
    }
  }else if(jet){
    const pods=sp?.jet?.pods;'''
    assert source.count(old)==1,'detailed engine branch changed'
    return source.replace(old,new,1)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('output',type=Path);parser.add_argument('--interior',action='store_true');a=parser.parse_args()
    s=a.source.read_text();out=patch_interior(s) if a.interior else patch_app(s);a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(out)
    print(json.dumps({'source':str(a.source),'output':str(a.output),'source_sha256':hashlib.sha256(s.encode()).hexdigest(),'output_sha256':hashlib.sha256(out.encode()).hexdigest(),'bytes':len(out.encode())}))
