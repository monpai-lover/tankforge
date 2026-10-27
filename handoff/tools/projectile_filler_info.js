// Information only: the catalog stores actual explosive mass, not TNT-equivalent
// mass. Never run a damage-strength conversion before presenting filler grams.
function projectileFillerLabel(shell,language='zh') {
  const mass=shell?.explosive_mass_kg,en=language==='en';
  if(typeof mass!=='number'||!Number.isFinite(mass)||mass<0)return en?'Filler data unverified':'裝藥資料未核實';
  if(mass===0)return en?'Explosive filler 0 g':'炸藥裝藥 0 g';
  const names={tnt:'TNT',petn:'PETN',hexogen:'RDX',rdx:'RDX',comp_b:'Composition B',explosive_d:'Explosive D',a_ix_1:'A-IX-1',a_ix_2:'A-IX-2',amatol:'Amatol',okfol:'Okfol',tritonal:'Tritonal',cyclotol:'Cyclotol',pbxn:'PBXN'};
  const grams=Number((mass*1000).toFixed(3)),material=names[shell.explosive_type]||shell.explosive_type|| (en?'unverified material':'材料未核實');
  return `${en?'Filler':'裝藥'} ${grams} g · ${material}`;
}
function projectileInfoEscape(value) {
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function aircraftBeltFillerInfo(guns,projectiles,bulletFactory,language='zh') {
  const rows=[],seen=new Set();
  for(const gun of guns||[]){
    const belt=gun.belt?.length?gun.belt:null,counts=new Map();
    for(const id of belt||[])counts.set(id,(counts.get(id)||0)+1);
    const entries=belt?[...counts].map(([id,n])=>[projectiles[id],n]):[[bulletFactory(gun),1]];
    const signature=JSON.stringify(entries.map(([shell,n])=>[shell?.id,n]));
    if(seen.has(signature))continue;seen.add(signature);
    rows.push(entries.map(([shell,n])=>`${projectileInfoEscape(shell?.name||shell?.id||(language==='en'?'Unknown round':'未識別彈藥'))} ×${n}: ${projectileInfoEscape(projectileFillerLabel(shell,language))}`).join('；'));
  }
  return rows.join('<br>');
}
