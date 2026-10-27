// Copyright (c) 2026 Replay Lab Contributors (MIT).
// Verbatim V3 gl.js trace/shard/field shaders; complete supplied notice is retained.
export const TRACEVS=`#version 300 es
precision highp float;layout(location=2) in vec3 aStart;layout(location=3) in vec3 aEnd;layout(location=4) in vec4 aColor;layout(location=5) in vec2 aParams;
uniform mat4 uVP;uniform vec2 uRes;uniform float uGlow;out vec4 color;out vec2 ribbon;
void main(){vec4 a=uVP*vec4(aStart,1),b=uVP*vec4(aEnd,1);vec2 A=a.xy/max(a.w,.001),B=b.xy/max(b.w,.001);vec2 dir=(B-A)*uRes;float l=length(dir);vec2 side=l>.0001?vec2(-dir.y,dir.x)/l:vec2(1,0);float t=float(gl_VertexID/2),signSide=float(gl_VertexID%2)*2.-1.;vec4 p=mix(a,b,t);float width=aParams.x*(uGlow>.5?2.5:1.);p.xy+=side*signSide*width/uRes*p.w;gl_Position=p;if(aParams.y==5.||a.w<.01||b.w<.01)gl_Position=vec4(2.,2.,2.,1.);color=aColor;color.a*=uGlow>.5?.015:.84;ribbon=vec2(signSide,t);}`;
export const TRACEFS=`#version 300 es
precision highp float;in vec4 color;in vec2 ribbon;out vec4 c;void main(){float a=(1.-smoothstep(.30,1.,abs(ribbon.x)))*mix(.24,1.,ribbon.y);c=vec4(color.rgb,color.a*a);}`;
// Recorded detonations use a bounded world-space billboard. The expansion and
// cooling are presentation only; position and start time come from the report.
export const BURSTVS=`#version 300 es
precision highp float;layout(location=2) in vec3 aStart;layout(location=3) in vec3 aEnd;layout(location=4) in vec4 aColor;layout(location=5) in vec2 aParams;
uniform mat4 uVP;out vec2 local;out vec4 color;out float age;
void main(){local=vec2(float(gl_VertexID%2)*2.-1.,float(gl_VertexID/2)*2.-1.);vec4 p=uVP*vec4(aStart,1.);vec2 scale=vec2(length(vec3(uVP[0][0],uVP[1][0],uVP[2][0])),length(vec3(uVP[0][1],uVP[1][1],uVP[2][1])));p.xy+=local*scale*aEnd.x;gl_Position=p;if(aParams.y!=5.||p.w<.01)gl_Position=vec4(2.,2.,2.,1.);color=aColor;age=aEnd.y;}`;
export const BURSTFS=`#version 300 es
precision highp float;in vec2 local;in vec4 color;in float age;out vec4 c;
void main(){float r=length(local);if(r>1.)discard;float wave=.91+.09*sin(atan(local.y,local.x)*9.+age*31.)*sin(r*17.-age*23.);float edge=1.-smoothstep(.45,1.,r/wave);vec3 hot=mix(vec3(1.,.20,.025),vec3(1.,.94,.63),1.-smoothstep(.03,.65,r));float cool=smoothstep(.10,.42,age);c=vec4(mix(hot,vec3(.19,.12,.065),cool)*color.rgb,color.a*edge*(1.-cool*.45));}`;
export const SHARDVS=`#version 300 es
precision highp float;layout(location=0) in vec3 aPosition;layout(location=1) in vec3 aNormal;layout(location=2) in vec3 aStart;layout(location=3) in vec3 aEnd;layout(location=4) in vec4 aColor;layout(location=5) in vec2 aParams;uniform mat4 uVP;uniform float uTime;out vec4 color;out float light;
void main(){float k=float(gl_InstanceID),a=k*2.399+uTime*5.,b=k*1.731;mat3 r=mat3(cos(a),0,-sin(a),sin(a)*sin(b),cos(b),cos(a)*sin(b),sin(a)*cos(b),-sin(b),cos(a)*cos(b));float size=.004+fract(k*.371)*.006;gl_Position=uVP*vec4(aEnd+r*aPosition*size,1.);color=aColor;light=.4+.6*abs(dot(r*aNormal,normalize(vec3(-.6,1,.5))));}`;
export const SHARDFS=`#version 300 es
precision highp float;in vec4 color;in float light;out vec4 c;void main(){c=vec4(color.rgb*(.72+.28*light),color.a);}`;
export const FIELDVS=`#version 300 es
precision highp float;layout(location=2) in vec3 aStart;layout(location=3) in vec3 aEnd;layout(location=4) in vec4 aColor;layout(location=5) in vec2 aParams;
uniform mat4 uVP;uniform float uPixel;out vec4 col;
vec3 ramp(float t){return clamp(vec3(1.5-abs(4.*t-3.),1.5-abs(4.*t-2.),1.5-abs(4.*t-1.)),0.,1.);}
void main(){float j=float(gl_VertexID),id=float(gl_InstanceID);float t=(j+.35)/18.;float q=fract(sin(id*17.1+j*2.14)*43758.54);vec3 d=aEnd-aStart;
 vec3 p=mix(aStart,aEnd,t);p+=vec3(sin(id*9.+j),cos(id*6.-j*2.),sin(id*2.+j*3.))*.011*q;
 gl_Position=uVP*vec4(p,1.);gl_PointSize=uPixel*(.8+q*.65);
 col=vec4(ramp(.22+t*.78)*.86,aColor.a*(.54+t*.35));if(aParams.y!=4.)gl_Position=vec4(2,2,2,1);
}`;
export const FIELDFS=`#version 300 es
precision highp float;in vec4 col;out vec4 c;void main(){vec2 q=gl_PointCoord-.5;if(dot(q,q)>.25)discard;c=col;}`;
