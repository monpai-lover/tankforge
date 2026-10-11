# B architecture handoff preserved by Root — 2026-10-11

This note persists previously researched architecture from Root-only session memory for fresh implementers. It is guidance and prior-probe context, not an implementation or new PASS receipt. Read the B design/plan and the B2 resumption audit; keep all unfinished B tasks. One runtime writer at a time. Original source geometry, dimensions, vehicle/weapon/armor data and assets remain protected. The currently active writer owns P1; do not begin B edits before ownership transfer.

## Mechanical bundle

### positiveD

P=[R,S],BT=[T,ST],H=diag(M,0)+PFᵀD^-1PF;rhs=[Mu*,0]+PFᵀWβF+PCᵀcapC+BTᵀτ.λF=W(βF−PFy),y=[u,aDot]. oldsoftD=1/[h(c+hk)],β=−kg/(c+hk).originalrawλ0/free/cap requiresw≥0/=0/≤0.

### hard

Oldroad/bearingD0mustnotaddε. mixed[H,−PHᵀ;−PH,0](y,λH)=(rhs,−βH); rankrevealingindefinite. dependenthardλnonunique originalboundsfeasiblebasispivot, notnegativeminnorm. basic≤dim(u)+rankS;alloriginalcandidatesremainchecked.

### rank

QRmechanicalSFandfullfixedforce/tangentRHScompatibility; rawSᵀλ+STᵀτcheck. Gaugechoosegeomonlyifinactive/capped inequalities permitelseblockingadmit;0gaugefailure≠infeasible.

### friction

Hδy=BTᵀδτ,δλF=−WPFδy,KT=BT H^-1 BTᵀ; recoverN thenfrictionellipse; boundcrosswholebundlepivot. slidingτ=Lλg=>Q=P+LᵀBT,reduceddiag(M,0)+QFᵀWPFnonsymmetricpivotedsolve; blindconvexconeQPaddsassociatednormalcoupling. Stickinghardvelocityrow.

### integration

Applyaccumulatedimpulsedeltas; u*removeownalreadystoredresponse afterspring/motor/bareupdates. AfterJchangesstoredgeneralizedimpulsemustnotoldλnewJ. Minshape nooptimizerforcesoroverridephysicalaDot; nextfeaturegaps matchprediction/rebuild. Hardvssoftdistinguishfinitepenaltycannotstaticloadwithgap0v0. BothsidessharedhullM separateshape.

### budget

k/c/cap fixedquadratureweights sum1peroriginalregions, noactivecount renorm, noface×oldstiffness.

### witness

inmemory50randomD>0 directKKTvsreducederror1.90e−14; minimalgroundshoewheelM2 R(0,1)S(1,−1)D(.2,.3)u*−1 λ1/1; tangentτ.2T.7ST.4 =>λg.866 λb.946 shapeequilibrium.

## Exact source contacts and frozen shape

### approvedDirection

Exact source finite solids for residual/render/contacts; visible guide wheel grooves when proven overlap while original envelope/N/p/station/r/w/mass/data unchanged.

### algebraic

Concretefinal: retainupperroof/hang/sprocketanchor/root, split normalπ/0externaljoins, oldlowerarcs/fullouterterrainplane onlyseed, trustedmonotonic256gridlowergraph y=seed+a beforemarch. Controls aroundexposedbearing/connectedgroundinterval; deterministic rank reduction actualpinmap. Geometryminchange constraints g≥0,b≥0,closure discardmultipliers. Mechanics Ru+Sa, MΔu=R^Tλ,S^Tλ=0,λ≥0. deterministicQR null(S^T)=Z λ=Zμ,J=Z^TR originalλnonnegative; groundchartfastAonlyifwellconditioned. singular/nonconvergent/notgraphrepresentable diagnosticsafecache.

### derivatives

Sidelevelpreallocatedbatch fixedrootperturbations and implicit ux=-Ex/Eu,actualmaterialfeature frozen,branchonesided; physical velocities includephaseJs, belt reciprocal response K=JM^-1J^T+Js²/m. Predictor correction hJ(Vcurrent−V0),boundedwholebatchrebuild.

### correspondence

Mechanicalcontinuous vsdecodedacceptedfrozenreplay: samematerialprimitives/branch, acceptedrealpenetration≤.5mm loadedrenderedfacegap≤.75mm; quantizedpins NEVER velocitydiff. 3individualwidthcolumns packedbounds. x13domainfaultcache retained.

### stage

ImplementerStage2a sourcegeometry+realgrooveproof; now authorized Stage2b1 then2b2 followed2c after2areport. Task2stilluncommitted/notreviewed.

### grooves

Per-entrysharedWheelSolidProfile actualaxialslabs/corridors;base guide xbound+existing0.2mmskin. floor max(0,r−Dguide−skin) withDguide provenconservativeguidevolumeYZdistance to actualclippedflankingbearingsections (triangleinequality); measuredSATdepthnotfloor16phasenotproof. throughslottinyrollersnohiddenaxis; trimallpaintplates/caps/bolt/hub intersects andvisibleoutboardsupportifneeded; source r/w/envelope/stationmass/N/punchanged.

### friction

Reduced tangent J=tx+taA actualJs; recover Δλg=-ga^-Tta^Tτ plusbearingresponses; ifdualnegative release/rebuild active set,recomputecaps. Sourcepointcoords fixedidentity. Existing c.wheels/Jbelt−1 invalidfornewcondensedcontact; no ta=0 assumption.

### shape

2sides*4rows*256*signed18bit=4608packedbytes6144B64 +metadata under8KiB, threeindividualgroundrows+lowerHEIGHT interiornode row needed to uniquelyfreeze. Exactupperjoinpoints derivednotquantfreed. Heightquant.25mm range±32m exacttrustedcounts/grid/bitorder/sign/padding/canonical;beforeownerfinalaccept,neverreroot/reproject, continuousshadowvelocity+acceptedcorrespondence.

### spin

Per-sideunwrapped existingtravelM frozenf64|s|≤2^32m (~1umresolution);exactdividebyoriginalr%TAU bothsidessame. max3radiigroup/side. Wfeature derivative (body.ex×(P−C))/r,shoeshift−ds/p,freezebaseangleδs/r avoidinglargecancellation. Pin-driven sprocket/proceduraltoothedidler unchanged. Remoteinterpolateunwrappedtravel.

### joins

Shiftπ/0downby>1chordangle valid toretainanchor/seam; all35phaseprove andactualmechanicalcoverageimmutablelowerarcprefix needed. Continuousc.ralllowerseednormals/tangents/arcs withoutdf/dc valid.

## Broken chain

### cut

material shoe i=(pin i,pin i+1); cut c opens c-1/c; node k pin(c+k)%N for0..N; V7cut i actually pin i+1

### step

h=1/240; kinetic velocities gravity+bending real forces; predictx;8position scans XPBD+endpoint/midpoint contacts strict split no inferreddx/h;4velocity scans rod rates+zero-restitution contact+friction actualjn

### solver

endpoint solver invmass2xinterior, chain weights only. Tridiagonal fresh nonlinear XPBD O(N) optional; verifyresidual, don't silentlyupiterations/stretch/compliance

### sleep

every fixedtick supportheights nodes+midpoints;terrain.version insufficient berm+extra unrevisioned. 0.7s quietcount initial, gate contact/speed/displacement/pitch/contact/rate residues

### velocity

same-ID actualworldsample diff includes hull/phase/q/path/idler; no doublehullvelocity; nohistory explicitanalyticfallback+diagnostic

### source

src/tracks.h 98-189/220-228/345-395/455-463/483-584;src/hybrid.h98-234;web/tracks.js15-37; V7velocitydirectiontracks.h565-570 don't copy

### license

third_party/tracklab-v7/LICENSE fullMIT Copyright(c)2026 Tracklabcontributors;package b9c008ba8034882de9af8e804b7873ff23267cbc47b14a0e37bb50afaba15cdc

## Damage, lifecycle and repair jack

### baseline

85dd0e1 (beforeTask2)

### hooks

vehicle.js constructor/step/place/applyNet expose runningGearPose read-only,chain-only; new runningGearDamage caps transitionadapter; enemies.jsuseCombat/combatHit/pose/follow; main.select/resetPose/damage/status/advanceCombat/fixedupdate centralreconcile; gfxTankmodelclosed/open matrices no fitting

### damage

sync after acceptedstate/caps BEFORE death pose/markDead. report.impacthullspace ornormalizedtrackmodulecenterfallback. Bootstrapalreadyfalsecap once; repeatedcapsneverrecut. Onlineauthonlycut. Fstart/cancelnotcaprestore. Restorecappermitsattemptclose currentbody/q/qv; retainoldchain+physicalbroken untilfeasible; retrypending; no independentpermission fromrepair_s/death/can_move

### ticks

G.acc fixed120player2substeps; offlineenemieschain-only tick afterplayerterrainpress incldead/range; notadvanceCombat. Remote netfollow noXPBD. DeathJcontinue models existing scene withoutalivefilter,respawn/resetfresh epoch

### render

root/body/running_gear/tracks meshN*2 existingkind5. mainupdatesroot/body3958 andgear4001, scene.update4213->Node.worldSTALE. Usecurrentframe computeorrefreshsubtree. Openworldshoeorientationuse stableworldref notrotatinghulltransverse;orthonormalunit matrices no residualscale. LODdetailonlynotrestq/refit. Wheel/idler beforegearSupports. Keepkind/fade/statuskind10restore;modeldisposefirstpartymeshesonce,importedcachenotfreed

### transfer

Captureoldstatebeforeselect disposes G; compatiblechassisnewtm newmass. Preservehullorigin/basis q/qvbothphase/idler pinsmaterialhistory/worldvelchains/sleep/diagpending/auth;clearwarmcaches; no place/reset/bootstraphealthy. newCOMreferencepos oldOrigin+RnewCOM;vNew=oldv+w×R(newCOM-oldCOM),w same. Actualworkshopbase retainsrunninggear/sourcechassis donors irrelevant. Exactgeo compat allowshetzer/flak andmk103/camo thoughmass/COM differ. Wholemk103/sdkY=-.063 butunchangedmodulecenters/hullsnotglobaltranslation =>incompatible diagnosticreset,nofamilyIDmagic

### combat

Combat.prepare normalizednewmodules,fresh statecorrectlen;bind oldstateINDEXunsafe. Remaponlysurvivingchassismodules bystableID+kind+matchedgeo into newfreshstate,trackhealthpreserved so no autohealing. Remaprepair_targets byIDs,nevercopyoldcaps/crew/swaps/racksacrossheads. Recomputenewcapwithbind/advance0. Preservedeathofexistingactoronlyrespawnreset

### repairRootProbe

Root realrig healthy15s+bothbroken15s120Hz2substeps flatroad verified2026-10-11T02:50:00: Hetzerhull drop.060m,T34.065m,HVSS/Proto.055m; allbarewheelbottomsg=0, would-be track bottomg−t, bodyspeeds<3e−10. Waitingalonecannotrestoreinsertionclearance.

### repairJack

Required Task4 clarification: restoreeventitselfnoimpulse/pose/qchange. Subsequentpendingsteps boundedexplicitexternalrepair-jack realcouplednormalimpulses,rampedheight/rate/force/stroke/work fromactualshoeenvelope+smallallowance;keepbrokentractionoff,oldchainuntilfullfeasible. Separatejackloadsfromordinarycontacts/terrainpress toavoidfakefriction. Dead/renewedcapfalsecancelsjackoldchainretained. Idleofflineenemyneedsidlecoupledphysicswhilependingjack/handover, otherwisechain-only;remotenojack/XPBD. Externallyimpossiblegeometrydiagnosedpendingatboundedstroke,nosnap/noextendidler. Testordinarybothbrokenflatrepair actualgeometry,atomicrestorestateunchanged,boundedlift/realclose,oneSide,death,remote,infeasible.

### repairJackPointAudit

Read-onlyfutureTask4 probes: per-qi actualaxle/wheel cups Jq_i=n·ey/common boundedbeam, solveinsideSPRING+barewheelPGS, hullonlyJq0 letsqv≈−Vh/ey_y keepwheelsonground, bogiemidpointnotguaranteedrock. 20mm/s,representative t+2mmstroke,perstation1.4preload: Hetzer/T34/HVSS axle+62/67/57mm hull+61.74/66.24/56.81,bareload0,peak1.016mg work~mgstroke. Hullonlysame stroke axlelift≈0/qnegative/stillbareloads. T34oneside+67mm other−.16mmpeak.506mgwork10.45kJ. T34initialq−90mm/body+90mm axle+67mm qreturns91mm body−23.9mm (noextra reboundstroke). DemonstrationNOTfinalnewsource envelope; controller actualprimitives-derivedstroke/rate/force/work+revocation/permission budgets. Nofileschanges.

### jackFields

[
  "epoch,chassisKey,permissionGeneration",
  "state:unseated/lifting/holding/exhausted",
  "supportStationIDs,actualHubPoints (outsideguideemptycorridor)",
  "footWorld,baseLength,baseAxleHeight",
  "commandExtension,measuredExtensions",
  "requiredEnvelopeLift,allowance,strokeMax",
  "rateUpMax/rateDownMax,seatingTolerance,lateralSeatRadius",
  "forceMax,stationForceWeights from originalpreload",
  "workPositiveSpent/Max",
  "accumulatedImpulse,responseCache",
  "lastGeometryFault,stableReadyTime"
]

### jackEquations

Ci=body.worldPoint([actualhub.x,station.y+qi+actualhub.yoffset,station.z+actualhub.zoffset]); Jh=(dot(n,ex/ey/ez),cross(r,n)dotaxes),Jq_i=dot(n,ey);body.contactResponse(n,Ci,[i,1],cache). g=n·(Ci-Fi)−(L0i+e), actualpointvelocity current; unilateralcappedcoupledimpulse, interleaveSPRING/bare normals/stopsgeneralcontact; resetλ oncePHYSsubstep notiteration. advancecommoncommand onlyseated/tracking bounded;stalllimits,no pull. Requiredlift read-onlyactualnewshoe insertionenvelope plusallowance; t+2demonstrationnotIDliteral. Proposed2cm/s/1.4preload aggregate/1.5preloadSum*strokeMaxwork need Task4receipt. Positiveworkactualsupportedpoint/roddisplacement trackingincluded preimpulsebound; preserve spentwork/seatingbaseline/stroke acrosscancel,reauth,reconnect,compattransfer no recapturehigherbaselineextrastroke. jackloadsNEVERss.load/traction/rolling/rut/terrainpress. Otherphase preserved callbacksimmutable.

## Network authority

### server

server.rs websocket direct internallytagged ClientMsg State s:Value rejects rg overflow beforeoptionalparser; parse raw whole envelope discriminator/state before locking, isolate rg rawbytes; remaining legacy strict, nonstate strict,64KiB totalcap unchanged

### authority

Supersededrepairtimerclears rule: trustedcombathealthy→damaged selects cut + topologyrev. Actualrepairedtargetcompletion grants repairPermitted+repairGeneration only; preservebroken/cut/rev/chain. Same-side trackhealthloss evenpositive revokespermission, death/J/crewinvalidrevokesall; no recut existingopen. Stablefeasibleowner sendscloseReadymask+generation samefreshacceptedmotion+frozenclosedshape+stilloldchains. Serveratomicallyvalidateallmask,consumepermits,singlerevfromfreshpackettransitionframe/receipt; noownerhealth/topologyauthority. ACKcurrentrecheckfailkeeplocalphysicalpending diag/no snap/no serverreversal, stablephysicalsupport/brakewait. Legacycanonicalvalidatedhandoverfallback.

### model

server load_combat onlyMGvisualmetadata/no tgphysics dep now. Need trustedshareddescriptor N/p staticoriginalrule +stations/limits, all35inclfun_hexa. no secondapproximation

### sides

authority[topology]=left,right; q order=RIGHTallfrontrear then LEFT

### client

main netStep currently omits ns.rg! selfsnap ignores p.s; consumeauth+keyframes w/o overwrite predictedmotion. enemies.js plural mixState spreads b currently rg jump, addsameepoch/revision/topology/count interpolate,shortextrapolatefreeze,epochclearbuf/off/seq;remote noXPBD

### lifecycle

spawn retainsstate must clear priorrg,epochnew; resume needs self+othersauthoritativekeyframe (notinterestthrottled),latejoin too; death/J sameepoch keepchain; select(id,true) transfer compatiblegeometry runninggear explicit;staticoffline enemychainfixedstep

### security

validateexactq/qv/modelN+1nodes/quantizedinttriples/coor+velbounds/bytebudget/counters/phases/idler/duplicatedsides/currentauth; no ownerassignbroken/cut/epoch/revision; socketserialmustcurrentonhandling afterresume oldpacket; ticker snapbeforecombatadvance invalidateoldchain ontransition

### tests

literalrawsocket1e309 (notValue),oversizeoptionalvswholecap,forgedtopology/health/wrongrevision/epoch/seq/replacedconn,cutlatestphase,repair/death/respawn,reconnectsleepkeyframe,realmain transport,remote noXPBD,sideorder

### productionFixture

Task1quality actualnetStep sourceairborneq=.15 qv=-.8 butomitsrg remotesq=-.108 qv=0: .258m/.8m/s error; mandatoryTask5realtransporttest notintermediateTask1blocker

### repairfields

authorityrepairPermitted[2]/repairGeneration[2]/lastHandoverSeq[2]; optionalownercloseReady:{mask,generation:[left,right]}. Gen needed grants/revokes/grants within sameepoch/topologyrev. Candidate shape allowedforpermittedbrokenside. Permissionstatusupdatedoesnotclear remoteinterpolation/oldchainframes; topologycut/closeinvalidatesframes.

### repairvalidation

CurrentConnserial+epoch/currentrevision/freshseq+acceptedlegacymotion+per-sidecurrentpermissiongeneration+servercombat alive trackcap restored repairtimercompleted eligiblecrew+trusteddescriptorexactfrozenpitch/closure/clearanceground row. Atomicmask no partialinvalidtwoSide. IdempotentACKhandoverseq. Spawnclearframes/permission/receiptnew epoch;deathJrevokeswithoutclosing;resume currentgen/latestkeyframes preservedlocaljackbudget. mainphysicalbrokenmustnotoverwritefromcaps.

### shapeRows

2sides*4rows*256*signed18bit=4608packedbytes6144B64 +metadata under8KiB, threeindividualgroundrows+lowerHEIGHT interiornode row needed to uniquelyfreeze. Exactupperjoinpoints derivednotquantfreed. Heightquant.25mm range±32m exacttrustedcounts/grid/bitorder/sign/padding/canonical;beforeownerfinalaccept,neverreroot/reproject, continuousshadowvelocity+acceptedcorrespondence.
