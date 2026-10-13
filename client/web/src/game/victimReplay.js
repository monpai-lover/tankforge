// State death and presentation eligibility are deliberately separate.
import {replayActorEqual} from './replayEvidence.js';
export function createVictimReplayGate(){
  let actor=null,dead=false,pending=null,presented=null,finished=true;
  return {
    admit(next){if(!replayActorEqual(next,actor)){actor=next?{...next}:null;dead=false;pending=presented=null;finished=true;}},
    markDead(a){if(replayActorEqual(a,actor))dead=true;},
    offer(a,death){if(!replayActorEqual(a,actor)||!death?.event_id||death.event_id===presented||pending&&pending!==death.event_id)return false;pending=death.event_id;finished=false;return true;},
    presented(id){if(id===pending){presented=id;pending=null;}},
    finish(){finished=true;pending=null;},
    canDeploy(cooldownReady){return !!cooldownReady&&finished;},
    get actor(){return actor;},get dead(){return dead;},get active(){return !finished;},get deathId(){return pending||presented;},
  };
}
