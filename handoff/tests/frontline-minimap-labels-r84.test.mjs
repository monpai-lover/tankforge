import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import test from 'node:test';
const file=new URL('../tools/frontline_minimap_labels_r84.js',import.meta.url),measure=text=>({width:Array.from(text).length*11,actualBoundingBoxAscent:9,actualBoundingBoxDescent:3});
function helper(){assert.ok(fs.existsSync(file),'R84 source-owned airport label helper');const c=vm.createContext({});vm.runInContext(fs.readFileSync(file,'utf8'),c);return c.TFMinimapLabelsR84;}
const row=(id,x,y,text='机场名称')=>({id,text,point:[x,y],team:id==='B'?0:1}),inside=r=>r.left>=4&&r.top>=4&&r.right<=184&&r.bottom<=184,overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const options={width:188,height:188,measureText:measure,scaleBarWidth:94};
test('two colocated airport names use measured nonoverlapping boxes beside the unchanged markers',()=>{
 const h=helper(),rows=[row('B',94,94),row('R',94,94)],before=JSON.stringify(rows),labels=h.layout(rows,options);assert.equal(labels.length,2);assert.ok(labels.every(inside));assert.ok(!overlap(labels[0],labels[1]));assert.equal(JSON.stringify(rows),before);for(const l of labels){assert.equal(l.width,48);assert.ok(Math.hypot(l.x-94,l.y-94)<90);assert.ok(!overlap(l,{left:87,top:87,right:101,bottom:101}));}
});
test('labels avoid title and scale regions and stay inside the existing 188 canvas near edges',()=>{
 const h=helper();for(const r of [row('B',8,52),row('B',178,55),row('B',160,180),row('B',80,138)]){const labels=h.layout([r],options);assert.equal(labels.length,1);for(const l of labels){assert.ok(inside(l));assert.ok(!overlap(l,{left:0,top:0,right:188,bottom:44}));assert.ok(!overlap(l,{left:10,top:149,right:114,bottom:186}));}}
});
test('long airport text is measured and abbreviated to fit without moving the map or its markers',()=>{
 const h=helper(),label=h.layout([row('B',94,100,'Very Long International Airport Name That Cannot Fit')],options)[0];assert.ok(label);assert.ok(label.text.endsWith('…'));assert.ok(inside(label));assert.ok(label.width<=180);
});
test('canvas adapter filters disabled and offscreen airports and restores font state',()=>{
 const h=helper(),calls=[],g={font:'10px sans-serif',textBaseline:'alphabetic',textAlign:'start',save(){this.old={font:this.font,textBaseline:this.textBaseline,textAlign:this.textAlign};},restore(){Object.assign(this,this.old);},measureText(t){assert.equal(this.font,h.font);return measure(t);},fillRect(...a){calls.push(['box',...a]);},fillText(...a){calls.push(['text',...a,this.font]);}};
 const field=(id,pos,enabled=true)=>({id,name:id,pos,enabled,runway:{},team:0}),fields=[field('Visible',[94,0,94]),field('Disabled',[80,0,80],false),field('OutsideCircle',[50,0,50]),field('OutsideCanvas',[400,0,94])];
 const labels=h.draw(g,fields,{width:188,height:188,point:p=>[p[0],p[2]],nearby:p=>p[0]!==50,scaleBarWidth:94});assert.equal(labels.length,1);assert.equal(labels[0].id,'Visible');assert.deepEqual(calls.filter(c=>c[0]==='text').map(c=>c[1]),['Visible']);assert.equal(g.font,'10px sans-serif');assert.equal(g.textBaseline,'alphabetic');assert.equal(g.textAlign,'start');
});
test('empty or invalid samples produce no names and never invent an airport position',()=>{
 const h=helper();assert.equal(h.layout([],options).length,0);assert.equal(h.layout([row('B',NaN,0),row('R',-1,94),row('X',94,189)],options).length,0);
});
