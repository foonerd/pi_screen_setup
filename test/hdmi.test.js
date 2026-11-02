'use strict';
// lib/hdmi: the kernel's mode from a preset's firmware lines, and the EDID generated for
// a panel with its own timings. When edid-decode is on the PATH every EDID the shipped
// database can produce is checked for conformance with it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const hdmi = require('../plugin/lib/hdmi');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'display_presets.json'), 'utf8'));
const HOSYOND = '1024 1 50 18 50 600 1 15 3 15 0 0 0 60 0 40000000 3';
const haveDecoder = spawnSync('edid-decode', ['--version'], { encoding: 'utf8' }).status === 0;

test('the firmware lines parse: hdmi_timings, hdmi_cvt, hdmi_group/hdmi_mode', () => {
    const t = hdmi.parseTimings(HOSYOND);
    assert.equal(t.hActive, 1024); assert.equal(t.vActive, 600); assert.equal(t.hSyncPositive, 1); assert.equal(t.vSyncPositive, 1);
    assert.equal(t.hFront, 50); assert.equal(t.hSync, 18); assert.equal(t.hBack, 50); assert.equal(t.vFront, 15); assert.equal(t.vSync, 3); assert.equal(t.vBack, 15);
    assert.equal(t.frameRate, 60); assert.equal(t.pixelClock, 40000000); assert.equal(t.aspect, 3);
    assert.equal(t.hTotal, 1142); assert.equal(t.vTotal, 633);
    assert.ok(Math.abs(t.refresh - 55.33) < 0.01, 'the vendor says 60; the clock says 55.3');
    assert.equal(hdmi.parseTimings('1024 1 50'), null);
    assert.equal(hdmi.parseTimings('0 1 50 18 50 600 1 15 3 15 0 0 0 60 0 40000000 3'), null);
    assert.equal(hdmi.parseTimings(null), null);
    assert.deepEqual(hdmi.parseCvt('800 480 60 6 0 0 0'), { width: 800, height: 480, rate: 60, aspect: 6, margins: false, interlace: false, reducedBlanking: false });
    assert.deepEqual(hdmi.parseCvt('1360 768 60'), { width: 1360, height: 768, rate: 60, aspect: 3, margins: false, interlace: false, reducedBlanking: false });
    assert.equal(hdmi.parseCvt('1920 1080 60 3 0 0 1').reducedBlanking, true);
    assert.equal(hdmi.parseCvt('800 480'), null);
    assert.equal(hdmi.parseCvt('800 480 60 x'), null);
    assert.deepEqual(hdmi.MODES['2/28'], [1280, 800, 60]);
    assert.deepEqual(hdmi.MODES['1/16'], [1920, 1080, 60]);
    assert.deepEqual(hdmi.MODES['2/83'], [1600, 900, 60, true]);
    assert.deepEqual(hdmi.MODES['1/97'], [3840, 2160, 60]);
});

test('resolution and the kernel mode: timings name the size only, CVT and the tables the rate too', () => {
    assert.deepEqual(hdmi.resolution({ hdmi_cvt: '800 480 60 6 0 0 0' }), { width: 800, height: 480, rate: 60, source: 'cvt', reducedBlanking: false });
    assert.equal(hdmi.resolution({ hdmi_timings: HOSYOND }).source, 'timings');
    assert.deepEqual(hdmi.resolution({ hdmi_group: 1, hdmi_mode: 4 }), { width: 1280, height: 720, rate: 60, source: 'mode', reducedBlanking: false });
    assert.equal(hdmi.resolution({ hdmi_group: 2, hdmi_mode: 87 }), null, 'mode 87 is "custom": nothing without cvt or timings');
    assert.equal(hdmi.resolution({}), null);
    assert.equal(hdmi.resolution(null), null);
    assert.equal(hdmi.videoMode({ hdmi_timings: HOSYOND }), '1024x600M');
    assert.equal(hdmi.videoMode({ hdmi_cvt: '800 480 60 6 0 0 0' }), '800x480M@60');
    assert.equal(hdmi.videoMode({ hdmi_cvt: '1920 1080 60 3 0 0 1' }), '1920x1080MR@60');
    assert.equal(hdmi.videoMode({ hdmi_group: 2, hdmi_mode: 83 }), '1600x900MR@60');
    assert.equal(hdmi.videoMode({ hdmi_group: 1, hdmi_mode: 16 }, { forceEnable: true }), '1920x1080M@60e');
    assert.equal(hdmi.videoMode({ hdmi_timings: HOSYOND }, { forceEnable: true }), '1024x600Me');
    assert.equal(hdmi.videoMode({ hdmi_group: 2, hdmi_mode: 87 }), null);
    assert.deepEqual(hdmi.customConfig('800 0 40 48 88 480 0 13 3 32 0 0 0 60 0 32000000 6'), { hdmi_timings: '800 0 40 48 88 480 0 13 3 32 0 0 0 60 0 32000000 6' });
    assert.deepEqual(hdmi.customConfig(' 1000 500 60 '), { hdmi_cvt: '1000 500 60' });
    assert.equal(hdmi.customConfig(''), null);
    assert.equal(hdmi.customConfig(null), null);
    assert.equal(hdmi.edidName('hosyond-10.1-hdmi-h'), 'pss-hosyond-10-1-hdmi-h');
    assert.equal(hdmi.edidName('Waveshare 7" (C)'), 'pss-waveshare-7-c');
    assert.equal(hdmi.edidName(''), 'pss-hdmi');
    assert.equal(hdmi.edidToken('HDMI-A-2', 'pss-x'), 'drm.edid_firmware=HDMI-A-2:edid/pss-x.bin');
    // every HDMI row with lines yields a mode for the kernel
    for (const [id, p] of Object.entries(db.presets)) {
        if (!p || p.type !== 'hdmi' || !p.config || !Object.keys(p.config).length) continue;
        assert.ok(hdmi.videoMode(p.config), id + ' has no kernel mode');
    }
});

test('the EDID: header, descriptor, checksums, the CTA block for audio; what the descriptor cannot hold', () => {
    const e = hdmi.edid(HOSYOND, { name: 'Hosyond 10.1" HDMI Display-H', audio: false });
    assert.equal(e.length, 128);
    assert.deepEqual([...e.subarray(0, 8)], [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]);
    assert.deepEqual([...e.subarray(8, 10)], [0x42, 0x73], 'manufacturer PSS');
    assert.equal(e[18], 1); assert.equal(e[19], 3);
    assert.equal(e[20] & 0x80, 0x80, 'digital');
    assert.equal(e[24] & 0x02, 0x02, 'the first descriptor is the preferred timing');
    assert.equal(e[126], 0, 'no extension');
    assert.equal(e.subarray(0, 128).reduce((a, b) => (a + b) & 0xff, 0), 0, 'block checksum');
    const d = e.subarray(54, 72);
    assert.equal(d.readUInt16LE(0), 4000, '40.00 MHz in 10 kHz units');
    assert.equal(d[2] | ((d[4] >> 4) << 8), 1024, 'h active');
    assert.equal(d[3] | ((d[4] & 0x0f) << 8), 118, 'h blank 50+18+50');
    assert.equal(d[5] | ((d[7] >> 4) << 8), 600, 'v active');
    assert.equal(d[6] | ((d[7] & 0x0f) << 8), 33, 'v blank 15+3+15');
    assert.equal(d[8] | ((d[11] >> 6) << 8), 50, 'h front');
    assert.equal(d[9] | (((d[11] >> 4) & 3) << 8), 18, 'h sync');
    assert.equal((d[10] >> 4) | (((d[11] >> 2) & 3) << 4), 15, 'v front');
    assert.equal((d[10] & 0x0f) | ((d[11] & 3) << 4), 3, 'v sync');
    assert.equal(d[17], 0x1e, 'digital separate sync, both positive');
    assert.equal(hdmi.edid('1080 0 36 4 26 2160 1 10 10 10 0 0 0 50 0 145467200 3')[54 + 17], 0x1c, 'negative hsync, positive vsync');
    assert.equal(e.subarray(95, 108).toString('ascii'), 'Hosyond 10.1"', 'the monitor name, 13 characters');
    assert.equal(hdmi.edid(HOSYOND, { name: 'Waveshare 5" HDMI' }).subarray(95, 108).toString('ascii'), 'Waveshare 5"\n', 'cut before a trailing space, terminated');
    assert.equal(hdmi.edid(HOSYOND, { name: '7" 1024×600 ✓' }).subarray(95, 108).toString('ascii'), '7" 1024600\n  ', 'ASCII only');
    assert.equal(e[75], 0xfd, 'range limits'); assert.ok(e[77] <= 54 && e[78] >= 56, 'around 55 Hz: ' + e[77] + '-' + e[78]);

    const a = hdmi.edid(HOSYOND, { name: 'x', audio: true });
    assert.equal(a.length, 256);
    assert.equal(a[126], 1);
    assert.ok(a.subarray(0, 126).equals(e.subarray(0, 126)) === false, 'product/name differ');
    assert.equal(a[128], 0x02); assert.equal(a[129], 0x03);
    assert.equal(a[131], 0x80 | 0x40 | 0x01, 'underscan, basic audio, one native timing');
    assert.deepEqual([...a.subarray(132, 136)], [0x23, 0x09, 0x07, 0x07], 'LPCM 2ch');
    assert.deepEqual([...a.subarray(145, 151)], [0x65, 0x03, 0x0c, 0x00, 0x10, 0x00], 'HDMI vendor block');
    assert.ok(a.subarray(128 + a[130], 128 + a[130] + 18).equals(a.subarray(54, 72)), 'the panel timing repeated as the native one');
    assert.equal(a.subarray(128, 256).reduce((x, y) => (x + y) & 0xff, 0), 0, 'extension checksum');

    assert.equal(hdmi.fits(HOSYOND), true);
    assert.equal(hdmi.fits('800 0 68 32 200 800 0 68 32 200 0 0 0 60 0 59400000 0'), false, 'v front 68 > 63');
    assert.equal(hdmi.fits('480 0 1 41 2 272 0 2 10 2 0 0 0 60 0 9009000 3'), false, 'clock under 10 MHz');
    assert.equal(hdmi.fits('nonsense'), false);
    assert.throws(() => hdmi.edid('800 0 68 32 200 800 0 68 32 200 0 0 0 60 0 59400000 0'), /out of range/);
    assert.throws(() => hdmi.edid(''), /no timings/);
    const rows = Object.entries(db.presets).filter(([, p]) => p && p.type === 'hdmi' && p.config && p.config.hdmi_timings);
    const withEdid = rows.filter(([, p]) => hdmi.fits(p.config.hdmi_timings));
    assert.ok(rows.length >= 30 && withEdid.length >= rows.length - 3, withEdid.length + ' of ' + rows.length + ' timing rows get an EDID');
});

test('every EDID the database can produce conforms (edid-decode)', { skip: haveDecoder ? false : 'edid-decode not on the PATH' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edid-'));
    let n = 0;
    for (const [id, p] of Object.entries(db.presets)) {
        if (!p || p.type !== 'hdmi' || !p.config || !p.config.hdmi_timings || !hdmi.fits(p.config.hdmi_timings)) continue;
        for (const audio of [false, true]) {
            const f = path.join(dir, id + (audio ? '-a' : '') + '.bin');
            fs.writeFileSync(f, hdmi.edid(p.config.hdmi_timings, { name: p.name, audio }));
            const r = spawnSync('edid-decode', ['-c', f], { encoding: 'utf8' });
            const out = r.stdout + r.stderr;
            assert.ok(/EDID conformity: PASS/.test(out), id + (audio ? ' (audio)' : '') + ': ' + out.slice(out.indexOf('Failures')).slice(0, 400));
            if (audio) {
                assert.ok(/Basic audio support/.test(out) && /Vendor-Specific Data Block \(HDMI\)/.test(out), id + ': HDMI sink with audio');
            }
            const t = hdmi.parseTimings(p.config.hdmi_timings);
            assert.ok(new RegExp('DTD 1:\\s+' + t.hActive + 'x' + t.vActive + '\\s').test(out), id + ': the detailed timing reads back');
            n++;
        }
    }
    assert.ok(n >= 50, n + ' EDIDs checked');
    fs.rmSync(dir, { recursive: true });
});
