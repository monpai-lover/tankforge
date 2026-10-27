#!/usr/bin/env python3
"""Register the F-15 front MPDs on their actual imported panel triangles."""
import sys,json
from instrument_alignment import finish_instruments
from refresh_optics import unpack
from convert import write_data_line

def main(path):
    raw=open(path,'rb').read();begin=raw.index(b'"aircraftModels":')+len(b'"aircraftModels":')
    models=json.loads(raw[begin:raw.rindex(b'</script>')].rstrip()[:-1]);del raw
    model=models['f15c'];_,parts=unpack(model,model)
    finish_instruments(model['spec'],parts,'f15c')
    write_data_line(path,'f15c',model)
    print(json.dumps(model['spec']['instrumentScreens']))

if __name__=='__main__':main(sys.argv[1])
