/* AEROLAB 02 instructor. Original C implementation; reference design decisions:
 * MouseFlight: separated world marker / aircraft / view.
 * wt-mouse-aim: bank-to-turn, measured-rate damping, heading confidence,
 * predictive AoA, finite handoff and settled-marker gates. Do NOT copy its
 * Nuclear Option stick gains: this plant accepts aerodynamic surface deflection.
 * wasm-flight-lab: measurement-only filtered derivatives / bounded integrators.
 * References and pinned identifiers: RESEARCH.md. */
typedef struct {
 V last_aim;
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
 float bank_signal=(eh-i->heading_rate*.58f)*i->confidence;
 float want=fatan2(bank_signal*speed*.67f,G);
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
 float ceiling=.28f+flaps*.025f;
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
 float pr=clamp(ep*2.0f*sensitivity+i->p_integral,-.30f,.7f)*align*i->q_schedule;
 if(pr>0)pr*=envelope;
 /* Plant-normalized inner rate servos. Coefficients match this project's
  * existing force/moment equations; feedback damps measured body rates. */
 float pressure=maxf(qbar,40),dp=6*2.1f/(2*maxf(speed,12)),dr=.25f*11/(2*maxf(speed,12)),dy=.5f*11/(2*maxf(speed,12));
 float ap=pressure*22*2.1f*.26f/14000.f,aroll=pressure*22*11*.12f/6500.f,ayaw=pressure*22*11*.05f/21000.f;
 float rr=clamp(bank_err*2.2f*sensitivity,-1.6f,1.6f);
 float yr=clamp(ey*.65f+G/maxf(speed,45)*fsin(bank)+i->y_integral,-.25f,.25f);
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
