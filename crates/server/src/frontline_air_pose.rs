//! Client-owned flight samples, admitted independently from native combat state.
use super::*;

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AirPose {
    pub position: [f32; 3],
    pub quaternion: [f32; 4],
    pub velocity: [f32; 3],
    pub angular_velocity: [f32; 3],
    pub sample_time_s: f32,
}
pub(super) struct PoseAdmission {
    epoch: u64,
    pose: AirPose,
    first_client_time: f64,
    first_server_time: f64,
    last_server_time: f64,
}
fn magnitude(v: &[f32]) -> f64 { v.iter().map(|x| (*x as f64).powi(2)).sum::<f64>().sqrt() }
fn separation(a: &[f32], b: &[f32]) -> f64 { a.iter().zip(b).map(|(a,b)|(*a as f64-*b as f64).powi(2)).sum::<f64>().sqrt() }

impl AirWorld {
    pub fn accept_pose(&mut self, id: u64, epoch: u64, mut pose: AirPose, now: f64) -> Result<AirPose, String> {
        let u=self.units.get(&id).ok_or("unknown_aircraft")?;
        if u.controller.is_none() || u.epoch!=epoch || !u.alive() || u.parked {return Err("inactive_flight_control".into());}
        if !now.is_finite() || !pose.sample_time_s.is_finite() || pose.sample_time_s<0.0 || pose.sample_time_s>1e7 ||
            !pose.position.iter().chain(&pose.quaternion).chain(&pose.velocity).chain(&pose.angular_velocity).all(|x|x.is_finite()) {
            return Err("nonfinite_flight_pose".into());
        }
        if pose.position.iter().any(|x|x.abs()>1e7) {return Err("flight_position_out_of_bounds".into());}
        let qnorm=magnitude(&pose.quaternion);
        if !(0.99..=1.01).contains(&qnorm) {return Err("invalid_flight_rotation".into());}
        pose.quaternion=pose.quaternion.map(|x|x/qnorm as f32);
        if pose.angular_velocity.iter().zip([2.8001,2.0001,4.0001]).any(|(x,max)|x.abs()>max) {
            return Err("flight_rotation_rate_out_of_bounds".into());
        }
        // Structural damage remains a separate native exposure calculation.
        // This loose movement envelope admits measured supersonic/dive flight.
        let speed=magnitude(&pose.velocity);
        let max_speed=self.template.limits.aircraft.get(&u.aircraft).map_or(1800.0,|l|
            (l.structural.ias_kmh/3.6*(pose.position[1].max(0.0) as f64/17000.0).exp()*2.0).clamp(400.0,1800.0));
        if speed>max_speed {return Err("flight_speed_out_of_bounds".into());}
        let previous=u.pose_admission.as_ref().filter(|p|p.epoch==epoch);
        let clock_valid=previous.is_none_or(|last|{
            let elapsed=pose.sample_time_s as f64-last.pose.sample_time_s as f64;
            let relative=pose.sample_time_s as f64-last.first_client_time-(now-last.first_server_time);
            (0.0001..=0.5).contains(&elapsed)&&(-0.5..=0.15).contains(&relative)&&now>=last.last_server_time
        });
        // A paused/backgrounded client may rebase only near the current native
        // predictor after a quiet interval, never by resetting a teleport budget.
        let recovering=!clock_valid&&previous.is_some_and(|last|now-last.last_server_time>=0.25)
            &&(pose.sample_time_s-u.state[23]).abs()<=0.35;
        if !clock_valid&&!recovering{return Err("stale_or_fast_flight_clock".into());}
        let previous=if recovering{None}else{previous};
        let (old_position,old_velocity,old_quaternion,old_omega,dt)=if let Some(last)=previous {
            let elapsed=pose.sample_time_s as f64-last.pose.sample_time_s as f64;
            (last.pose.position,last.pose.velocity,last.pose.quaternion,last.pose.angular_velocity,elapsed)
        }else{
            let age=(pose.sample_time_s-u.state[23]).abs() as f64;
            if age>0.35{return Err("stale_initial_flight_pose".into());}
            let elapsed=age.clamp(0.05,0.35);
            ([u.state[0],u.state[1],u.state[2]],[u.state[7],u.state[8],u.state[9]],
             [u.state[3],u.state[4],u.state[5],u.state[6]],[u.state[10],u.state[11],u.state[12]],elapsed)
        };
        let max_accel=(u.profile.physics.envelope[0] as f64*9.80665+
            u.profile.physics.airframe[12] as f64/u.profile.physics.airframe[0] as f64+20.0).clamp(80.0,250.0);
        let distance=separation(&pose.position,&old_position);
        if distance>speed.max(magnitude(&old_velocity))*dt+0.5*max_accel*dt*dt+2.0 {
            return Err("flight_teleport_rejected".into());
        }
        if separation(&pose.velocity,&old_velocity)>max_accel*dt+8.0 {return Err("flight_acceleration_out_of_bounds".into());}
        let old_qnorm=magnitude(&old_quaternion).max(0.01);
        let dot=pose.quaternion.iter().zip(old_quaternion).map(|(a,b)|*a as f64*b as f64/old_qnorm).sum::<f64>().abs().clamp(0.0,1.0);
        let angle=2.0*dot.acos();
        if angle>magnitude(&pose.angular_velocity).max(magnitude(&old_omega))*dt+0.20 {return Err("flight_orientation_jump".into());}
        if u.servicing() && (distance>0.25 || speed>0.5) {return Err("flight_moved_during_service".into());}
        // Sweep the movement chord through the same terrain/ocean surface used
        // by the native kernel; clients cannot tunnel below hills between poses.
        for step in 0..=8 {
            let t=step as f64/8.0;
            let p: [f64;3]=std::array::from_fn(|i|old_position[i] as f64+(pose.position[i] as f64-old_position[i] as f64)*t);
            let terrain=self.ground.height(p[0],p[2]);
            let surface=match self.ground.water_level(p[0],p[2]) {Some(w) if !self.ground.contains(p[0],p[2])=>w,Some(w)=>terrain.max(w),None=>terrain};
            if p[1]<surface+1.9 {return Err("flight_intersects_terrain".into());}
        }
        let first_client_time=previous.map_or(pose.sample_time_s as f64,|p|p.first_client_time);
        let first_server_time=previous.map_or(now,|p|p.first_server_time);
        let u=self.units.get_mut(&id).unwrap();
        u.runtime.adopt_kinematics(&pose.position,&pose.quaternion,&pose.velocity,&pose.angular_velocity).map_err(|e|e.to_string())?;
        let telemetry=u.runtime.telemetry().map_err(|e|e.to_string())?;
        u.state=telemetry.state;u.aero=telemetry.aero;
        u.pose_admission=Some(PoseAdmission{epoch,pose:pose.clone(),first_client_time,first_server_time,last_server_time:now});
        Ok(pose)
    }
}
