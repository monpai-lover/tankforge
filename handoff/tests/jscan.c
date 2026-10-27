// Print JSON keys up to given depth with byte offsets and sizes.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc,char**argv){
  FILE*f=fopen(argv[1],"rb"); int maxd=atoi(argv[2]); long skip=argc>3?atol(argv[3]):0;
  fseek(f,0,SEEK_END); long n=ftell(f); fseek(f,0,SEEK_SET);
  char*b=malloc(n); fread(b,1,n,f);
  long i=skip; int d=0; long start[64]; char key[64][128]; int inobj[64];
  char lastkey[128]=""; int expectKey=0;
  while(i<n){ char c=b[i];
    if(c=='"'){ long j=i+1; while(b[j]!='"'){ if(b[j]=='\\') j++; j++; }
      // key if followed by ':'
      long k=j+1; while(b[k]==' ')k++;
      if(b[k]==':'){ int L=j-i-1; if(L>127)L=127; memcpy(lastkey,b+i+1,L); lastkey[L]=0; }
      i=j+1; continue; }
    if(c=='{'||c=='['){ start[d]=i; strcpy(key[d],lastkey); d++; lastkey[0]=0; }
    else if(c=='}'||c==']'){ d--; if(d>=1 && d<=maxd) printf("%*s%s %c %ld..%ld (%ld)\n",(d-1)*2,"",key[d],b[start[d]],start[d],i,i-start[d]+1); }
    else if(c==','){ lastkey[0]=0; }
    else if(c=='<' && d==0){ }
    i++; }
  return 0; }
