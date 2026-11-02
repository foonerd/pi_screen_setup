'use strict';
// lib/overlays: the shipped vendor overlay files — the manifest, the name mapping both
// ways, what a videoconfig.txt needs, what is installed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const overlays = require('../plugin/lib/overlays');

const SHIPPED = path.join(__dirname, '..', 'plugin', 'overlays');

test('the shipped set loads clean and maps the vendor names the database uses', () => {
    const s = overlays.load(SHIPPED);
    assert.deepEqual(s.problems, []);
    assert.equal(s.count, 17);
    assert.equal(s.fetched, '2026-11-02');
    assert.equal(s.fileFor('vc4-kms-DPI-5inch'), 'pss-vc4-kms-dpi-5inch');
    assert.equal(s.fileFor('waveshare_35DSI'), 'pss-waveshare-35dsi', 'the database writes it with a small w, the vendor with a capital');
    assert.equal(s.fileFor('vc4-kms-v3d'), null, 'a kernel overlay is not ours');
    assert.equal(s.fileFor(null), null);
    assert.equal(s.vendorFor('pss-waveshare-35dsi'), 'Waveshare_35DSI');
    assert.equal(s.vendorFor('pss-nothing'), null);
    assert.ok(s.names().has('waveshare_35dsi') && s.names().has('vc4-kms-dpi-5inch'));
    assert.equal(s.record('pss-waveshare-5dpi').source, 'https://files.waveshare.com/wiki/5inch%20DPI%20LCD/5DPI-DTBO.zip');
    assert.equal(s.bytes('pss-waveshare-5dpi').readUInt32BE(0), overlays.FDT_MAGIC);
    assert.equal(s.bytes('pss-nothing'), null);
});

test('a dtoverlay value to the shipped name and back, parameters untouched', () => {
    const s = overlays.load(SHIPPED);
    assert.equal(s.toShipped('waveshare_35DSI,35H,dsi1'), 'pss-waveshare-35dsi,35H,dsi1');
    assert.equal(s.toShipped('vc4-kms-DPI-5inch'), 'pss-vc4-kms-dpi-5inch');
    assert.equal(s.toShipped('vc4-kms-v3d,cma-256'), 'vc4-kms-v3d,cma-256');
    assert.equal(s.toShipped('vc4-kms-dsi-generic,hactive=640,hfp=48'), 'vc4-kms-dsi-generic,hactive=640,hfp=48');
    assert.equal(s.toVendor('pss-waveshare-35dsi,35H,dsi1'), 'Waveshare_35DSI,35H,dsi1');
    assert.equal(s.toVendor('pss-vc4-kms-dpi-7inch'), 'vc4-kms-DPI-7inch');
    assert.equal(s.toVendor('vc4-kms-dpi-hyperpixel4,rotate=90'), 'vc4-kms-dpi-hyperpixel4,rotate=90');
    assert.equal(s.toVendor(''), '');
    const text = ['# x', 'dtoverlay=vc4-kms-v3d', 'dtoverlay=pss-vc4-kms-dpi-5inch', 'dtoverlay=pss-waveshare-5dpi,rotate=90', 'dtoverlay=pss-waveshare-5dpi', 'dtoverlay=pss-not-ours', '  dtoverlay=pss-waveshare-35dsi,35E,dsi1  ', 'hdmi_group=2'].join('\n');
    assert.deepEqual(s.needed(text), ['pss-vc4-kms-dpi-5inch', 'pss-waveshare-5dpi', 'pss-waveshare-35dsi']);
    assert.deepEqual(s.needed(''), []);
    assert.deepEqual(s.needed(null), []);
});

test('a broken shipment is reported and left out, never installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-'));
    assert.deepEqual(overlays.load(dir).problems, [], 'no manifest: nothing shipped, nothing wrong');
    assert.equal(overlays.load(dir).count, 0);
    const good = fs.readFileSync(path.join(SHIPPED, 'pss-waveshare-5dpi.dtbo'));
    fs.writeFileSync(path.join(dir, 'pss-ok.dtbo'), good);
    fs.writeFileSync(path.join(dir, 'pss-tampered.dtbo'), Buffer.concat([good, Buffer.from([1])]));
    fs.writeFileSync(path.join(dir, 'pss-text.dtbo'), 'dtoverlay=evil\n');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
        schema: 1, overlays: {
            ok: { file: 'pss-ok', sha256: overlays.sha256(good), source: 'https://x' },
            tampered: { file: 'pss-tampered', sha256: overlays.sha256(good) },
            text: { file: 'pss-text', sha256: overlays.sha256(Buffer.from('dtoverlay=evil\n')) },
            missing: { file: 'pss-missing', sha256: 'x' },
            badname: { file: 'vc4-kms-v3d', sha256: 'x' },
            twice: { file: 'pss-ok', sha256: overlays.sha256(good) },
        }
    }));
    const s = overlays.load(dir);
    assert.equal(s.count, 1);
    assert.equal(s.fileFor('ok'), 'pss-ok');
    assert.equal(s.fileFor('tampered'), null);
    assert.deepEqual(s.problems.map((p) => p.split(':')[0]).sort(), ['badname', 'missing', 'tampered', 'text', 'twice']);
    assert.ok(s.problems.some((p) => /not the file the manifest describes/.test(p)));
    assert.ok(s.problems.some((p) => /not a device tree blob/.test(p)));
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{');
    assert.match(overlays.load(dir).problems[0], /does not parse/);
    fs.rmSync(dir, { recursive: true });
});

test('what is installed: the pss- files in /boot/overlays, nothing else, [] when unreadable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-'));
    ['vc4-kms-v3d.dtbo', 'pss-b.dtbo', 'pss-a.dtbo', 'pss-Bad.dtbo', 'pss-c.dts', 'README'].forEach((f) => fs.writeFileSync(path.join(dir, f), ''));
    assert.deepEqual(overlays.installed(dir), ['pss-a', 'pss-b']);
    assert.deepEqual(overlays.installed(path.join(dir, 'nope')), []);
    fs.rmSync(dir, { recursive: true });
});
