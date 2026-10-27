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
#define CAPTURE_HI .16f
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
#ifndef MAX_BANK_HI
#define MAX_BANK_HI 1.45f
#endif
#ifndef BANK_SLEW
#define BANK_SLEW 4.f
#endif
#ifndef BANK_CAPTURE
#define BANK_CAPTURE .6f
#endif
typedef struct {
 V last_aim,aim_w;
 float last_alpha,alpha_rate,last_load,load_rate,aim_rate,heading_rate;
 float p_integral,y_integral,aoa_gate,g_gate,aoa_gate_down,g_gate_down,aoa_max,aoa_min,pressure,path_support,q_schedule,confidence,off;
 float hold[3],manual_value[3],axis_auth[3];
 float cmd_pitch_rate,cmd_roll_rate,cmd_yaw_rate,roll_error;
 int ready,envelope_ready,commit,phase;
} Instructor;
static Instructor instructor;
static int control_profile=1,handoff_mode=0;
static float release_delay=.22f,return_rate=5.f;
/* configure() retains its original ABI and positive-G meaning. Optional signed
 * limits are independent; zero AoA selects this airframe's live flap limit.
 * These are game-model limits, not certified historical airframe envelopes. */
static float g_limit_down=-3.f,aoa_limit_up=0,aoa_limit_down=0;
static float approach(float a,float b,float dt,float rate){return a+(b-a)*(1-fexp(-dt*rate));}
static void clear_instructor(void){
 instructor=(Instructor){0};instructor.aoa_gate=instructor.g_gate=instructor.aoa_gate_down=instructor.g_gate_down=1;
 instructor.q_schedule=1;for(int i=0;i<3;i++)instructor.axis_auth[i]=1;
}
EX void configure_envelope(float max_g,float min_g,float max_aoa,float min_aoa){
 g_limit=clamp(sane(max_g,6.5f),2,12);
 g_limit_down=clamp(sane(min_g,-3.f),-9,-.5f);
 max_aoa=sane(max_aoa,0);min_aoa=sane(min_aoa,0);
 aoa_limit_up=max_aoa>0?clamp(max_aoa,.06f,.65f):0;
 aoa_limit_down=min_aoa<0?clamp(min_aoa,-.65f,-.04f):0;
}
static float envelope_aoa_up(void){return aoa_limit_up>0?aoa_limit_up:af_stall+flaps*.025f;}
static float envelope_aoa_down(void){return aoa_limit_down<0?aoa_limit_down:-.75f*(af_stall+flaps*.025f);}
/* Shared by both control profiles. Only lead INTO a limit for the gates;
 * the restoring command below uses the full signed derivative for damping. */
static void update_envelope(float dt,float qbar,int flags){
 Instructor *i=&instructor;
 i->pressure=maxf(qbar,40);
 if(!i->envelope_ready){i->last_alpha=alpha;i->last_load=load;i->envelope_ready=1;}
 i->alpha_rate=approach(i->alpha_rate,clamp(wrap(alpha-i->last_alpha)/dt,-5,5),dt,12.5f);i->last_alpha=alpha;
 i->load_rate=approach(i->load_rate,clamp((load-i->last_load)/dt,-60,60),dt,12.5f);i->last_load=load;
 if(!protect||!(flags&1)){
  i->aoa_gate=i->g_gate=i->aoa_gate_down=i->g_gate_down=1;
  return;
 }
 float hi=envelope_aoa_up(),low=envelope_aoa_down();
 /* Before the stall, this plant's lift slope predicts the AoA needed for
  * signed G. Constrain the guard by that known local model as well as delayed
  * measured load. Low-q aircraft keep their aerodynamic AoA limit; flap lift
  * and lost wing area are included. This changes commands, never forces. */
 float lift_per_cl=qbar*af_s*maxf((dmg_lift_l+dmg_lift_r)*.5f,.1f)/(af_m*G);
 if(speed>30&&lift_per_cl>.05f){
  float bias=.20f+.36f*flaps;
  hi=minf(hi,maxf(.015f,(g_limit/lift_per_cl-bias)/af_cla));
  low=maxf(low,minf(-.015f,(g_limit_down/lift_per_cl-bias)/af_cla));
 }
 i->aoa_max=hi;i->aoa_min=low;float lo=-low;
 i->path_support=smooth(1.5f,3.f,lift_per_cl*(.20f+.36f*flaps+af_cla*hi));
 float ap=alpha+maxf(0,i->alpha_rate)*.35f,an=-alpha-minf(0,i->alpha_rate)*.35f;
 float gp=load+maxf(0,i->load_rate)*.27f,gn=-load-minf(0,i->load_rate)*.27f;
 float goals[4]={1-smooth(hi*.73f,hi*.97f,ap),1-smooth(g_limit*.80f,g_limit*.96f,gp),
                 1-smooth(lo*.73f,lo*.97f,an),1-smooth(-g_limit_down*.80f,-g_limit_down*.96f,gn)};
 float *gates[4]={&i->aoa_gate,&i->g_gate,&i->aoa_gate_down,&i->g_gate_down};
 for(int k=0;k<4;k++)*gates[k]=approach(*gates[k],goals[k],dt,goals[k]<*gates[k]?35:5);
}
static float protect_pitch(float command,int flags){
 /* Protection follows instructor-enabled semantics in both profiles. Turning
  * either switch off restores the original physical surface controls. */
 if(!protect||!(flags&1))return command;
 Instructor *i=&instructor;
 /* Convert surface deflection to a rate demand using this plant's existing
  * pitch servo. Limiting a raw stick or a restoring stick separately lets the
  * two controllers accumulate opposite momentum across a reversal. Both now
  * pass through this one damped, airframe-normalized path. */
 float pc=aero_pc(command),ap=i->pressure*af_s*af_c*pc/af_ix,dp=aero_pitch_damping/maxf(speed,12);
 float response=maxf(ap*.22f,.3f),slope=dp/pc+1/response;
 float bias=aero_pitch_bias(alpha)/pc+omega.x/response;
 float up_rate=g_limit*G/maxf(speed,12),down_rate=g_limit_down*G/maxf(speed,12);
 float rate=clamp((command-bias)/slope,down_rate,up_rate);
 /* Normal acceleration rotates the flight path. Gate only the requested
  * change in AoA, about its approximate holding rate, so closing a gate does
  * not discard the trim/damping that keeps a loaded turn settled. */
 float path_rate=clamp((load-fcos(bank)*fcos(pitch))*G/maxf(speed,12),-3,3);
 /* A wing with little available load must not keep following a rising path
  * at its AoA ceiling until it runs out of pitch authority. Retain gravity's
  * downward path rate; fade upward holding toward the natural zero-surface
  * response as available lift falls through 3 to 1.5 G. This is a local
  * pre-stall estimate, not a guaranteed attainable load after a departure. */
 if(path_rate>0)path_rate=mix(minf(path_rate,-bias/slope),path_rate,i->path_support);
 float delta=rate-path_rate;
 int high=alpha>i->aoa_max||load>g_limit,low=alpha<i->aoa_min||load<g_limit_down;
 if(delta>0&&!low)rate=path_rate+delta*minf(i->aoa_gate,i->g_gate);
 if(delta<0&&!high)rate=path_rate+delta*minf(i->aoa_gate_down,i->g_gate_down);
 /* Full signed prediction is the damping in recovery. Unlike the one-sided
  * outward gates, it relaxes immediately as unloading develops. A requested
  * unloading direction stays available, with the same rate bounds guarding
  * against an overshoot through the opposite limit. No state is clipped. */
 float predicted_alpha=alpha+i->alpha_rate*.35f,predicted_g=load+i->load_rate*.27f;
 /* Distributed surfaces can reach their local stall before the CG sample. Retain ten percent
  * of AoA headroom while unloading; this is command protection, never an attitude/force clamp. */
 float recover_up=maxf((predicted_alpha-i->aoa_max*.90f)*2.5f,(predicted_g-g_limit*.98f)*G/maxf(speed,12)*1.5f);
 float recover_down=maxf((i->aoa_min*.90f-predicted_alpha)*2.5f,(g_limit_down*.98f-predicted_g)*G/maxf(speed,12)*1.5f);
 rate-=clamp(recover_up,0,.7f)-clamp(recover_down,0,.7f);
 return bias+slope*clamp(rate,down_rate,up_rate);
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
 if(!i->ready){i->last_aim=target;i->ready=1;}
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
 /* deep enough to turn at the G limit (acos(1/6.5) = 81 deg) instead of zoom-climbing with the pull */
 float max_bank=mix(.82f,MAX_BANK_HI,smooth(58,92,speed));
 want=clamp(want,-max_bank,max_bank);
 desired_bank+=clamp(wrap(want-desired_bank),-BANK_SLEW*dt,BANK_SLEW*dt);
 float bank_err=wrap(desired_bank-bank);
 /* When nearly vertical, horizontal heading and bank cease being reliable.
  * Use target in the body frame; inside the capture cone just damp roll. */
 float geom_err=fatan2(lx,ly);
 float vertical_err=clamp(geom_err,-1.3f,1.3f)*smooth(.035f,.16f,i->off);
 float vertical_weight=1-smooth(.18f,.52f,i->confidence);
 bank_err=mix(bank_err,vertical_err,vertical_weight);
 i->roll_error=bank_err;
 i->q_schedule=clamp(qbar/6200.f,.30f,1);
 float envelope=minf(minf(i->aoa_gate,i->g_gate),minf(i->aoa_gate_down,i->g_gate_down));
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
 /* Plant-normalized inner rate servos. Coefficients match this project's
  * existing force/moment equations; feedback damps measured body rates. */
 float pressure=maxf(qbar,40),dp=aero_pitch_damping/maxf(speed,12),dr=aero_roll_damping/maxf(speed,12),dy=aero_yaw_damping/maxf(speed,12);
 float pc=aero_pc(ep),rc=maxf(aero_roll_control,.015f),yc=maxf(aero_yaw_control,.01f);
 float ap=pressure*af_s*af_c*pc/af_ix,aroll=pressure*af_s*af_b*rc/af_iz,ayaw=pressure*af_s*af_b*yc/af_iy;
 float rr=clamp(bank_err*2.2f*sensitivity,-1.6f,1.6f);
 float coord=G/maxf(speed,45)*fsin(bank);
 float yr=clamp(ey*(.65f+YAW_CAPTURE*capture)+coord+i->y_integral+clamp(ff_y-coord,-.08f,.08f)*YAW_FF,-.25f,.25f);
 i->cmd_pitch_rate=pr;i->cmd_roll_rate=rr;i->cmd_yaw_rate=yr;
 float p=aero_pitch_bias(alpha)/pc+(dp/pc)*pr+(pr+omega.x)/maxf(ap*.22f,.3f);
 float roll=(dr/rc)*rr+(rr+omega.z)/maxf(aroll*.16f,.8f);
 float yaw=-(.12f/yc)*beta+(dy/yc)*yr+(yr-omega.y)/maxf(ayaw*.35f,.5f);
 if(!(flags&1)||authority<.001f){desired_bank=bank;i->p_integral=i->y_integral=0;}
 float vals[3]={clamp(p,-1,1),clamp(roll,-1,1),clamp(yaw,-.45f,.45f)};
 for(int k=0;k<3;k++)vals[k]=mix(i->manual_value[k],vals[k],i->axis_auth[k]);
 *outp=vals[0];*outr=vals[1];*outy=vals[2];
 mode=authority<.99f?3:absf(bank_err)>.20f?1:i->off>.06f?2:0;
 i->phase=mode;
}
