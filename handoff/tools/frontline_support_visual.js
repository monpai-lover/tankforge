// A campaign conversion retains its actual registered chassis and running gear.
// Native owns its stripped weapon contacts, zero stock and hard fire denial.
// This presentation removes the corresponding source weapon parts as well.
function frontlineSupportLoadout(loadout,unit){
  if(!unit.role||unit.role==='combat')return loadout;
  const c=unit.campaign_conversion;
  if(!['engineer','supply'].includes(unit.role)||c?.kind!=='campaign_support_conversion'||c.role!==unit.role||c.chassis!==unit.vehicle||c.prototype!==true)throw Error('Invalid support conversion');
  const weapon=new Set(['turret','gun','barrel']);
  return {...loadout,visual:{...loadout.visual,parts:loadout.visual.parts.filter(p=>!weapon.has(p.mount))},
    imported:loadout.imported?{...loadout.imported,parts:loadout.imported.parts.filter(p=>!weapon.has(p.mount))}:null,
    turrets:[],machineGuns:[],gunCount:0};
}
function frontlineSupportStatus(task,job){
  const status=job?.status||task?.status;
  const names={queued:'等待可通行路线',moving:'驶向设施',travelling:'驶向设施',stopping:'停车准备作业',working:'作业中',waiting_for_unit:'等待支援车到场',paused_unit_away:'等待支援车就位',complete:'已完成',interrupted:'目标状态已变化，请重新派遣',cancelled:'已取消',cancelled_unit_lost:'支援车已损失',cancelled_unit_replaced:'支援车已更换',restart_required_revision:'设施再次受损，请重新派遣'};
  let text=names[status]||(status?'等待服务器确认':'待命');
  if(job&&Number.isFinite(job.elapsed_s)&&Number.isFinite(job.duration_s)&&job.duration_s>0&&status==='working')text+=` ${Math.min(100,Math.max(0,job.elapsed_s/job.duration_s*100)).toFixed(0)}%${job.boosted?' · 护送补给加速':''}`;
  return text;
}
