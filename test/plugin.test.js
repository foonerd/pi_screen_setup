'use strict';
// The plugin shell with a stub Volumio context: the KMS line that generateVideoConfig
// writes for real boards, and the two preset update paths keeping every field.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const board = require('../plugin/lib/board');

const PiScreenSetup = require(path.join('..', 'plugin', 'index.js'));

function plugin(values) {
    const store = Object.assign({}, values);
    const ctx = {
        coreCommand: { pushToastMessage() { }, broadcastMessage() { }, sharedVars: { get: () => 'en' } },
        logger: { info() { }, warn() { }, error() { } },
        configManager: {},
    };
    const p = new PiScreenSetup(ctx);
    p.config = { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; } };
    p.getI18n = (k) => k;
    p.store = store;
    return p;
}

function hw(hex) {
    const b = board.decodeRevision(board.parseRevision(hex));
    return { model: b.name, model_raw: 'Raspberry Pi', soc: b.processor, ram_mb: b.memoryMb, hdmi_ports: b.hdmi, dsi_ports: b.dsi, has_composite: b.composite, kms_supported: b.kms === 'yes', kms_overlay: b.kmsOverlay, kms_policy: b.kms, board: b, serial: null, is_pi: true };
}

const kmsLine = (text) => text.split(/\r?\n/).find((l) => l.startsWith('dtoverlay=vc4-kms')) || null;

test('the KMS line follows the board: kernel default on auto, Volumio 128 on a 3A+', () => {
    const base = { 'kms.mode': 'on', 'primary_output': 'hdmi0', 'hdmi0.enabled': true, 'hdmi0.display_preset': 'auto' };
    let p = plugin(Object.assign({ 'kms.cma_option': 'auto' }, base)); p.hardwareInfo = hw('c04170');
    assert.equal(kmsLine(p.generateVideoConfig()), 'dtoverlay=vc4-kms-v3d-pi5', 'Pi 5 auto');
    p = plugin(Object.assign({ 'kms.cma_option': 'auto' }, base)); p.hardwareInfo = hw('c03111');
    assert.equal(kmsLine(p.generateVideoConfig()), 'dtoverlay=vc4-kms-v3d-pi4', 'Pi 4 auto');
    p = plugin(Object.assign({ 'kms.cma_option': 'auto' }, base)); p.hardwareInfo = hw('9020e1');
    assert.equal(kmsLine(p.generateVideoConfig()), 'dtoverlay=vc4-kms-v3d,cma-128', 'Pi 3A+ auto is the Volumio 128');
    p = plugin(Object.assign({ 'kms.cma_option': 'default' }, base)); p.hardwareInfo = hw('c03111');
    assert.equal(kmsLine(p.generateVideoConfig()), 'dtoverlay=vc4-kms-v3d-pi4,cma-64', 'legacy default still 64 until migrated');
    p = plugin(Object.assign({ 'kms.cma_option': '256' }, base)); p.hardwareInfo = hw('9020e1');
    assert.equal(kmsLine(p.generateVideoConfig()), 'dtoverlay=vc4-kms-v3d,cma-128', 'clamped on 512 MB');
    p = plugin(Object.assign({ 'kms.cma_option': 'custom', 'kms.cma_custom_mb': 250 }, base)); p.hardwareInfo = hw('a02082');
    assert.equal(kmsLine(p.generateVideoConfig()), 'dtoverlay=vc4-kms-v3d,cma-252');
    p = plugin(Object.assign({ 'kms.cma_option': 'auto' }, base)); p.hardwareInfo = hw('902120');
    assert.equal(kmsLine(p.generateVideoConfig()), null, 'Zero 2 W: KMS omitted as the OS does');
});

test('updating a preset keeps the fields the form does not carry', () => {
    const p = plugin({});
    p.draftPresets = { version: '1.5.9', presets: { 'btt-pitft50-v1.0': { name: 'BTT', type: 'dsi', description: 'd', config: { dtoverlay: 'x' }, vc4_kms: false, emit_dsi_overlay: false, native_resolution: '800x480', notes: 'n' } } };
    p.saveDraftPresets = () => { };
    p.refreshUIConfig = () => { };
    p.adminUpdatePreset({ admin_preset_id: 'btt-pitft50-v1.0', admin_preset_name: 'BTT 2', admin_preset_type: 'dsi', admin_preset_desc: 'd2', admin_preset_config: '{"dtoverlay":"y"}' });
    const after = p.draftPresets.presets['btt-pitft50-v1.0'];
    assert.equal(after.name, 'BTT 2');
    assert.deepEqual(after.config, { dtoverlay: 'y' });
    assert.equal(after.vc4_kms, false);
    assert.equal(after.emit_dsi_overlay, false);
    assert.equal(after.native_resolution, '800x480');
    assert.equal(after.notes, 'n');
});

test('detectHardware on a machine without a revision code resolves a non-Pi', async () => {
    const p = plugin({});
    const info = await p.detectHardware();
    assert.equal(typeof info.is_pi, 'boolean');
    assert.equal(info.kms_overlay === null || typeof info.kms_overlay === 'string', true);
});

test('the stored "default" CMA is moved to auto once, with a notice', () => {
    const toasts = [];
    const p = plugin({ 'kms.cma_option': 'default' });
    p.commandRouter.pushToastMessage = (type, title, msg) => toasts.push(msg);
    p.hardwareInfo = hw('c03111');
    assert.equal(p.migrateCmaDefault(), true);
    assert.equal(p.store['kms.cma_option'], 'auto');
    assert.equal(p.store['kms.cma_migrated'], true);
    assert.equal(toasts.length, 1);
    assert.equal(p.migrateCmaDefault(), false, 'only once');
    const q = plugin({ 'kms.cma_option': 'high' }); q.hardwareInfo = hw('c03111');
    assert.equal(q.migrateCmaDefault(), false, 'an explicit choice stays');
    assert.equal(q.store['kms.cma_option'], 'high');
});
