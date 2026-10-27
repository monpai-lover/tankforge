// Visual submissions only. Never wait for the GPU on the main thread: decoded
// native frames, input and UI must remain responsive while a slow frame draws.
function createFrontlineRenderGate(renderer) {
  const gl=renderer.gl;
  let pending=null,generation=renderer.generation;
  const stats={submitted:0,skipped:0,failed:0};
  function clear(){if(pending){if(generation===renderer.generation&&!renderer.lost)gl.deleteSync(pending);pending=null;}}
  function ready(){
    if(generation!==renderer.generation){pending=null;generation=renderer.generation;}
    if(renderer.lost)return false;
    if(!pending)return true;
    // A zero timeout is essential: no finish(), positive wait or busy loop.
    const status=gl.clientWaitSync(pending,0,0);
    if(status===gl.TIMEOUT_EXPIRED){stats.skipped++;return false;}
    if(status===gl.WAIT_FAILED)stats.failed++;
    clear();return true;
  }
  function submitted(){
    clear();
    pending=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
    gl.flush();stats.submitted++;
  }
  return {ready,submitted,clear,stats};
}
