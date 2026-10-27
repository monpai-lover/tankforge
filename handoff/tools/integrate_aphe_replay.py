"""Add timed APHE flashes to the installed supplied-V3 renderer in place.

The handoff's client/web replay source predates the active site. Do not rebuild
the whole client from it: that would discard the supplied renderer and cameras.
"""
from pathlib import Path
import re

root=Path(__file__).resolve().parents[2]
path=root/'handoff/bundle/app.js.html'
text=path.read_text(encoding='utf-8')

def once(old,new):
    global text
    if new in text:return
    assert text.count(old)==1,old[:160]
    text=text.replace(old,new)

start='  // BEGIN RECORDED APHE REPLAY\n'
end='  // END RECORDED APHE REPLAY\n'
helper=(root/'handoff/tools/aphe_replay_presentation.js').read_text(encoding='utf-8')
shaders=(root/'client/web/src/gfx/replayShaders.js').read_text(encoding='utf-8')
shader='\n'.join('  var APHE_'+name+' = `'+re.search(r'export const '+name+r'=`([\s\S]*?)`;',shaders)[1]+'`;'
                 for name in ('BURSTVS','BURSTFS'))
block=start+helper+'\n'+shader+'''
  var recordedApheReplay = createRecordedApheReplay({prepare:prepareReplayEvent,sample:samplePreparedReplay});
  prepareReplayEvent = recordedApheReplay.prepare;
  samplePreparedReplay = recordedApheReplay.sample;
'''+end
if start in text:
    a=text.index(start);b=text.index(end,a)+len(end);text=text[:a]+block+text[b:]
else:
    anchor='  // client/web/src/game/projectileReplay.js\n';assert text.count(anchor)==1
    text=text.replace(anchor,block+'\n'+anchor)

once('projectiles, bodySummaries, bodyBudgetOverflow: bodySummaries.length, traces, staticTraces, arrivals:',
     'projectiles, bodySummaries, bodyBudgetOverflow: bodySummaries.length, bursts: samples.flatMap(s=>s.bursts||[]).slice(0,64), traces, staticTraces, arrivals:')
old='      this.prepared = { frameId: frame.id, nodes: this.nodes, sourceNodes: sources, instances: this.instances, count, dynamicCount, physicalS: frame.physicalS, reveal, frame, source: suppliedReplaySource };'
new='''      const recordedBursts=packRecordedReplayBursts(this.instances,WORDS,frame,count,dynamicCount,MAX_TRACES);
      count=recordedBursts.count;dynamicCount=recordedBursts.dynamicCount;
      this.prepared = { frameId: frame.id, nodes: this.nodes, sourceNodes: sources, instances: this.instances, count, dynamicCount, burstCount:recordedBursts.burstCount,droppedTraceCount:recordedBursts.droppedTraceCount, physicalS: frame.physicalS, reveal, frame, source: suppliedReplaySource };'''
once(old,new)

# Retain the supplied renderer's seed attribute and 13-word layout.
a=text.index('  var TRACEVS2 = ');b=text.index('  var TRACEFS2 = ',a)
section=text[a:b]
old='if(a.w<.01||b.w<.01)gl_Position=vec4(2.,2.,2.,1.);'
new='if(aParams.y==5.||a.w<.01||b.w<.01)gl_Position=vec4(2.,2.,2.,1.);'
assert old in section or new in section
section=section.replace(old,new);text=text[:a]+section+text[b:]
once('      this.fieldProgram = this.program(FIELDVS2, FIELDFS2);',
     '      this.fieldProgram = this.program(FIELDVS2, FIELDFS2);\n      this.burstProgram = this.program(APHE_BURSTVS, APHE_BURSTFS);')
once('''      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      return vp;''','''      if(settings.burstCount && this.samples){
        const b=this.burstProgram;gl.depthMask(false);gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(b.p);this.mat(b,"uVP",vp);gl.bindVertexArray(this.traceVAO);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,this.samples);this.drawCalls++;
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      return vp;''')
once('field: prepared.frame.event?.profile?.family === "he", dynamicCount: prepared.dynamicCount',
     'field: prepared.frame.event?.profile?.family === "he" || prepared.burstCount>0, burstCount:prepared.burstCount, dynamicCount: prepared.dynamicCount')
path.write_text(text,encoding='utf-8',newline='\n')
print('Updated active supplied-V3 APHE replay; kept original cameras, geometry, materials and sample layout')
