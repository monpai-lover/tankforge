#!/usr/bin/env python3
"""Actual Chromium Web Audio decode and spatial playback from the pinned public suffix."""
import asyncio,base64,hashlib,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'handoff/tests/out/me262-u4-audio-20261025'
async def main():
    suffix=ROOT/'handoff/server/dist/tankforge-page-update-20261025-u4-audio/app.js.html'
    app=suffix.read_text();mp3=(ROOT/'handoff/tests/fixtures/me262-u4-audio/report_kwk39_50.mp3').read_bytes()
    meta=json.loads((ROOT/'handoff/tests/fixtures/me262-u4-audio/source.json').read_text())
    def section(a,b):
        i=app.index(a);j=app.index(b,i);return app[i:j]
    script=section('  // client/web/src/game/audioReload.js','  // client/web/src/game/statusview.js')
    script+='\nconst G4={mode:"battle",paused:false,thumbShot:false,time:0};const sound=new Sound();'
    bank={'schemaVersion':1,'selectionState':'user-directed','adoption':{'source':'human-direct-instruction','statement':'同時完成所有的音效生成和替換'},'profiles':[{'id':'weapon_kwk39_50','kind':'weapon','bindings':['gun:kwk39_50_l60'],'cues':{'report':'report_kwk39_50'}}], 'cues':{'report_kwk39_50':{**meta,'url':'data:audio/mpeg;base64,'+base64.b64encode(mp3).decode()}},'externalCues':{}}
    script+='\nsound.loadFullBank('+json.dumps(bank)+');\n'+section('    // BEGIN AIRCRAFT SHOT AUDIO','    function airAudio()')
    script+='''
    window.audioQa={sound,G4,airShot};document.querySelector('button').onclick=()=>{
      sound.start();sound.setFullAudible(airShotAudioAudible());sound.setListener({position:[0,0,0],forward:[0,0,1],up:[0,1,0],velocity:[0,0,0],time:0});
      aircraftShotAudio.prepare('mk214a');
    };
    '''
    errors=[]
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True,args=['--no-sandbox'])
        try:
            page=await browser.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            await page.set_content('<button>启用声音</button>');await page.add_script_tag(content=script)
            await page.locator('button').click();await page.wait_for_function('audioQa.sound.full.buffers.has("report_kwk39_50")',timeout=15000)
            result=await page.evaluate('''()=>{const {sound,G4,airShot}=audioQa,b=sound.full.buffers.get('report_kwk39_50'),v=b.getChannelData(0);let sum=0,peak=0;for(const x of v){sum+=x*x;peak=Math.max(peak,Math.abs(x));}airShot('mk214a',1,[0,0,3],[0,0,0],0);G4.mode='frontline';G4.paused=true;sound.setFullAudible(airShotAudioAudible());airShot('mk214a',2,[0,0,3],[0,0,0],.4,'frontline:test');return{context:sound.ctx.state,duration:b.duration,sampleRate:b.sampleRate,channels:b.numberOfChannels,rms:Math.sqrt(sum/v.length),peak,voices:sound.full.voices.size,played:sound.aircraftShots.stats.played,active:sound.full.active,muted:sound.muted};}''')
            assert result['context']=='running' and result['rms']>.005 and result['peak']>.1 and result['played']==2 and result['voices']==2 and result['active'] and not errors
            result.update({'pass':True,'appSha256':hashlib.sha256(suffix.read_bytes()).hexdigest(),'cueSha256':hashlib.sha256(mp3).hexdigest(),'pageErrors':errors,'scope':'Actual Chromium AudioContext decode/spatial output; subjective listening not claimed'})
            (OUT/'browser-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
        finally:await browser.close()
asyncio.run(main())
