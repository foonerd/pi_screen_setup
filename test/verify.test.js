'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const verify = require('../plugin/lib/verify');
const board = require('../plugin/lib/board');
const configtxt = require('../plugin/lib/configtxt');
const fixtures = require('./fixtures');

// A fake / tree with the files a Pi 5 would show after a boot with KMS applied.
function fakeRoot(opts) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pss-verify-'));
    const mk = (p, content) => { fs.mkdirSync(path.join(root, path.dirname(p)), { recursive: true }); fs.writeFileSync(path.join(root, p), content); };
    if (opts.overlays) for (const o of opts.overlays) { fs.mkdirSync(path.join(root, 'proc/device-tree/chosen/overlays', o), { recursive: true }); mk('proc/device-tree/chosen/overlays/name', 'overlays'); }
    if (opts.vc4) fs.mkdirSync(path.join(root, 'sys/module/vc4'), { recursive: true });
    if (opts.connectors) for (const [name, status, modes] of opts.connectors) {
        mk(`sys/class/drm/card1-${name}/status`, status + '\n');
        mk(`sys/class/drm/card1-${name}/enabled`, (status === 'connected' ? 'enabled' : 'disabled') + '\n');
        mk(`sys/class/drm/card1-${name}/modes`, (modes || []).join('\n') + '\n');
    }
    mk('proc/meminfo', `MemTotal: 4000000 kB\nCmaTotal: ${(opts.cmaMb || 64) * 1024} kB\n`);
    mk('proc/cmdline', 'console=tty1 root=/dev/mmcblk0p2 video=DSI-2:720x1280@60,rotate=90 quiet');
    return root;
}

test('the snapshot reads overlays, connectors, CMA and cmdline from the tree', () => {
    const root = fakeRoot({ overlays: ['vc4-kms-v3d-pi5', 'vc4-kms-dsi-ili9881-7inch'], vc4: true, connectors: [['HDMI-A-1', 'disconnected'], ['DSI-2', 'connected', ['720x1280']]], cmaMb: 64 });
    const s = verify.snapshot(root);
    assert.deepEqual(s.overlays, ['vc4-kms-dsi-ili9881-7inch', 'vc4-kms-v3d-pi5']);
    assert.equal(s.kmsBound, true);
    assert.deepEqual(s.connectors.map((c) => c.name + ':' + c.status), ['DSI-2:connected', 'HDMI-A-1:disconnected']);
    assert.equal(s.connectors[0].modes[0], '720x1280');
    assert.equal(s.cmaMb, 64);
    assert.match(s.cmdline, /video=DSI-2/);
});

test('a tree without the nodes yields nulls, not throws', () => {
    const s = verify.snapshot('/nonexistent-root');
    assert.equal(s.overlays, null);
    assert.equal(s.kmsBound, null);
    assert.equal(s.connectors, null);
    assert.equal(s.cmaMb, null);
    assert.equal(s.cmdline, null);
});

test('findings name what differs between the written config and the running system', () => {
    const actual = { overlays: ['dwc2'], kmsBound: false, connectors: [{ name: 'HDMI-A-1', status: 'disconnected', enabled: 'disabled', modes: [] }], cmaMb: 64, cmdline: '' };
    const f = verify.findings({ kmsOverlay: 'vc4-kms-v3d-pi4', cmaMb: 256, connector: 'HDMI-A-1' }, actual);
    assert.deepEqual(f.map((x) => x.code), ['KMS_NOT_APPLIED', 'CMA_DIFFERS', 'CONNECTOR_NOT_CONNECTED']);
    assert.deepEqual(verify.findings({ kmsOverlay: null }, { overlays: null, kmsBound: true, connectors: null, cmaMb: null }).map((x) => x.code), ['KMS_UNEXPECTED']);
    assert.deepEqual(verify.findings({ kmsOverlay: 'vc4-kms-v3d', cmaMb: null }, { overlays: null, kmsBound: true, connectors: [{ name: 'DSI-1', status: 'connected' }], cmaMb: 256 }), [], 'no chosen/overlays node is not a finding when the driver is bound');
    assert.deepEqual(verify.findings({ kmsOverlay: 'vc4-kms-v3d' }, { overlays: null, kmsBound: null, connectors: null, cmaMb: null }).map((x) => x.code), ['KMS_STATE_UNREADABLE']);
    assert.deepEqual(verify.findings({ kmsOverlay: 'vc4-kms-v3d', connector: 'DSI-2' }, { overlays: null, kmsBound: true, connectors: [{ name: 'HDMI-A-1', status: 'connected' }], cmaMb: null }).map((x) => x.code), ['CONNECTOR_MISSING']);
});

test('the Pi 5 bench capture: KMS bound, DSI-2 connected, 128 MB CMA, no chosen/overlays node', { skip: fixtures.skip }, () => {
    const root = path.join(fixtures.DIR, 'hanger-pi5-td2-4.231');
    const s = verify.snapshot(root);
    assert.equal(s.overlays, null);
    assert.equal(s.kmsBound, true);
    assert.equal(s.connectors.find((c) => c.name === 'DSI-2').status, 'connected');
    assert.equal(s.cmaMb, 128);
    const sys = board.readSystem(root);
    assert.equal(sys.board.name, 'Pi 5');
    assert.equal(sys.board.memoryMb, 16384);
    assert.deepEqual(sys.compatible, ['raspberrypi,5-model-b', 'brcm,bcm2712']);
    // The boot files as the plugin 0.8.1 left them: OS video lines stripped, our file included.
    const read = (n) => fs.readFileSync(path.join(root, 'boot', n), 'utf8');
    const entries = configtxt.parse(read('config.txt'), 'config.txt', { 'volumioconfig.txt': read('volumioconfig.txt'), 'videoconfig.txt': read('videoconfig.txt'), 'userconfig.txt': read('userconfig.txt') });
    const state = configtxt.displayState(configtxt.effective(entries, Object.assign({}, sys.board, { serial: sys.serial })));
    assert.equal(state.kmsOverlay, 'vc4-kms-v3d-pi5');
    assert.equal(state.cmaMb, 128);
    assert.ok(state.overlays.includes('vc4-kms-dsi-ili9881-7inch,rotation=270'));
    assert.equal(state.displayAutoDetect, null, 'the plugin stripped display_auto_detect from the OS file');
    assert.deepEqual(verify.findings({ kmsOverlay: 'vc4-kms-v3d-pi5', cmaMb: 128, connector: 'DSI-2' }, s), []);
});

test('the report carries every section and no account data', () => {
    const b = board.decodeRevision(0xc04170);
    const text = verify.report({
        pluginVersion: '1.0.0', dbVersion: '1.5.9', uname: '6.12.47+rpt-rpi-2712',
        board: b, system: { model: 'Raspberry Pi 5 Model B Rev 1.0', compatible: ['raspberrypi,5-model-b', 'brcm,bcm2712'], serial: '1a2b3c4d' },
        bootFiles: { 'config.txt': 'include volumioconfig.txt\n', 'volumioconfig.txt': '[all]\ndtoverlay=vc4-kms-v3d\n', 'videoconfig.txt': null },
        effective: { kmsOverlay: 'vc4-kms-v3d', kmsParams: '', cmaMb: null, displayAutoDetect: '1', overlays: ['vc4-kms-v3d'], hdmi: {} },
        trailingFilters: ['pi4'],
        expected: { kmsOverlay: 'vc4-kms-v3d-pi5', cmaMb: null, connector: 'DSI-2' },
        actual: { overlays: null, kmsBound: true, connectors: [{ name: 'DSI-2', status: 'connected', enabled: 'enabled', modes: ['720x1280'] }], cmaMb: 64, cmdline: 'quiet' },
        pluginState: { primary_output: 'dsi1', preset: 'rpi-touch-display-2-7' },
        dmesg: '[    1.0] vc4-drm gpu: bound',
    });
    for (const section of ['== Board ==', '== Kernel ==', '== Boot files as found ==', '== Effective for this board', '== Applied by the firmware', '== KMS driver ==', '== DRM connectors', '== Memory ==', '== Plugin ==', '== Findings ==', '== dmesg']) {
        assert.ok(text.includes(section), section);
    }
    assert.ok(text.includes('(missing)'), 'a missing boot file is said so');
    assert.ok(text.includes('WARNING volumioconfig.txt ends inside [pi4]'));
    assert.ok(text.includes('Findings ==\nnone'));
    assert.ok(!text.includes('1a2b3c4d'), 'the full serial is not printed');
    assert.ok(text.includes('…3c4d'));
});
