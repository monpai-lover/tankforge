import assert from 'node:assert/strict';

const replayMarker='/* TF_R85_IMMEDIATE_REPLAY_TARGET */';
const replayAnchor=`      const idle = current && (current.session.finished || current.session.filmTimeS >= current.session.endFilm);
      if (current && purpose !== "analysis" && purpose !== "victim" && !(purpose === "offensive" && idle)) {
        this._defer(target, rep, shell, dist3, mg, detail, purpose);
        return false;
      }`;
const replayReplacement=`      ${replayMarker}
      // Same-target evidence already appended above; the next offensive target
      // acquires immediately, even while the old physical animation is active.
      // Keep the old snapshot alive until acquisition has succeeded below.
      if (current && purpose !== "analysis" && purpose !== "victim" && purpose !== "offensive") {
        this._defer(target, rep, shell, dist3, mg, detail, purpose);
        return false;
      }`;
function replaceOnce(source,anchor,replacement,label){
  assert.equal(source.split(anchor).length-1,1,`R85 ${label} anchor must occur exactly once`);
  return source.replace(anchor,replacement);
}
export function patchR85ReplayTargetSwitch(source){
  if(source.includes(replayMarker)){
    assert.ok(source.includes(replayReplacement),'R85 replay target marker drift');return source;
  }
  return replaceOnce(source,replayAnchor,replayReplacement,'replay target');
}

const exitMarker='/* TF_R85_LOCAL_GARAGE_EXIT */';
const exitAnchor="f.keys.clear();setMode('garage');note('已退出空战对局');";
const exitReplacement="f.keys.clear();"+exitMarker+"toGarage();note('已退出空战对局');";
// Apply to both the installed app and the retained frontline_client patch input.
// The accepted left handler has already released native models and cleared
// f.active/f.room, so toGarage now belongs to the local owner, not native return.
export function patchR85SingleplayerExit(source){
  if(source.includes(exitMarker)){
    assert.ok(source.includes(exitReplacement),'R85 local garage exit marker drift');return source;
  }
  return replaceOnce(source,exitAnchor,exitReplacement,'local garage exit');
}

const protectionMarker='/* TF_R85_REGISTERED_ARMOR_INSPECTION */';
const protectionAnchor='this.analysisOwner = new LocalSurfaceCombat(combat.core, { [spec]: { ...packet, variants: [] } }, this.renderer);';
const protectionReplacement=`${protectionMarker}
        // Registration verifies the complete reviewed packet, including pinned
        // descendants. Its uploads use the same renderer as the visible model.
        this.analysisOwner = new LocalSurfaceCombat(combat.core, { [spec]: packet }, this.env.renderer);`;
export function patchR85ProtectionQuery(source){
  if(source.includes(protectionMarker)){
    assert.ok(source.includes(protectionReplacement),'R85 registered armor inspection marker drift');
  }else{
    source=replaceOnce(source,protectionAnchor,protectionReplacement,'registered armor inspection');
  }
  return patchR85PrivateAnalysisLife(source);
}

const privateLifeMarker='/* TF_R85_PRIVATE_ANALYSIS_LIFE */';
const privateLifeAnchor=`        this.analysisLife++;
        this.analysisOwner.register(this.analysisKey, spec, { battle: 1, entity: 1, life: this.analysisLife }, this.model, this.inspectionBody);
      }
      return this.analysisOwner.pose(this.analysisKey, null);`;
const privateLifeReplacement=`      }
      ${privateLifeMarker}
      // Each inspection ray is a fresh private target. The previous preview's
      // core-issued crew/barrel state cannot be submitted as fresh health.
      // Keep the verified buffers and prepared GPU variants; only replace this
      // one private native scene/life, using the real registration API.
      const owner = this.analysisOwner, actor = { battle: 1, entity: 1, life: ++this.analysisLife };
      const previous = owner.actors.get(this.analysisKey);
      if (!previous?.registered || !owner.validateShape(previous)) return owner.register(this.analysisKey, spec, actor, this.model, this.inspectionBody);
      this.model.root.update();
      const updates = owner.matrices(previous), reviewed = owner.packet(spec), actorKey = '1:1:' + actor.life;
      const accepted = combat.core.combatSurfaceRegister(this.analysisKey, reviewed, { entityId: actorKey, spawnEpoch: actor.life, buildHash: previous.manifest.buildHash, poseRevision: 0 }, updates);
      for (const variant of reviewed.variants || []) combat.core.combatSurfaceVariantRegister(this.analysisKey, variant);
      Object.assign(previous, { actor, actorKey, revision: accepted.poseRevision, updates, tick: null, available: true, reason: null, registrationFailed: false, failedActor: null });
      owner.lastUnavailable = null;
      return previous;`;
function patchR85PrivateAnalysisLife(source){
  if(source.includes(privateLifeMarker)){
    assert.ok(source.includes(privateLifeReplacement),'R85 private analysis life marker drift');
  }else{
    source=replaceOnce(source,privateLifeAnchor,privateLifeReplacement,'private analysis life');
  }
  const retryMarker='/* TF_R85_ANALYSIS_RETRY */';
  const retryAnchor=`        } catch {
          value = this._unregisteredPick(origin, end);
        }
      } else value = this._platePick(combat, origin, dir, turretYaw, end);`;
  const retryReplacement=`        } catch {
          ${retryMarker}
          // A transient native query failure is not a stable geometry answer.
          // Do not pin its unknown fallback in the unchanged-ray cache.
          value = this._unregisteredPick(origin, end);
          this.inspectionCache = null;
          this.cursor.present(value);
          return value;
        }
      } else value = this._platePick(combat, origin, dir, turretYaw, end);`;
  if(source.includes(retryMarker)){
    assert.ok(source.includes(retryReplacement),'R85 analysis retry marker drift');return source;
  }
  return replaceOnce(source,retryAnchor,retryReplacement,'analysis retry');
}
export function patchR85ClientStateQueries(source){
  return patchR85ProtectionQuery(patchR85SingleplayerExit(patchR85ReplayTargetSwitch(source)));
}
