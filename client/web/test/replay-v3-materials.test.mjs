import test from 'node:test';
import assert from 'node:assert/strict';
import {litFS} from '../src/gfx/shaders.js';

test('actual replay material branch uses V3 pale armor rim and translucent casualty silhouettes',()=>{
  const source=litFS('');
  assert.match(source,/float fineRim = pow\(1\.0 - nv, 7\.0\)/);
  assert.match(source,/alpha = 0\.011 \+ fineRim \* 0\.18/,'armor faces remain nearly clear with V3 fine rim');
  assert.match(source,/0\.27 \+ fineRim \* 0\.60/,'casualty crew stay translucent');
  assert.match(source,/vec3\(0\.0015, 0\.002, 0\.003\)/,'retained structure uses V3 dark solid role');
  assert.doesNotMatch(source,/dark smoked hull/,'legacy replay hull material is removed');
});
