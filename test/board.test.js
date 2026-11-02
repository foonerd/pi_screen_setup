'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const board = require('../plugin/lib/board');

// Codes from the official "new-style revision codes in use" table (2026-11-02).
const CASES = [
    ['a02082', 'Pi 3B', 1024, 'bcm2837', ['pi3'], 'vc4-kms-v3d'],
    ['a020d3', 'Pi 3B+', 1024, 'bcm2837', ['pi3', 'pi3+'], 'vc4-kms-v3d'],
    ['9020e0', 'Pi 3A+', 512, 'bcm2837', ['pi3', 'pi3+'], 'vc4-kms-v3d'],
    ['9020e1', 'Pi 3A+', 512, 'bcm2837', ['pi3', 'pi3+'], 'vc4-kms-v3d'],
    ['a02042', 'Pi 2B', 1024, 'bcm2837', ['pi2'], 'vc4-kms-v3d'],
    ['a01041', 'Pi 2B', 1024, 'bcm2836', ['pi2'], 'vc4-kms-v3d'],
    ['902120', 'Pi Zero 2 W', 512, 'bcm2837', ['pi0', 'pi0w', 'pi02'], 'vc4-kms-v3d'],
    ['c03111', 'Pi 4B', 4096, 'bcm2711', ['pi4'], 'vc4-kms-v3d-pi4'],
    ['a03111', 'Pi 4B', 1024, 'bcm2711', ['pi4'], 'vc4-kms-v3d-pi4'],
    ['d03115', 'Pi 4B', 8192, 'bcm2711', ['pi4'], 'vc4-kms-v3d-pi4'],
    ['c03130', 'Pi 400', 4096, 'bcm2711', ['pi4', 'pi400'], 'vc4-kms-v3d-pi4'],
    ['a03140', 'CM4', 1024, 'bcm2711', ['pi4', 'cm4'], 'vc4-kms-v3d-pi4'],
    ['c04170', 'Pi 5', 4096, 'bcm2712', ['pi5'], 'vc4-kms-v3d-pi5'],
    ['e04171', 'Pi 5', 16384, 'bcm2712', ['pi5'], 'vc4-kms-v3d-pi5'],
    ['d04180', 'CM5', 8192, 'bcm2712', ['pi5', 'cm5'], 'vc4-kms-v3d-pi5'],
    ['d04190', 'Pi 500', 8192, 'bcm2712', ['pi5', 'pi500'], 'vc4-kms-v3d-pi5'],
    ['c041a0', 'CM5 Lite', 4096, 'bcm2712', ['pi5', 'cm5'], 'vc4-kms-v3d-pi5'],
    ['a02100', 'CM3+', 1024, 'bcm2837', ['pi3', 'pi3+', 'cm3+'], 'vc4-kms-v3d'],
    ['9000c1', 'Pi Zero W', 512, 'bcm2835', ['pi0', 'pi0w'], null],
    ['900032', 'Pi B+', 512, 'bcm2835', ['pi1'], null],
];

test('new-style revision codes decode to the documented board', () => {
    for (const [hex, name, mem, proc, filters, overlay] of CASES) {
        const b = board.decodeRevision(board.parseRevision(hex));
        assert.equal(b.name, name, hex);
        assert.equal(b.memoryMb, mem, hex + ' memory');
        assert.equal(b.processor, proc, hex + ' processor');
        assert.deepEqual(b.filters, filters, hex + ' filters');
        assert.equal(b.kmsOverlay, overlay, hex + ' overlay');
        assert.equal(b.known, true, hex);
    }
});

test('Pi 400, Pi 500 and the Zero 2 W are not their bigger siblings', () => {
    assert.equal(board.decodeRevision(0xc03130).dsi.length, 0, 'Pi 400 has no DSI');
    assert.equal(board.decodeRevision(0xd04190).dsi.length, 0, 'Pi 500 has no DSI');
    assert.equal(board.decodeRevision(0x902120).kms, 'os-omits');
    assert.equal(board.decodeRevision(0x902120).dsi.length, 0);
    assert.deepEqual(board.decodeRevision(0xc04170).dsi, ['dsi0', 'dsi1']);
    assert.deepEqual(board.decodeRevision(0xc03111).dsi, ['dsi1']);
});

test('the revision is read from device-tree bytes, a cpuinfo dump, or a hex string', () => {
    assert.equal(board.parseRevision(Buffer.from([0x00, 0xc0, 0x41, 0x70])), 0xc04170);
    assert.equal(board.parseRevision('Hardware\t: BCM2835\nRevision\t: c04170\nSerial\t\t: 10000000abcdef01\nModel\t\t: Raspberry Pi 5 Model B Rev 1.0\n'), 0xc04170);
    assert.equal(board.parseRevision('0xa02082'), 0xa02082);
    assert.equal(board.parseRevision('a02082'), 0xa02082);
    assert.equal(board.parseRevision('garbage'), null);
    assert.equal(board.parseRevision(''), null);
});

test('old-style codes are Pi 1 era boards without KMS', () => {
    const b = board.decodeRevision(0x000e);
    assert.equal(b.name, 'Pi B');
    assert.equal(b.newStyle, false);
    assert.equal(b.kms, 'no');
    assert.deepEqual(b.filters, ['pi1']);
    assert.equal(board.decodeRevision(0x0011).filters.indexOf('cm1') !== -1, true);
    assert.equal(board.decodeRevision(0x00ff), null);
});

test('an unknown new-style type is reported, not guessed', () => {
    const b = board.decodeRevision(0x80f000 | (0xee << 4));
    assert.equal(b.known, false);
    assert.equal(b.type, 0xee);
    assert.deepEqual(b.filters, []);
});

test('DSI connector names follow the family', () => {
    const pi5 = board.decodeRevision(0xc04170);
    const pi4 = board.decodeRevision(0xc03111);
    assert.equal(board.dsiConnector(pi5, 'dsi1'), 'DSI-2');
    assert.equal(board.dsiConnector(pi5, 'dsi0'), 'DSI-1');
    assert.equal(board.dsiConnector(pi4, 'dsi1'), 'DSI-1');
});

test('MemTotal rounds up to the installed size', () => {
    assert.equal(board.memoryFromMeminfo('MemTotal:         944200 kB\n'), 1024);
    assert.equal(board.memoryFromMeminfo('MemTotal:         429000 kB\n'), 512);
    assert.equal(board.memoryFromMeminfo('MemTotal:        3884000 kB\n'), 4096);
    assert.equal(board.memoryFromMeminfo('nothing'), null);
});

test('readSystem tolerates a machine that is not a Pi', () => {
    const s = board.readSystem('/nonexistent-root');
    assert.equal(s.board, null);
    assert.deepEqual(s.compatible, []);
});
