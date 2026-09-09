// Self-check for brand identity + cluster collapse (plain node, no Leaflet).
//   node client/test-brands.mjs
import assert from 'node:assert/strict';
import { getBrandKey, collapseSameBrand, haversineMiles } from './src/brands.js';

// Name variants of one company resolve to one key (the logo identity)
assert.equal(getBrandKey('GetGo Café + Market'), getBrandKey('GetGo'));
assert.equal(getBrandKey('GetGo Gas Station'), getBrandKey('GetGo'));
assert.equal(getBrandKey('Sheetz #472'), getBrandKey('Sheetz'));
assert.notEqual(getBrandKey('Sheetz'), getBrandKey('GetGo'));
// Unknown brands keep their normalized name as the key
assert.equal(getBrandKey("Joe's Pizza"), "joe's pizza");

// A cluster shows one cell per brand; merged count is kept
const cells = collapseSameBrand(
  [{ n: 'GetGo' }, { n: 'GetGo Café + Market' }, { n: 'Sheetz' }, { n: 'GetGo Gas Station' }],
  (i) => getBrandKey(i.n)
);
assert.deepEqual(cells.map((c) => c.n), ['GetGo', 'Sheetz']);
assert.equal(cells[0].merged, 3);

// Distance helper used for "same physical site" (< 0.1 mi)
assert.ok(haversineMiles(40.32, -79.72, 40.32, -79.72) < 1e-9);
assert.ok(Math.abs(haversineMiles(40.32, -79.72, 40.3345, -79.72) - 1.0) < 0.02);

console.log('brands self-check: 9 assertions green');
