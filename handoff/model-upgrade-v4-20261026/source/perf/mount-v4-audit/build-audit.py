import json,hashlib,pathlib
root=pathlib.Path(__file__).resolve().parents[2]
catalog=json.loads((root/'perf/mount-v3/catalog-capabilities.json').read_text())
store=json.loads((root/'perf/mount-v3/store-definitions.json').read_text())
sources={
 'mig21_mf':{'url':'https://muzeumlotnictwa.pl/eksponaty/mikojan-guriewicz-mig-21mf-6504/','publisher':'Polish Aviation Museum','supports':'MiG-21MF has four wing hardpoints and four R-3S, R-3R or R-60 missiles. This does not establish R-60M as an exact variant.'},
 'f16_block70':{'url':'https://www.govinfo.gov/content/pkg/FR-2024-10-18/pdf/2024-24144.pdf','publisher':'US Government Publishing Office / Department of Defense','supports':'Opening continuation of arms-sales notification 2024-24122 describes Jordan F-16C/D Block 70, APG-83, Sniper and GBU-10 kits. It establishes aircraft-level compatibility, not a per-station clearance matrix.'},
 'f86f':{'url':'https://www.af.mil/News/Photos/igphoto/2000593829/','publisher':'US Air Force','supports':'F-86F-35 photo caption names a pair of 1000-pound or smaller bombs and eight HVAR rockets. Exact source model block is not specified in the game.'},
 'p51d':{'url':'https://www.nationalww2museum.org/visit/museum-campus/us-freedom-pavilion/warbirds/north-american-p-51-mustang','publisher':'National WWII Museum','supports':'P-51D maximum load 2000 pounds of bombs or ten five-inch rockets. This is a total aircraft limit, not evidence every mixed arrangement is valid.'},
 'f4u1d':{'url':'https://airandspace.si.edu/collection-objects/vought-f4u-1d-corsair/nasm_A19610124000','publisher':'Smithsonian National Air and Space Museum','supports':'F4U-1D operational narrative includes carriage of two 1000-pound bombs. Adding smaller AN-M64 on existing bomb stations is a game fit inference from already modelled AN-M65 capability.'},
 'mirage5':{'url':'https://www.dassault-aviation.com/en/passion/aircraft/military-dassault-aircraft/mirage-5/','publisher':'Dassault Aviation','supports':'Mirage 5 derivative was designed for tactical support; more external load attachments and up to fourteen bombs. Page explicitly discusses 50 French Mirage 5F aircraft. It does not identify the precise bomb mark or station chart.'},
 'mig29a':{'url':'https://www.nationalmuseum.af.mil/Visit/Museum-Exhibits/Fact-Sheets/Display/Article/197174/mikoyan-gurevich-mig-29a/','publisher':'National Museum of the US Air Force','supports':'Early MiG-29A six air-to-air missiles, bombs and 57mm, 80mm, 240mm rockets. This supports existing UB-16, B-8M1 and S-24B resource classes; exact station placement remains a game fit inference.'},
 'f104g':{'url':'https://www.deutsches-museum.de/flugwerft-schleissheim/ausstellung/militaerluftfahrt/f-104-g','publisher':'Deutsches Museum','supports':'Confirms F-104G multirole fighter-bomber subtype. No exact weapons or station clearance table on this page, so it is not used to authorize extra stores.'},
 'a10c':{'url':'https://www.af.mil/News/Article-Display/Article/129371/a-10-upgrade-effort-transforms-warthog-capabilities/','publisher':'US Air Force','supports':'A-10 Precision Engagement upgrade basis; prior package uses source hash and A-10C model identity guards before exposing targeting pods.'},
}
notes={
 'nf01':('fictional_existing','Game prototype; no historical real-aircraft completeness claim.'),
 'nf02':('fictional_existing','Game test platform; cross-national modern missiles are explicitly test capabilities and must not authorize them on historical carriers.'),
 'p51d':('candidate_existing_resource','AN-M65 1000lb candidate at each existing inner bomb station. Five-HVAR-per-side capacity needs a new row layout and mixed-clearance audit; do not simply raise the current count.'),
 'bf109g':('preserved_variant_guard','G-6 single center bomb station preserved. Do not add SC500 or gun pods from generic Bf109 family without its rack/variant evidence. SC50 and small-bomb racks lack exact models.'),
 'spitfire9':('preserved_variant_guard','Current 2x250lb wing plus500lb center are kept; do not borrow rockets or late Spitfire capabilities for MkIX.'),
 'mig15':('preserved_pending_exact_resources','MiG15bis 2 wing stations retained. Correct drop tanks and exact larger-bomb clearance require model and primary station evidence; no K13/R3/R60 expansion.'),
 'f86f':('candidate_existing_resource','AN-M65 1000lb candidate at each existing inner bomb station. No Sidewinder addition absent evidence that this specific F model includes that operator retrofit.'),
 'f104g':('fix_geometry_preserve_variant','Wingtip rail position fix is separate. Additional ventral catamaran rail, correct tip/wing tanks and rocket clearance need dedicated geometry; F104S Sparrow capability must not leak into F104G.'),
 'mig21':('active_repair','Expand from2 to4 wing stations and implement dedicated R3R resource/definition. R60M must not be substituted for museum-named R60 without an exact MF retrofit source. Correct MF tank shapes are not PTB800.'),
 'fw190a8':('preserved_pending_exact_rack_evidence','Existing SC500 center is retained. SC250 is a plausible same-rack candidate but no dedicated primary rack source was established in this audit. Small-bomb ER4 racks and gun/rocket kits require new models.'),
 'yak9u':('preserved_variant_guard','No external menu retained for Yak9U. Bomb carriage of Yak9B or other Yak9 derivatives is not inherited.'),
 'a6m2':('preserved_variant_guard','Model21 pair of60kg bomb stations kept. Do not inherit late A6M fighter-bomber250kg racks or suicide load configurations.'),
 'f4u1d':('candidate_existing_resource','AN-M64 500lb can be game-fitted to the same existing twin bomb stations that already allow AN-M65; exact lug interface is inferred, not a newly sourced manufacturing clearance.'),
 'me262':('preserved_source_sockets','A1a24R4M source sockets retained. No bombs borrowed from A2a.'),
 'hunter6':('preserved_variant_guard','F6 current bombs/RP3 retained. FGA9, Swiss Mk58 Maverick or experimental SRAAM capabilities are not transferred. Exact larger British bomb and tank resources missing.'),
 'mig17f':('preserved_variant_guard','Existing FAB250/UB16 at2 wing stations retained. Lim6 and Chinese export modernizations are distinct; no missile capability assumed.'),
 'mirage3e':('samp250_model_and_menu_implemented','Source identity is Mirage5F. A new independent SAMP250-class game-estimate procedural asset and symmetric inner choices are now implemented from aircraft capability and actual-carriage photograph evidence. It is not a Mk82 alias. Current-build geometry acceptance is separate. ExactSAMP subtype, RPK/JL100 tank-carrier and ECM/chaff resources remain explicit gaps.'),
 'f4e':('preserved_variant_guard','AIM7E/AIM9L, supported AGMs, bomb/rocket and PaveSpike options retained. AIM7F/M or later targeting pods need block/operator retrofit evidence and placement; no automatic family expansion.'),
 'f15c':('preserved_variant_guard','Actual source F15E, native dual rail and fixed LANTIRN recognized. Existing new AMRAAM/Sidewinder/bombs retained. Sniper/LITENING replacement requires hiding source pod and a mount path; do not show2pods at once. JDAM/SDB families missing definitions/models.'),
 'mig29':('candidate_existing_resource','Early9.12 candidate UB16(57mm) and S24B(240mm) on existing mid attack stations. No RVVAE/Kh31P/Kh29TE from upgraded later variants.'),
 'f16v':('candidate_existing_resource','GBU10 Block70 compatibility confirmed, candidate single on each existing mid attack pylon with Sniper. AGM65D supported by broader F16 primary material but this audit does not treat it as an exact V station clearance. Correct370gal/300gal tanks and JDAM/SDB are separate resources.'),
 'su27':('preserved_variant_guard','Actual Su27UBK source kept with R73/R27T/R27R, existingbomb/rocket options. Su27SKM/SM R77 or guidedAGM upgrades not inferred for UBK. Correct serial station mapping and mixedfit remain geometry work.'),
 'a10a':('preserved_variant_guard','Actual source A10C;11 numbered pylons and source-hash-gated Sniper/LITENING kept. No blanket expansion to every store on every pylon. JDAM/APKWS need distinct model/behavior; current unguided Hydra is not APKWS.'),
 'su25':('preserved_variant_guard','Ten numbered pylons already expose gunpod/tanks/rockets/bombs/Kh25ML/Kh29L. Do not inherit Su25T Vikhr or new radar AGM without its targeting integration.'),
 'me262a2a':('preserved_source_sockets','A2a2SC250 source release sockets retained. SC500 needs exact clearance/adapter checks and code generalization beyond current source_bombs expectedSC250 guard.'),
 'me262u4':('preserved_prototype','Experimental50mm cannon prototype has no external source release sockets; no new menu inferred from otherMe262 subtypes.'),
}
candidates=[
 {'model':'p51d','station':'inner','sides':[-1,1],'options':{'anm65':1},'evidence':['p51d'],'state':'proposal_requires_fit_validation'},
 {'model':'f86f','station':'inner','sides':[-1,1],'options':{'anm65':1},'evidence':['f86f'],'state':'proposal_requires_fit_validation'},
 {'model':'f4u1d','station':'inner','sides':[-1,1],'options':{'anm64':1},'evidence':['f4u1d'],'state':'proposal_game_fit_inference'},
 {'model':'mig29','station':'mid','sides':[-1,1],'options':{'ub16':1,'s24b':1},'evidence':['mig29a'],'state':'proposal_requires_fit_validation'},
 {'model':'f16v','station':'mid','sides':[-1,1],'options':{'gbu10':1},'evidence':['f16_block70'],'state':'proposal_requires_fit_validation'},
]
rows=[]
for id,m in catalog['models'].items():
 status,note=notes[id]
 slots=[{'key':s['key'],'station':s['station'],'side':s['side'],'options':s['options']} for s in m['slots']]
 rows.append({'id':id,'name':m['name'],'sourceMain':m['sourceMain'],'reviewStatus':status,'notes':note,'baselineSlots':slots,'existingSlotCount':len(slots),'existingStationWeaponOptions':sum(len(s['options']) for s in slots)})
report={'schema':1,'scope':'Read-only audit of all26 catalog identities and menu resource gaps. Aircraft-level sources do not establish an exhaustive station clearance matrix. Candidates are not installed by this report. Runtime geometry fixes and accepted catalog options are delivered separately.','baselineAppSha256':catalog['appSha256'],'models':rows,'candidateMenuAdditions':candidates,'sources':sources,'constraints':['Preserve all67 existing production presets and indices.','Use explicit custom-menu options, never infer from all globally available models.','No operational weapon parameters are revised by this audit.','Native server capabilities must be merged with current local air-combat code and remain authoritative.']}
out=pathlib.Path(__file__).resolve().parent
(out/'catalog-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
md=['# 全26机型挂载菜单复核','', '本表核对当前包内具体机型身份、既有可选项与资源缺口。它不把一次资料检索等同于实机全部挂载组合认证。上级集成者应将通过模型适配与运行验证的候选项标为已实现；本表候选本身不修改菜单。','', '|机型ID|模型实际名称|既有槽数|状态|说明|','|---|---|---:|---|---|']
for r in rows:md.append('|'+r['id']+'|'+r['name']+'|'+str(r['existingSlotCount'])+'|'+r['reviewStatus']+'|'+r['notes']+'|')
md+=['','## 有现成资源的优先候选','', '这些是飞机级能力证据与现成资源交集，挂点选择属于待运行验证的游戏拟合，不是实机挂载手册。','']
for c in candidates:md.append('- '+c['model']+' / '+c['station']+' / '+', '.join(k+' ×'+str(v)+'每侧' for k,v in c['options'].items())+'；依据 '+', '.join(c['evidence'])+'。')
md+=['','## 全量武器兼容覆盖','', '新增 `weapon-carrier-coverage.json` 与 `coverage.schema.json`，对当前26机型×全部87个武器定义逐对标出菜单状态。available 表示当前菜单可选；missing_model / requires_adapter / unverified 分别标缺建模、缺适配架与具体变种兼容未证实。component_only 和 ground_only 不能当作飞机直接外挂。兼容覆盖仍需当前构建的几何/运行验收，不能据此声称所有实机组合已经做完。', '', 'Mirage5F 的 SAMP250 已新增独立程序模型及双侧内挂点选项；尺寸、精细子型号、色彩和伤害数值均为游戏估计。实际摄影来源：T.Laurent，1990年9月，https://www.airhistory.net/photo/159898/46 。保留遗留ID mirage3e，不修改原预设索引。', '', '重建覆盖：`node perf/mount-v4-audit/export-coverage.mjs path/to/current-app-script.html`。模型/目录源码改动后应重建；它读取实际生产layout函数与当前catalog模块。', '', '## 来源与适用边界','']
for k,s in sources.items():md+=['- '+k+' — ['+s['publisher']+']('+s['url']+')：'+s['supports']]
(out/'README.md').write_text('\n'.join(md)+'\n')
print(json.dumps({'models':len(rows),'candidates':len(candidates),'sourceCount':len(sources)},ensure_ascii=False))
