'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const configtxt = require('../plugin/lib/configtxt');
const board = require('../plugin/lib/board');

const os = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'os', name), 'utf8');
const files = (volumioconfig, userconfig) => ({
    'volumioconfig.txt': volumioconfig,
    'userconfig.txt': userconfig || '',
});
const PI5 = Object.assign(board.decodeRevision(0xc04170), { serial: '1a2b3c4d' });
const PI4 = Object.assign(board.decodeRevision(0xc03111), { serial: '1a2b3c4d' });
const PI3BP = Object.assign(board.decodeRevision(0xa020d3), { serial: '1a2b3c4d' });
const PI3AP = Object.assign(board.decodeRevision(0x9020e1), { serial: '1a2b3c4d' });
const ZERO2 = Object.assign(board.decodeRevision(0x902120), { serial: '1a2b3c4d' });
const CM4 = Object.assign(board.decodeRevision(0xa03140), { serial: '1a2b3c4d' });

function state(volumioconfig, b, userconfig) {
    const entries = configtxt.parse(os('config-4.231.txt'), 'config.txt', files(volumioconfig, userconfig));
    return configtxt.displayState(configtxt.effective(entries, b));
}

test('filters of different types combine, of the same type replace, [all] resets', () => {
    const text = ['[pi4]', 'a=1', '[pi5]', 'b=1', '[0x1a2b3c4d]', 'c=1', '[all]', 'd=1', '[none]', 'e=1', '[all]', 'f=1'].join('\n');
    const eff = configtxt.effective(configtxt.parse(text, 't'), PI5);
    assert.deepEqual(Object.keys(eff.single).sort(), ['b', 'c', 'd', 'f']);
    const eff4 = configtxt.effective(configtxt.parse(text, 't'), PI4);
    assert.deepEqual(Object.keys(eff4.single).sort(), ['a', 'd', 'f'], 'the serial AND pi5 excludes c on a Pi 4');
});

test('[0x…] is a serial-number filter, not a revision filter', () => {
    const text = '[0x9020e1]\nx=1\n[all]\ny=1';
    assert.deepEqual(Object.keys(configtxt.effective(configtxt.parse(text, 't'), PI3AP).single), ['y'], 'a 3A+ whose serial is not 9020e1 does not match');
    const lucky = Object.assign({}, PI3AP, { serial: '9020e1' });
    assert.deepEqual(Object.keys(configtxt.effective(configtxt.parse(text, 't'), lucky).single).sort(), ['x', 'y']);
    assert.deepEqual(Object.keys(configtxt.effective(configtxt.parse('[board-type=0xe]\nx=1', 't'), PI3AP).single), ['x'], 'board-type is the filter pi.sh wanted');
});

test('Volumio 4.231 volumioconfig.txt never applies KMS on a Pi 3B+, 4 or 5', () => {
    const v = os('volumioconfig-4.231.txt');
    for (const [b, name] of [[PI5, 'Pi 5'], [PI4, 'Pi 4'], [PI3BP, 'Pi 3B+'], [PI3AP, 'Pi 3A+'], [CM4, 'CM4']]) {
        const s = state(v, b);
        assert.equal(s.kmsOverlay, null, name + ': the serial filters before [pi3]/[pi4]/[pi5] swallow the overlay lines');
        assert.equal(s.displayAutoDetect, '1', name + ': [all] still applies');
    }
    assert.equal(state(v, ZERO2).kmsOverlay, null, 'Zero 2 W: omitted on purpose');
});

test('Volumio 4.119 volumioconfig.txt applies KMS with the kernel default CMA', () => {
    const v = os('volumioconfig-4.119.txt');
    for (const [b, name] of [[PI5, 'Pi 5'], [PI4, 'Pi 4'], [PI3BP, 'Pi 3B+'], [PI3AP, 'Pi 3A+'], [CM4, 'CM4']]) {
        const s = state(v, b);
        assert.equal(s.kmsOverlay, 'vc4-kms-v3d', name);
        assert.equal(s.cmaMb, null, name + ': no cma parameter');
    }
    assert.equal(state(v, ZERO2).kmsOverlay, null);
});

test('a corrected 4.231 file (board-type instead of serial) gives the 3A+ its 128 MB and the rest the default', () => {
    const fixed = os('volumioconfig-4.231.txt').replace('[0x9020e0]', '[board-type=0x0e]').replace('[0x9020e1]\ndtoverlay=vc4-kms-v3d,cma-128\n', '').replace('[pi3]\ndtoverlay=vc4-kms-v3d', '[all]\n[pi3]\ndtoverlay=vc4-kms-v3d');
    // The second overlay line for [pi3] still follows the [board-type] block; pi.sh's
    // intent needs an [all] (or the board-type block placed last). Both lines are
    // accumulated by the firmware, so the 3A+ sees two overlay lines; the first wins
    // for the parameter the kernel reads — the plugin must own this instead.
    const s3 = state(fixed, PI3AP);
    assert.equal(s3.overlays.filter((o) => o.startsWith('vc4-kms-v3d')).length, 2);
    assert.equal(state(fixed, PI4).kmsOverlay, 'vc4-kms-v3d');
    assert.equal(state(fixed, PI5).kmsOverlay, 'vc4-kms-v3d');
});

test('a filter left open in volumioconfig.txt would govern userconfig.txt', () => {
    const v = '[pi4]\ndtoverlay=vc4-kms-v3d';
    const u = 'dtoverlay=hifiberry-dac';
    assert.deepEqual(state(v, PI5, u).overlays, [], 'Pi 5 inherits [pi4] across the include');
    assert.deepEqual(state(v, PI4, u).overlays, ['vc4-kms-v3d', 'hifiberry-dac']);
    assert.deepEqual(configtxt.trailingFilters(configtxt.parse(v, 'v')), ['pi4']);
    assert.deepEqual(configtxt.trailingFilters(configtxt.parse(os('volumioconfig-4.231.txt'), 'v')), [], 'the OS file ends in [all]');
});

test('the display state reads the KMS line, its CMA and the HDMI keys', () => {
    const text = 'dtoverlay=vc4-kms-v3d-pi4,cma-256,noaudio\nhdmi_group=2\nhdmi_mode=87\nhdmi_cvt 1024 600 60 6 0 0 0\ndisplay_auto_detect=0';
    const s = configtxt.displayState(configtxt.effective(configtxt.parse(text, 't'), PI4));
    assert.equal(s.kmsOverlay, 'vc4-kms-v3d-pi4');
    assert.equal(s.cmaMb, 256);
    assert.equal(s.kmsParams, 'cma-256,noaudio');
    assert.equal(s.displayAutoDetect, '0');
    assert.deepEqual(s.hdmi, { hdmi_group: '2', hdmi_mode: '87', hdmi_cvt: '1024 600 60 6 0 0 0' });
    assert.equal(configtxt.displayState(configtxt.effective(configtxt.parse('dtoverlay=vc4-kms-v3d,cma-size=134217728', 't'), PI4)).cmaMb, 128);
});

test('a missing include is recorded and the rest still evaluates', () => {
    const entries = configtxt.parse('include missing.txt\nx=1', 'c', {});
    assert.equal(entries.find((e) => e.kind === 'include').found, false);
    assert.deepEqual(Object.keys(configtxt.effective(entries, PI4).single), ['x']);
});

test('unknown filters hide lines and never apply them', () => {
    const eff = configtxt.effective(configtxt.parse('[whatever=1]\nx=1\n[all]\ny=1', 't'), PI4);
    assert.deepEqual(Object.keys(eff.single), ['y']);
});
