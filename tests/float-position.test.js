import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampFloat } from '../src/ui/float-position.js';

const bounds = { width: 375, top: 35, bottom: 740 };

test('stays below the top bar and above the input bar', () => {
    assert.deepEqual(clampFloat(331, 0, 44, bounds), { x: 331, y: 35 });
    assert.deepEqual(clampFloat(10, 900, 44, bounds), { x: 10, y: 696 });
});

test('stays inside the screen horizontally', () => {
    assert.deepEqual(clampFloat(-50, 300, 44, bounds), { x: 0, y: 300 });
    assert.deepEqual(clampFloat(9999, 300, 44, bounds), { x: 331, y: 300 });
});
