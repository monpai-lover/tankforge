// Native battle adapter for the completed Aircraft controls, cameras and HUD.
// Native damage and inventories remain authoritative. These original input and
// presentation callbacks feed scoped local movement without local combat.
function createEstablishedAircraftBridge({game,document,airHud,project,clearInput,syncTouch,pilotStep,systems,audio,effects,camera,drawHud,selection}) {
  if (!game || !document?.body?.dataset || !airHud) throw Error('Aircraft battle presentation dependencies are required');
  for (const [name,callback] of Object.entries({project,clearInput,syncTouch,pilotStep,systems,audio,effects,camera,drawHud,selection})) {
    if (typeof callback !== 'function') throw Error(`Missing original aircraft callback: ${name}`);
  }
  let air=null,model=null,host=null,life=null;
  function lifeKey(unit) {
    const ref=unit?.unit;
    if (unit?.sensed || !ref || ![ref.battle,ref.unit,ref.life].every(Number.isSafeInteger)) throw Error('Private native aircraft life is required');
    return `${ref.battle}:${ref.unit}:${ref.life}`;
  }
  function bind(nextModel,unit) {
    if (!nextModel?.plane) throw Error('Original native Aircraft model is required');
    const nextLife=lifeKey(unit),accepted=project(unit,nextModel);
    if (!accepted || !Array.isArray(accepted.guns) || !accepted.stores || !Array.isArray(accepted.stores.items)) throw Error('Accepted aircraft resource projection is required');
    if (!air || air.plane!==nextModel.plane || life!==nextLife) {
      unbind();
      model=nextModel;life=nextLife;
      air={plane:model.plane,active:true,nativeAuthority:true};
    }
    model=nextModel;host=unit;
    // The projector owns these stable display reservoirs. Do not merge host
    // objects into the air shell: that would overwrite ctl, camera or pilot aim.
    air.guns=accepted.guns;air.stores=accepted.stores;air.fuel=accepted.fuel;
    air.resourceRevision=accepted.resourceRevision ?? unit.resource_revision;
    air.active=true;air.nativeAuthority=true;
    game.air=air;game.mode='battle';document.body.dataset.mode='battle';
    document.body.dataset.air='1';airHud.hidden=false;
    air.plane.instrumentContext=air;
    return air;
  }
  function unbind() {
    if (!air) return;
    clearInput(air);
    air.storeHeld=air.storeTap=false;air.nativeIntent=null;air.active=false;
    if (air.plane.instrumentContext===air) air.plane.instrumentContext=null;
    if (game.air===air) {
      game.air=null;document.body.dataset.air='0';airHud.hidden=true;
    }
    // The native world owns model/plane lifetime and GPU resources.
    air=null;model=null;host=null;life=null;
  }
  function step(dt) {
    if (!air?.active) return;
    syncTouch(air,dt);pilotStep(air,dt);systems(air,dt);audio(air,dt);effects(air,dt);
  }
  function intent() {
    if (!air?.active || !air.nativeIntent) return null;
    return {...air.nativeIntent,aim:air.nativeIntent.aim.slice(),
      fire:!!(air.fireAll || air.inputFireAll || air.fireCannon || air.inputFireCannon),
      release:!!(air.storeHeld || air.storeTap)};
  }
  function consumeIntent() {
    if (air) air.storeTap=false;
  }
  return {bind,unbind,step,intent,consumeIntent,
    selection:()=>air?.active?selection(air,host,model):null,
    view:(dt,heightAt)=>air?.active?camera(air,dt,heightAt):null,
    draw:(viewProj,cw,ch)=>air?.active?drawHud(air,viewProj,cw,ch):null,
    getair:()=>air};
}
