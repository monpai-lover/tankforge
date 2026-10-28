import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyR82AirwarFixes} from '../tools/apply_r82_airwar_fixes.mjs';
import {applyR83AirwarFixes} from '../tools/apply_r83_airwar_fixes.mjs';
import {applyR84AirwarFixes} from '../tools/apply_r84_airwar_fixes.mjs';
import {applyR85AirwarFixes} from '../tools/apply_r85_airwar_fixes.mjs';

test('current R86 composer installs both leaf owners and legacy composers retain them', async () => {
  const path = new URL('../tools/apply_r86_airwar_fixes.mjs', import.meta.url);
  assert.ok(fs.existsSync(path), 'R86 current composer must exist');
  const {applyR86AirwarFixes} = await import(path);
  const source = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
  const result = applyR86AirwarFixes(source);
  assert.match(result, /TF_R86_WATER_BEGIN/);
  assert.match(result, /TF_R86_AIRWAR_HUD/);
  assert.equal(applyR86AirwarFixes(result), result);
  for (const compose of [applyR82AirwarFixes, applyR83AirwarFixes, applyR84AirwarFixes, applyR85AirwarFixes]) {
    assert.equal(compose(result), result, `${compose.name} must preserve newer reviewed owners`);
  }
});
