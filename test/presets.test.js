'use strict';
// lib/presets: the schema 2 database — names, aliases, applicability, validation against
// the kernel's overlay list.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const presets = require('../plugin/lib/presets');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'display_presets.json'), 'utf8'));
const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, 'overlay-tokens.json'), 'utf8')).overlays;
const P = db.presets;

test('the shipped database is schema 2 and valid against the kernel list', () => {
    assert.equal(db.schema, 2);
    assert.deepEqual(presets.validate(db, tokens), []);
    assert.ok(presets.count(P) >= 218);
    assert.ok(presets.nameCount(P) > presets.count(P) + 40, 'aliases add names');
    assert.equal(presets.count({ a: {}, _comment_x: 'x' }), 1);
});

test('names resolve: key, name, alias, any case', () => {
    assert.equal(presets.resolve(P, 'rpi-touch2-7inch'), 'rpi-touch2-7inch');
    assert.equal(presets.resolve(P, 'Raspberry Pi Touch Display 2 - 7"'), 'rpi-touch2-7inch');
    assert.equal(presets.resolve(P, 'luckfox 7-dsi-touch-a'), 'waveshare-dsi-v2-7.0a');
    assert.equal(presets.resolve(P, 'Waveshare 70H-1024600'), 'waveshare-7-hdmi-c');
    assert.equal(presets.resolve(P, 'Seeed 114990836'), 'waveshare-10.1-hdmi-b');
    assert.equal(presets.resolve(P, 'no such screen'), null);
    assert.equal(presets.resolve(P, '_comment_hdmi'), null);
    assert.equal(presets.aliasIndex(P)['spotpear 5inch-dsi-lcd-(c)'], 'waveshare-dsi-5.0c-800x480');
});

test('picker options carry the canonical name and every alias, pointing at the key', () => {
    const o = presets.options(P, 'dsi');
    const canon = o.find((x) => x.value === 'waveshare-dsi-v2-7.0a' && x.label === P['waveshare-dsi-v2-7.0a'].name);
    const alias = o.filter((x) => x.value === 'waveshare-dsi-v2-7.0a' && x.label !== canon.label);
    assert.ok(canon);
    assert.equal(alias.length, 2);
    assert.ok(alias.some((x) => /Luckfox 7-DSI-TOUCH-A \(as /.test(x.label)));
    assert.equal(presets.options(P, 'dsi', (p, a) => a + '!').some((x) => x.label === 'Luckfox 7-DSI-TOUCH-A!'), true);
    assert.equal(o.some((x) => x.value === 'auto'), false);
    const dep = { x: { name: 'X', type: 'hdmi', config: {}, deprecated: true, superseded_by: 'y' }, y: { name: 'Y', type: 'hdmi', config: {} } };
    assert.deepEqual(presets.options(dep, 'hdmi').map((x) => x.value), ['y'], 'a deprecated row is not offered');
});

test('rotation parameter per overlay, from the database, with the pre-schema-2 fallback', () => {
    assert.equal(presets.rotationParam(P['rpi-touch2-7inch']), 'rotation');
    assert.equal(presets.rotationParam(P['waveshare-dsi-7.0c']), 'rotation');
    assert.equal(presets.rotationParam(P['rpi-touch-7inch']), null);
    assert.equal(presets.rotationParam(P['waveshare-dsi-v2-7.0a']), null, 'the v2 overlay has no rotation parameter');
    assert.equal(presets.rotationParam(P['hyperpixel4']), 'rotate');
    assert.equal(presets.rotationParam(P['vga666']), null);
    assert.equal(presets.rotationParam(P['waveshare-2.8dpi']), null, 'vc4-kms-v3d, first in the vendor sequence, takes no rotate');
    assert.equal(presets.rotationParam({ type: 'dsi', overlay_rotation_param: true }), 'rotation');
    assert.equal(presets.rotationParam({ type: 'dsi', overlay_rotation_param: false }), null);
    assert.equal(presets.rotationParam({ type: 'dpi' }), 'rotate', 'a v1 DPI row behaves as before');
    assert.equal(presets.rotationParam({ type: 'dpi', rotation_param: null }), null);
    assert.equal(presets.rotationParam(null), null);
});

test('applicability: kernel, board, vendor overlays, deprecation; notes, never a refusal without a reason', () => {
    const ctx = { kernel: '6.12.75-v8+', boardFilters: ['pi5'], shippedOverlays: new Set() };
    assert.deepEqual(presets.applicable(P['rpi-touch2-7inch'], ctx), { ok: true, notes: [] });
    const e = presets.applicable(P['waveshare-dsi-10.1e-4lane'], ctx);
    assert.equal(e.ok, false);
    assert.deepEqual(e.notes.map((n) => n.code), ['MIN_KERNEL']);
    assert.equal(e.notes[0].detail, '6.18.55');
    assert.deepEqual(presets.applicable(P['waveshare-dsi-10.1e-4lane'], { kernel: '6.18.60', boardFilters: ['pi5'] }), { ok: true, notes: [] });
    assert.deepEqual(presets.applicable(P['waveshare-dsi-10.1e-4lane'], { kernel: '6.18.60', boardFilters: ['pi4'] }).notes.map((n) => n.code), ['BOARD']);
    assert.deepEqual(presets.applicable(P['waveshare-2.8dpi'], ctx).notes.map((n) => n.detail), ['vc4-kms-dpi-2inch8', 'waveshare-28dpi-3b-4b', 'waveshare-touch-28dpi']);
    assert.equal(presets.applicable(P['waveshare-2.8dpi'], { shippedOverlays: new Set(['vc4-kms-dpi-2inch8', 'waveshare-28dpi-3b-4b', 'waveshare-touch-28dpi']) }).ok, true);
    assert.deepEqual(presets.applicable({ deprecated: true, superseded_by: 'y', experimental: true }, ctx), { ok: true, notes: [{ code: 'DEPRECATED', detail: 'y' }, { code: 'EXPERIMENTAL' }] });
    assert.equal(presets.applicable(null, ctx).ok, false);
    assert.equal(presets.applicable(P['jdi-lt070me05000'], { boardFilters: [] }).ok, true, 'no board known: no board note');
    assert.equal(presets.compareKernel('6.12.75-v8+', '6.18.55'), -1);
    assert.equal(presets.compareKernel('6.18.55', '6.18.55'), 0);
    assert.equal(presets.compareKernel('6.18.60-v8-16k+', '6.18.55'), 1);
    assert.equal(presets.compareKernel('6.12', '6.12.0'), 0);
});

test('validation: the schema and the kernel list', () => {
    const one = (p, k) => presets.validateOne(k || 'k', p, tokens, ['k', 'other']);
    assert.deepEqual(one({ name: 'n', type: 'dsi', config: { dtoverlay: 'vc4-kms-dsi-7inch' }, rotation_param: null }), []);
    assert.match(one({ name: 'n', type: 'dsi', config: { dtoverlay: 'vc4-kms-dsi-7inch,rotation=90' } })[0], /no parameter rotation/);
    assert.match(one({ name: 'n', type: 'dsi', config: { dtoverlay: 'vc4-kms-dsi-nonesuch' } })[0], /not in the kernel and not in requires_overlay/);
    assert.deepEqual(one({ name: 'n', type: 'dsi', config: { dtoverlay: 'vc4-kms-dsi-nonesuch' }, requires_overlay: ['vc4-kms-dsi-nonesuch'] }), []);
    assert.deepEqual(one({ name: 'n', type: 'dsi', config: { dtoverlay: 'vc4-kms-dsi-waveshare-panel,10_1_inchE_2lane' }, min_kernel: '6.18.55', rotation_param: 'rotation' }), [], 'a token a newer kernel brings');
    assert.match(one({ name: 'n', type: 'dsi', config: { dtoverlay: 'vc4-kms-dsi-7inch' }, rotation_param: 'rotation' })[0], /rotation_param rotation but/);
    assert.match(one({ name: 'n', type: 'dsi', config: {}, rotation_param: 'spin' })[0], /rotation_param must be/);
    assert.match(one({ name: 'n', type: 'hdmi', config: {}, provenance: 'somewhere' })[0], /provenance must be/);
    assert.match(one({ name: 'n', type: 'hdmi', config: {}, boards: ['pi9'] })[0], /unknown pi9/);
    assert.match(one({ name: 'n', type: 'hdmi', config: {}, min_kernel: 'new' })[0], /min_kernel/);
    assert.match(one({ name: 'n', type: 'hdmi', config: {}, deprecated: true })[0], /deprecated without/);
    assert.match(one({ name: 'n', type: 'hdmi', config: {}, superseded_by: 'nope' })[0], /superseded_by names no preset/);
    assert.match(one({ name: 'n', type: 'hdmi', config: {}, aliases: 'x' })[0], /aliases must be an array/);
    assert.match(one({ name: 'n', type: 'lvds', config: {} })[0], /type lvds/);
    assert.match(one({ name: 'n', type: 'hdmi', config: {} }, 'bad key!')[0], /key not in/);
    const twice = { version: '1.0.0', presets: { a: { name: 'A', type: 'hdmi', config: {}, aliases: ['Same'] }, b: { name: 'B', type: 'hdmi', config: {}, aliases: ['same'] }, c: { name: 'C', type: 'hdmi', config: {}, aliases: ['a'] } } };
    const errs = presets.validate(twice, tokens);
    assert.ok(errs.some((e) => /alias "same" collides with alias of a/.test(e)), errs.join());
    assert.ok(errs.some((e) => /alias "a" collides with key a/.test(e)), errs.join());
    assert.deepEqual(presets.validate({ version: 'x' }, tokens), ['database: version x is not X.Y.Z', 'database: no presets object']);
    assert.deepEqual(presets.validate(null), ['database: not an object']);
    assert.deepEqual(presets.validate({ version: '1.0.0', presets: { _comment_x: 'ok', k: { name: 'n', type: 'hdmi', config: {} } } }), [], 'without the kernel list only the schema is checked');
});
