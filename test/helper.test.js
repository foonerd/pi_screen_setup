'use strict';
// lib/drift and the root helper script (plugin/scripts/pi-screen-setup-root.sh), the
// latter run as it is, against a relocated root.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const drift = require('../plugin/lib/drift');
const strip = require('../plugin/lib/strip');
const privileged = require('../plugin/lib/privileged');

test('drift: the OS version, the kind of change, the lines in userconfig.txt that act on the display', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'));
    assert.equal(drift.osVersion(root), null);
    fs.mkdirSync(path.join(root, 'etc'));
    fs.writeFileSync(path.join(root, 'etc', 'os-release'), 'PRETTY_NAME="x"\nVOLUMIO_VERSION="4.231"\n');
    assert.equal(drift.osVersion(root), '4.231');
    fs.writeFileSync(path.join(root, 'etc', 'os-release'), 'VOLUMIO_VERSION=4.300\n');
    assert.equal(drift.osVersion(root), '4.300');
    fs.rmSync(root, { recursive: true });

    assert.equal(drift.classify(['ERR_CONFIG_MISMATCH'], '4.231', '4.300'), 'os-update');
    assert.equal(drift.classify(['ERR_VIDEOCONFIG_MISSING'], '4.231', '4.231'), 'missing');
    assert.equal(drift.classify(['ERR_CONFIG_MISMATCH'], '4.231', '4.231'), 'changed');
    assert.equal(drift.classify(['ERR_CONFIG_MISMATCH'], null, '4.231'), 'changed', 'no reference: not called an update');
    assert.equal(drift.classify([], null, null), 'changed');

    const c = drift.conflicts('# comment\n[pi4]\ndisplay_lcd_rotate=3\ndisplay_hdmi_rotate=3\ndtoverlay=vc4-kms-v3d\ndtoverlay=vc4-kms-dsi-7inch\nhdmi_group=2\ndtoverlay=hifiberry-dac\ngpu_mem=256\n');
    assert.deepEqual(c.map((x) => x.code), ['LEGACY_ROTATE', 'LEGACY_ROTATE', 'KMS_LINE', 'PANEL_OVERLAY', 'DISPLAY_SETTING']);
    assert.equal(c[0].line, 'display_lcd_rotate=3');
    assert.deepEqual(drift.conflicts(null), []);
    assert.deepEqual(drift.conflicts(''), []);
});

function helperRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-'));
    fs.mkdirSync(path.join(root, 'boot', 'overlays'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data', 'INTERNAL', 'pi_screen_setup', 'strip'), { recursive: true });
    fs.writeFileSync(path.join(root, 'boot', 'config.txt'), 'gpu_mem=128\ninclude volumioconfig.txt\ninclude videoconfig.txt\ninclude userconfig.txt\n');
    fs.writeFileSync(path.join(root, 'boot', 'videoconfig.txt'), '### pi_screen_setup managed - DO NOT EDIT ###\n');
    fs.writeFileSync(path.join(root, 'boot', 'volumioconfig.txt'), '# stripped\n[pi4]\n[all]\n');
    fs.writeFileSync(path.join(root, 'boot', 'userconfig.txt'), '# user\n');
    fs.writeFileSync(path.join(root, 'boot', 'cmdline.txt'), 'quiet splash plymouth.ignore-serial-consoles video=HDMI-A-1:rotate=90 plymouth=90 fbcon=rotate:1');
    return root;
}
const read = (root, f) => fs.readFileSync(path.join(root, 'boot', f), 'utf8');
const helper = (root) => privileged.direct(root);
const fails = (fn, re) => { try { fn(); } catch (e) { assert.match(String(e.stderr || e.message), re); return; } assert.fail('expected a refusal ' + re); };

test('the root helper: write-boot writes atomically and refuses what it must', () => {
    const root = helperRoot();
    const h = helper(root);
    h.writeBoot('videoconfig', 'a\nb\n');
    assert.equal(read(root, 'videoconfig.txt'), 'a\nb\n');
    assert.equal((fs.statSync(path.join(root, 'boot', 'videoconfig.txt')).mode & 0o777), 0o644);
    h.writeBoot('userconfig', '');
    assert.equal(read(root, 'userconfig.txt'), '', 'userconfig.txt may be emptied');
    fails(() => h.writeBoot('config', ''), /refusing to write an empty file/);
    assert.ok(read(root, 'config.txt').length > 0);
    fails(() => h.writeBoot('cmdline', ''), /empty/);
    fails(() => h.writeBoot('passwd', 'x'), /name must be/);
    fails(() => h.writeBoot('../etc/passwd', 'x'), /name must be/);
    fails(() => h.writeBoot('config', 'a\0b'), /NUL/);
    fails(() => h.writeBoot('volumioconfig', 'x'.repeat(70000)), /larger than/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'boot')).filter((f) => f.startsWith('.pss.')), [], 'no temporary file left behind');
    h.removeBoot('videoconfig');
    assert.equal(fs.existsSync(path.join(root, 'boot', 'videoconfig.txt')), false);
    h.removeBoot('videoconfig');
    fails(() => h.removeBoot('config'), /only videoconfig/);
    assert.ok(fs.existsSync(path.join(root, 'boot', 'config.txt')));
    fails(() => execFileSync('sh', [privileged.SCRIPT, 'format-disk'], { env: Object.assign({}, process.env, { PSS_ROOT: root }), stdio: 'pipe' }), /verbs:/);
    fs.rmSync(root, { recursive: true });
});

test('the root helper: clean-exit takes the plugin out and puts the stripped lines back only when the file is as it left it', () => {
    const root = helperRoot();
    const h = helper(root);
    const dir = path.join(root, 'data', 'INTERNAL', 'pi_screen_setup', 'strip');
    strip.record(dir, 'volumioconfig.txt', '# original\n[pi4]\ndtoverlay=vc4-kms-v3d-pi4\n[all]\n', read(root, 'volumioconfig.txt'));
    strip.record(dir, 'userconfig.txt', '# user\nhdmi_group=2\n', '# user\n');
    fs.appendFileSync(path.join(root, 'boot', 'userconfig.txt'), '# edited after\n');
    fs.writeFileSync(path.join(root, 'boot', 'overlays', 'pss-waveshare-5dpi.dtbo'), Buffer.from([0xd0, 0x0d, 0xfe, 0xed]));
    fs.writeFileSync(path.join(root, 'boot', 'overlays', 'pss-vc4-kms-dpi-5inch.dtbo'), Buffer.from([0xd0, 0x0d, 0xfe, 0xed]));
    fs.writeFileSync(path.join(root, 'boot', 'overlays', 'vc4-kms-v3d.dtbo'), Buffer.from([0xd0, 0x0d, 0xfe, 0xed]));
    const out = h.cleanExit();
    assert.equal(read(root, 'config.txt'), 'gpu_mem=128\ninclude volumioconfig.txt\ninclude userconfig.txt\n');
    assert.equal(fs.existsSync(path.join(root, 'boot', 'videoconfig.txt')), false);
    assert.equal(read(root, 'volumioconfig.txt'), '# original\n[pi4]\ndtoverlay=vc4-kms-v3d-pi4\n[all]\n');
    assert.equal(read(root, 'userconfig.txt'), '# user\n# edited after\n', 'changed since: left alone');
    assert.equal(read(root, 'cmdline.txt'), 'quiet splash plymouth.ignore-serial-consoles\n');
    assert.deepEqual(fs.readdirSync(path.join(root, 'boot', 'overlays')), ['vc4-kms-v3d.dtbo'], 'the plugin\'s overlay files go, the OS\'s stay');
    assert.ok(/config\.txt: include line removed/.test(out));
    assert.ok(/videoconfig\.txt: removed/.test(out));
    assert.ok(/volumioconfig\.txt: the lines the plugin removed are back/.test(out));
    assert.ok(/WARNING: userconfig\.txt changed since/.test(out));
    assert.ok(/cmdline\.txt: rotation parameters removed/.test(out));
    assert.ok(/overlays: 2 plugin-installed file\(s\) removed/.test(out));
    assert.equal(fs.existsSync(path.join(dir, 'volumioconfig.txt.original')), false, 'consumed');
    assert.equal(fs.existsSync(path.join(dir, 'userconfig.txt.original')), true, 'kept for the user');
    const again = h.cleanExit();
    assert.equal(again.trim().split('\n').filter((l) => !/^WARNING/.test(l)).length, 0, 'a second run has nothing to do');
    assert.equal(read(root, 'cmdline.txt'), 'quiet splash plymouth.ignore-serial-consoles\n');
    fs.rmSync(root, { recursive: true });
});

test('the root helper: overlays and EDID files under their own prefix only, and only real blobs', () => {
    const root = helperRoot();
    const h = helper(root);
    // A shipped vendor blob: binary, full of NUL bytes, written as it is
    const dtbo = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'overlays', 'pss-waveshare-5dpi.dtbo'));
    assert.ok(dtbo.includes(0), 'the blob holds NUL bytes');
    h.installOverlay('pss-example', dtbo);
    assert.ok(fs.readFileSync(path.join(root, 'boot', 'overlays', 'pss-example.dtbo')).equals(dtbo));
    assert.equal((fs.statSync(path.join(root, 'boot', 'overlays', 'pss-example.dtbo')).mode & 0o777), 0o644);
    fails(() => h.installOverlay('pss-text', 'dtoverlay=vc4-kms-v3d\n'), /not a flattened device tree/);
    fails(() => h.installOverlay('pss-short', Buffer.from([0xd0, 0x0d])), /not a flattened device tree/);
    assert.equal(fs.existsSync(path.join(root, 'boot', 'overlays', 'pss-text.dtbo')), false);
    fails(() => h.installOverlay('vc4-kms-v3d', dtbo), /must start with pss-/);
    fails(() => h.installOverlay('pss-Bad_Name', dtbo), /lower-case/);
    fails(() => h.installOverlay('pss-../x', dtbo), /lower-case/);
    h.removeOverlay('pss-example');
    assert.equal(fs.existsSync(path.join(root, 'boot', 'overlays', 'pss-example.dtbo')), false);
    fails(() => h.removeOverlay('vc4-kms-v3d'), /must start with pss-/);
    const edid = Buffer.concat([Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]), Buffer.alloc(120)]);
    h.installEdid('pss-panel', edid);
    assert.ok(fs.readFileSync(path.join(root, 'lib', 'firmware', 'edid', 'pss-panel.bin')).equals(edid));
    fails(() => h.installEdid('pss-panel', 'edid-bytes'), /not an EDID block/);
    fails(() => h.installEdid('panel', edid), /must start with pss-/);
    assert.equal(privileged.bootName('/boot/config.txt', '/boot'), 'config');
    assert.equal(privileged.bootName('/boot/overlays/config.txt', '/boot'), null);
    assert.equal(privileged.bootName('/boot/README', '/boot'), null);
    assert.equal(privileged.bootName('/boot/passwd.txt', '/boot'), null);
    fs.rmSync(root, { recursive: true });
});
