#!/usr/bin/env python3
import sys,json,numpy as np
from refresh_optics import unpack
from muzzle_alignment import finish_muzzles,ANCHORS
from convert import write_data_line,to_game_points

def main(path):
    raw=open(path,'rb').read();i=raw.index(b'"aircraftModels":')+len(b'"aircraftModels":')
    models=json.loads(raw[i:raw.rindex(b'</script>')].rstrip()[:-1]);del raw
    changed={}
    for key in ANCHORS:
        model=models[key];_,parts=unpack(model,model)
        finish_muzzles(model['spec'],parts,{'cg':np.array(model['cg_in_model']),'to_game_points':to_game_points},key)
        print(key,model['spec']['muzzles'],flush=True);changed[key]=model
    write_data_line(path,None,changed)

if __name__=='__main__':main(sys.argv[1])
