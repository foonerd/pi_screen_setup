'use strict';
// lib/recover: reading the plugin's own videoconfig.txt and cmdline.txt back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const recover = require('../plugin/lib/recover');

const B = recover.BANNER;

test('a file without the banner is not ours', () => {
    assert.equal(recover.parseVideoconfig('# Pi Screen Setup - Configuration pending\n'), null);
    assert.equal(recover.parseVideoconfig(null), null);
    assert.equal(recover.parseVideoconfig(''), null);
});

test('the sections the generator writes, with and without the [all] lead', () => {
    const text = [B, '# Generated: 2026-10-14T19:06:18.473Z', '# Model: Raspberry Pi 5 Model B Rev 1.1', '[all]', 'stray=1', '',
        '# KMS Display Driver', 'dtoverlay=vc4-kms-v3d-pi5,cma-128', '',
        '# HDMI0 Configuration', 'hdmi_force_hotplug=1', 'hdmi_drive=2', '',
        '# DSI1 Configuration', 'dtoverlay=vc4-kms-dsi-ili9881-7inch,rotation=270', '',
        '# DPI Configuration', 'dtoverlay=vc4-kms-v3d,rotate=90', 'dtoverlay=vc4-kms-dpi-2inch8', 'dpi_timings=1 2 3', '',
        '# Composite Output Configuration', 'enable_tvout=1', 'sdtv_mode=2', 'sdtv_aspect=3', '',
        '# Custom Overlay', 'dtoverlay=example,bar=1', ''].join('\n');
    const p = recover.parseVideoconfig(text);
    assert.equal(p.generated, '2026-10-14T19:06:18.473Z');
    assert.equal(p.model, 'Raspberry Pi 5 Model B Rev 1.1');
    assert.equal(p.migrated, false);
    assert.equal(p.baseline, false);
    assert.deepEqual(p.kms, { overlay: 'vc4-kms-v3d-pi5', cmaMb: 128 });
    assert.deepEqual(p.sections['HDMI0'], ['hdmi_force_hotplug=1', 'hdmi_drive=2']);
    assert.deepEqual(recover.hdmi(p.sections['HDMI0']), { drive: 2, lines: ['hdmi_force_hotplug=1'], extra: [] });
    assert.deepEqual(recover.dsi(p.sections['DSI1']), { overlay: 'vc4-kms-dsi-ili9881-7inch', rotation: 270, params: '', noPanelOverlay: false });
    assert.deepEqual(recover.dpi(p.sections['DPI']), { overlays: ['vc4-kms-v3d', 'vc4-kms-dpi-2inch8'], rotation: 90, timing: ['dpi_timings=1 2 3'] });
    assert.deepEqual(recover.composite(p.sections['Composite']), { mode: 2, aspect: 3 });
    assert.deepEqual(p.sections['Custom Overlay'], ['dtoverlay=example,bar=1']);
    assert.deepEqual(p.unknown, ['stray=1'], 'a line before any section is unknown');
});

test('dsi params with commas, the no-overlay note, custom sections, the baseline and migrated markers, headless', () => {
    const dsi = recover.dsi(['dtoverlay=vc4-kms-dsi-waveshare-panel,7_0_inchC,i2c1']);
    assert.deepEqual(dsi, { overlay: 'vc4-kms-dsi-waveshare-panel', rotation: 0, params: '7_0_inchC,i2c1', noPanelOverlay: false });
    const withRot = recover.dsi(['dtoverlay=vc4-kms-dsi-ili9881-7inch,rotation=90,dsi0']);
    assert.deepEqual(withRot, { overlay: 'vc4-kms-dsi-ili9881-7inch', rotation: 90, params: 'dsi0', noPanelOverlay: false });
    const p = recover.parseVideoconfig([B, '# DSI0 Configuration', '# No vc4-kms-dsi panel dtoverlay line (preset emit_dsi_overlay=false)', '', '# DSI1 Custom Configuration', 'dtoverlay=foo,x=1', '', '# DPI Custom Configuration', 'dtoverlay=vc4-kms-dpi-generic,hactive=800', '', '# Headless Mode - No display output configured', ''].join('\n'));
    assert.equal(recover.dsi(p.sections['DSI0']).noPanelOverlay, true);
    assert.equal(recover.dsi(p.sections['DSI0']).overlay, null);
    assert.deepEqual(p.sections['DSI1 Custom'], ['dtoverlay=foo,x=1']);
    assert.deepEqual(p.sections['DPI Custom'], ['dtoverlay=vc4-kms-dpi-generic,hactive=800']);
    assert.equal(p.headless, true);
    assert.equal(recover.parseVideoconfig([B, '# Baseline: the OS boot files apply no KMS driver on this board (Pi 5)', '[all]', 'dtoverlay=vc4-kms-v3d-pi5'].join('\n')).baseline, true);
    const m = recover.parseVideoconfig([B, '# Source: Migrated from existing configuration', '# KMS Display Driver', 'dtoverlay=vc4-kms-v3d', '# User Display Configuration', 'hdmi_group=2'].join('\n'));
    assert.equal(m.migrated, true);
    assert.deepEqual(m.kms, { overlay: 'vc4-kms-v3d', cmaMb: null });
    assert.deepEqual(recover.dpi(['dtoverlay=vc4-kms-dpi-hyperpixel4']), { overlays: ['vc4-kms-dpi-hyperpixel4'], rotation: 0, timing: [] });
    assert.deepEqual(recover.dpi(['dtoverlay=vc4-kms-dpi-generic,hactive=800,rotate=180']), { overlays: ['vc4-kms-dpi-generic,hactive=800'], rotation: 180, timing: [] });
    assert.deepEqual(recover.hdmi(['hdmi_group:1=2', 'hdmi_mode:1=87', 'hdmi_timings:1=1 2 3', 'max_framebuffer_height=1480', 'hdmi_drive:1=1']), { drive: 1, lines: ['hdmi_group:1=2', 'hdmi_mode:1=87', 'hdmi_timings:1=1 2 3'], extra: ['max_framebuffer_height=1480'] });
    assert.deepEqual(recover.composite([]), { mode: null, aspect: null });
});

test('cmdline: the rotation forms updateCmdline writes', () => {
    assert.deepEqual(recover.cmdline('quiet video=HDMI-A-1:320x1480M@60,rotate=90 plymouth=90 fbcon=rotate:1'), { video: { connector: 'HDMI-A-1', mode: '320x1480M@60', rotate: 90 }, plymouth: 90, fbcon: 1 });
    assert.deepEqual(recover.cmdline('quiet video=DSI-1:rotate=270 plymouth=270 fbcon=rotate:3'), { video: { connector: 'DSI-1', mode: null, rotate: 270 }, plymouth: 270, fbcon: 3 });
    assert.deepEqual(recover.cmdline('quiet video=HDMI-A-2:480x1920M@60 fbcon=rotate:0'), { video: { connector: 'HDMI-A-2', mode: '480x1920M@60', rotate: null }, plymouth: null, fbcon: 0 });
    assert.deepEqual(recover.cmdline('splash plymouth.ignore-serial-consoles quiet'), { video: null, plymouth: null, fbcon: null }, 'plymouth.ignore-serial-consoles is not a rotation');
    assert.deepEqual(recover.cmdline(null), { video: null, plymouth: null, fbcon: null });
});
