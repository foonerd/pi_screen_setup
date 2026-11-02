'use strict';
// lib/strip: the display lines out of Volumio's boot files, and the record that lets a
// clean exit put them back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const strip = require('../plugin/lib/strip');

const OS = fs.readFileSync(path.join(__dirname, 'fixtures', 'os', 'volumioconfig-4.231.txt'), 'utf8');

test('the 4.231 volumioconfig.txt: every KMS and hdmi_ line goes, every filter header and comment stays', () => {
    const r = strip.apply(OS);
    assert.equal(r.changed, true);
    assert.ok(r.removed.length >= 4, JSON.stringify(r.removed));
    assert.ok(r.removed.every((x) => /^(dtoverlay=vc4-|hdmi_|display_auto_detect|max_framebuffer_)/.test(x.line)), JSON.stringify(r.removed));
    assert.ok(r.removed.some((x) => x.section === '[pi4]' || x.section === '[pi5]' || x.section === '[pi3]'), 'removed lines carry the filter they were under');
    const before = OS.split('\n').filter((l) => /^\[.*\]$/.test(l.trim()));
    const after = r.text.split('\n').filter((l) => /^\[.*\]$/.test(l.trim()));
    assert.deepEqual(after, before, 'filter structure unchanged');
    assert.equal(r.text.split('\n').filter((l) => l.startsWith('#')).length, OS.split('\n').filter((l) => l.startsWith('#')).length);
    assert.equal(strip.apply(r.text).changed, false, 'idempotent');
    assert.equal(strip.apply(r.text).text, r.text);
});

test('what is and is not a display line', () => {
    ['dtoverlay=vc4-kms-v3d,cma-128', 'dtoverlay=vc4-fkms-v3d', 'dtoverlay=vc4-kms-dsi-7inch', 'dtoverlay=vc4-kms-dpi-hyperpixel4', 'dtoverlay=vga666', 'hdmi_group=2', 'hdmi_force_hotplug:1=1', 'config_hdmi_boost=7', 'max_framebuffer_height=1480', 'display_auto_detect=1', 'display_default_lcd=0', 'sdtv_mode=2', 'framebuffer_width=800', 'enable_tvout=1', '  hdmi_drive=2  ']
        .forEach((l) => assert.equal(strip.matches(l), true, l));
    ['dtoverlay=hifiberry-dac', 'dtparam=audio=on', 'gpu_mem=128', 'display_lcd_rotate=3', 'display_hdmi_rotate=3', 'display_rotate=1', '#hdmi_group=2', 'include userconfig.txt', '[pi4]', 'arm_64bit=1']
        .forEach((l) => assert.equal(strip.matches(l), false, l));
});

test('CRLF files keep their line ending; comments and blank lines are not touched', () => {
    const r = strip.apply('# c\r\nhdmi_group=2\r\n\r\ndtparam=audio=on\r\n');
    assert.equal(r.text, '# c\r\n\r\ndtparam=audio=on\r\n');
    assert.deepEqual(r.removed, [{ line: 'hdmi_group=2', section: '[all]', index: 1 }]);
    assert.equal(strip.apply('').changed, false);
});

test('the record and the exit plan', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-'));
    const original = 'a\nhdmi_group=2\nb\n';
    const r = strip.apply(original);
    assert.equal(strip.readRecord(dir, 'volumioconfig.txt'), null);
    assert.deepEqual(strip.exitPlan(dir, 'volumioconfig.txt', r.text), { action: 'leave', reason: 'no record' });
    strip.record(dir, 'volumioconfig.txt', original, r.text);
    assert.equal(fs.readFileSync(path.join(dir, 'volumioconfig.txt.original'), 'utf8'), original);
    assert.equal(fs.readFileSync(path.join(dir, 'volumioconfig.txt.sha256'), 'utf8').trim(), strip.sha256(r.text));
    assert.deepEqual(strip.exitPlan(dir, 'volumioconfig.txt', r.text), { action: 'restore', original });
    assert.deepEqual(strip.exitPlan(dir, 'volumioconfig.txt', r.text + '# edited\n'), { action: 'leave', reason: 'changed since the plugin stripped it' });
    assert.deepEqual(strip.exitPlan(dir, 'volumioconfig.txt', null), { action: 'none', reason: 'no file' });
    fs.rmSync(dir, { recursive: true });
});
