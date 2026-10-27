#!/usr/bin/env python3
"""Calibrate already-imported optics without resimplifying geometry or recompressing atlases."""
import sys,json,zlib,base64,gzip,subprocess
import numpy as np
import alignment
from convert import Part,write_data_line

def unpack(model,record):
    blob=bytearray(zlib.decompress(base64.b64decode(record['blob'])))
    parts=[]
    for p in record['parts']:
        P=np.frombuffer(blob,'<i2',p['vertices']*3,p['pos']).reshape(-1,3).astype(float)*model['posScale']
        I=np.frombuffer(blob,'<u2',p['triangles']*3,p['idx']).reshape(-1,3).copy()
        parts.append(Part(name=p['name'],group=p['group'],mover=p.get('mover'),P=P,I=I))
    return blob,parts

def repack(model,record,blob,parts):
    for p,q in zip(record['parts'],parts):
        positions=np.round(q.P/model['posScale'])
        assert np.abs(positions).max()<32767
        blob[p['pos']:p['pos']+p['vertices']*6]=positions.astype('<i2').tobytes()
    record['blob']=base64.b64encode(zlib.compress(blob,9)).decode()

def main(path, baseline=None):
    raw=open(path,'rb').read()
    begin=raw.index(b'"aircraftModels":')+len(b'"aircraftModels":')
    # aircraftModels is the final top-level payload member in this handoff format.
    end=raw.rindex(b'</script>');body=raw[begin:end].rstrip()
    assert body.endswith(b'}}')
    models=json.loads(body[:-1]);del raw,body
    if baseline:
        chunks=subprocess.check_output(['git','ls-tree','-r','--name-only',baseline,'handoff/bundle/']).decode().splitlines()
        packed=b''.join(subprocess.check_output(['git','show',f'{baseline}:{p}']) for p in chunks if '/data.line.gz.part' in p)
        original=gzip.decompress(packed);del packed
        i=original.index(b'"aircraftModels":')+len(b'"aircraftModels":')
        old=json.loads(original[i:original.rindex(b'</script>')].rstrip()[:-1]);del original
        for key in models:
            if key in ('f104g','mirage3e','mig17f'):continue  # Reconverted from GLB after this pass.
            screens=models[key]['spec'].get('instrumentScreens')
            models[key]=old[key]
            if screens:models[key]['spec']['instrumentScreens']=screens
    changed={}
    for key,model in models.items():
        spec=model['spec']
        if spec.get('opticsCalibration'):continue
        blob,parts=unpack(model,model)
        alignment.calibrate_optics(spec,parts,{},key)
        if not spec.get('opticsCalibration'):continue
        repack(model,model,blob,parts)
        calibration=spec['opticsCalibration']
        if model.get('cockpitHi'):
            hblob,hparts=unpack(model,model['cockpitHi'])
            alignment.shift_optical_assembly(hparts,calibration['sourceGlassBounds'],calibration['assemblyOffset'][1])
            alignment.shift_ufc(hparts,calibration.get('ufcOffset',0))
            repack(model,model['cockpitHi'],hblob,hparts)
        points=np.concatenate([p.P[np.unique(p.I)] for p in parts if p.group=='glass' and p.mover is None and (p.name.startswith('HUD_GLASS:') or alignment.SIGHT.search(p.name))])
        spec['sight']['points']=np.unique(np.round(points,5),axis=0).tolist()
        spec['sight']['eye']=spec['eye'][:]
        spec['alignmentVersion']=2
        changed[key]=model
        print(key,'eye',spec['eye'],'assembly lift',calibration['assemblyOffset'][1],flush=True)
    write_data_line(path,None,changed)

if __name__=='__main__':main(*sys.argv[1:])
