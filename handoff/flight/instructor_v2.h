/* AEROLAB 02 instructor. Original C implementation; reference design decisions:
 * MouseFlight: separated world marker / aircraft / view.
 * wt-mouse-aim: bank-to-turn, measured-rate damping, heading confidence,
 * predictive AoA, finite handoff and settled-marker gates. Do NOT copy its
 * Nuclear Option stick gains: this plant accepts aerodynamic surface deflection.
 * wasm-flight-lab: measurement-only filtered derivatives / bounded integrators.
 * References and pinned identifiers: RESEARCH.md. */
#ifndef FF_GAIN
#define FF_GAIN 1.f
#endif
#ifndef CAPTURE_LO
#define CAPTURE_LO .03f
#endif
#ifndef CAPTURE_HI
#define CAPTURE_HI .12f
#endif
#ifndef PITCH_CAPTURE
#define PITCH_CAPTURE .8f
#endif
#ifndef YAW_CAPTURE
#define YAW_CAPTURE 1.2f
#endif
#ifndef YAW_FF
#define YAW_FF 1.f
#endif
#ifndef BANK_CAPTURE
#define BANK_CAPTURE .6f
#endif
typedef struct {
 V last_aim,aim_w;
 float last_alpha,alpha_rate,last_load,load_rate,aim_rate,heading_rate;
 float p_integral,y_integral,aoa_gate,g_gate,q_schedule,confidence,off;
 float hold[3],manual_value[3],axis_auth[3];
 float cmd_pitch_rate,cmd_roll_rate,cmd_yaw_rate,roll_error;
 int ready,commit,phase;
} Instructor;
static Instructor instructor;
static int control_profile=1,handoff_mode=0;
static float release_delay=.22f,return_rate=5.f;
static float approach(float a,float b,float dt,float rate){return a+(b-a)*(1-fexp(-dt*rate));}
static void clear_instructor(void){
 instructor=(Instructor){0};instructor.aoa_gate=instructor.g_gate=1;
 instructor.q_schedule=1;for(int i=0;i<3;i++)instructor.axis_auth[i]=1;
}
EX void configure_control(int profile,int handoff,float delay,float response){
 int p=profile!=0,h=handoff!=0;
 if(p!=control_profile||h!=handoff_mode){clear_instructor();desired_bank=bank;}
 control_profile=p;handoff_mode=h;
 release_delay=clamp(sane(delay,.22f),0,1.5f);
 return_rate=clamp(sane(response,1),.4f,2)*5;
}
static void refined_instructor(float dt,V target,V r,V u,V f,float qbar,
 float mp,float mr,float my,int flags,float *outp,float *outr,float *outy){
 Instructor *i=&instructor;float m[3]={mp,mr,my};
 int any=absf(mp)+absf(mr)+absf(my)>.025f;
 for(int k=0;k<3;k++){
  int used=(handoff_mode?absf(m[k])>.025f:any);
  if(used){i->hold[k]=(flags&2)?maxf(release_delay,.65f):release_delay;i->manual_value[k]=m[k];i->axis_auth[k]=0;}
  else {i->hold[k]=maxf(0,i->hold[k]-dt);i->manual_value[k]=approach(i->manual_value[k],m[k],dt,8);}
  float goal=((flags&1)&&i->hold[k]<=0)?1:0;
  if(!(flags&1))i->manual_value[k]=m[k];
  i->axis_auth[k]=approach(i->axis_auth[k],goal,dt,goal?return_rate:35);
 }
 authority=(i->axis_auth[0]+i->axis_auth[1]+i->axis_auth[2])/3;
 manual_hold=maxf(i->hold[0],maxf(i->hold[1],i->hold[2]));
 if(!i->ready){i->last_aim=target;i->last_alpha=alpha;i->last_load=load;i->ready=1;}
 float a_rate=wrap(alpha-i->last_alpha)/dt;
 i->alpha_rate=approach(i->alpha_rate,clamp(a_rate,-5,5),dt,12.5f);i->last_alpha=alpha;
 i->load_rate=approach(i->load_rate,clamp((load-i->last_load)/dt,-30,30),dt,12.5f);i->last_load=load;
 float ar=fatan2(len(cross(i->last_aim,target)),clamp(dot(i->last_aim,target),-1,1))/dt;
 /* The marker's own angular velocity (world, filtered ~0.1 s): fed forward so the nose moves with a
  * moving aim instead of trailing it by rate/gain (a 4 deg/s crossing target was trailed by ~4 deg). */
 V wr=mul(cross(i->last_aim,target),1/maxf(dt,1e-4f));
 if(len(wr)>3)wr=mul(wr,3/len(wr));
 i->aim_w=v(approach(i->aim_w.x,wr.x,dt,10),approach(i->aim_w.y,wr.y,dt,10),approach(i->aim_w.z,wr.z,dt,10));
 i->aim_rate=approach(i->aim_rate,ar,dt,7);i->last_aim=target;
 float lx=dot(target,r),ly=dot(target,u),lz=dot(target,f);
 i->off=fatan2(__builtin_sqrtf(lx*lx+ly*ly),lz);
 i->confidence=__builtin_sqrtf(f.x*f.x+f.z*f.z);
 float ep=fatan2(ly,maxf(lz,.015f));
 float ey=fatan2(lx,maxf(lz,.15f));
 V fd=rotate(att,cross(omega,v(0,0,1)));
 float h_rate=(f.z*fd.x-f.x*fd.z)/maxf(i->confidence*i->confidence,.04f);
 i->heading_rate=approach(i->heading_rate,clamp(h_rate,-3,3),dt,14);
 float eh=wrap(fatan2(target.x,target.z)-heading);
 /* Choose a turn side while the marker straddles dead astern. Retire the
  * commitment well before final capture so ordinary reversals remain free. */
 if(absf(eh)>2.62f && !i->commit)i->commit=eh<0?-1:1;
 if(absf(eh)<2.05f)i->commit=0;
 if(i->commit&&absf(eh)>2.4f)eh=i->commit*absf(eh);
 /* heading rate of the marker: the turn to fly, not only the error to close */
 float aim_h=clamp(i->aim_w.y/maxf(target.x*target.x+target.z*target.z,.04f),-1.5f,1.5f)*FF_GAIN;
 float bank_signal=(eh-(i->heading_rate-aim_h)*.58f+aim_h/.67f)*i->confidence;
 float want=fatan2(bank_signal*speed*.67f,G);
 want*=1-BANK_CAPTURE*(1-smooth(CAPTURE_LO,CAPTURE_HI,i->off))*(1-smooth(.02f,.08f,absf(aim_h)));
 float max_bank=mix(.82f,1.20f,smooth(58,92,speed));
 want=clamp(want,-max_bank,max_bank);
 desired_bank+=clamp(wrap(want-desired_bank),-1.5f*dt,1.5f*dt);
 float bank_err=wrap(desired_bank-bank);
 /* When nearly vertical, horizontal heading and bank cease being reliable.
  * Use target in the body frame; inside the capture cone just damp roll. */
 float geom_err=fatan2(lx,ly);
 float vertical_err=clamp(geom_err,-1.3f,1.3f)*smooth(.035f,.16f,i->off);
 float vertical_weight=1-smooth(.18f,.52f,i->confidence);
 bank_err=mix(bank_err,vertical_err,vertical_weight);
 i->roll_error=bank_err;
 i->q_schedule=clamp(qbar/6200.f,.30f,1);
 float ceiling=af_stall+flaps*.025f;
 float pred=alpha+maxf(0,i->alpha_rate)*.27f;
 float aoa_goal=1-smooth(ceiling*.73f,ceiling*.97f,pred);
 float gpred=load+maxf(i->load_rate,0)*.085f;
 float ggoal=1-smooth(g_limit*.84f,g_limit,gpred);
 if(!protect||!(flags&1)){aoa_goal=1;ggoal=1;}
 i->aoa_gate=approach(i->aoa_gate,aoa_goal,dt,aoa_goal<i->aoa_gate?30:4.5f);
 i->g_gate=approach(i->g_gate,ggoal,dt,ggoal<i->g_gate?35:5);
 float envelope=minf(i->aoa_gate,i->g_gate);
 int fine=i->off<.09f&&i->aim_rate<.05f&&envelope>.98f&&speed>55;
 /* Integral units are rad/s, not stick. Freeze while the actuator saturates,
  * handoff is active, target moves, or envelope intervention is necessary. */
 if(fine&&i->axis_auth[0]>.99f&&absf(ctl_p)<.7f)i->p_integral=clamp(i->p_integral+ep*dt*.11f,-.012f,.012f);
 else i->p_integral=approach(i->p_integral,0,dt,3);
 if(fine&&i->axis_auth[2]>.99f&&absf(ctl_y)<.4f)i->y_integral=clamp(i->y_integral+ey*dt*.07f,-.016f,.016f);
 else i->y_integral=approach(i->y_integral,0,dt,3);
 float align=clamp(1-absf(bank_err)/1.6f,.28f,1);
 /* body-frame feed-forward of the marker's motion (pitch-up, yaw-right rates) */
 float ff_p=-dot(i->aim_w,r)*FF_GAIN,ff_y=dot(i->aim_w,u)*FF_GAIN;
 /* capture cone (MouseFlight / War Thunder fine aim): close a few degrees directly with the
  * elevator and rudder rather than by banking */
 float capture=1-smooth(CAPTURE_LO,CAPTURE_HI,i->off);
 float pr=clamp((ep*(2.0f+PITCH_CAPTURE*capture)*sensitivity+i->p_integral)*align*i->q_schedule+ff_p,-.30f,.7f);
 if(pr>0)pr*=envelope;
 /* Plant-normalized inner rate servos. Coefficients match this project's
  * existing force/moment equations; feedback damps measured body rates. */
 float pressure=maxf(qbar,40),dp=6*af_c/(2*maxf(speed,12)),dr=.25f*af_b/(2*maxf(speed,12)),dy=.5f*af_b/(2*maxf(speed,12));
 float ap=pressure*af_s*af_c*.26f/af_ix,aroll=pressure*af_s*af_b*.12f/af_iz,ayaw=pressure*af_s*af_b*.05f/af_iy;
 float rr=clamp(bank_err*2.2f*sensitivity,-1.6f,1.6f);
 float coord=G/maxf(speed,45)*fsin(bank);
 float yr=clamp(ey*(.65f+YAW_CAPTURE*capture)+coord+i->y_integral+clamp(ff_y-coord,-.08f,.08f)*YAW_FF,-.25f,.25f);
 i->cmd_pitch_rate=pr;i->cmd_roll_rate=rr;i->cmd_yaw_rate=yr;
 float p=(.38f/.26f)*(alpha-.028f)+(dp/.26f)*pr+(pr+omega.x)/maxf(ap*.22f,.3f);
 float roll=(dr/.12f)*rr+(rr+omega.z)/maxf(aroll*.16f,.8f);
 float yaw=-(.12f/.05f)*beta+(dy/.05f)*yr+(yr-omega.y)/maxf(ayaw*.35f,.5f);
 if(!(flags&1)||authority<.001f){desired_bank=bank;i->p_integral=i->y_integral=0;}
 float vals[3]={clamp(p,-1,1),clamp(roll,-1,1),clamp(yaw,-.45f,.45f)};
 for(int k=0;k<3;k++)vals[k]=mix(i->manual_value[k],vals[k],i->axis_auth[k]);
 /* Manual inputs are still allowed to unload. This is not a state clamp. */
 if(protect&&(flags&1)&&vals[0]>0){
  if(i->axis_auth[0]<.99f)vals[0]*=envelope;
  if(alpha>ceiling)vals[0]=minf(vals[0],-clamp((alpha-ceiling)*5,0,.65f));
 }
 *outp=vals[0];*outr=vals[1];*outy=vals[2];
 mode=authority<.99f?3:absf(bank_err)>.20f?1:i->off>.06f?2:0;
 i->phase=mode;
}
