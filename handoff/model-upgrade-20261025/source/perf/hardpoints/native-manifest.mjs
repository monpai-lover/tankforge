import fs from'node:fs';
const map=JSON.parse(fs.readFileSync(new URL('./native-layout-map.json',import.meta.url)));
fs.writeFileSync(new URL('./f15-native-host-map.json',import.meta.url),JSON.stringify({...map,models:{f15c:map.models.f15c}},null,2)+'\n');
console.log('F15 measured/inferred initial-layout handoff refreshed from final full map');
