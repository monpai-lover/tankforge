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
/* Airframe (configure_airframe; defaults: the NF-01). mass kg, wing area m2, chord / span m, pitch / yaw /
 * roll inertia kg m2, zero-lift drag, induced-drag factor, lift slope /rad, stall AoA rad, engine kind
 * (0 propeller: thrust falls with speed, max 15.5 kN; 1 turbojet: thrust_max N rising slightly with Mach,
 * throttle above 1 = afterburner up to ab_gain more), transonic drag rise from Mach 0.88. */
static float af_m=3200,af_s=22,af_c=2.1f,af_b=11,af_ix=14000,af_iy=21000,af_iz=6500,af_cd0=.026f,af_k=.065f,af_cla=4.5f,af_stall=.28f,af_tmax=15500,af_ab=0;
static int af_jet=0;
/* Battle damage from the host (set_damage): engine thrust, lift of each wing, control authority. */
static float dmg_thrust=1,dmg_lift_l=1,dmg_lift_r=1,dmg_pitch=1,dmg_roll=1,dmg_yaw=1;
static float wind_strength=0,wind_direction=.8f,sensitivity=1,g_limit=6.5f;
static float out[80];
static int crashed,mode,protect=1,external_world=0,gear_failed=0;
static float since_ground=9,ground_steer=0;
#include "aerodynamics.h"
#include "instructor_v2.h"
#include "gear_sequence.h"
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
 out[74]=.5f*density(pos.y)*speed*speed;out[75]=len(vel);out[76]=t;
 out[77]=instructor.aoa_gate_down;out[78]=instructor.g_gate_down;out[79]=g_limit_down;
 out[42]=r.x;out[43]=r.y;out[44]=r.z;out[45]=u.x;out[46]=u.y;out[47]=u.z;out[48]=f.x;out[49]=f.y;out[50]=f.z;
 gear_sequence_publish();
}
EX int state_ptr(void){return (int)(uintptr_t)out;}
EX int state_len(void){return 80;}
EX int core_version(void){return 215;}
EX void configure_airframe(float mass,float area,float chord,float span,float ix,float iy,float iz,float cd0,float k,float cla,float stall_aoa,int jet,float thrust_max,float ab_gain){
 af_m=clamp(sane(mass,3200),300,60000);af_s=clamp(sane(area,22),4,200);af_c=clamp(sane(chord,2.1f),.5f,12);af_b=clamp(sane(span,11),2,60);
 af_ix=clamp(sane(ix,14000),500,5e6f);af_iy=clamp(sane(iy,21000),500,5e6f);af_iz=clamp(sane(iz,6500),200,5e6f);
 af_cd0=clamp(sane(cd0,.026f),.005f,.2f);af_k=clamp(sane(k,.065f),.01f,.5f);af_cla=clamp(sane(cla,4.5f),1,8);af_stall=clamp(sane(stall_aoa,.28f),.12f,.6f);
 af_jet=jet!=0;af_tmax=clamp(sane(thrust_max,15500),500,4e5f);af_ab=clamp(sane(ab_gain,0),0,2);
 aero_defaults();
 gear_sequence_airframe_reset();
}
/* Host impulses (gun recoil, a store's release): a velocity change in the world frame (m/s) and an
 * angular-rate change in the body frame (rad/s; +x noses down, +y yaws right, +z raises the right wing). Bounded per call. */
EX void impulse(float dvx,float dvy,float dvz,float dwx,float dwy,float dwz){
 if(crashed)return;
 vel=add(vel,v(clamp(sane(dvx,0),-5,5),clamp(sane(dvy,0),-5,5),clamp(sane(dvz,0),-5,5)));
 omega=add(omega,v(clamp(sane(dwx,0),-.5f,.5f),clamp(sane(dwy,0),-.5f,.5f),clamp(sane(dwz,0),-.5f,.5f)));
 telemetry();
}
/* 1 = intact. A torn-off wing (0) rolls the aircraft toward it past what the ailerons hold; pitch 0 is the
 * tail gone: no pitch or yaw stability left, and the nose tucks under. */
EX void set_damage(float thrust_k,float lift_l,float lift_r,float pitch_k,float roll_k,float yaw_k){
 dmg_thrust=clamp(sane(thrust_k,1),0,1);dmg_lift_l=clamp(sane(lift_l,1),0,1);dmg_lift_r=clamp(sane(lift_r,1),0,1);
 dmg_pitch=clamp(sane(pitch_k,1),0,1);dmg_roll=clamp(sane(roll_k,1),0,1);dmg_yaw=clamp(sane(yaw_k,1),0,1);
}
/* Gear torn off by accepted wind-load damage: immediately remove wheel support
 * and all four mechanism axes. Mass/store reconfiguration never repairs it. */
EX void set_gear_failure(int failed){
 gear_failed=failed!=0;
 if(gear_failed){gear=0;gear_sequence_reset(0);}
 telemetry();
}
EX void configure(float wind_kts,float wind_deg,float response,float max_g,int protection){
 wind_strength=clamp(sane(wind_kts,0),0,45)*.514444f;wind_direction=sane(wind_deg,45)*PI/180;
 sensitivity=clamp(sane(response,1),.5f,1.6f);g_limit=clamp(sane(max_g,6.5f),2,9);protect=protection!=0;
}
EX void reset(int scenario){
 gear_failed=0;
 if(ag.tip<=0)aero_defaults();
 for(int k=0;k<48;k++)aero_out[k]=0;
 aero_brake=0;
 clear_instructor();t=0;engine=.72f;ctl_p=ctl_r=ctl_y=manual_hold=0;authority=1;load=1;stall=0;desired_bank=0;gear=flaps=0;crashed=0;mode=0;
 dmg_thrust=dmg_lift_l=dmg_lift_r=dmg_pitch=dmg_roll=dmg_yaw=1;
 omega=v(0,0,0);wind=v(0,0,0);pos=v(0,720,-3650);vel=v(0,0,112);att=(Q){-.0105f,0,0,.999945f};
 if(scenario==1){pos=v(0,250,-4700);vel=v(0,-1,91);gear=1;engine=.48f;}
 if(scenario==2){pos=v(0,1650,-4300);vel=v(0,0,57);engine=.3f;att=(Q){-.115f,0,0,.99337f};}
 if(scenario==3){pos=v(0,3300,-6500);vel=v(0,-28,172);att=(Q){.035f,0,0,.99939f};engine=.9f;}
 if(scenario==4){pos=v(0,24.05f,-2400);vel=v(0,0,.1f);gear=1;flaps=.5f;engine=.05f;att=(Q){0,0,0,1};}
 gear_sequence_reset(gear);att=qnorm(att);telemetry();
}
/* Parked (on_ground) or flying start anywhere in the host world, nose along heading (rad, 0 = +Z). */
EX void spawn(float x,float y,float z,float hdg,float airspeed,int on_ground){
 reset(0);float h=sane(hdg,0)*.5f;att=qnorm((Q){0,fsin(h),0,fcos(h)});pos=v(sane(x,0),sane(y,0),sane(z,0));
 V f=rotate(att,v(0,0,1));vel=mul(f,clamp(sane(airspeed,0),0,250));
 if(on_ground){pos.y=ground_at(pos.x,pos.z)+2.f;vel=mul(f,.1f);gear=1;flaps=.5f;engine=.05f;mode=4;since_ground=0;}else since_ground=9;
 gear_sequence_reset(gear);
 telemetry();
}
/* Scoped movement adoption, never a raw-memory restore. The host validates
 * actor/life/epoch and plausible motion. Fuel, weapons, damage, engine, controls,
 * mechanism axes and the native clock remain owned by their existing lifecycles. */
EX int adopt_kinematics(float x,float y,float z,float qx,float qy,float qz,float qw,
 float vx,float vy,float vz,float wx,float wy,float wz){
 float values[13]={x,y,z,qx,qy,qz,qw,vx,vy,vz,wx,wy,wz};
 for(int k=0;k<13;k++)if(!__builtin_isfinite(values[k]))return 0;
 float q2=qx*qx+qy*qy+qz*qz+qw*qw;
 if(crashed || absf(x)>1e7f || absf(y)>1e7f || absf(z)>1e7f || q2<.98f || q2>1.02f ||
    vx*vx+vy*vy+vz*vz>1800.f*1800.f || absf(wx)>2.8001f || absf(wy)>2.0001f || absf(wz)>4.0001f)return 0;
 float ground=ground_at(x,z);if(y<ground+1.9f)return 0;
 pos=v(x,y,z);att=qnorm((Q){qx,qy,qz,qw});vel=v(vx,vy,vz);omega=v(wx,wy,wz);
 int wheels=y<=ground+2.05f && gear>.9f && gear_sequence_locked() && landable_at(x,z);
 since_ground=wheels?0.f:.31f;mode=wheels?4:3;
 telemetry();return 1;
}
/* Accepted controller handoff initialization only. Not a running-state or
 * resource import; damage and an irreversible failed gear cannot be repaired. */
EX int seed_control_state(float eng,float p,float r,float y,float gear_value,float flap_value,float brake,
 float main,float doors,float nose,float nose_door){
 float values[11]={eng,p,r,y,gear_value,flap_value,brake,main,doors,nose,nose_door};
 if(crashed || t>.00001f)return 0;
 for(int k=0;k<11;k++)if(!__builtin_isfinite(values[k]))return 0;
 if(eng<0 || eng>1.12f || absf(p)>1 || absf(r)>1 || absf(y)>1)return 0;
 for(int k=4;k<11;k++)if(values[k]<0 || values[k]>1)return 0;
 if(gs.mode && absf(gear_value-(main+nose)*.5f)>.01f)return 0;
 if(gear_failed && (gear_value>.0001f || main>.0001f || nose>.0001f))return 0;
 engine=eng;ctl_p=p;ctl_r=r;ctl_y=y;gear=gear_value;flaps=flap_value;aero_brake=brake;
 if(gs.mode){gs.main=main;gs.main_doors=doors;gs.nose=nose;gs.nose_door=nose_door;gs.resume_pending=0;}
 aero_out[8]=ctl_r*ag.roll;aero_out[9]=ctl_p*(ctl_p>=0?ag.pu:ag.pd);
 aero_out[10]=ctl_y*ag.yaw;aero_out[11]=flaps*ag.flap;aero_out[23]=aero_brake;
 telemetry();return 1;
}
/* flags: 1 instructor; 2 free-look; 4 gear; 8 legacy full flap; 16 airbrake;
 * 32 level-hold; 64 combat flap (0.25); 128 takeoff flap (0.5).
 * Flap priority: takeoff, combat, legacy full, then retracted.
 * Manual override is global, with a short blending handoff after release. */
EX void step(float dt,float ax,float ay,float az,float throttle,float manual_pitch,float manual_roll,float manual_yaw,int flags){
 dt=clamp(sane(dt,0),0,.025f);if(dt==0||crashed)return;
 if(gear_failed){flags&=~4;gear=0;gear_sequence_reset(0);}
 /* on the wheels: a ground contact within the last 0.3 s (a bump on rough ground does not count as flying) */
 since_ground+=dt;int was_ground=since_ground<.3f;
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
   float required=af_m*G/maxf(qbar*af_s,1000);float trim=clamp((required-.20f)/af_cla,-.10f,.17f);
   target=norm(v(target.x,trim-clamp(vel.y*.018f,-.15f,.15f),target.z));
 }
 update_envelope(dt,qbar,flags);
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
 } /* legacy controller */
 /* On the wheels the instructor steers with the rudder (and nose / tail wheel) only: the ailerons stay
    the pilot's keys, the elevator too until near flying speed (the speed at which 10 deg of incidence
    lifts the weight, less 10%), from which the instructor may rotate for the take-off. */
 /* diagnostic: apply protection after wheel intent selection */
 /* the steering on the wheels: the yaw keys, the roll keys too below the rotation speed (they do not
    roll a taxiing aircraft), or the instructor's rudder at its full range */
 ground_steer=0;
 if(was_ground){
   float rot=__builtin_sqrtf(2*af_m*G/(1.225f*af_s*maxf(.2f+af_cla*.15f+.36f*flaps,.3f)))*.9f;
   int taxi=speed<rot;
   /* Moving the stick still moves the ailerons on the wheels. Steering is a separate wheel action;
      aerodynamic force continues to depend on local airflow and the gear damps the body's roll. */
   rCmd=manual_roll;
   if(taxi){
     if((flags&1) && absf(manual_pitch)<=.025f){
       /* Diagnostic wheel-phase attitude servo: hold the existing level rest
          attitude through physical elevator trim, independent of taxi yaw. */
       float pr=clamp(-pitch*2.8f*sensitivity*clamp(qbar/6200.f,.30f,1),-.30f,.7f);
       float pc=aero_pc(pr),dp=aero_pitch_damping/maxf(speed,12);
       float ap=maxf(qbar,40)*af_s*af_c*pc/af_ix;
       pCmd=aero_pitch_bias(alpha)/pc+(dp/pc)*pr+(pr+omega.x)/maxf(ap*.22f,.3f);
     }else pCmd=manual_pitch;
   }
   ground_steer=manual?clamp(manual_yaw+(taxi?manual_roll:0),-1,1):clamp(yCmd/.45f,-1,1);
 }
 pCmd=protect_pitch(pCmd,flags);
 pCmd=clamp(pCmd,-1,1);rCmd=clamp(rCmd,-1,1);yCmd=clamp(yCmd,-1,1);
 ctl_p+=clamp(pCmd-ctl_p,-3.5f*dt,3.5f*dt);ctl_r+=clamp(rCmd-ctl_r,-4.0f*dt,4.0f*dt);ctl_y+=clamp(yCmd-ctl_y,-3*dt,3*dt);
 float flap_target=(flags&128)?.5f:(flags&64)?.25f:(flags&8)?1.f:0.f;
 engine+=(throttle-engine)*clamp(dt*1.6f,0,1);
 if(gs.mode)gear_sequence_step(dt,(flags&4)!=0);
 else {gs.resume_pending=0;gear+=clamp(((flags&4)?1.f:0.f)-gear,-.55f*dt,.55f*dt);}
 flaps+=clamp(flap_target-flaps,-.65f*dt,.65f*dt);
 aero_brake+=clamp(((flags&16)?1.f:0.f)-aero_brake,-dt,dt);
 V body_flow=v(dot(av,r),dot(av,u),dot(av,f)),body_force,moment;
 aero_forces(body_flow,rho,&body_force,&moment);
 stall=maxf(aero_out[2],aero_out[3])*smooth(12,35,speed);
 float mach=speed/340.f;
 /* wave drag: rising through the transonic to a peak near Mach 1.1, easing off supersonic (a third less by Mach 2) */
 float cd=af_cd0+.028f*smooth(.88f,1.05f,mach)*(1-.35f*smooth(1.2f,2.f,mach))+.030f*gear+.035f*flaps+.095f*aero_brake+.7f*stall*fsin(alpha)*fsin(alpha)+.16f*beta*beta+.045f*(2-dmg_lift_l-dmg_lift_r);
 body_force=add(body_force,mul(norm(body_flow),-qbar*af_s*cd));
 thrust=(af_jet?af_tmax*minf(engine,1)*(1+.18f*minf(mach,1.2f))*(1+af_ab*clamp((engine-1)/.12f,0,1)):engine*minf(af_tmax,950000*af_tmax/15500/maxf(speed+30,45)))*dmg_thrust;
 V aero=rotate(att,body_force);V force=add(add(aero,mul(f,thrust)),v(0,-af_m*G,0));
 load=body_force.y/(af_m*G);
 aero_out[16]=body_force.x;aero_out[17]=body_force.y;aero_out[18]=body_force.z;
 aero_out[19]=moment.x;aero_out[20]=moment.y;aero_out[21]=moment.z;
 V inertia=v(af_ix,af_iy,af_iz);V gyro=cross(omega,v(omega.x*inertia.x,omega.y*inertia.y,omega.z*inertia.z));
 V torque=sub(moment,gyro);
 omega=add(omega,mul(v(torque.x/inertia.x,torque.y/inertia.y,torque.z/inertia.z),dt));
 omega.x=clamp(omega.x,-2.8f,2.8f);omega.y=clamp(omega.y,-2.0f,2.0f);omega.z=clamp(omega.z,-4,4);
 Q dq=qmul(att,(Q){omega.x,omega.y,omega.z,0});
 att=qnorm((Q){att.x+dq.x*dt*.5f,att.y+dq.y*dt*.5f,att.z+dq.z*dt*.5f,att.w+dq.w*dt*.5f});
 vel=add(vel,mul(force,dt/af_m));pos=add(pos,mul(vel,dt));
 float ground=ground_at(pos.x,pos.z);
 if(pos.y<ground+2.f){
   int runway=landable_at(pos.x,pos.z);
   /* Core 208 (user report: every landing ended as a crash): a touchdown is accepted down to 6.5 m/s of
      sink (a 75-80 m/s jet on a 3 deg slope without a flare sinks ~4 m/s, the old 4.2 limit), at up to 20
      deg of bank and from 18 deg nose down to 26 deg nose up (a delta's or a tail-dragger's landing
      attitude); once rolling on its wheels (on the ground within 0.3 s) the nose's pitching on the brakes and the bumps is no
      crash, up to 34 deg of bank and 20 deg nose down; beyond those, or wheels up, it is a crash. */
   int rolling=was_ground;
   if(gear>.9f && gear_sequence_locked() && runway && (rolling? absf(bank)<.6f && pitch> -.35f && pitch<.6f
                                    : absf(bank)<.35f && vel.y> -6.5f && pitch> -.32f && pitch<.45f)){
      pos.y=ground+2.f;if(vel.y<0)vel.y=0;
      if(external_world){
        /* Any heading: kill side slip across the wheels, steer with the rudder (tail wheel). */
        V fh=norm(v(f.x,0,f.z)),rh=v(fh.z,0,-fh.x);float side=dot(vel,rh),hz0=__builtin_sqrtf(vel.x*vel.x+vel.z*vel.z);
        vel=sub(vel,mul(rh,side*minf(1,dt*6.f)));
        /* nose / tail wheel steering: up to 60 deg at taxiing speed, 6 deg at take-off speed, about a
           wheelbase of 0.42 span: the turn rate the rolling wheels give (core 209, user report: it spun
           on the spot; the old differential-brake pivot of 25 deg/s at a standstill is gone) */
        float wheel=mix(1.05f,.1f,smooth(4,45,hz0)),wb=.42f*af_b;
        float rate=hz0*fsin(wheel)/fcos(wheel)/wb;
        omega.y+=(ground_steer*minf(rate,.8f)-omega.y)*clamp(dt*5,0,1);
      }else vel.x*=maxf(0,1-dt*2.0f);float brake=((flags&16)? .32f:.015f);float hz=__builtin_sqrtf(vel.x*vel.x+vel.z*vel.z);if(hz>.001f){float reduction=clamp(1-brake*G*dt/hz,0,1);vel.x*=reduction;vel.z*=reduction;}
      if(thrust>1000)omega.x*=.99f;
      /* core 210: on its wheels the gear holds the wings level (user report: a landing still ended in a
         crash; rolling out fast, the aircraft banked over on the runway): the roll rate damped hard */
      omega.z*=maxf(0,1-dt*10.f);
      if((external_world||pos.z< -2100) && speed<45 && !manual){att=qnorm((Q){0,att.y,0,att.w});omega.x=0;omega.z=0;}
      mode=4;since_ground=0;
   }else {crashed=1;pos.y=ground+1.f;vel=v(0,0,0);omega=v(0,0,0);mode=5;}
 }
 if(!__builtin_isfinite(pos.x+pos.y+pos.z+att.w)){crashed=1;pos=v(0,900,-3600);vel=v(0,0,0);att=(Q){0,0,0,1};mode=5;}
 telemetry();
}
