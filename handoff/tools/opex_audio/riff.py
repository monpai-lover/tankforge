import sys,struct
def walk(b,o,end,path,out):
    while o+8<=end:
        cid=b[o:o+4].decode('latin1'); sz=struct.unpack('<I',b[o+4:o+8])[0]
        if cid in ('RIFF','LIST'):
            typ=b[o+8:o+12].decode('latin1'); walk(b,o+12,o+8+sz,path+[cid+':'+typ],out)
        else: out.append(('/'.join(path+[cid]),o+8,sz))
        o+=8+sz+(sz&1)
    return out
if __name__=='__main__':
    b=open(sys.argv[1],'rb').read()
    for p,o,sz in walk(b,0,len(b),[],[]):
        if len(sys.argv)<3 or sys.argv[2] in p: print(p,o,sz)
