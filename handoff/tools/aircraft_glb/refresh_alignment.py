#!/usr/bin/env python3
"""Refresh measured attachment/optical metadata without changing a model's geometry or textures.

Usage: python3 refresh_alignment.py DATA_LINE F86_GLB
Useful after changing alignment.py: source geometry is decoded losslessly from the existing records.
"""
import base64
import json
import os
import sys
import zlib

import numpy as np

import alignment
from convert import Part, to_game_points
from gltf import Gltf


def main(path, f86_path):
    text = open(path, encoding='utf8').read()
    start, end = text.index('>')+1, text.rindex('</script>')
    data = json.loads(text[start:end])
    for key, model in data['aircraftModels'].items():
        blob = zlib.decompress(base64.b64decode(model['blob']))
        parts = []
        for p in model['parts']:
            P = np.frombuffer(blob, '<i2', p['vertices']*3, p['pos']).reshape(-1,3).astype(float)*model['posScale']
            I = np.frombuffer(blob, '<u2', p['triangles']*3, p['idx']).reshape(-1,3)
            parts.append(Part(name=p['name'],group=p['group'],mover=p.get('mover'),P=P,I=I))
        spec = model['spec']
        # Only the MiG-29 has an explicit centre tank socket from its source package.
        keep = {'center':spec['stations']['center']} if key=='mig29' else {}
        spec['stations'] = keep
        ctx = {'cg':np.array(model['cg_in_model']), 'to_game_points':to_game_points,
               'sources':{'main':Gltf(f86_path)} if key=='f86f' else {}}
        alignment.finish(spec, parts, ctx, key)
        print(key, 'eye', spec['eye'], 'centre station',spec['stations'].get('center'))
    output = text[:start]+json.dumps(data,ensure_ascii=False,separators=(',',':'))+text[end:]
    tmp = path+'.alignment.tmp'
    with open(tmp,'w',encoding='utf8') as f:
        f.write(output)
    os.replace(tmp,path)


if __name__=='__main__':
    main(*sys.argv[1:])
