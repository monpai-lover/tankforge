"""Compile/link actual candidate shaders on installed browser WebGL2; no gameplay FPS claim."""
import argparse
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
args.out.mkdir(parents=True,exist_ok=False)
fixture=args.out/'shaders.json'
subprocess.run(['node',str(ROOT/'handoff/tests/large-world-render-webgl-fixture.mjs'),str(fixture)],cwd=ROOT,check=True)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page()
    page.set_content('<canvas width="128" height="128"></canvas>')
    result=page.evaluate('''shaders=>{
      const gl=document.querySelector('canvas').getContext('webgl2');if(!gl)throw Error('WebGL2 unavailable');
      const results=[];
      for(const [name,pair]of Object.entries(shaders)){
        const program=gl.createProgram(),compiled=[];
        for(let i=0;i<2;i++){const shader=gl.createShader(i?gl.FRAGMENT_SHADER:gl.VERTEX_SHADER);gl.shaderSource(shader,pair[i]);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(name+': '+gl.getShaderInfoLog(shader));gl.attachShader(program,shader);compiled.push(shader);}
        gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(name+': '+gl.getProgramInfoLog(program));
        const uniforms=Array.from({length:gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS)},(_,i)=>gl.getActiveUniform(program,i).name);
        if(name==='lit'&&!uniforms.includes('uModelViewProj'))throw Error('main precise matrix is not active');
        if(name==='depth'&&!uniforms.includes('uModelLightVP'))throw Error('shadow precise matrix is not active');
        results.push({name,linked:true,uniforms});gl.deleteProgram(program);compiled.forEach(s=>gl.deleteShader(s));
      }
      return {passed:gl.getError()===gl.NO_ERROR,renderer:gl.getParameter(gl.RENDERER),scope:'Actual shader compilation/linking in WebGL2; no gameplay/FPS claim',results};
    }''',json.loads(fixture.read_text()))
    result['browserVersion']=browser.version
    (args.out/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    assert result['passed']
    print(json.dumps({**result,'results':[{'name':x['name'],'linked':x['linked']}for x in result['results']]}))
    browser.close()
