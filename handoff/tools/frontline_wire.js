    // Lossless, opt-in native frame transport. A decoder belongs to one socket.
    // Failed packets never alter the accepted frame or its string dictionary.
    function createFrontlineWireDecoder(){
      const MAX_BYTES=16*1024*1024,MAX_NODES=2000000,MAX_SYMBOLS=65536,MAX_DEPTH=64;
      const SAFE=9007199254740991n,own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
      const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
      const define=(o,k,v)=>Object.defineProperty(o,k,{value:v,writable:true,enumerable:true,configurable:true});
      // JSON float/integer tags remain distinct even when both become JS Number.
      // This guards identity fields and float-XOR patches without changing views.
      let types=new WeakMap(),header=null,baseline=null,symbols=[],symbolSet=new Set();
      const floats=(o,k)=>types.get(o)===true||types.get(o)?.has(k)===true;
      const fail=reason=>{throw new Error('frontline wire2: '+reason);};
      const freeze=v=>{
        if(v&&typeof v==='object'&&!Object.isFrozen(v)){
          for(const k of Object.keys(v))freeze(v[k]);
          Object.freeze(v);
        }
        return v;
      };
      function scope(frame){
        const uint=(o,k,positive)=>object(o)&&own(o,k)&&!floats(o,k)&&Number.isSafeInteger(o[k])&&o[k]>=(positive?1:0);
        if(!object(frame)||frame.op!=='frame'||!uint(frame,'battle',true)||!uint(frame,'tick',false))fail('frame identity');
        const ids=new Set();
        for(const field of ['units','aircrafts']){
          if(!Array.isArray(frame[field]))fail('missing frame entities');
          for(const item of frame[field]){
            const u=object(item)&&own(item,'unit')?item.unit:null;
            if(!uint(u,'battle',true)||!uint(u,'unit',true)||!uint(u,'life',true)||u.battle!==frame.battle||ids.has(u.unit))fail('cross-battle/duplicate unit identity');
            ids.add(u.unit);
          }
        }
        return [BigInt(frame.battle),BigInt(frame.tick)];
      }
      function decode(input){
        let bytes;
        if(input instanceof ArrayBuffer)bytes=new Uint8Array(input);
        else if(ArrayBuffer.isView(input))bytes=new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
        else fail('binary packet required');
        if(bytes.length<41||bytes.length>MAX_BYTES)fail('frame byte length');
        const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        if(bytes[0]!==84||bytes[1]!==70||bytes[2]!==68||bytes[3]!==50||bytes[4]>1)fail('header');
        const next={full:bytes[4]===0,stream:view.getBigUint64(5,true),epoch:view.getUint32(13,true),battle:view.getBigUint64(17,true),tick:view.getBigUint64(25,true),baseTick:view.getBigUint64(33,true)};
        if(!next.stream||!next.epoch||!next.battle||next.full&&next.baseTick!==0n||!next.full&&next.tick<=next.baseTick)fail('header identity/tick');
        if(header){
          if(next.stream!==header.stream)fail('socket stream changed');
          if(next.full){
            if(next.epoch<=header.epoch||next.battle===header.battle&&next.tick<header.tick)fail('stale reset');
          }else if(next.epoch!==header.epoch||next.battle!==header.battle||next.baseTick!==header.tick)fail('missing or different baseline');
        }else if(!next.full)fail('full baseline required');
        const existing=next.full?[]:symbols,known=next.full?new Set():symbolSet,added=[],addedSet=new Set();
        let offset=41,nodes=0;
        const visit=depth=>{if(depth>MAX_DEPTH||++nodes>MAX_NODES)fail('tree depth/nodes');};
        const take=n=>{if(n<0||offset+n>bytes.length)fail('truncated frame');const start=offset;offset+=n;return start;};
        const byte=()=>bytes[take(1)];
        function varint(){
          let result=0n;
          for(let i=0;i<10;i++){
            const b=byte();
            if(i===9&&b>1||i>0&&b===0)fail('noncanonical/overflow varint');
            result|=BigInt(b&127)<<BigInt(i*7);
            if(b<128)return result;
          }
          fail('overflow varint');
        }
        const count=()=>{const n=varint();if(n>BigInt(MAX_NODES))fail('container length');return Number(n);};
        const finite=v=>{if(!Number.isFinite(v))fail('nonfinite number');return v;};
        const number=(width)=>finite(width===4?view.getFloat32(take(4),true):view.getFloat64(take(8),true));
        const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
        function string(){
          const tag=byte();
          if(tag===6){
            const length=count(),at=take(length);
            let s;try{s=utf8.decode(bytes.subarray(at,at+length));}catch(_){fail('UTF8');}
            if(known.has(s)||addedSet.has(s))fail('duplicate string definition');
            if(existing.length+added.length>=MAX_SYMBOLS)fail('string dictionary');
            added.push(s);addedSet.add(s);return s;
          }
          if(tag===7){
            const id=count();if(id>=existing.length+added.length)fail('unknown string reference');
            return id<existing.length?existing[id]:added[id-existing.length];
          }
          fail('expected string');
        }
        const boxed=(v,f=false)=>({v,f});
        function value(depth){
          visit(depth);const tag=byte();
          if(tag===0)return boxed(null);
          if(tag===1||tag===2)return boxed(tag===2);
          if(tag===3){const raw=varint(),i=(raw>>1n)^-(raw&1n);if(i>=0n||i< -SAFE)fail('negative integer');return boxed(Number(i));}
          if(tag===4){const u=varint();if(u>SAFE)fail('unsafe JavaScript integer');return boxed(Number(u));}
          if(tag===5||tag===10)return boxed(number(tag===10?4:8),true);
          if(tag===6||tag===7){offset--;return boxed(string());}
          if(tag===8||tag===11||tag===12){
            const length=count(),a=[],mask=new Set();
            // Check packed lengths before allocating their elements.
            if(tag!==8&&length*(tag===11?4:8)>bytes.length-offset)fail('truncated packed array');
            for(let i=0;i<length;i++){
              if(tag===8){const n=value(depth+1);a.push(n.v);if(n.f)mask.add(String(i));}
              else{visit(depth+1);a.push(number(tag===11?4:8));}
            }
            if(tag!==8)types.set(a,true);else if(mask.size)types.set(a,mask);
            return boxed(a);
          }
          if(tag===9){
            const length=count(),o={},mask=new Set();
            for(let i=0;i<length;i++){
              const key=string();if(own(o,key))fail('duplicate object key');
              const n=value(depth+1);define(o,key,n.v);if(n.f)mask.add(key);
            }
            if(mask.size)types.set(o,mask);return boxed(o);
          }
          fail('value tag');
        }
        function copy(base){
          const out=Array.isArray(base)?base.slice():{};
          if(!Array.isArray(base))for(const key of Object.keys(base))define(out,key,base[key]);
          const old=types.get(base),mask=old===true?new Set(Object.keys(base)):new Set(old);
          types.set(out,mask);return [out,mask];
        }
        function patch(base,isFloat,depth){
          visit(depth);const tag=byte();
          if(tag===0)return boxed(base,isFloat);
          if(tag===1)return value(depth+1);
          if(tag===2){
            if(!object(base))fail('object patch type');
            const [out,mask]=copy(base),length=count(),seen=new Set(),entity=object(base.unit)&&own(base,'unit');
            for(let i=0;i<length;i++){
              const key=string();if(seen.has(key))fail('duplicate patch key');seen.add(key);
              if(entity&&key==='unit')fail('identity requires entity replacement');
              if(bytes[offset]===4){
                offset++;if(!own(base,key))fail('remove missing key');delete out[key];mask.delete(key);
              }else{
                let n;
                if(own(base,key))n=patch(base[key],floats(base,key),depth+1);
                else{if(byte()!==1)fail('new key requires replacement');n=value(depth+1);}
                define(out,key,n.v);if(n.f)mask.add(key);else mask.delete(key);
              }
            }
            return boxed(out);
          }
          if(tag===3){
            if(!Array.isArray(base))fail('array patch type');
            const [out,mask]=copy(base),length=count(),seen=new Set();
            for(let i=0;i<length;i++){
              const index=count();if(index>=base.length||seen.has(index))fail('duplicate/invalid array index');seen.add(index);
              const key=String(index),n=patch(base[index],floats(base,key),depth+1);
              out[index]=n.v;if(n.f)mask.add(key);else mask.delete(key);
            }
            return boxed(out);
          }
          if(tag===5){
            if(!isFloat||typeof base!=='number')fail('float XOR base');
            const bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,base,true);
            bits.setBigUint64(0,bits.getBigUint64(0,true)^varint(),true);
            return boxed(finite(bits.getFloat64(0,true)),true);
          }
          fail('patch tag');
        }
        const frame=(next.full?value(0):patch(baseline,false,0)).v;
        if(offset!==bytes.length)fail('trailing bytes');
        const [battle,tick]=scope(frame);if(battle!==next.battle||tick!==next.tick)fail('header/frame identity mismatch');
        // Freeze only new branches; unchanged branches already belong to a
        // frozen accepted sample, and can safely be shared by subsequent frames.
        freeze(frame);
        if(next.full){symbols=added;symbolSet=addedSet;}
        else{for(const s of added){symbols.push(s);symbolSet.add(s);}}
        baseline=frame;header=next;
        return {t:'frontline',version:1,message:frame};
      }
      return {
        decode,
        reset(){header=null;baseline=null;symbols=[];symbolSet=new Set();types=new WeakMap();},
        get state(){return header?Object.freeze({...header,symbols:symbols.length}):null;}
      };
    }
