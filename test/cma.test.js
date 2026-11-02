'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cma = require('../plugin/lib/cma');
const board = require('../plugin/lib/board');

const b = (hex) => board.decodeRevision(board.parseRevision(hex));

test('the policy follows the overlay default and clamps 512 MB boards', () => {
    assert.deepEqual(cma.policy(b('c04170')), { kernelDefault: 64, recommended: 64, max: 512, sizes: cma.SIZES, auto: true }, 'Pi 5 4 GB');
    assert.deepEqual(cma.policy(b('c03111')), { kernelDefault: 508, recommended: 508, max: 512, sizes: cma.SIZES, auto: true }, 'Pi 4 4 GB');
    assert.deepEqual(cma.policy(b('a03111')).max, 512, 'Pi 4 1 GB: half of RAM');
    assert.deepEqual(cma.policy(b('a02082')), { kernelDefault: 256, recommended: 256, max: 512, sizes: cma.SIZES, auto: true }, 'Pi 3B 1 GB');
    const p3a = cma.policy(b('9020e1'));
    assert.equal(p3a.recommended, 128, 'Pi 3A+: Volumio policy');
    assert.equal(p3a.max, 128);
    assert.deepEqual(p3a.sizes, [32, 64, 96, 128]);
    assert.equal(p3a.auto, false);
    assert.equal(cma.policy(b('9000c1')).kernelDefault, null, 'Zero W: no KMS');
    assert.equal(cma.policy(null).sizes.length, 0);
});

test('the parameter is empty for auto on big boards and explicit on small ones', () => {
    assert.equal(cma.parameter('auto', null, b('c04170')), '');
    assert.equal(cma.parameter('auto', null, b('c03111')), '');
    assert.equal(cma.parameter('auto', null, b('9020e1')), ',cma-128');
    assert.equal(cma.parameter(256, null, b('c03111')), ',cma-256');
    assert.equal(cma.parameter(256, null, b('9020e1')), ',cma-128', 'clamped to the small-board max');
    assert.equal(cma.parameter('custom', 250, b('c03111')), ',cma-252', '4 MB aligned');
    assert.equal(cma.parameter('custom', 9000, b('c03111')), ',cma-512');
    assert.equal(cma.parameter('custom', 1, b('c03111')), ',cma-32');
    assert.equal(cma.parameter('custom', 'x', b('c03111')), '', 'garbage falls back to auto');
});

test('legacy options map onto the new choices', () => {
    assert.deepEqual(cma.fromLegacyOption('default'), { choice: 64 });
    assert.deepEqual(cma.fromLegacyOption('high'), { choice: 256 });
    assert.deepEqual(cma.fromLegacyOption('custom', 200), { choice: 'custom', mb: 200 });
    assert.deepEqual(cma.fromLegacyOption('256'), { choice: 256 });
    assert.deepEqual(cma.fromLegacyOption('auto'), { choice: 'auto' });
    assert.deepEqual(cma.fromLegacyOption(undefined), { choice: 'auto' });
});

test('the applied CMA is read from CmaTotal', () => {
    assert.equal(cma.appliedMb('MemTotal: 1000 kB\nCmaTotal:          65536 kB\nCmaFree: 1 kB'), 64);
    assert.equal(cma.appliedMb('CmaTotal:         520192 kB'), 508);
    assert.equal(cma.appliedMb('nothing'), null);
});
