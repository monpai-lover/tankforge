// Run on the debug handoff page with __tf/__tfx and pyShot.
const tf=window.__tf,x=window.__tfx,G=tf.G;
const check=(condition,message)=>{if(!condition)throw Error(message);};
const next=()=>new Promise(resolve=>setTimeout(resolve,0));
await tf.coreReady();await x.flightCoreP;tf.pause(true);tf.finishThumbs();
tf.setQuality('low');tf.renderer.q={...tf.renderer.q,dome:64,cloudSteps:4};tf.renderer._buildDome(64);
if(G.air?.active)x.exitAircraft(true);
document.querySelector('.hangar-card[data-air=nf01]').click();
for(let i=0;i<120&&!(G.air?.active&&G.air.plane.type.id==='nf01');i++){tf.advance(1/60,[],false);await next();}
check(G.air?.active&&G.air.plane.type.id==='nf01','NF01 did not board');
const plane=G.air.plane,recorder=plane.diagnostics;
plane.spawn(-8000,3000,-8000,0,140,false);
tf.advance(.2,[],false);
check(!recorder.enabled&&recorder.count===0,'diagnostics sampled while disabled');
const press=(repeat=false)=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'F10',repeat,bubbles:true,cancelable:true}));
press();check(recorder.enabled,'F10 did not enable diagnostics');
press(true);check(recorder.enabled,'repeated F10 changed diagnostics');
window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',bubbles:true,cancelable:true}));
tf.advance(3.2,[],false);
window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyS',bubbles:true,cancelable:true}));
// HUD text is refreshed every fourth rendered frame; skip-draw simulation steps do not tick it.
for(let i=0;i<4;i++)tf.advance(1/60,[],true);
const panel=document.getElementById('air-diag-panel'),chart=panel.querySelector('canvas');
check(!panel.hidden,'diagnostic panel is hidden');
check(recorder.count>=90&&recorder.count<=105,'diagnostic sample rate is not 30Hz');
check(/角速度|Rates command\/actual/.test(panel.querySelector('pre').textContent),'diagnostic display did not consume telemetry');
check(chart.getContext('2d').getImageData(0,0,chart.width,chart.height).data.some((value,index)=>index%4===3&&value>0),'diagnostic plot is empty');
const csv=recorder.toCSV(),lines=csv.trim().split('\r\n'),columns=lines[0].split(',');
check(recorder.snapshot().some(row=>row[columns.indexOf('input_pitch')]===1),'CSV did not capture actual keyboard pitch input');
check(lines.length===recorder.count+1,'CSV row count differs from captured history');
for(const field of ['core_version','kernel_time_s','physics_dt_s','input_pitch','kernel_input_target_x','command_pitch_deg_s','actual_pitch_deg_s','aoa_gate_negative','g_gate_negative','g_limit_negative','flaps','flap_stage','flap_target'])check(columns.includes(field),`missing CSV field ${field}`);
check(recorder.snapshot().every(row=>row[columns.indexOf('schema')]===2),'CSV did not use flap-aware schema 2');
check(csv.includes(',204,'),'CSV kernel version is not the rebuilt core');
const exportButton=document.getElementById('air-diag-export');check(!exportButton.disabled,'CSV export button is disabled');exportButton.click();await next();
await pyShot('flight-diagnostics');
const before=recorder.count;press();check(!recorder.enabled&&panel.hidden,'F10 did not close diagnostics');
tf.advance(1,[],false);check(recorder.count===before,'closed diagnostics kept sampling');
check(recorder.toCSV()===csv,'closed diagnostics changed captured history');
return {coreVersion:plane.api.core_version(),sampleCount:before,csvColumns:columns.length,csvRows:lines.length-1,disabledCount:recorder.count,ringCapacity:recorder.capacity,disabledPanelHidden:panel.hidden,csvBytes:csv.length};
