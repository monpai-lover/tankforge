/* Optional accepted four-axis gear mechanism. Source Me262 values are
 * 0=stowed/closed, 1=down/open. No rendering clock owns these values.
 * Default mode0 leaves the core212 scalar mechanism and telemetry unchanged. */
typedef struct {
 int mode,resume_pending;
 float main,nose,main_doors,nose_door;
 float main_s,nose_s,main_doors_s,nose_open_s,nose_close_s;
} GearSequence;
static GearSequence gs={0,0,0,0,0,0,3,3,1,.75f,1};
static void gear_sequence_publish(void){
 aero_out[36]=gs.mode?gs.main:0;
 aero_out[37]=gs.mode?gs.main_doors:0;
 aero_out[38]=gs.mode?gs.nose:0;
 aero_out[39]=gs.mode?gs.nose_door:0;
}
static void gear_sequence_reset(float down){
 gs.main=gs.nose=down>.5f?1.f:0.f;
 gs.main_doors=gs.nose_door=gs.main;
 gs.resume_pending=0;
 gear_sequence_publish();
}
static void gear_sequence_airframe_reset(void){
 /* Immediate configure_airframe -> configure_surfaces -> configure_gear may
  * update mass/stores during a transition. Save the accepted mechanism only
  * across that uninterrupted configuration transaction. A mode0 physics step,
  * reset, spawn or explicit disable invalidates it before any later reuse. */
 if(gs.mode)gs.resume_pending=1;
 gs.mode=0;
 gear_sequence_publish();
}
EX void configure_gear_sequence(int sequence_mode,float main_s,float nose_s,float main_doors_s,float nose_open_s,float nose_close_s){
 gs.main_s=clamp(sane(main_s,3),.05f,60);
 gs.nose_s=clamp(sane(nose_s,3),.05f,60);
 gs.main_doors_s=clamp(sane(main_doors_s,1),.05f,60);
 gs.nose_open_s=clamp(sane(nose_open_s,.75f),.05f,60);
 gs.nose_close_s=clamp(sane(nose_close_s,1),.05f,60);
 int was_mode=gs.mode;
 if(sequence_mode!=1){gs.mode=0;gs.resume_pending=0;gear_sequence_publish();return;}
 if(!was_mode && !(gs.resume_pending && absf(gear-(gs.main+gs.nose)*.5f)<.00001f)){
  gs.main=gs.nose=clamp(gear,0,1);
  gs.main_doors=gs.nose_door=gear>.00001f?1.f:0.f;
 }
 gs.mode=1;gs.resume_pending=0;
 gear_sequence_publish();
}
/* Consume only the fraction of this fixed physics step required by a phase.
 * Carry remaining time through phase boundaries, avoiding cadence-dependent
 * accumulated delays and allowing immediate, continuous mid-phase reversal. */
static int gear_sequence_move(float *value,float target,float seconds,float *remaining){
 float distance=absf(target-*value),needed=distance*seconds;
 if(needed<=*remaining+.0000001f){
  *remaining=maxf(0,*remaining-needed);*value=target;return 1;
 }
 *value+=target>*value?*remaining/seconds:-*remaining/seconds;
 *value=clamp(*value,0,1);*remaining=0;return 0;
}
static void gear_sequence_step(float dt,int down){
 float left=dt;
 if(down){
  if(gs.main<1){
   if(!gear_sequence_move(&gs.main_doors,1,gs.main_doors_s,&left))goto done;
   if(!gear_sequence_move(&gs.main,1,gs.main_s,&left))goto done;
  }
  if(gs.main_doors<1 && !gear_sequence_move(&gs.main_doors,1,gs.main_doors_s,&left))goto done;
  if(gs.nose<1){
   if(!gear_sequence_move(&gs.nose_door,1,gs.nose_open_s,&left))goto done;
   if(!gear_sequence_move(&gs.nose,1,gs.nose_s,&left))goto done;
  }
  if(gs.nose_door<1)gear_sequence_move(&gs.nose_door,1,gs.nose_open_s,&left);
 }else {
  if(gs.main>0){
   if(!gear_sequence_move(&gs.main_doors,1,gs.main_doors_s,&left))goto done;
   if(!gear_sequence_move(&gs.main,0,gs.main_s,&left))goto done;
  }
  if(!gear_sequence_move(&gs.main_doors,0,gs.main_doors_s,&left))goto done;
  if(gs.nose>0){
   if(!gear_sequence_move(&gs.nose_door,1,gs.nose_open_s,&left))goto done;
   if(!gear_sequence_move(&gs.nose,0,gs.nose_s,&left))goto done;
  }
  gear_sequence_move(&gs.nose_door,0,gs.nose_close_s,&left);
 }
done:
 gear=(gs.main+gs.nose)*.5f;
 gear_sequence_publish();
}
static int gear_sequence_locked(void){return !gs.mode || (gs.main>=.999f && gs.nose>=.999f);}
