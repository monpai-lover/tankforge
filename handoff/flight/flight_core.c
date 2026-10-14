/* AEROLAB — freestanding flight-test kernel. Original implementation, MIT.
 * Coordinates: right-handed, +X right, +Y up, +Z forward.
 * State is authoritative here; JS submits intent, not a new position.
 * This is an entertainment model, not validated aircraft engineering software.
 * TankForge variant: set_world(1) takes ground height and landable surface from the host
 * (import module "world"), spawn() places the aircraft anywhere; the dynamics are unchanged. */
#include <stdint.h>
#include <stddef.h>
void *memset(void *dst,int value,size_t n){volatile unsigned char *p=dst;for(size_t i=0;i<n;i++)p[i]=(unsigned char)value;return dst;}
#define PI 3.14159265358979323846f
#define G 9.80665f
#define EX __attribute__((visibility("default")))
__attribute__((import_module("math"),import_name("sin"))) extern float fsin(float);
__attribute__((import_module("math"),import_name("cos"))) extern float fcos(float);
__attribute__((import_module("math"),import_name("atan2"))) extern float fatan2(float,float);
__attribute__((import_module("math"),import_name("exp"))) extern float fexp(float);
__attribute__((import_module("math"),import_name("asin"))) extern float fasin(float);
__attribute__((import_module("math"),import_name("acos"))) extern float facos(float);
__attribute__((import_module("world"),import_name("ground"))) extern float world_ground(float,float);
__attribute__((import_module("world"),import_name("landable"))) extern int world_landable(float,float);
typedef struct {float x,y,z;} V;
typedef struct {float x,y,z,w;} Q;
static V v(float x,float y,float z){return (V){x,y,z};}
static V add(V a,V b){return v(a.x+b.x,a.y+b.y,a.z+b.z);}
static V sub(V a,V b){return v(a.x-b.x,a.y-b.y,a.z-b.z);}
static V mul(V a,float s){return v(a.x*s,a.y*s,a.z*s);}
static float dot(V a,V b){return a.x*b.x+a.y*b.y+a.z*b.z;}
static V cross(V a,V b){return v(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
static float len(V a){return __builtin_sqrtf(dot(a,a));}
static float absf(float a){return __builtin_fabsf(a);}
static float clamp(float a,float l,float h){return a<l?l:(a>h?h:a);}
static float maxf(float a,float b){return a>b?a:b;}
static float minf(float a,float b){return a<b?a:b;}
static float mix(float a,float b,float t){return a+(b-a)*t;}
static float smooth(float l,float h,float a){float t=clamp((a-l)/(h-l),0,1);return t*t*(3-2*t);}
static V norm(V a){return mul(a,1/maxf(len(a),0.00001f));}
static float sane(float a,float fallback){return __builtin_isfinite(a)?a:fallback;}
static float wrap(float a){while(a>PI)a-=2*PI;while(a< -PI)a+=2*PI;return a;}
static V rotate(Q q,V a){V t=mul(cross(v(q.x,q.y,q.z),a),2);return add(a,add(mul(t,q.w),cross(v(q.x,q.y,q.z),t)));}
static Q qmul(Q a,Q b){return (Q){a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z};}
static Q qnorm(Q q){float l=__builtin_sqrtf(q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w);return (Q){q.x/l,q.y/l,q.z/l,q.w/l};}
static V pos,vel,omega,wind;
static Q att;
static float t,engine,ctl_p,ctl_r,ctl_y,manual_hold,authority,stall,load,alpha,beta,speed,bank,pitch,heading,desired_bank,gear,flaps,thrust;
static float wind_strength=0,wind_direction=.8f,sensitivity=1,g_limit=6.5f;
static float out[80];
static int crashed,mode,protect=1,external_world=0;
#include "instructor_v2.h"
static float density(float h){return 1.225f*fexp(-maxf(h,0)/8500);}
/* Analytic island: shared through WASM with the rendered mesh and collisions. */
EX float terrain_height(float x,float z){
 float broad=fexp(-((x+1800)*(x+1800)/15000000+(z-2300)*(z-2300)/18000000));
 float far=fexp(-((x-4700)*(x-4700)/8500000+(z-6700)*(z-6700)/14000000));
 float ridge=(.54f+.22f*fsin(x*.00094f+z*.00046f)+.17f*fcos(z*.0014f-x*.0003f)+.07f*fsin(x*.0037f+z*.0021f));
 float h=-160+broad*(100+1050*ridge)+far*(450+380*ridge);
 h+=950*fexp(-((x+4100)*(x+4100)/2200000+(z-4200)*(z-4200)/4000000))*(.68f+.32f*absf(fsin(x*.0022f-z*.0016f)));
 h+=430*fexp(-((x+2200)*(x+2200)/2600000+(z-6900)*(z-6900)/2200000));
 float strip=(1-smooth(210,760,absf(x)))*(1-smooth(1300,2100,absf(z+1450)));
 h=mix(h,22,strip);
 return h;
}
static float ground_at(float x,float z){return external_world?sane(world_ground(x,z),0):maxf(0,terrain_height(x,z));}
static int landable_at(float x,float z){return external_world?world_landable(x,z)!=0:(absf(x)<28 && absf(z+1450)<1300);}
EX void set_world(int external){external_world=external!=0;}
static void telemetry(void){
 V r=rotate(att,v(1,0,0)),u=rotate(att,v(0,1,0)),f=rotate(att,v(0,0,1));
 bank=fatan2(-r.y,u.y);pitch=fasin(clamp(f.y,-1,1));heading=fatan2(f.x,f.z);
 V av=sub(vel,wind);speed=len(av);alpha=fatan2(-dot(av,u),maxf(.01f,dot(av,f)));beta=fasin(clamp(dot(norm(av),r),-1,1));
 out[0]=pos.x;out[1]=pos.y;out[2]=pos.z;out[3]=att.x;out[4]=att.y;out[5]=att.z;out[6]=att.w;
 out[7]=vel.x;out[8]=vel.y;out[9]=vel.z;out[10]=omega.x;out[11]=omega.y;out[12]=omega.z;
 out[13]=speed;out[14]=speed*__builtin_sqrtf(density(pos.y)/1.225f);out[15]=alpha;out[16]=beta;out[17]=load;
 out[18]=heading;out[19]=pitch;out[20]=bank;out[21]=stall;out[22]=(float)crashed;out[23]=t;
 out[24]=ctl_p;out[25]=ctl_r;out[26]=ctl_y;out[27]=engine;out[28]=authority;out[29]=desired_bank;
 out[30]=wind.x;out[31]=wind.y;out[32]=wind.z;out[33]=gear;out[34]=flaps;out[35]=pos.y-ground_at(pos.x,pos.z);
 out[36]=(float)mode;out[37]=thrust;out[38]=manual_hold;out[39]=protect;out[40]=g_limit;out[41]=wind_strength;
 out[51]=instructor.confidence;out[52]=instructor.q_schedule;out[53]=instructor.aoa_gate;
 out[54]=instructor.off;out[55]=instructor.aim_rate;out[56]=instructor.p_integral;out[57]=instructor.y_integral;
 out[58]=instructor.axis_auth[0];out[59]=instructor.axis_auth[1];out[60]=instructor.axis_auth[2];
 out[61]=control_profile;out[62]=instructor.g_gate;out[63]=instructor.commit;
 out[64]=instructor.cmd_pitch_rate;out[65]=instructor.cmd_roll_rate;out[66]=instructor.cmd_yaw_rate;
 out[67]=instructor.alpha_rate;out[68]=instructor.load_rate;out[69]=instructor.heading_rate;
 out[70]=handoff_mode;out[71]=release_delay;out[72]=return_rate;out[73]=instructor.roll_error;
 out[74]=.5f*density(pos.y)*speed*speed;out[75]=len(vel);out[76]=t;out[77]=out[78]=out[79]=0;
 out[42]=r.x;out[43]=r.y;out[44]=r.z;out[45]=u.x;out[46]=u.y;out[47]=u.z;out[48]=f.x;out[49]=f.y;out[50]=f.z;
}
EX int state_ptr(void){return (int)(uintptr_t)out;}
EX int state_len(void){return 80;}
EX int core_version(void){return 200;}
EX void configure(float wind_kts,float wind_deg,float response,float max_g,int protection){
 wind_strength=clamp(sane(wind_kts,0),0,45)*.514444f;wind_direction=sane(wind_deg,45)*PI/180;
 sensitivity=clamp(sane(response,1),.5f,1.6f);g_limit=clamp(sane(max_g,6.5f),2,9);protect=protection!=0;
}
EX void reset(int scenario){
 clear_instructor();t=0;engine=.72f;ctl_p=ctl_r=ctl_y=manual_hold=0;authority=1;load=1;stall=0;desired_bank=0;gear=flaps=0;crashed=0;mode=0;
 omega=v(0,0,0);wind=v(0,0,0);pos=v(0,720,-3650);vel=v(0,0,112);att=(Q){-.0105f,0,0,.999945f};
 if(scenario==1){pos=v(0,250,-4700);vel=v(0,-1,91);gear=1;engine=.48f;}
 if(scenario==2){pos=v(0,1650,-4300);vel=v(0,0,57);engine=.3f;att=(Q){-.115f,0,0,.99337f};}
 if(scenario==3){pos=v(0,3300,-6500);vel=v(0,-28,172);att=(Q){.035f,0,0,.99939f};engine=.9f;}
 if(scenario==4){pos=v(0,24.05f,-2400);vel=v(0,0,.1f);gear=1;flaps=.5f;engine=.05f;att=(Q){0,0,0,1};}
 att=qnorm(att);telemetry();
}
/* Parked (on_ground) or flying start anywhere in the host world, nose along heading (rad, 0 = +Z). */
EX void spawn(float x,float y,float z,float hdg,float airspeed,int on_ground){
 reset(0);float h=sane(hdg,0)*.5f;att=qnorm((Q){0,fsin(h),0,fcos(h)});pos=v(sane(x,0),sane(y,0),sane(z,0));
 V f=rotate(att,v(0,0,1));vel=mul(f,clamp(sane(airspeed,0),0,250));
 if(on_ground){pos.y=ground_at(pos.x,pos.z)+2.f;vel=mul(f,.1f);gear=1;flaps=.5f;engine=.05f;}
 telemetry();
}
/* flags: 1 instructor; 2 free-look; 4 gear; 8 flap; 16 airbrake; 32 level-hold.
 * Manual override is global, with a short blending handoff after release. */
EX void step(float dt,float ax,float ay,float az,float throttle,float manual_pitch,float manual_roll,float manual_yaw,int flags){
 dt=clamp(sane(dt,0),0,.025f);if(dt==0||crashed)return;
 throttle=clamp(sane(throttle,.7f),0,1.12f);manual_pitch=clamp(sane(manual_pitch,0),-1,1);manual_roll=clamp(sane(manual_roll,0),-1,1);manual_yaw=clamp(sane(manual_yaw,0),-1,1);
 V target=norm(v(sane(ax,0),sane(ay,0),sane(az,1)));if(len(target)<.5f)target=v(0,0,1);
 t+=dt;V r=rotate(att,v(1,0,0)),u=rotate(att,v(0,1,0)),f=rotate(att,v(0,0,1));
 float gust=wind_strength*(1+.13f*fsin(t*.71f)+.08f*fsin(t*2.19f));
 wind=v(fsin(wind_direction)*gust,.035f*wind_strength*fsin(t*.9f),fcos(wind_direction)*gust);
 V av=sub(vel,wind),vh=norm(av);speed=maxf(len(av),.5f);float vf=dot(av,f);
 alpha=fatan2(-dot(av,u),maxf(.01f,vf));beta=fasin(clamp(dot(vh,r),-.98f,.98f));
 float rho=density(pos.y),qbar=.5f*rho*speed*speed;
 bank=fatan2(-r.y,u.y);heading=fatan2(f.x,f.z);pitch=fasin(clamp(f.y,-1,1));
 int manual=absf(manual_pitch)+absf(manual_roll)+absf(manual_yaw)>.025f;
 if(!control_profile){
 if(manual)manual_hold=(flags&2)? .7f:.22f;else manual_hold=maxf(0,manual_hold-dt);
 float desired_authority=((flags&1)&&manual_hold==0)?1:0;
 authority+=(desired_authority-authority)*clamp(dt*(desired_authority>0?5:35),0,1);
 if(manual)authority=0;
 }
 float pCmd=0,rCmd=0,yCmd=0;
 if(flags&32){
   float required=3200*G/maxf(qbar*22,1000);float trim=clamp((required-.20f)/4.5f,-.10f,.17f);
   target=norm(v(target.x,trim-clamp(vel.y*.018f,-.15f,.15f),target.z));
 }
 if(control_profile){
  refined_instructor(dt,target,r,u,f,qbar,manual_pitch,manual_roll,manual_yaw,flags,&pCmd,&rCmd,&yCmd);
 }else {
 if((flags&1)&&authority>.001f){
   float ehead=wrap(fatan2(target.x,target.z)-heading);
   float erp=fatan2(dot(target,u),maxf(dot(target,f),.015f));
   float world_yaw=dot(rotate(att,omega),v(0,1,0));
   float want= fatan2((ehead-.72f*world_yaw)*speed*.72f,G);
   float max_bank=(speed<65?.82f:1.22f);want=clamp(want,-max_bank,max_bank);
   if(absf(target.y)>.83f)want=clamp(bank+fatan2(dot(target,r),maxf(dot(target,u),.06f)),-1.4f,1.4f);
   desired_bank+=clamp(want-desired_bank,-1.4f*dt,1.4f*dt);
   rCmd=clamp((wrap(desired_bank-bank)*2.4f+omega.z*.8f)*sensitivity,-1,1);
   float roll_alignment=clamp(1-absf(wrap(desired_bank-bank))/1.5f,.22f,1);
   float pd=clamp(erp*2.6f*sensitivity,-.24f,.7f)*roll_alignment;
   pCmd=(pd+omega.x)*2.15f + (alpha-.028f)*1.45f;
   float yawff=G/maxf(speed,45)*fsin(bank);
   yCmd=clamp((dot(target,r)*.8f+yawff-omega.y)*1.1f-beta*1.55f,-.45f,.45f);
   mode=absf(wrap(desired_bank-bank))>.24f?1:(absf(ehead)+absf(erp)>.07f?2:0);
 }else {desired_bank=bank;mode=3;}
 pCmd=mix(manual_pitch,pCmd,authority);rCmd=mix(manual_roll,rCmd,authority);yCmd=mix(manual_yaw,yCmd,authority);
 /* Envelope intervention uses measured AoA and normal aerodynamic load, not speed-clamping. */
 if(protect && (flags&1)){
   float predicted=alpha+maxf(0,-omega.x)*.22f;
   if(predicted>.20f && pCmd>0)pCmd*=clamp((.275f-predicted)/.075f,0,1);
   if(alpha>.285f)pCmd=minf(pCmd,-clamp((alpha-.285f)*5,0,.6f));
   if(load>g_limit && pCmd>0)pCmd*=clamp(1-(load-g_limit)*.7f,0,1);
 }
 } /* legacy controller */
 pCmd=clamp(pCmd,-1,1);rCmd=clamp(rCmd,-1,1);yCmd=clamp(yCmd,-1,1);
 ctl_p+=clamp(pCmd-ctl_p,-3.5f*dt,3.5f*dt);ctl_r+=clamp(rCmd-ctl_r,-4.0f*dt,4.0f*dt);ctl_y+=clamp(yCmd-ctl_y,-3*dt,3*dt);
 engine+=(throttle-engine)*clamp(dt*1.6f,0,1);gear+=clamp(((flags&4)?1.f:0.f)-gear,-.55f*dt,.55f*dt);flaps+=clamp(((flags&8)?1.f:0.f)-flaps,-.65f*dt,.65f*dt);
 float stallAngle=.28f+flaps*.025f;stall=smooth(stallAngle*.82f,stallAngle*1.45f,absf(alpha))*smooth(12,35,speed);
 float cl=.20f+4.5f*alpha+.36f*flaps;float post=1.05f*fsin(2*alpha);
 cl=mix(cl,post,smooth(stallAngle,stallAngle+.32f,absf(alpha)));cl=clamp(cl,-1.5f,1.7f);
 float cd=.026f+.065f*cl*cl+.030f*gear+.035f*flaps+((flags&16)? .095f:0)+.7f*stall*fsin(alpha)*fsin(alpha)+.16f*beta*beta;
 V lift_dir=norm(sub(u,mul(vh,dot(u,vh))));
 V lift=mul(lift_dir,qbar*22*cl),drag=mul(vh,-qbar*22*cd);
 V side=mul(r,-qbar*22*.62f*beta);
 thrust=engine*minf(15500,950000/maxf(speed+30,45));
 V aero=add(add(lift,drag),side);V force=add(add(aero,mul(f,thrust)),v(0,-3200*G,0));
 load=dot(aero,u)/(3200*G);
 float c=2.1f,b=11.f;float eff=maxf(qbar,40);float dampingV=maxf(speed,12);
 V moment=v(eff*22*c*(-.26f*ctl_p+.38f*(alpha-.028f)-6*c/(2*dampingV)*omega.x),
            eff*22*b*(.05f*ctl_y+.12f*beta-.50f*b/(2*dampingV)*omega.y),
            eff*22*b*(-.12f*ctl_r+.012f*beta-.25f*b/(2*dampingV)*omega.z));
 if(stall>.3f)moment.z+=fsin(t*5.3f)*stall*1100;
 V inertia=v(14000,21000,6500);V gyro=cross(omega,v(omega.x*inertia.x,omega.y*inertia.y,omega.z*inertia.z));
 V torque=sub(moment,gyro);
 omega=add(omega,mul(v(torque.x/inertia.x,torque.y/inertia.y,torque.z/inertia.z),dt));
 omega.x=clamp(omega.x,-2.8f,2.8f);omega.y=clamp(omega.y,-2.0f,2.0f);omega.z=clamp(omega.z,-4,4);
 Q dq=qmul(att,(Q){omega.x,omega.y,omega.z,0});
 att=qnorm((Q){att.x+dq.x*dt*.5f,att.y+dq.y*dt*.5f,att.z+dq.z*dt*.5f,att.w+dq.w*dt*.5f});
 vel=add(vel,mul(force,dt/3200));pos=add(pos,mul(vel,dt));
 float ground=ground_at(pos.x,pos.z);
 if(pos.y<ground+2.f){
   int runway=landable_at(pos.x,pos.z);
   if(gear>.9f && runway && absf(bank)<.23f && vel.y> -4.2f && absf(pitch)<.32f){
      pos.y=ground+2.f;if(vel.y<0)vel.y=0;
      if(external_world){
        /* Any heading: kill side slip across the wheels, steer with the rudder (tail wheel). */
        V fh=norm(v(f.x,0,f.z)),rh=v(fh.z,0,-fh.x);float side=dot(vel,rh),hz0=__builtin_sqrtf(vel.x*vel.x+vel.z*vel.z);
        vel=sub(vel,mul(rh,side*minf(1,dt*6.f)));
        omega.y+=(ctl_y*.55f*clamp(hz0/6.f,0,1)*(1-smooth(30,55,hz0))-omega.y)*clamp(dt*4,0,1);
      }else vel.x*=maxf(0,1-dt*2.0f);float brake=((flags&16)? .32f:.015f);float hz=__builtin_sqrtf(vel.x*vel.x+vel.z*vel.z);if(hz>.001f){float reduction=clamp(1-brake*G*dt/hz,0,1);vel.x*=reduction;vel.z*=reduction;}
      if(thrust>1000)omega.x*=.99f;
      if((external_world||pos.z< -2100) && speed<45 && !manual){att=qnorm((Q){0,att.y,0,att.w});omega.x=0;omega.z=0;}
      mode=4;
   }else {crashed=1;pos.y=ground+1.f;vel=v(0,0,0);omega=v(0,0,0);mode=5;}
 }
 if(!__builtin_isfinite(pos.x+pos.y+pos.z+att.w)){crashed=1;pos=v(0,900,-3600);vel=v(0,0,0);att=(Q){0,0,0,1};mode=5;}
 telemetry();
}
