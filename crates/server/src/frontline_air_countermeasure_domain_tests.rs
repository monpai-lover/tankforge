//! Exercise the real frontline command path; client poses and stocks are never inputs.
use super::*;

struct Fixture { hub:FrontlineHub, unit:UnitRef, epoch:u64 }
impl Fixture {
    fn new(aircraft:&str)->Self {
        let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let mut hub=FrontlineHub::new(&data).unwrap();
        for (player,command) in [
            (1,Command::Create{name:"Native countermeasures".into(),map:"taiwan".into(),observer:true,era:2022}),
            (2,Command::Join{room:1,observer:false,team:Some(Team::Blue)}),
            (3,Command::Join{room:1,observer:false,team:Some(Team::Blue)}),
            (1,Command::Start),
            (2,Command::DeployAir{aircraft:aircraft.into(),spawn:"air".into(),loadout:0,custom:None,fuel_minutes:None}),
        ] {let out=hub.handle(player,command,0.0);assert!(!out.iter().any(|(_,m)|matches!(m,Update::Error{..})),"aircraft fixture {aircraft}: {out:?}");}
        let p=&hub.rooms[&1].members[&2].view;
        let (unit,epoch)=(p.controlled.unwrap(),p.epoch);
        Self{hub,unit,epoch}
    }
    fn view(&self)->Value {serde_json::to_value(self.hub.rooms[&1].air.views().into_iter().find(|v|v.unit==self.unit).unwrap()).unwrap()}
    fn release(&mut self,player:u32,unit:UnitRef,epoch:u64,seq:u64,kind:&str)->Vec<(u32,Update)> {
        let command=serde_json::from_value(json!({"op":"air_countermeasure","unit":unit,"epoch":epoch,"seq":seq,"kind":kind})).expect("native countermeasure intent must parse");
        self.hub.handle(player,command,0.0)
    }
}
fn is_error(out:&[(u32,Update)],code:&str)->bool {out.iter().any(|(_,m)|matches!(m,Update::Error{code:c,..} if c==code))}

#[test]
fn native_countermeasure_host_stock_cooldown_and_snapshots_are_idempotent() {
    let mut f=Fixture::new("su27");let before=f.view();
    assert!(before["countermeasures"]["flares"].as_u64().unwrap_or(0)>2,"actual exported aircraft capacities must be present");
    assert!(!f.release(2,f.unit,f.epoch,1,"both").iter().any(|(_,m)|matches!(m,Update::Error{..})));
    let after=f.view();
    for kind in ["flares","chaff"] {assert_eq!(after["countermeasures"][kind].as_u64().unwrap()+2,before["countermeasures"][kind].as_u64().unwrap());}
    assert_eq!(after["decoys"].as_array().unwrap().len(),4);
    assert_eq!(after["countermeasures"]["release_seq"],1);
    assert_eq!(f.view(),after,"reading the same accepted snapshot cannot release again");
    assert!(is_error(&f.release(2,f.unit,f.epoch,2,"flares"),"countermeasure_rejected"));
    assert_eq!(f.view(),after,"cycling dispenser rejection cannot spend inventory");
    assert_eq!(f.hub.rooms[&1].air.units[&f.unit.unit].last_seq,1,"failed release cannot consume an action sequence");
}

#[test]
fn native_countermeasure_control_life_epoch_sequence_and_replay_are_guarded() {
    let mut f=Fixture::new("su27");let before=f.view();
    for (player,unit,epoch,seq,code) in [
        (1,f.unit,f.epoch,1,"observer"),
        (3,f.unit,f.epoch,1,"stale_control"),
        (2,UnitRef{battle:f.unit.battle+1,..f.unit},f.epoch,1,"stale_control"),
        (2,UnitRef{life:f.unit.life+1,..f.unit},f.epoch,1,"stale_control"),
        (2,f.unit,f.epoch+1,1,"stale_control"),
        (2,f.unit,f.epoch,0,"stale_input"),
    ] {assert!(is_error(&f.release(player,unit,epoch,seq,"flares"),code));assert_eq!(f.view(),before);}
    assert!(is_error(&f.release(2,f.unit,f.epoch,1,"bogus"),"countermeasure_rejected"));assert_eq!(f.view(),before);
    f.release(2,f.unit,f.epoch,1,"flares");let accepted=f.view();
    assert!(is_error(&f.release(2,f.unit,f.epoch,1,"flares"),"stale_input"));assert_eq!(f.view(),accepted);
}

#[test]
fn native_countermeasure_unfitted_aircraft_cannot_create_stock_or_decoys() {
    let mut f=Fixture::new("f86f");let before=f.view();
    assert!(is_error(&f.release(2,f.unit,f.epoch,1,"both"),"countermeasure_rejected"));
    assert_eq!(f.view(),before);
    assert!(before["decoys"].as_array().is_some_and(|v|v.is_empty()));
}
