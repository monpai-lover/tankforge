/* Distributed flight surfaces, original TankForge implementation.
 * References: gasgiant/Aircraft-Physics (local airflow and force/torque summation),
 * brihernandez/MouseFlight and cosistra/wt-mouse-aim (intent/controller separation).
 * The coefficients are game estimates, not measured historical airfoil polars.
 * Positions are metres from the same CG as the drawn aircraft. */
typedef struct {
 float root,tip,wy,wz,tz,ta,fz,fa,roll,pu,pd,yaw,flap,sweep,taper;
 int delta,stabilator;
} AeroGeometry;
static AeroGeometry ag;
static float aero_out[48],aero_brake;
static float aero_pitch_up=.26f,aero_pitch_down=.26f,aero_roll_control=.12f,aero_yaw_control=.05f;
static float aero_roll_damping,aero_yaw_damping,aero_pitch_damping;
static float aero_pc(float demand){return maxf(demand>=0?aero_pitch_up:aero_pitch_down,.025f);}
static float aero_pitch_bias(float aoa){
 return (ag.delta?0:.38f*(aoa-.028f))-ag.wz/af_c*(.20f+af_cla*aoa+.36f*flaps);
}
static void aero_derive(void){
 aero_pitch_up=.26f*ag.pu/.42f*(ag.stabilator?1.8f:1);
 aero_pitch_down=.26f*ag.pd/.42f*(ag.stabilator?1.8f:1);
 aero_roll_control=.12f*ag.roll/.38f;
 aero_yaw_control=.05f*ag.yaw/.40f;
 float x2=0,z2=0,weight=0;
 for(int j=0;j<6;j++){
  float f=(j+.5f)/6,x=mix(ag.root,ag.tip,f),w=mix(1,ag.taper,f);
  float z=ag.wz-fsin(ag.sweep)/maxf(.2f,fcos(ag.sweep))*(x-(ag.root+ag.tip)*.5f);
  x2+=w*x*x;z2+=w*z*z;weight+=w;
 }
 aero_roll_damping=af_cla*x2/maxf(weight*af_b,.01f);
 aero_pitch_damping=(ag.delta?0:3*af_c)+af_cla*z2/maxf(weight*af_c,.01f);
 aero_yaw_damping=.12f*absf(ag.fz)+.22f*(.3f*af_b)*(.3f*af_b)/af_b;
}
static void aero_defaults(void){
 ag=(AeroGeometry){.root=af_b*.05f,.tip=af_b*.5f,.wy=0,.wz=0,
  .tz=-af_b*.4f,.ta=af_s*.16f,.fz=-af_b*.38f,.fa=af_s*.1f,
  .roll=.38f,.pu=.42f,.pd=.42f,.yaw=.4f,.flap=.7f,.sweep=0,.taper=.6f};
 aero_derive();
}
/* Optional geometry ABI, called by the host for players, AI, respawns and load changes.
 * Surface angles are the actual mesh's full-travel angles; all-moving tails gain full-chord lift. */
EX void configure_surfaces(float root,float tip,float wy,float wz,float tz,float ta,float fz,float fa,
 float roll,float pitch_up,float pitch_down,float yaw,float flap_angle,float sweep,float taper,int delta,int stabilator){
 ag.root=clamp(sane(root,af_b*.05f),0,af_b*.35f);
 ag.tip=clamp(sane(tip,af_b*.5f),ag.root+.1f,af_b*.6f);
 ag.wy=clamp(sane(wy,0),-af_c*2,af_c*2);ag.wz=clamp(sane(wz,0),-af_c*2,af_c*2);
 ag.tz=clamp(sane(tz,-af_b*.4f),-af_b,-.5f);ag.ta=clamp(sane(ta,af_s*.16f),af_s*.04f,af_s*.4f);
 ag.fz=clamp(sane(fz,-af_b*.38f),-af_b,-.5f);ag.fa=clamp(sane(fa,af_s*.1f),af_s*.025f,af_s*.3f);
 ag.roll=clamp(sane(roll,.38f),.06f,.9f);ag.pu=clamp(sane(pitch_up,.42f),.06f,.9f);
 ag.pd=clamp(sane(pitch_down,.42f),.06f,.9f);ag.yaw=clamp(sane(yaw,.4f),.08f,.9f);
 ag.flap=clamp(sane(flap_angle,.7f),.08f,1.3f);
 ag.sweep=clamp(sane(sweep,0),-.2f,1.15f);ag.taper=clamp(sane(taper,.6f),.08f,1.8f);
 ag.delta=delta!=0;ag.stabilator=stabilator!=0;aero_derive();
}
EX int aero_state_ptr(void){return (int)(uintptr_t)aero_out;}
EX int aero_state_len(void){return 48;}
static V aero_airflow(V flow,V at){return add(flow,cross(omega,at));}
static float aero_alpha(V flow){return fatan2(-flow.y,flow.z);}
static float aero_polar(float a,float bias,float extra,float limit,float *separation){
 float effective=a+extra/maxf(af_cla,1);
 float s=smooth(limit,limit+.32f,absf(effective));
 *separation=smooth(limit*.82f,limit*1.45f,absf(effective));
 return clamp(mix(bias+af_cla*a+extra,1.05f*fsin(2*effective),s),-1.5f,1.7f);
}
static void aero_add(V *force,V *moment,V local,V at){
 *force=add(*force,local);*moment=add(*moment,cross(at,local));
}
static void aero_forces(V flow,float rho,V *force,V *moment){
 *force=v(0,0,0);*moment=v(0,0,0);
 for(int k=0;k<48;k++)aero_out[k]=0;
 float sumw=0,lever=0,meanx=0;
 for(int j=0;j<6;j++){
  float f=(j+.5f)/6,w=mix(1,ag.taper,f),x=mix(ag.root,ag.tip,f);
  sumw+=w;meanx+=w*x;if(j>=3)lever+=w*x;
 }
 meanx/=sumw;
 float rollLift=aero_roll_control*af_b*sumw/maxf(lever,.01f);
 float pitchControl=aero_pc(ctl_p),pitchLift=ag.delta?pitchControl*af_c/maxf(.45f*af_c,.1f):0;
 float limit=af_stall+flaps*.025f;
 for(int side=-1;side<=1;side+=2)for(int j=0;j<6;j++){
  float f=(j+.5f)/6,w=mix(1,ag.taper,f),area=af_s*.5f*w/sumw;
  float x=mix(ag.root,ag.tip,f),z=ag.wz-fsin(ag.sweep)/maxf(.2f,fcos(ag.sweep))*(x-meanx);
  V at=v(side*x,ag.wy,z),local=aero_airflow(flow,at);
  float q=.5f*rho*dot(local,local),a=aero_alpha(local),part_stall=0;
  float flapLift=j<3?.36f*flaps*(ag.flap/.7f)*sumw/maxf(3*(1+(ag.taper-1)*.25f),.1f):0;
  float delta=(j>=3?-side*ctl_r*rollLift*dmg_roll:0)-(ag.delta&&j>=3?ctl_p*pitchLift*2*dmg_pitch:0);
  float cl=aero_polar(a,.20f,flapLift+delta,limit,&part_stall);
  float available=side<0?dmg_lift_l:dmg_lift_r;
  // Damage removes that surface's lift and its own control increment, never the opposite wing.
  V liftDirection=norm(v(0,local.z,-local.y));
  V lift=mul(liftDirection,q*area*cl*available);
  V drag=mul(norm(local),-q*area*(af_k*cl*cl+.012f*delta*delta)*available);
  aero_add(force,moment,add(lift,drag),at);
  int k=side<0?0:1;
  aero_out[k]+=a*w/sumw;aero_out[2+k]+=part_stall*w/sumw;aero_out[4+k]+=lift.y;
  aero_out[24+(side<0?j:6+j)]=part_stall;
  // An elevon changes the trailing-edge pressure centre as well as the net wing lift.
  if(ag.delta&&j>=3){
   float effective=delta*(1-part_stall*.7f)*available;
   moment->x+=.45f*af_c*q*area*effective;
  }
 }
 float a=aero_alpha(flow),vforward=maxf(absf(flow.z),12);
 if(!ag.delta){
  V at=v(0,0,ag.tz),local=aero_airflow(flow,at);
  float arm=absf(ag.tz),q=.5f*rho*dot(local,local);
  // Tail volume and downwash are calibrated to this game's static margin; angular local airflow
  // supplies pitch damping. Elevator travel is derived from the corresponding visible surface.
  float gain=3*af_c/arm,downwash=.38f/gain;
  float tailAlpha=(aero_alpha(local)-a)+downwash*(a-.028f)-pitchControl/gain*ctl_p;
  float slope=gain*af_s*af_c/(ag.ta*arm);
  float cl=mix(slope*tailAlpha,1.05f*fsin(2*tailAlpha),smooth(.35f,.75f,absf(tailAlpha)));
  V lift=mul(norm(v(0,local.z,-local.y)),q*ag.ta*cl*dmg_pitch);
  V drag=mul(norm(local),-q*ag.ta*.10f*cl*cl*dmg_pitch);
  aero_add(force,moment,add(lift,drag),at);aero_out[6]=lift.y;
 }
 {
  V at=v(0,.2f*af_c,ag.fz),local=aero_airflow(flow,at);
  float q=.5f*rho*dot(local,local),b=fatan2(local.x,maxf(absf(local.z),.1f));
  float gain=.12f*af_s*af_b/(ag.fa*absf(ag.fz));
  float cl=gain*(b+aero_yaw_control/.12f*ctl_y*dmg_yaw);
  cl=mix(cl,1.1f*fsin(2*b),smooth(.4f,.9f,absf(b)));
  V fin=v(-q*ag.fa*cl*(dmg_pitch<.02f?0:1),0,0);
  aero_add(force,moment,fin,at);aero_out[7]=fin.x;
 }
 // Distributed fuselage side force damps yaw without inventing a torque independent of airflow.
 for(int side=-1;side<=1;side+=2){
  V at=v(0,0,side*.3f*af_b),local=aero_airflow(flow,at);
  float q=.5f*rho*dot(local,local),b=fatan2(local.x,maxf(absf(local.z),.1f));
  aero_add(force,moment,v(-q*af_s*.11f*b,0,0),at);
 }
 aero_out[8]=ctl_r*ag.roll;aero_out[9]=ctl_p*(ctl_p>=0?ag.pu:ag.pd);
 aero_out[10]=ctl_y*ag.yaw;aero_out[11]=flaps*ag.flap;
 aero_out[12]=aero_pc(ctl_p);aero_out[13]=aero_roll_control;aero_out[14]=aero_yaw_control;
 aero_out[15]=.5f*rho*dot(flow,flow);aero_out[22]=vforward;aero_out[23]=aero_brake;
}
