//! Original aircraft weapon UI intents must be accepted and executed natively.
use super::*;
use crate::frontline_air::AirUnitView;

fn data_path() -> std::path::PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data") }
fn accepted(out: Vec<(u32, Update)>) {
    assert!(!out.iter().any(|(_,u)|matches!(u,Update::Error{..})),"unexpected native rejection: {out:?}");
}
fn weapon_command(reference: UnitRef, epoch:u64, seq:u64, id:Option<&str>, index:Option<usize>, program:&str, guns:&str) -> Command {
    serde_json::from_value(json!({"op":"air_weapon_control","unit":reference,"epoch":epoch,"seq":seq,
        "store_id":id,"store_index":index,"program":program,"gun_mode":guns}))
        .expect("native protocol must admit the original aircraft weapon selection intent")
}
struct Fixture { hub:FrontlineHub, reference:UnitRef, epoch:u64, seq:u64, now:f64 }
impl Fixture {
    fn new(aircraft:&str, custom:Option<BTreeMap<String,String>>) -> Self {
        let mut hub=FrontlineHub::new(&data_path()).unwrap();
        accepted(hub.handle(1,Command::Create{name:"Native selected weapons".into(),map:"taiwan".into(),observer:true,era:2022},0.0));
        accepted(hub.handle(2,Command::Join{room:1,observer:false,team:Some(Team::Blue)},0.0));
        accepted(hub.handle(1,Command::Start,0.0));
        accepted(hub.handle(2,Command::DeployAir{aircraft:aircraft.into(),spawn:"air".into(),loadout:0,custom, fuel_minutes: None},0.0));
        let member=&hub.rooms[&1].members[&2].view;
        let (reference,epoch)=(member.controlled.unwrap(),member.epoch);
        Self{hub,reference,epoch,seq:0,now:0.0}
    }
    fn mixed() -> Self {
        Self::new("su25",Some(BTreeMap::from([
            ("p2".into(),"fab500".into()),("p3".into(),"ub16".into()),
            ("p4".into(),"fab500".into()),("p5".into(),"ptb800".into())
        ])))
    }
    fn view(&self) -> AirUnitView { self.hub.rooms[&1].air.views().into_iter().find(|v|v.unit==self.reference).unwrap() }
    fn select(&mut self,id:Option<&str>,index:Option<usize>,program:&str,guns:&str) {
        self.seq+=1;
        accepted(self.hub.handle(2,weapon_command(self.reference,self.epoch,self.seq,id,index,program,guns),self.now));
    }
    fn tick(&mut self,fire:bool,release:bool) -> Vec<Value> {
        self.seq+=1;
        accepted(self.hub.handle(2,Command::AirInput{unit:self.reference,epoch:self.epoch,seq:self.seq,
            aim:[0.0,0.0,1.0],throttle:0.75,manual_pitch:0.0,manual_roll:0.0,manual_yaw:0.0,
            flags:1,fire,release},self.now));
        self.now+=STEP;
        self.hub.tick(self.now+1e-8).into_iter().filter(|(to,_)|to.contains(&1)).flat_map(|(_,update)| {
            match update {Update::Frame{events,..}=>events,_=>Vec::new()}
        }).filter(|event|event["shooter"]["unit"].as_u64()==Some(self.reference.unit)).collect()
    }
    fn count(&self,id:&str)->u64 {
        self.view().stores.iter().filter(|s|s["id"]==id&&!s["gone"].as_bool().unwrap_or(false))
            .map(|s|s["count"].as_u64().unwrap()).sum()
    }
    fn store_shots(events:&[Value])->usize {events.iter().filter(|e|e["kind"]=="shot"&&e["detail"]["store"]==true).count()}
}

#[test]
fn air_weapon_control_selects_native_store_family_and_single_is_one_rising_edge() {
    let mut f=Fixture::mixed();
    let bombs=f.count("fab500");
    f.select(Some("ub16"),None,"single","all");
    let mut shots=Vec::new();
    for _ in 0..6 {shots.extend(f.tick(false,true));}
    assert_eq!(Fixture::store_shots(&shots),1);
    assert_eq!(f.count("ub16"),15);
    assert_eq!(f.count("fab500"),bombs,"selecting rockets must not drop the first bomb");
    f.select(Some("ub16"),None,"single","all");
    assert_eq!(Fixture::store_shots(&f.tick(false,true)),0,"selection command cannot manufacture a new rising edge");
    f.tick(false,false);
    assert_eq!(Fixture::store_shots(&f.tick(false,true)),1);
    assert_eq!(f.count("ub16"),14);
}

#[test]
fn air_weapon_control_individual_pylon_and_explicit_empty_selection_never_fall_back() {
    let mut f=Fixture::mixed();
    let index=f.view().stores.iter().position(|s|s["station"]=="p4").unwrap();
    f.select(Some("fab500"),Some(index),"single","all");
    assert_eq!(Fixture::store_shots(&f.tick(false,true)),1);
    assert!(f.view().stores[index]["gone"]==true);
    assert_eq!(f.count("fab500"),1,"the other bomb station remains loaded");
    for _ in 0..4 {f.tick(false,false);}
    f.select(Some("fab500"),Some(index),"single","all");
    assert_eq!(Fixture::store_shots(&f.tick(false,true)),0,"empty known pylon is selectable but cannot borrow another station");
    f.tick(false,false);
    f.select(None,None,"single","all");
    assert_eq!(Fixture::store_shots(&f.tick(false,true)),0,"explicit no-store selection does not release a different payload");
    assert_eq!(f.count("fab500"),1);
    assert_eq!(f.count("ub16"),16);
}

#[test]
fn air_weapon_control_original_pair_four_eight_and_all_programs_are_bounded_and_scheduled() {
    let mut pair=Fixture::mixed();
    pair.select(Some("fab500"),None,"pair","all");
    let events=pair.tick(false,true);
    assert_eq!(Fixture::store_shots(&events),2);
    assert_eq!(pair.count("fab500"),0);
    assert_eq!(pair.count("ub16"),16);
    assert_eq!(Fixture::store_shots(&pair.tick(false,true)),0);

    let mut four=Fixture::new("su25",Some(BTreeMap::from([
        ("p2".into(),"fab500".into()),("p3".into(),"fab500".into()),
        ("p4".into(),"fab500".into()),("p5".into(),"fab500".into())
    ])));
    four.select(Some("fab500"),None,"s4","all");
    let first=four.tick(false,true);
    assert_eq!(Fixture::store_shots(&first),1,"bomb salvo starts one round, rather than an instantaneous inventory dump");
    assert_eq!(four.count("fab500"),3);
    let mut shots=Fixture::store_shots(&first);
    for _ in 0..3 {shots+=Fixture::store_shots(&four.tick(false,false));}
    assert_eq!(shots,1,"the source0.2-second bomb interval cannot collapse into an immediate burst");
    for _ in 0..11 {shots+=Fixture::store_shots(&four.tick(false,false));}
    assert_eq!(shots,4,"the source four-bomb burst continues at0.2s intervals after key-up");
    assert_eq!(four.count("fab500"),0);

    let mut eight=Fixture::mixed();
    eight.select(Some("ub16"),None,"s8","all");
    let first=eight.tick(false,true);
    assert_eq!(Fixture::store_shots(&first),1);
    let mut shots=Fixture::store_shots(&first);
    for _ in 0..4 {shots+=Fixture::store_shots(&eight.tick(false,false));}
    assert_eq!(shots,3,"rocket rounds are scheduled at the original0.08-second interval");
    for _ in 0..9 {shots+=Fixture::store_shots(&eight.tick(false,false));}
    assert_eq!(shots,8);
    assert_eq!(eight.count("ub16"),8);
    assert_eq!(eight.count("fab500"),2);
    eight.select(Some("ub16"),None,"s4","all");
    let mut shots=Fixture::store_shots(&eight.tick(false,true));
    for _ in 0..9 {shots+=Fixture::store_shots(&eight.tick(false,false));}
    assert_eq!(shots,4);
    assert_eq!(eight.count("ub16"),4);

    let mut all=Fixture::mixed();
    all.select(Some("fab500"),None,"all","all");
    assert_eq!(Fixture::store_shots(&all.tick(false,true)),1);
    for _ in 0..6 {all.tick(false,false);}
    assert_eq!(all.count("fab500"),0,"all ends at actual remaining bombs");
    assert_eq!(all.count("ub16"),16);
    assert_eq!(all.count("ptb800"),1);
    assert_eq!(Fixture::store_shots(&all.tick(false,true)),0,"completed bomb burst cannot borrow rockets");
}

#[test]
fn air_weapon_control_original_held_ripple_uses_host_point_eleven_second_cooldown() {
    let mut f=Fixture::mixed();
    f.select(Some("ub16"),None,"held","all");
    let mut shots=Vec::new();
    for _ in 0..9 {shots.extend(f.tick(false,true));}
    let count=Fixture::store_shots(&shots);
    assert_eq!(count,4,"held ripple must use the original0.11-second cooldown");
    assert_eq!(f.count("ub16"),16-count as u64);
    assert_eq!(f.count("fab500"),2);
    let remaining=f.count("ub16");
    for _ in 0..4 {f.tick(false,false);}
    assert_eq!(f.count("ub16"),remaining,"releasing the key stops the ripple");
}

#[test]
fn air_weapon_control_cannon_trigger_excludes_machine_guns_but_includes_native_gunpods() {
    let mut f=Fixture::new("fw190a8",None);
    let before=f.view();
    f.select(None,None,"single","cannon");
    let events=f.tick(true,false);
    let after=f.view();
    for gun in &before.guns {
        let remaining=after.guns.iter().find(|g|g.id==gun.id).unwrap().ammo;
        if gun.id.starts_with("air_mg131") {assert_eq!(remaining,gun.ammo,"13mm machine guns do not fire on cannon trigger");}
        else {assert!(remaining<gun.ammo,"20mm cannon must actually fire");}
    }
    assert!(events.iter().filter(|e|e["kind"]=="shot").all(|e|e["detail"]["caliber_mm"].as_f64().is_some_and(|c|c>=20.0)));
    f.select(None,None,"single","all");
    f.tick(true,false);
    assert!(f.view().guns.iter().filter(|g|g.id.starts_with("air_mg131")).all(|g|g.ammo<before.guns.iter().find(|b|b.id==g.id).unwrap().ammo));
    let mut pod=Fixture::new("su25",Some(BTreeMap::from([("p2".into(),"sppu22".into())])));
    pod.select(None,None,"single","cannon");
    let events=pod.tick(true,false);
    assert!(events.iter().any(|e|e["kind"]=="shot"&&e["detail"]["weapon_instance"].as_str().is_some_and(|id|id.starts_with("air_pod_"))&&e["detail"]["caliber_mm"]==23.0),"accepted23mm pod is a cannon feed");
}

#[test]
fn air_weapon_control_requires_owned_life_epoch_and_sequence_and_rejects_unaccepted_choices() {
    let mut f=Fixture::mixed();
    accepted(f.hub.handle(3,Command::Join{room:1,observer:false,team:Some(Team::Red)},0.0));
    let before=serde_json::to_value(f.view()).unwrap();
    let requests=[
        weapon_command(f.reference,f.epoch,1,Some("invented_payload"),None,"single","all"),
        weapon_command(f.reference,f.epoch,1,Some("ub16"),Some(999),"single","all"),
        weapon_command(f.reference,f.epoch,1,Some("ub16"),Some(0),"single","all"),
        weapon_command(f.reference,f.epoch,1,Some("fab500"),None,"s8","all"),
        weapon_command(f.reference,f.epoch,1,Some("fab500"),None,"held","all"),
        weapon_command(f.reference,f.epoch,1,Some("ub16"),None,"pair","all"),
        weapon_command(f.reference,f.epoch,1,Some("ub16"),None,"all","all"),
        weapon_command(f.reference,f.epoch,1,None,None,"client_burst_999","all"),
        weapon_command(f.reference,f.epoch,1,None,None,"single","client_everything"),
    ];
    for command in requests {
        let out=f.hub.handle(2,command,0.0);
        assert!(out.iter().any(|(_,u)|matches!(u,Update::Error{..})),"bad selection must be rejected: {out:?}");
        assert_eq!(serde_json::to_value(f.view()).unwrap(),before,"rejected selection cannot alter resources or accepted control");
    }
    for (player,reference,epoch,seq) in [
        (1,f.reference,f.epoch,1),
        (3,f.reference,f.epoch,1),
        (2,UnitRef{life:f.reference.life+1,..f.reference},f.epoch,1),
        (2,UnitRef{battle:f.reference.battle+1,..f.reference},f.epoch,1),
        (2,f.reference,f.epoch+1,1),
        (2,f.reference,f.epoch,0),
    ] {
        let out=f.hub.handle(player,weapon_command(reference,epoch,seq,Some("ub16"),None,"single","all"),0.0);
        assert!(out.iter().any(|(_,u)|matches!(u,Update::Error{..})),"invalid authority must be rejected: {out:?}");
    }
    f.select(Some("ub16"),None,"single","all");
    let echo=serde_json::to_value(f.view()).unwrap();
    assert_eq!(echo["weapon_control"]["store_id"],"ub16");
    assert_eq!(echo["weapon_control"]["program"],"single");
    assert!(serde_json::from_value::<Command>(json!({"op":"air_weapon_control","unit":f.reference,"epoch":f.epoch,"seq":9,"store_id":"ub16","store_index":null,"program":"all","gun_mode":"all","count":999,"mass":0})).is_err(),"protocol cannot admit client-authored projectile counts or mass");
    let position=f.hub.rooms[&1].air.units[&f.reference.unit].pos();
    f.hub.rooms.get_mut(&1).unwrap().air.blast(position,2000.0,1,97,false,None);
    assert!(!f.hub.rooms[&1].air.units[&f.reference.unit].alive());
    let dead=f.hub.handle(2,weapon_command(f.reference,f.epoch,99,Some("ub16"),None,"single","all"),0.0);
    assert!(dead.iter().any(|(_,u)|matches!(u,Update::Error{code,..} if code=="destroyed")));
    let room=f.hub.rooms.get_mut(&1).unwrap();room.started=false;room.finished=true;
    let denied=f.hub.handle(2,weapon_command(f.reference,f.epoch,99,Some("ub16"),None,"single","all"),0.0);
    assert!(denied.iter().any(|(_,u)|matches!(u,Update::Error{code,..} if code=="round_ended")));
}
