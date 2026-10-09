import json,struct,numpy as np
def load(path):
    b=open(path,'rb').read()
    L=struct.unpack('<I',b[12:16])[0]
    j=json.loads(b[20:20+L])
    B=b[20+L+8:]
    def acc(i):
        a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
        ct={5126:np.float32,5123:np.uint16,5121:np.uint8,5125:np.uint32}[a['componentType']]
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        off=bv.get('byteOffset',0)+a.get('byteOffset',0)
        arr=np.frombuffer(B,dtype=ct,count=a['count']*n,offset=off).astype(np.float64 if ct==np.float32 else np.int64)
        return arr.reshape(a['count'],n) if n>1 else arr
    return j,acc
