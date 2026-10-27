/** The supplied MiG-21MF pack retained four opaque black disks where its
 * removed source stores' caps used to be. They are isolated alpha-test
 * remnants, not the launch rails (source05), and are empty even with no stores.
 * Keep array indices and the original immutable bytes: measured hardware
 * bindings address parts 51/60 and must not shift. Zeroing only these two
 * signature-checked draw ranges removes them from render and triangle hitbox.
 */
export const MIG21_SOURCE='db84ea973ae3dbb337e4c7c711cf5c36d6e53413d9f4ee2bbfc47daf9ee94a30';
export const MIG21_ORPHANS=[
 {index:58,name:'wing_l_source17',group:'wing_l',vertices:146,triangles:240,pos:2042036,nor:2042912,uv:2043352,idx:2043936},
 {index:67,name:'wing_r_source17',group:'wing_r',vertices:146,triangles:240,pos:2169068,nor:2169944,uv:2170384,idx:2170968}
];
export function normalizeModel(id,m){
 if(id!=='mig21'||m?.sourceHashes?.main!==MIG21_SOURCE||m.version!==2||Math.abs(m.posScale-1/3000)>1e-12||m.sourceOrphanCleanup===1)return m;
 if(MIG21_ORPHANS.some(({index,...signature})=>{const p=m.parts?.[index];return !p||p.textured!==false||p.alphaTest!==true||p.mover!=null||!p.colour?.every(c=>c===0)||Object.entries(signature).some(([k,v])=>p[k]!==v);}))return m;
 const parts=m.parts.slice();for(const {index}of MIG21_ORPHANS)parts[index]={...parts[index],triangles:0,removedSourceOrphanTriangles:parts[index].triangles};
 return{...m,parts,sourceOrphanCleanup:1};
}
