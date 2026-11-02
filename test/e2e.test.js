'use strict';
// The plugin end to end in a Volumio-shaped tree (test/harness.js): the configuration
// file as Volumio seeds it, the real v-conf, real boot files of a Volumio release, a
// board described through /proc and /sys, the wizard, the apply, a restart, a settings
// file that was reset while the boot files kept the configuration, an OS update, the
// migration of a hand-written configuration, restore points, the presets database over
// HTTP, the admin draft and the management API. The last test asserts that every
// function index.js defines was called by this file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const H = require('./harness');
const fs = H.fs;
const conf = require('../plugin/lib/conf');
const recover = require('../plugin/lib/recover');

const BANNER = '### pi_screen_setup managed - DO NOT EDIT ###';
const lines = (text) => text.split(/\r?\n/);
const without = (text, re) => lines(text).filter((l) => !re.test(l)).join('\n');
const sansDate = (text) => lines(text).filter((l) => !l.startsWith('# Generated:')).join('\n').replace(/\s+$/, '');
// kew promises are thenables, not native ones; adopt before asserting on them
const rejects = (fn, re, msg) => assert.rejects(() => Promise.resolve().then(fn), re, msg);
const MIGRATION = /^(dtoverlay=vc4-f?kms|dtoverlay=.*(dsi|dpi|hyperpixel|vga666)|hdmi_|sdtv_|framebuffer_|enable_tvout|display_auto_detect|display_default_lcd)/i;

async function waitFor(fn, what, ms) {
    const until = Date.now() + (ms || 3000);
    for (; ;) {
        const v = fn();
        if (v) return v;
        if (Date.now() > until) throw new Error('timed out waiting for ' + what);
        await H.sleep(20);
    }
}

// Writes the pending v-conf state now (v-conf defers by a second) and detaches the
// instance from the file so a late timer of a finished scenario cannot write into the
// next one; then boots a fresh instance on the same tree, as a reboot would.
function flush(env) { if (env.p.config && env.p.config.saved === false) env.p.config.save(); }
async function stop(env) { await H.settle(); await env.p.onStop(); flush(env); if (env.p.config) env.p.config.filePath = undefined; }
async function restart(env, opts) { await stop(env); const next = H.plugin(opts); await next.start(); return next; }

// A local presets database over HTTP for the update and import paths.
function serve(body, status) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            res.statusCode = status || 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(typeof body === 'string' ? body : JSON.stringify(body));
        });
        server.listen(0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + server.address().port + '/display_presets.json', close: () => new Promise((r) => server.close(r)) }));
    });
}

// Runs the wizard's savers directly, as the UI would, and applies.
async function configure(env, settings) {
    Object.keys(settings).forEach((k) => env.p.setConfigValue(k, settings[k]));
    env.p.primaryOutputCache = settings.primary_output || env.p.getConfigValue('primary_output', 'hdmi0');
    await env.p.applyConfiguration();
    flush(env);
}

const uiSection = (ui, id) => ui.sections.find((s) => s.id === id);
const uiItem = (ui, sectionId, id) => (uiSection(ui, sectionId).content || []).find((c) => c.id === id);

test('the shipped configuration file is one v-conf reads: defaults come back, writes persist', async () => {
    H.seed();
    const env = H.plugin();
    await env.p.onVolumioStart();
    assert.equal(env.p.config.get('wizard_complete', 'default'), false, 'a stored false is read as false, not as the default');
    assert.equal(env.p.config.get('kms.cma_option'), 'auto');
    assert.equal(env.p.config.get('hdmi0.display_preset'), 'auto');
    assert.equal(env.p.config.get('nothing.here', 'd'), 'd');
    env.p.config.set('wizard_complete', true);
    env.p.config.set('hdmi0.rotation', 90);
    env.p.setJsonValue('migration_raw_lines', [{ source: 'x', line: 'hdmi_group=2' }]);
    flush(env);
    const onDisk = H.readConfigFile();
    assert.deepEqual(onDisk.wizard_complete, { type: 'boolean', value: true });
    assert.deepEqual(onDisk.hdmi0.rotation, { type: 'number', value: 90 });
    assert.deepEqual(env.p.getJsonValue('migration_raw_lines', []), [{ source: 'x', line: 'hdmi_group=2' }]);
    assert.deepEqual(env.p.getJsonValue('migration_parsed', {}), {});
    assert.equal(env.logs.some((l) => /converted to the v-conf format/.test(l[1])), false, 'the shipped file needs no conversion');
    await stop(env);
});

test('a configuration file written before 1.0 (raw JSON) is converted once and keeps its values', async () => {
    H.seed({ config: 'raw' });
    const before = H.readConfigFile();
    assert.equal(conf.isNormalized(before), false);
    assert.equal(before.kms.cma_option, 'default');
    const env = H.plugin();
    await env.p.onVolumioStart();
    assert.equal(env.logs.some((l) => /converted to the v-conf format/.test(l[1])), true);
    const after = H.readConfigFile();
    assert.equal(conf.isNormalized(after), true, 'every leaf is { type, value }');
    assert.equal(env.p.config.get('kms.cma_option'), 'default', 'the stored choice survives the conversion');
    assert.equal(env.p.config.get('primary_output'), 'hdmi0');
    assert.equal(env.p.config.get('migration_pending'), false, 'a key that was already in the v-conf shape is untouched');
    assert.deepEqual(env.p.getJsonValue('migration_raw_lines', null), []);
    env.p.config.set('wizard_complete', true);
    flush(env);
    assert.deepEqual(H.readConfigFile().wizard_complete, { type: 'boolean', value: true }, 'writes to converted keys persist');
    await stop(env);
    const again = H.plugin();
    await again.p.onVolumioStart();
    assert.equal(again.logs.some((l) => /converted to the v-conf format/.test(l[1])), false, 'conversion happens once');
    assert.equal(again.p.config.get('wizard_complete'), true);
    await stop(again);
});

test('first start on a Pi 5 with 4.231 boot files: the board, a KMS baseline, the server; a restart changes nothing', async () => {
    H.seed({ board: 'pi5' });
    const env = H.plugin();
    await env.start();
    const hw = env.p.hardwareInfo;
    assert.equal(hw.model, 'Pi 5');
    assert.equal(hw.model_raw, 'Raspberry Pi 5 Model B Rev 1.1');
    assert.equal(hw.soc, 'bcm2712');
    assert.equal(hw.ram_mb, 16384);
    assert.deepEqual(hw.dsi_ports, ['dsi0', 'dsi1']);
    assert.equal(hw.kms_overlay, 'vc4-kms-v3d-pi5');
    assert.equal(hw.serial, 'a1b2c3d4');
    flush(env);
    assert.deepEqual(H.readConfigFile().hardware.detected, { type: 'boolean', value: true }, 'hardware facts are persisted');
    assert.equal(H.readConfigFile().hardware.model.value, 'Pi 5');

    // The OS file applies no KMS on this board (R1): the one driver line is written under our banner
    const vc = H.readBoot('videoconfig.txt');
    assert.ok(vc.startsWith(BANNER), vc);
    assert.ok(/^# Baseline:/m.test(vc));
    assert.ok(/^\[all\]$/m.test(vc));
    assert.ok(/^dtoverlay=vc4-kms-v3d-pi5$/m.test(vc), 'Pi 5 auto CMA is the kernel default');
    assert.ok(/^include videoconfig\.txt$/m.test(H.readBoot('config.txt')));
    assert.ok(env.p.config.get('kms.baseline_applied'));
    assert.ok(env.toasts.some((t) => t.message === env.p.getI18n('KMS_BASELINE_APPLIED')));
    assert.equal(env.p.config.get('wizard_complete'), false, 'a baseline is not a configuration');
    assert.equal(env.p.lastBoot.effective.kmsOverlay, 'vc4-kms-v3d-pi5', 'with the include in place the baseline is effective');
    assert.ok(env.port() > 0, 'management server listening on an ephemeral port');
    assert.deepEqual(env.p.getConfigurationFiles(), ['config.json']);
    env.p.onRestart();
    await env.p.onVolumioReboot();
    await env.p.onVolumioShutdown();

    const second = await restart(env);
    assert.equal(second.toasts.some((t) => t.message === env.p.getI18n('KMS_BASELINE_APPLIED')), false, 'the baseline is written once');
    assert.equal(second.toasts.some((t) => /rebuilt from the boot files/.test(t.message)), false, 'a baseline file is never mistaken for a configuration');
    assert.equal(second.p.config.get('wizard_complete'), false);
    assert.equal(await second.p.ensureKmsBaseline(second.p.readEffectiveBoot()), false);
    await stop(second);
});

test('a Zero 2 W gets no baseline and no KMS line: the OS omits the driver there', async () => {
    H.seed({ board: 'zero2w', kms: false });
    const env = H.plugin();
    await env.start();
    assert.equal(env.p.hardwareInfo.kms_supported, false);
    assert.equal(fs.existsSync(path.join(H.BOOT, 'videoconfig.txt')), false);
    assert.equal(env.p.getEffectiveKmsEnabled(), false);
    const caps = env.p.getHardwareCapabilities();
    assert.ok(caps.warnings.includes(env.p.getI18n('KMS_NOT_SUPPORTED')));
    assert.ok(caps.warnings.includes(env.p.getI18n('LOW_RAM_WARNING')));
    await stop(env);
});

test('the wizard on a Pi 5 with a Touch Display 2 on DSI-2, applied, read back after a restart', async () => {
    H.seed({ board: 'pi5' });
    const env = H.plugin();
    await env.start();

    // The 4.231 volumioconfig.txt holds display lines: the migration offer comes first
    let ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_migration_detected').hidden, false);
    assert.equal(env.p.config.get('migration_state'), 'detected');
    assert.ok(env.p.getJsonValue('migration_raw_lines', []).length > 0, 'the detected lines are stored as a document');
    assert.ok(uiItem(ui, 'section_migration_detected', 'migration_raw_display').value.includes('volumioconfig.txt: dtoverlay=vc4-kms-v3d'));
    await env.p.migrateSkip();
    await H.settle();
    assert.ok(env.pushes().length >= 1, 'the UI is pushed after the choice');
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step1_output').hidden, false);
    const outputs = uiItem(ui, 'section_step1_output', 'primary_output').options.map((o) => o.value);
    assert.deepEqual(outputs, ['hdmi0', 'hdmi1', 'dsi0', 'dsi1', 'dpi', 'composite', 'custom', 'headless']);

    env.p.saveStep1({ primary_output: { value: 'dsi1' } });
    assert.equal(env.p.config.get('primary_output'), 'dsi1');
    assert.equal(env.p.config.get('dsi1.enabled'), true);
    assert.equal(env.p.config.get('hdmi0.enabled'), false);
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step2_dsi').hidden, false);
    const dsiOptions = uiItem(ui, 'section_step2_dsi', 'dsi_overlay').options;
    assert.ok(dsiOptions.some((o) => o.value === 'rpi-touch2-7inch'));
    assert.equal(dsiOptions[dsiOptions.length - 1].value, 'custom');

    env.p.saveStep2Dsi({ dsi_overlay: { value: 'rpi-touch2-7inch' }, dsi_custom_params: '' });
    assert.equal(env.p.step2ShowAudioCache, true, 'a board with HDMI asks about HDMI audio next');
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step2_audio').hidden, false);
    assert.equal(uiItem(ui, 'section_step2_audio', 'audio_hdmi1_mode').hidden, false, 'two HDMI ports on a Pi 5');
    env.p.saveStep2Audio({ audio_hdmi0_mode: { value: 'audio' }, audio_hdmi1_mode: { value: 'none' } });
    assert.equal(env.p.config.get('wizard_step'), 3);

    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step3_rotation').hidden, false);
    assert.equal(uiItem(ui, 'section_step3_rotation', 'cmdline_video').hidden, true, 'this panel rotates through its overlay');
    env.p.saveStep3({ rotation: { value: 270 } });
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step4_kms').hidden, false);
    const cmaOptions = uiItem(ui, 'section_step4_kms', 'cma_option').options.map((o) => o.value);
    assert.equal(cmaOptions[0], 'auto');
    assert.ok(cmaOptions.includes('128') && cmaOptions.includes('512'));
    assert.ok(/16384 MB/.test(uiItem(ui, 'section_step4_kms', 'cma_option').doc));
    env.p.saveStep4({ kms_mode: { value: 'preset' }, cma_option: { value: '128' }, cma_custom_mb: '256' });
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step5_ota').hidden, false);
    env.p.saveStep5({ ota_behavior: { value: 'notify' } });
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step6_preview').hidden, false);
    const preview = uiItem(ui, 'section_step6_preview', 'preview_summary').value;
    assert.ok(preview.startsWith('DSI: Raspberry Pi Touch Display 2'), preview);
    assert.ok(/270/.test(preview) && /128 MB/.test(preview), preview);

    await env.p.applyConfiguration();
    const vc = H.readBoot('videoconfig.txt');
    assert.deepEqual(lines(sansDate(vc)).filter(Boolean), [
        BANNER, '# Model: Raspberry Pi 5 Model B Rev 1.1', '[all]',
        '# KMS Display Driver', 'dtoverlay=vc4-kms-v3d-pi5,cma-128',
        '# HDMI0 Configuration', 'hdmi_force_hotplug=1', 'hdmi_drive=2',
        '# DSI1 Configuration', 'dtoverlay=vc4-kms-dsi-ili9881-7inch,rotation=270',
    ]);
    assert.equal(H.readBoot('cmdline.txt'), H.CMDLINE, 'the overlay rotates the panel; cmdline.txt is left alone');
    assert.equal(lines(H.readBoot('config.txt')).filter((l) => l === 'include videoconfig.txt').length, 1);
    assert.ok(lines(H.readBoot('config.txt')).indexOf('include videoconfig.txt') > lines(H.readBoot('config.txt')).indexOf('include volumioconfig.txt'));
    assert.equal(MIGRATION.test(without(H.readBoot('volumioconfig.txt'), /^#/)), false, 'the OS display lines were stripped');
    assert.ok(fs.existsSync(path.join(H.INTERNAL, 'backups', 'current', 'metadata.json')));
    assert.equal(fs.readJsonSync(path.join(H.INTERNAL, 'backups', 'current', 'metadata.json')).primary_output, 'dsi1');
    assert.equal(env.p.listRestorePoints().length, 1);
    assert.equal(env.modal().data.title, env.p.getI18n('REBOOT_REQUIRED'));
    flush(env);
    const disk = H.readConfigFile();
    assert.equal(disk.wizard_complete.value, true);
    assert.equal(disk.primary_output.value, 'dsi1');
    assert.equal(disk.dsi1.overlay.value, 'rpi-touch2-7inch');
    assert.equal(disk.dsi1.rotation.value, 270);
    assert.equal(disk.kms.cma_option.value, '128');
    assert.equal(disk.videoconfig_mode.value, 'generated');
    assert.ok(disk.applied_date.value);
    assert.ok(disk.kernel_version.value);

    const second = await restart(env);
    assert.equal(second.p.getConfigValue('primary_output'), 'dsi1');
    assert.equal(second.p.wizardDataCache && Object.keys(second.p.wizardDataCache).length, 0, 'nothing comes from a session cache');
    assert.equal(second.p.driftDetected, false);
    assert.equal(second.toasts.some((t) => /rebuilt from the boot files/.test(t.message)), false, 'the settings were there; nothing to recover');
    assert.equal(second.p.lastBoot.effective.kmsOverlay, 'vc4-kms-v3d-pi5');
    assert.equal(second.p.lastBoot.effective.cmaMb, 128);
    ui = await second.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_current_config').hidden, false);
    assert.equal(uiItem(ui, 'section_current_config', 'current_summary').value, preview);
    assert.equal(uiSection(ui, 'section_step1_output').hidden, true);
    assert.equal(sansDate(second.p.generateVideoConfig()), sansDate(vc), 'the stored settings regenerate the same file');
    await stop(second);
});

// The bench after an OS update with "restore settings": the plugin's own files are on
// /boot, the settings file is the 0.6.2 default (nothing was ever persisted by 0.8.x).
const BENCH_VIDEOCONFIG = [BANNER, '# Generated: 2026-10-14T19:06:18.473Z', '# Model: Raspberry Pi 5 Model B Rev 1.1', '', '# KMS Display Driver', 'dtoverlay=vc4-kms-v3d-pi5,cma-128', '', '# DSI0 Configuration', 'dtoverlay=vc4-kms-dsi-ili9881-7inch,rotation=270', ''].join('\n');
function benchTree() {
    const config = lines(H.osFile('config-4.231.txt'));
    config.splice(config.indexOf('include userconfig.txt'), 0, 'include videoconfig.txt');
    const stripped = lines(H.osFile('volumioconfig-4.231.txt')).filter((l) => !MIGRATION.test(l.trim())).join('\n');
    const files = { 'videoconfig.txt': BENCH_VIDEOCONFIG, 'config.txt': config.join('\n'), 'volumioconfig.txt': stripped, 'cmdline.txt': H.CMDLINE };
    return { files, metadata: { saved: '2026-10-14T19:06:18.552Z', primary_output: 'dsi0', description: 'DSI: Raspberry Pi Touch Display 2 - 7", Rotation: 270 degrees, KMS CMA: 128MB' } };
}

test('settings are rebuilt from the plugin\'s own boot files when the settings file never saw an apply (the bench)', async () => {
    const bench = benchTree();
    H.seed({ board: 'pi5', config: 'raw', boot: bench.files, current: bench });
    const env = H.plugin();
    await env.start();
    const toast = env.toasts.find((t) => /rebuilt from the boot files/.test(t.message));
    assert.ok(toast, JSON.stringify(env.toasts));
    assert.ok(toast.message.includes('2026-10-14T19:06:18.552Z'));
    assert.equal(env.p.config.get('wizard_complete'), true);
    assert.equal(env.p.config.get('primary_output'), 'dsi0');
    assert.equal(env.p.config.get('dsi0.enabled'), true);
    assert.equal(env.p.config.get('dsi0.overlay'), 'rpi-touch2-7inch');
    assert.equal(env.p.config.get('dsi0.rotation'), 270);
    assert.equal(env.p.config.get('hdmi0.enabled'), false);
    assert.equal(env.p.config.get('kms.mode'), 'preset');
    assert.equal(env.p.config.get('kms.cma_option'), '128');
    assert.equal(env.p.config.get('applied_date'), '2026-10-14T19:06:18.552Z');
    assert.equal(env.p.config.get('videoconfig_mode'), 'generated');
    assert.equal(env.p.driftDetected, false, 'the saved copies match the files; no drift');
    assert.equal(sansDate(env.p.generateVideoConfig()), sansDate(lines(BENCH_VIDEOCONFIG).concat().join('\n')).replace('# Model: Raspberry Pi 5 Model B Rev 1.1\n', '# Model: Raspberry Pi 5 Model B Rev 1.1\n[all]\n'), 'the recovered settings regenerate the file the bench boots from (plus the [all] lead)');
    flush(env);
    assert.equal(H.readConfigFile().dsi0.overlay.value, 'rpi-touch2-7inch', 'recovered settings are on disk');
    const ui = await env.p.getUIConfig();
    assert.ok(uiItem(ui, 'section_current_config', 'current_summary').value.startsWith('DSI: Raspberry Pi Touch Display 2'));

    const second = await restart(env);
    assert.equal(second.toasts.some((t) => /rebuilt from the boot files/.test(t.message)), false, 'recovery runs once; afterwards the settings file is the authority');
    assert.equal(second.p.config.get('dsi0.overlay'), 'rpi-touch2-7inch');

    // An OS update puts fresh config.txt and volumioconfig.txt on /boot
    await stop(second);
    fs.writeFileSync(path.join(H.BOOT, 'config.txt'), H.osFile('config-4.231.txt'));
    fs.writeFileSync(path.join(H.BOOT, 'volumioconfig.txt'), H.osFile('volumioconfig-4.231.txt'));
    const third = H.plugin();
    await third.start();
    assert.equal(third.p.driftDetected, true);
    assert.ok(third.p.driftErrors.includes('ERR_INCLUDE_MISSING'), third.p.driftErrors.join());
    assert.ok(third.p.driftErrors.includes('ERR_CONFIG_MISMATCH'));
    assert.ok(third.p.driftErrors.includes('ERR_VOLUMIOCONFIG_MISMATCH'));
    assert.ok(third.p.driftErrors.includes('ERR_KMS_NOT_EFFECTIVE'), 'without the include the OS file leaves KMS off on a Pi 5');
    await waitFor(() => third.modal(), 'the reboot modal after the regeneration');
    assert.ok(third.toasts.some((t) => t.message === third.p.getI18n('CONFIG_DRIFT_DETECTED')), 'notify mode says so');
    assert.ok(/^include videoconfig\.txt$/m.test(H.readBoot('config.txt')));
    assert.equal(MIGRATION.test(without(H.readBoot('volumioconfig.txt'), /^#/)), false, 'the fresh OS file was stripped again');
    const vc = H.readBoot('videoconfig.txt');
    assert.ok(/^dtoverlay=vc4-kms-dsi-ili9881-7inch,rotation=270$/m.test(vc), 'regenerated from the recovered settings, not from defaults:\n' + vc);
    assert.ok(/^\[all\]$/m.test(vc));
    assert.equal(/HDMI0 Configuration/.test(vc), false);
    assert.equal(third.modal().data.title, third.p.getI18n('REBOOT_REQUIRED'));
    const fourth = await restart(third);
    assert.equal(fourth.p.driftDetected, false, 'the regenerated state is the saved state');
    await stop(fourth);
});

test('the saved copy of videoconfig.txt serves the recovery when the live one is gone', async () => {
    const bench = benchTree();
    const boot = Object.assign({}, bench.files, { 'videoconfig.txt': null, 'config.txt': H.osFile('config-4.231.txt') });
    H.seed({ board: 'pi5', config: 'shipped', boot, current: bench });
    const env = H.plugin();
    await env.start();
    assert.equal(env.p.config.get('dsi0.overlay'), 'rpi-touch2-7inch');
    assert.equal(env.p.config.get('wizard_complete'), true);
    assert.ok(env.p.driftErrors.includes('ERR_VIDEOCONFIG_MISSING'));
    await waitFor(() => fs.existsSync(path.join(H.BOOT, 'videoconfig.txt')) && /ili9881/.test(H.readBoot('videoconfig.txt')), 'videoconfig.txt regenerated');
    await stop(env);
});

test('a settings file that does not parse, or is missing, starts from defaults and still recovers from the boot files', async () => {
    const bench = benchTree();
    H.seed({ board: 'pi5', config: null, boot: bench.files, current: bench });
    fs.writeFileSync(path.join(H.CONFIG_DIR, 'config.json'), '{ not json');
    let env = H.plugin();
    await env.start();
    assert.equal(env.p.config.get('dsi0.overlay'), 'rpi-touch2-7inch');
    flush(env);
    assert.equal(conf.isNormalized(H.readConfigFile()), true, 'the unreadable file is replaced by a sound one');
    await stop(env);
    H.seed({ board: 'pi4', config: null });
    env = H.plugin();
    await env.start();
    assert.equal(env.p.config.get('wizard_complete', false), false);
    assert.equal(env.p.getConfigValue('primary_output', 'hdmi0'), 'hdmi0');
    assert.equal(env.p.hardwareInfo.model, 'Pi 4B');
    await stop(env);
});

test('a reset wizard is not undone by the recovery; a restore of the configuration needs an apply first', async () => {
    H.seed({ board: 'pi4' });
    let env = H.plugin();
    await env.start();
    await rejects(() => env.p.restoreConfiguration(), /applied/, 'nothing to regenerate from');
    await configure(env, { primary_output: 'hdmi0', 'hdmi0.enabled': true, 'hdmi0.mode': 'screen_audio', 'hdmi0.display_preset': 'auto' });
    env.p.resetWizard();
    assert.equal(env.p.config.get('wizard_complete'), false);
    assert.equal(env.p.config.get('wizard_step'), 1);
    assert.ok(env.p.config.get('applied_date'));
    env = await restart(env);
    assert.equal(env.p.config.get('wizard_complete'), false, 'applied once, reset by the user: the files stay, the wizard stays reset');
    assert.equal(env.toasts.some((t) => /rebuilt from the boot files/.test(t.message)), false);
    await stop(env);
});

test('ota_behavior ask shows the choice and restoreAndReboot regenerates; silent regenerates without a warning', async () => {
    H.seed({ board: 'pi4' });
    let env = H.plugin();
    await env.start();
    await configure(env, { primary_output: 'hdmi0', 'hdmi0.enabled': true, 'hdmi0.mode': 'screen', 'hdmi0.display_preset': 'waveshare-9.3-hdmi', ota_behavior: 'ask' });
    await stop(env);
    fs.writeFileSync(path.join(H.BOOT, 'config.txt'), H.osFile('config-4.231.txt'));
    env = H.plugin();
    await env.start();
    await waitFor(() => env.modal(), 'the ask modal');
    assert.equal(env.modal().data.title, env.p.getI18n('CONFIG_DRIFT_TITLE'));
    assert.equal(env.modal().data.buttons[0].payload.method, 'restoreAndReboot');
    assert.equal(/^include videoconfig\.txt$/m.test(H.readBoot('config.txt')), false, 'nothing happens until the user chooses');
    const ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_ota_drift').hidden, false);
    assert.ok(uiItem(ui, 'section_ota_drift', 'drift_errors').value.length > 0);
    env.p.restoreAndReboot();
    await waitFor(() => /^include videoconfig\.txt$/m.test(H.readBoot('config.txt')), 'the include restored');
    await waitFor(() => env.p.driftDetected === false, 'drift state cleared');
    assert.equal(env.modal().data.title, env.p.getI18n('REBOOT_REQUIRED'));

    env.p.saveOtaBehavior({ ota_behavior_edit: { value: 'silent' } });
    assert.equal(env.p.config.get('ota_behavior'), 'silent');
    await stop(env);
    fs.writeFileSync(path.join(H.BOOT, 'config.txt'), H.osFile('config-4.231.txt'));
    env = H.plugin();
    await env.start();
    await waitFor(() => /^include videoconfig\.txt$/m.test(H.readBoot('config.txt')), 'silent regeneration');
    assert.equal(env.toasts.some((t) => t.message === env.p.getI18n('CONFIG_DRIFT_DETECTED')), false);
    await waitFor(() => env.modal(), 'reboot modal');
    await stop(env);
});

// Every output the generator knows, written, the settings file reset, recovered from the
// file, regenerated: the second file equals the first and cmdline.txt stays as it was.
const ROUND_TRIPS = [
    { name: 'Pi 4, HDMI0 preset with hdmi_cvt, rotation 90, hotplug, boost, HDMI1 audio', board: 'pi4', settings: { primary_output: 'hdmi0', 'hdmi0.enabled': true, 'hdmi0.mode': 'screen', 'hdmi0.display_preset': 'waveshare-9.3-hdmi', 'hdmi0.rotation': 90, 'hdmi0.force_hotplug': true, 'hdmi0.boost': 5, 'hdmi1.enabled': true, 'hdmi1.mode': 'audio' }, expect: { 'hdmi1.mode': 'audio', 'hdmi0.display_preset': 'waveshare-9.3-hdmi', 'hdmi0.rotation': 90 } },
    { name: 'Pi 4, HDMI1 primary with hdmi_timings and video_mode', board: 'pi4', settings: { primary_output: 'hdmi1', 'hdmi0.enabled': false, 'hdmi0.mode': 'none', 'hdmi1.enabled': true, 'hdmi1.mode': 'screen_audio', 'hdmi1.display_preset': 'waveshare-11.9-hdmi', 'hdmi1.rotation': 0 }, expect: { primary_output: 'hdmi1', 'hdmi1.display_preset': 'waveshare-11.9-hdmi' } },
    { name: 'Pi 4, HDMI0 custom timings and parameters', board: 'pi4', settings: { primary_output: 'hdmi0', 'hdmi0.enabled': true, 'hdmi0.mode': 'screen_audio', 'hdmi0.display_preset': 'custom-hdmi', 'hdmi0.custom_timings': '1000 500 60 6 0 0 0', 'hdmi0.custom_params': 'hdmi_pixel_freq_limit=400000000\n# a note\n', 'hdmi0.rotation': 180 }, expect: { 'hdmi0.display_preset': 'custom-hdmi', 'hdmi0.custom_timings': '1000 500 60 6 0 0 0', 'hdmi0.rotation': 180 } },
    { name: 'Pi 4, HDMI0 group/mode preset, EDID ignored, KMS off', board: 'pi4', settings: { primary_output: 'hdmi0', 'hdmi0.enabled': true, 'hdmi0.mode': 'screen_audio', 'hdmi0.display_preset': 'waveshare-11.6-hdmi-h', 'hdmi0.ignore_edid': true, 'kms.mode': 'off' }, expect: { 'kms.mode': 'off', 'hdmi0.ignore_edid': true, 'hdmi0.display_preset': 'waveshare-11.6-hdmi-h' } },
    { name: 'Pi 4, HDMI0 auto with a custom CMA', board: 'pi4', settings: { primary_output: 'hdmi0', 'hdmi0.enabled': true, 'hdmi0.mode': 'screen_audio', 'hdmi0.display_preset': 'auto', 'kms.mode': 'on', 'kms.cma_option': 'custom', 'kms.cma_custom_mb': 250 }, expect: { 'kms.cma_option': 'custom', 'kms.cma_custom_mb': 252 } },
    { name: 'Pi 5, DSI0 original 7" (rotation through cmdline), HDMI0 audio', board: 'pi5', settings: { primary_output: 'dsi0', 'dsi0.enabled': true, 'dsi0.overlay': 'rpi-touch-7inch', 'dsi0.rotation': 90, 'hdmi0.enabled': true, 'hdmi0.mode': 'audio' }, expect: { 'dsi0.rotation': 90, 'dsi0.overlay': 'rpi-touch-7inch', 'hdmi0.mode': 'audio' } },
    { name: 'Pi 5, DSI1 custom overlay line', board: 'pi5', settings: { primary_output: 'dsi1', 'dsi1.enabled': true, 'dsi1.overlay': 'custom', 'dsi1.custom_params': 'vc4-kms-dsi-example,x=1,y=2' }, expect: { 'dsi1.overlay': 'custom', 'dsi1.custom_params': 'vc4-kms-dsi-example,x=1,y=2' } },
    { name: 'Pi 5, DSI0 panel without its own overlay line and without KMS', board: 'pi5', settings: { primary_output: 'dsi0', 'dsi0.enabled': true, 'dsi0.overlay': 'btt-pitft50-v1.0', 'kms.mode': 'preset' }, expect: { 'dsi0.overlay': 'btt-pitft50-v1.0', 'kms.mode': 'preset' } },
    { name: 'Pi 4, DPI preset with several overlays, rotation 90, timing line', board: 'pi4', settings: { primary_output: 'dpi', 'dpi.enabled': true, 'dpi.overlay': 'waveshare-2.8dpi', 'dpi.rotation': 90, 'dpi.custom_timing': 'dpi_timings=480 0 26 16 10 640 0 25 10 15 0 0 0 60 0 32000000 1' }, expect: { 'dpi.overlay': 'waveshare-2.8dpi', 'dpi.rotation': 90 } },
    { name: 'Pi 4, DPI single overlay, no rotation', board: 'pi4', settings: { primary_output: 'dpi', 'dpi.enabled': true, 'dpi.overlay': 'hyperpixel4', 'dpi.rotation': 0 }, expect: { 'dpi.overlay': 'hyperpixel4' } },
    { name: 'Pi 4, DPI custom overlay', board: 'pi4', settings: { primary_output: 'dpi', 'dpi.enabled': true, 'dpi.overlay': 'custom', 'dpi.custom_timing': 'vc4-kms-dpi-generic,hactive=800,vactive=480' }, expect: { 'dpi.overlay': 'custom' } },
    { name: 'Pi 3B+, composite PAL 16:9', board: 'pi3bplus', settings: { primary_output: 'composite', 'composite.enabled': true, 'composite.mode': 'pal', 'composite.aspect': '16:9' }, expect: { 'composite.mode': 'pal', 'composite.aspect': '16:9' } },
    { name: 'Pi 4, a custom overlay line as the output', board: 'pi4', settings: { primary_output: 'custom', 'custom_overlay.enabled': true, 'custom_overlay.line': 'dtoverlay=example-panel,bar=1' }, expect: { 'custom_overlay.line': 'dtoverlay=example-panel,bar=1' } },
    { name: 'Pi 4, headless', board: 'pi4', settings: { primary_output: 'headless', 'hdmi0.enabled': false }, expect: { primary_output: 'headless' } },
];

test('round trip: every output type regenerates to the same files after the settings are rebuilt from them', async () => {
    for (const rt of ROUND_TRIPS) {
        H.seed({ board: rt.board });
        let env = H.plugin();
        await env.start();
        await configure(env, rt.settings);
        const vc1 = H.readBoot('videoconfig.txt');
        const cmd1 = H.readBoot('cmdline.txt');
        await stop(env);
        // the settings file goes back to the shipped one; the boot files stay
        fs.copySync(path.join(H.PLUGIN_DIR, 'config.json'), path.join(H.CONFIG_DIR, 'config.json'));
        env = H.plugin();
        await env.start();
        assert.ok(env.toasts.some((t) => /rebuilt from the boot files/.test(t.message)), rt.name + ': recovery announced');
        Object.keys(rt.expect).forEach((k) => assert.equal(env.p.getConfigValue(k), rt.expect[k], rt.name + ': ' + k));
        assert.equal(sansDate(env.p.generateVideoConfig()), sansDate(vc1), rt.name + ': videoconfig.txt regenerates identically');
        await env.p.updateCmdline();
        assert.equal(H.readBoot('cmdline.txt'), cmd1, rt.name + ': cmdline.txt regenerates identically');
        assert.equal(env.p.driftDetected, false, rt.name + ': no drift');
        await stop(env);
    }
});

test('a hand-written configuration in the OS files: detected, validated, matched to a preset, accepted, kept through an OS update', async () => {
    const user = H.USERCONFIG + 'hdmi_group=2\nhdmi_mode=87\nhdmi_cvt=1600 600 60 6 0 0 0\nhdmi_drive=2\nconfig_hdmi_boost=7\n';
    H.seed({ board: 'pi4', boot: { 'userconfig.txt': user } });
    let env = H.plugin();
    await env.start();
    const info = await env.p.detectMigration();
    assert.equal(info.migration_needed, true);
    assert.deepEqual(info.sources, ['volumioconfig.txt', 'userconfig.txt']);
    assert.ok(info.lines.some((l) => l.source === 'userconfig.txt' && l.line === 'hdmi_cvt=1600 600 60 6 0 0 0'));
    let ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_migration_detected').hidden, false);
    await env.p.migrateValidate();
    assert.equal(env.p.config.get('migration_state'), 'review');
    assert.equal(env.p.config.get('hdmi0.display_preset'), 'waveshare-9.3-hdmi', 'the cvt line names the preset');
    assert.equal(env.p.config.get('hdmi0.boost'), 7);
    assert.equal(env.p.config.get('kms.mode'), 'on');
    const parsed = env.p.getJsonValue('migration_parsed', null);
    assert.ok(parsed && parsed.parsed && parsed.recognized.length > 0);
    assert.ok(env.p.interpretConfigToHuman(parsed).some((l) => /Waveshare 9\.3/.test(l)));
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_migration_review').hidden, false);
    assert.ok(/Waveshare 9\.3/.test(uiItem(ui, 'section_migration_review', 'review_interpreted').value));
    assert.ok(uiItem(ui, 'section_migration_review', 'review_validation').value.length > 0);
    await env.p.migrateAccept();
    assert.equal(env.p.config.get('wizard_complete'), true);
    assert.equal(env.p.config.get('videoconfig_mode'), 'migrated');
    const vc = H.readBoot('videoconfig.txt');
    assert.ok(/^# Source: Migrated/m.test(vc));
    assert.ok(/^\[all\]$/m.test(vc));
    assert.equal((vc.match(/^dtoverlay=vc4-kms-v3d/gm) || []).length, 1, 'one KMS line however many filter sections the OS file had');
    assert.ok(/^hdmi_cvt=1600 600 60 6 0 0 0$/m.test(vc));
    assert.equal(/^hdmi_cvt/m.test(H.readBoot('userconfig.txt')), false, 'moved out of userconfig.txt');
    assert.ok(/^# Add your custom/m.test(H.readBoot('userconfig.txt')), 'the rest of userconfig.txt stays');
    assert.ok(/^include videoconfig\.txt$/m.test(H.readBoot('config.txt')));
    await stop(env);
    fs.writeFileSync(path.join(H.BOOT, 'config.txt'), H.osFile('config-4.231.txt'));
    fs.writeFileSync(path.join(H.BOOT, 'videoconfig.txt'), '# something else\n');
    env = H.plugin();
    await env.start();
    assert.ok(env.p.driftErrors.includes('ERR_VIDEOCONFIG_MODIFIED'));
    await waitFor(() => /^# Source: Migrated/m.test(H.readBoot('videoconfig.txt')), 'the migrated file is copied back, not regenerated');
    assert.ok(/^hdmi_cvt=1600 600 60 6 0 0 0$/m.test(H.readBoot('videoconfig.txt')));
    await stop(env);
});

test('migration: as-is, skip, reconfigure, the manual trigger, and a clean system', async () => {
    H.seed({ board: 'pi4', boot: { 'userconfig.txt': H.USERCONFIG + 'hdmi_group=1\nhdmi_mode=16\n' } });
    let env = H.plugin();
    await env.start();
    await env.p.getUIConfig();
    await env.p.migrateAsIs();
    assert.equal(env.p.config.get('migration_state'), 'review');
    assert.equal(env.p.getJsonValue('migration_validation', [])[0].type, 'info');
    await env.p.migrateReconfigure();
    assert.equal(env.p.config.get('migration_state'), 'none');
    assert.equal(env.p.config.get('wizard_step'), 1);
    assert.deepEqual(env.p.getJsonValue('migration_raw_lines', null), []);
    env.p.performMigration();
    await waitFor(() => !/^hdmi_group/m.test(H.readBoot('userconfig.txt')), 'lines removed by the manual trigger');
    assert.equal((await env.p.detectMigration()).migration_needed, false);
    assert.equal((await env.p.executeMigration()).message, 'No migration needed');
    await env.p.migrateValidate();
    assert.equal(env.p.config.get('migration_state'), 'none', 'nothing left to migrate');
    await env.p.migrateAsIs();
    assert.equal(env.p.config.get('migration_state'), 'none');
    env.p.config.set('migration_state', 'processing');
    env.p.migrationStateCache = 'processing';
    const ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_migration_detected').hidden, false, 'while processing the detected section stays');
    await env.p.migrateSkip();
    assert.equal(env.p.config.get('wizard_step'), 1);
    await stop(env);
    H.seed({ board: 'pi4', boot: { 'volumioconfig.txt': '# clean\n[all]\n' } });
    env = H.plugin();
    await env.start();
    const ui2 = await env.p.getUIConfig();
    assert.equal(uiSection(ui2, 'section_migration_detected').hidden, true);
    assert.equal(uiSection(ui2, 'section_step1_output').hidden, false, 'no migration: straight to step 1');
    assert.equal(env.p.config.get('wizard_step'), 1);
    await stop(env);
});

test('restore points, file backups, the factory copies and the boot file helpers', async () => {
    H.seed({ board: 'pi4' });
    let env = H.plugin();
    await env.start();
    const beforeApply = H.readBoot('videoconfig.txt');
    await configure(env, { primary_output: 'hdmi0', 'hdmi0.enabled': true, 'hdmi0.mode': 'screen_audio', 'hdmi0.display_preset': 'waveshare-9.3-hdmi' });
    const applied = H.readBoot('videoconfig.txt');
    for (let i = 0; i < 12; i++) { await env.p.createRestorePoint(); await H.sleep(2); }
    const points = env.p.listRestorePoints();
    assert.equal(points.length, 10, 'ten restore points are kept');
    assert.ok(points[0].description.startsWith('HDMI0: Waveshare 9.3'));
    assert.ok(points[0].created > points[9].created);
    let ui = await env.p.getUIConfig();
    assert.equal(uiItem(ui, 'section_current_config', 'restore_point').options.length, 10);
    assert.equal(env.p.selectedRestorePoint, points[0].id, 'the newest is preselected');
    assert.equal(uiItem(ui, 'section_current_config', 'restore_factory_btn').hidden, false);

    env.p.saveRestorePointSelection({ value: points[3].id });
    assert.equal(env.p.selectedRestorePoint, points[3].id);
    fs.writeFileSync(path.join(H.BOOT, 'videoconfig.txt'), '# damaged\n');
    env.p.restoreSelectedPoint();
    await waitFor(() => H.readBoot('videoconfig.txt') === applied, 'restored from the point');
    assert.equal(env.modal().data.title, env.p.getI18n('REBOOT_REQUIRED'));
    env.p.selectedRestorePoint = null;
    env.p.restoreSelectedPoint();
    assert.equal(env.lastToast().message, env.p.getI18n('SELECT_RESTORE_POINT'));
    await rejects(() => env.p.restoreFromPoint('2000-01-01T00-00-00-000Z'), /not found/);

    for (let i = 0; i < 12; i++) { await env.p.createBackup(path.join(H.BOOT, 'cmdline.txt')); await H.sleep(2); }
    const backups = fs.readdirSync(env.p.backupDir).filter((f) => f.startsWith('cmdline.txt.') && f.endsWith('.bak'));
    assert.equal(backups.length, 10, 'ten file backups per name are kept');
    assert.equal(await env.p.createBackup(path.join(H.BOOT, 'absent.txt')), null);
    assert.equal(env.p.getLatestBackup('cmdline.txt'), path.join(env.p.backupDir, backups.sort().reverse()[0]));
    assert.equal(env.p.getLatestBackup('nothing'), null);
    const target = path.join(H.ROOT, 'elsewhere.txt');
    await env.p.restoreFromBackup(env.p.getLatestBackup('cmdline.txt'), target);
    assert.equal(fs.readFileSync(target, 'utf8'), H.readBoot('cmdline.txt'));
    await rejects(() => env.p.restoreFromBackup('/nowhere.bak', target), /not found/);
    fs.writeFileSync(path.join(H.BOOT, 'videoconfig.txt'), '# damaged again\n');
    env.p.restoreBackup();
    await waitFor(() => env.lastToast().message === env.p.getI18n('BACKUP_RESTORED'), 'the legacy restore');
    assert.equal(H.readBoot('videoconfig.txt'), beforeApply, 'it brings back the newest .bak, taken before the apply');

    const userBefore = H.readBoot('userconfig.txt');
    assert.equal(env.p.writeBootFile(path.join(H.BOOT, 'userconfig.txt'), userBefore + '# probe\n'), true);
    assert.equal(H.readBoot('userconfig.txt'), userBefore + '# probe\n');
    assert.equal(env.p.writeBootFile(path.join(H.BOOT, 'probe.txt'), 'x\n'), false, 'the helper serves five names');
    assert.equal(fs.existsSync(path.join(H.BOOT, 'probe.txt')), false);
    assert.equal(env.p.writeBootFile(path.join(H.ROOT, 'config.txt'), 'x\n'), false, 'and only under /boot');
    assert.equal(env.p.writeBootFile(path.join(H.BOOT, 'config.txt'), ''), false, 'an empty config.txt is refused');
    assert.ok(H.readBoot('config.txt').length > 0);
    assert.equal(env.p.copyToBootFile(path.join(H.BOOT, 'userconfig.txt'), path.join(H.BOOT, 'probe2.txt')), false);
    assert.equal(env.p.copyToBootFile(path.join(H.ROOT, 'absent'), path.join(H.BOOT, 'userconfig.txt')), false);
    assert.equal(env.p.removeBootFile(path.join(H.BOOT, 'cmdline.txt')), false, 'only videoconfig.txt is removable');
    assert.ok(fs.existsSync(path.join(H.BOOT, 'cmdline.txt')));
    assert.equal(env.p.removeBootFile(path.join(H.BOOT, 'never-there.txt')), true);
    assert.equal(env.p.writeBootFile(path.join(H.BOOT, 'userconfig.txt'), userBefore), true);
    const priv = env.p.priv;
    env.p.priv = { writeBoot() { throw new Error('denied'); }, removeBoot() { throw new Error('denied'); }, cleanExit() { throw new Error('denied'); } };
    assert.equal(env.p.writeBootFile(path.join(H.BOOT, 'videoconfig.txt'), 'y\n'), false);
    assert.equal(env.p.copyToBootFile(path.join(H.BOOT, 'userconfig.txt'), path.join(H.BOOT, 'config.txt')), false);
    assert.equal(env.p.removeBootFile(path.join(H.BOOT, 'videoconfig.txt')), false);
    await rejects(() => env.p.writeVideoConfig(), /Failed to write/);
    await rejects(() => env.p.restoreFactoryDefaults(), /denied/);
    env.p.executeFactoryRestore();
    await waitFor(() => env.lastToast() && env.lastToast().type === 'error', 'error toast');
    env.p.priv = priv;

    await env.p.removeConfigInclude();
    assert.equal(/^include videoconfig\.txt$/m.test(H.readBoot('config.txt')), false);
    await env.p.removeConfigInclude();
    await env.p.ensureConfigInclude();
    assert.equal((H.readBoot('config.txt').match(/^include videoconfig\.txt$/gm) || []).length, 1);
    await env.p.ensureConfigInclude();
    assert.equal((H.readBoot('config.txt').match(/^include videoconfig\.txt$/gm) || []).length, 1, 'idempotent');

    // The clean exit: the plugin's lines leave, the stripped lines come back
    assert.equal(env.p.hasPluginBootChanges(), true);
    assert.ok(fs.existsSync(path.join(H.INTERNAL, 'strip', 'volumioconfig.txt.original')), 'the strip was recorded');
    assert.notEqual(H.readBoot('volumioconfig.txt'), H.osFile('volumioconfig-4.231.txt'), 'stripped while configured');
    assert.ok(/fbcon=rotate:0/.test(H.readBoot('cmdline.txt')));
    env.p.restoreFactory();
    assert.equal(env.modal().data.buttons[0].payload.method, 'executeFactoryRestore');
    env.p.executeFactoryRestore();
    await waitFor(() => env.modal().data.message === env.p.getI18n('FACTORY_REBOOT_MESSAGE'), 'the reboot modal after the removal');
    assert.equal(fs.existsSync(path.join(H.BOOT, 'videoconfig.txt')), false, 'videoconfig.txt removed');
    assert.equal(H.readBoot('config.txt'), H.osFile('config-4.231.txt'), 'the include line is gone');
    assert.equal(H.readBoot('volumioconfig.txt'), H.osFile('volumioconfig-4.231.txt'), 'Volumio\'s file is back as the OS wrote it');
    assert.equal(H.readBoot('cmdline.txt').trim(), H.CMDLINE, 'the rotation parameters are gone');
    assert.equal(fs.existsSync(path.join(H.INTERNAL, 'strip', 'volumioconfig.txt.original')), false, 'record consumed');
    assert.equal(env.p.hasPluginBootChanges(), false);
    assert.equal(env.p.config.get('wizard_complete'), false);
    assert.ok(env.p.config.get('applied_date'), 'an explicit removal is not undone by the recovery');
    await H.settle();
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_migration_detected').hidden, false, 'the OS lines are back, so the take-over is offered again');
    assert.equal(uiSection(ui, 'section_current_config').hidden, true);
    env = await restart(env);
    assert.equal(env.p.config.get('wizard_complete'), false, 'nothing of ours on /boot: nothing recovered');
    await stop(env);

    // A file edited after the strip is left alone, and said so
    H.seed({ board: 'pi4', boot: { 'userconfig.txt': H.USERCONFIG + 'hdmi_group=1\nhdmi_mode=16\n' } });
    env = H.plugin();
    await env.start();
    await configure(env, { primary_output: 'hdmi0', 'hdmi0.enabled': true, 'hdmi0.mode': 'screen_audio', 'hdmi0.display_preset': 'auto' });
    assert.equal(/^hdmi_group/m.test(H.readBoot('userconfig.txt')), false, 'userconfig.txt stripped at the apply');
    assert.ok(fs.existsSync(path.join(H.INTERNAL, 'strip', 'userconfig.txt.original')));
    fs.appendFileSync(path.join(H.BOOT, 'volumioconfig.txt'), '# edited by hand\n');
    const report = await env.p.restoreFactoryDefaults();
    assert.ok(/WARNING: volumioconfig\.txt changed since/.test(report), report);
    assert.ok(/userconfig\.txt: the lines the plugin removed are back/.test(report), report);
    assert.ok(/^hdmi_group=1$/m.test(H.readBoot('userconfig.txt')));
    assert.ok(/# edited by hand/.test(H.readBoot('volumioconfig.txt')), 'the edited file stays');
    assert.ok(fs.existsSync(path.join(H.INTERNAL, 'strip', 'volumioconfig.txt.original')), 'the original is kept for the user');
    assert.equal(env.toasts.filter((t) => t.type === 'warning').pop().message.includes('volumioconfig.txt changed'), true);
    await stop(env);
});

test('the presets database: bundled, checked, downloaded, cached across restarts, reverted; settings and the manager URL', async () => {
    const bundled = fs.readJsonSync(path.join(H.PLUGIN_DIR, 'display_presets.json'));
    const newer = { version: '99.0.0', last_updated: '2030-01-01', presets: Object.assign({}, bundled.presets, { 'test-new-hdmi': { name: 'Test New', type: 'hdmi', description: '', config: { hdmi_group: 2, hdmi_mode: 82 } } }) };
    const remote = await serve(newer);
    H.seed({ board: 'pi4' });
    let env = H.plugin();
    await env.start();
    assert.equal(env.p.compareVersions('1.5.9', '1.5.10'), -1);
    assert.equal(env.p.compareVersions('2.0', '1.9.9'), 1);
    assert.equal(env.p.compareVersions('1.0.0', '1.0.0'), 0);
    assert.equal(env.p.compareVersions('unknown', '1.0.0'), -1);
    assert.equal(env.p.compareVersions('1.0.0', 'unknown'), 1);
    assert.equal(env.p.config.get('database.active_source'), 'bundled');
    assert.equal(env.p.displayPresetsVersion, bundled.version);
    assert.equal(env.p.config.get('database.bundled_version'), bundled.version);
    assert.ok(fs.existsSync(path.join(env.p.presetsCacheDir, 'metadata.json')));
    assert.equal(env.p.createDefaultMetadata().remote_url, env.p.config.get('database.remote_url'));

    env.p.saveDatabaseSettings({ db_remote_url: remote.url, db_auto_check: true });
    assert.equal(env.p.config.get('database.remote_url'), remote.url);
    assert.equal(env.p.presetsMetadata.remote_url, remote.url);
    const check = await env.p.checkDatabaseUpdate();
    assert.equal(check.available, true);
    assert.equal(check.remote_version, '99.0.0');
    assert.ok(env.p.config.get('database.last_check'));
    await env.p.checkForDatabaseUpdate();
    assert.equal(env.modal().data.buttons[0].payload.method, 'applyDatabaseUpdate');
    await env.p.applyDatabaseUpdate();
    assert.equal(env.p.config.get('database.active_source'), 'cached');
    assert.equal(env.p.displayPresetsVersion, '99.0.0');
    assert.ok(env.p.getDisplayPreset('test-new-hdmi'));
    assert.ok(fs.existsSync(path.join(env.p.presetsCacheDir, 'remote.json')));
    await env.p.checkForDatabaseUpdate();
    assert.ok(env.lastToast().message.includes('99.0.0'), 'up to date now');
    let ui = await env.p.getUIConfig();
    assert.equal(uiItem(ui, 'section_database', 'db_active_version').value, '99.0.0');
    assert.equal(uiItem(ui, 'section_database', 'db_preset_count').value, String(Object.keys(newer.presets).filter((k) => !k.startsWith('_comment')).length), 'section markers are not presets');
    assert.equal(uiItem(ui, 'section_database', 'db_revert_btn').hidden, false);

    env = await restart(env);
    assert.equal(env.p.config.get('database.active_source'), 'cached', 'the cached database loads first');
    assert.equal(env.p.displayPresetsVersion, '99.0.0');
    await env.p.revertDatabase();
    assert.equal(env.p.config.get('database.active_source'), 'bundled');
    assert.equal(env.p.displayPresetsVersion, bundled.version);
    assert.equal(fs.existsSync(path.join(env.p.presetsCacheDir, 'remote.json')), false);
    ui = await env.p.getUIConfig();
    assert.equal(uiItem(ui, 'section_database', 'db_revert_btn').hidden, true);

    assert.equal(env.p.getManagementUrl(), 'http://hanger.local:0');
    env.p.saveHostnameOverride({ db_hostname_override: ' 10.0.0.5 ' });
    assert.equal(env.p.getManagementUrl(), 'http://10.0.0.5:0');
    ui = await env.p.getUIConfig();
    assert.equal(uiItem(ui, 'section_preset_manager', 'db_open_manager_btn').onClick.url, 'http://10.0.0.5:0');
    assert.equal(uiItem(ui, 'section_preset_manager', 'db_hostname_override').value, ' 10.0.0.5 ');

    assert.equal((await env.p.fetchRemoteDatabase(remote.url)).version, '99.0.0');
    await rejects(() => env.p.fetchRemoteDatabase('ftp://x'), /http/);
    await rejects(() => env.p.fetchRemoteDatabase('http://127.0.0.1:1/x'), /ECONNREFUSED|connect/);
    await remote.close();
    const broken = await serve('not json');
    env.p.config.set('database.remote_url', broken.url);
    await rejects(() => env.p.fetchRemoteDatabase(broken.url), /JSON|Unexpected/);
    await rejects(() => env.p.checkDatabaseUpdate(), /Invalid JSON/);
    await env.p.checkForDatabaseUpdate();
    assert.equal(env.lastToast().type, 'warning');
    await rejects(() => env.p.downloadDatabaseUpdate(), /Failed to process/);
    await env.p.applyDatabaseUpdate();
    assert.equal(env.lastToast().type, 'error');
    await broken.close();
    const missing = await serve({}, 404);
    env.p.config.set('database.remote_url', missing.url);
    await rejects(() => env.p.fetchRemoteDatabase(missing.url), /404/);
    await rejects(() => env.p.checkDatabaseUpdate(), /404/);
    await rejects(() => env.p.downloadDatabaseUpdate(), /404/);
    await missing.close();
    const noPresets = await serve({ version: '1' });
    env.p.config.set('database.remote_url', noPresets.url);
    await rejects(() => env.p.downloadDatabaseUpdate(), /missing presets/);
    await noPresets.close();
    await stop(env);

    // the automatic check on start, against a local server
    const auto = await serve(newer);
    H.seed({ board: 'pi4', remoteUrl: auto.url, autoCheck: true });
    env = H.plugin();
    await env.start();
    await waitFor(() => env.p.config.get('database.last_check'), 'the start-up check ran');
    assert.ok(env.logs.some((l) => /Database update available - v99\.0\.0/.test(l[1])));
    await auto.close();
    await stop(env);
});

test('the presets a user authored on a release before 1.0 are carried to the Internal Storage directory', async () => {
    const draft = { version: '1.5.9', presets: { 'my-own-panel': { name: 'My Own Panel', type: 'hdmi', description: '', config: { hdmi_group: 2, hdmi_mode: 87, hdmi_cvt: '1000 600 60 6 0 0 0' } } } };
    const cached = { version: '1.5.9', presets: Object.assign({}, fs.readJsonSync(path.join(H.PLUGIN_DIR, 'display_presets.json')).presets, draft.presets) };
    H.seed({ board: 'pi4', config: 'raw', legacyCache: { 'draft.json': draft, 'remote.json': cached, 'backups/presets_backup_2026-01-01T00-00-00-000Z.json': draft } });
    let env = H.plugin();
    await env.start();
    assert.equal(env.p.presetsCacheDir, path.join(H.INTERNAL, 'presets_cache'));
    assert.ok(fs.existsSync(path.join(H.INTERNAL, 'presets_cache', 'draft.json')), 'the draft moved');
    assert.ok(fs.existsSync(path.join(H.INTERNAL, 'presets_cache', 'backups', 'presets_backup_2026-01-01T00-00-00-000Z.json')), 'the preset backups moved');
    assert.equal(fs.existsSync(path.join(H.PLUGIN_DATA, 'presets_cache')), false, 'nothing left in the plugin folder');
    assert.equal(env.p.config.get('database.active_source'), 'cached', 'the fetched database is still the active one');
    assert.ok(env.p.getDisplayPreset('my-own-panel'), 'the user\'s own preset is there');
    env.p.initDraftPresets();
    assert.ok(env.p.draftPresets.presets['my-own-panel']);
    assert.ok(env.logs.some((l) => /presets cache carried over/.test(l[1])));
    env = await restart(env);
    assert.equal(env.logs.some((l) => /presets cache carried over/.test(l[1])), false, 'once');
    assert.ok(env.p.getDisplayPreset('my-own-panel'));
    await stop(env);
});

test('the admin draft: list, load, add, update, delete, version, export, import, publish, discard, the toggles', async () => {
    H.seed({ board: 'pi4' });
    const env = H.plugin();
    await env.start();
    await env.p.toggleAdminMode();
    assert.equal(env.p.showAdminUI, true);
    assert.ok(env.p.draftPresets && env.p.draftPresets.version === env.p.displayPresetsVersion);
    const list = env.p.getAdminPresetList();
    assert.ok(list.length > 100);
    assert.ok(list.every((e) => e.id && e.name && e.type));
    assert.equal((await env.p.adminGetPreset({ preset_id: 'rpi-touch2-7inch' })).preset.type, 'dsi');
    assert.equal((await env.p.adminGetPreset({ preset_id: 'nope' })).success, false);

    await env.p.adminAddPreset({ admin_preset_id: 'My Panel X', admin_preset_name: 'My Panel', admin_preset_type: 'hdmi', admin_preset_desc: 'd', admin_preset_config: '{"hdmi_group":2,"hdmi_mode":87,"hdmi_cvt":"1024 600 60 6 0 0 0"}' });
    assert.ok(env.p.draftPresets.presets['my-panel-x'], 'id normalised');
    assert.equal(env.p.config.get('admin.draft_dirty'), true);
    assert.equal(fs.readJsonSync(path.join(env.p.presetsCacheDir, 'draft.json')).presets['my-panel-x'].name, 'My Panel');
    await env.p.adminAddPreset({ admin_preset_id: 'my-panel-x', admin_preset_name: 'dup' });
    assert.ok(env.lastToast().message.includes('my-panel-x'), 'duplicate refused');
    await env.p.adminAddPreset({ admin_preset_id: '', admin_preset_name: 'x' });
    assert.equal(env.lastToast().type, 'error');
    await env.p.adminAddPreset({ admin_preset_id: '../x', admin_preset_name: 'x' });
    assert.equal(env.lastToast().type, 'error');
    await env.p.adminAddPreset({ admin_preset_id: 'bad-json', admin_preset_name: 'x', admin_preset_config: '{' });
    assert.equal(env.lastToast().type, 'error');
    await env.p.adminAddPreset({ admin_preset_id: 'bad-type', admin_preset_name: 'x', admin_preset_type: 'lvds' });
    assert.equal(env.lastToast().type, 'error');
    await env.p.adminUpdatePreset({ admin_preset_id: 'my-panel-x', admin_preset_name: 'My Panel 2', admin_preset_type: 'hdmi', admin_preset_config: '{"hdmi_group":2,"hdmi_mode":82}' });
    assert.equal(env.p.draftPresets.presets['my-panel-x'].name, 'My Panel 2');
    await env.p.adminUpdatePreset({ admin_preset_id: 'missing' });
    assert.equal(env.lastToast().type, 'error');
    await env.p.adminUpdatePreset({ admin_preset_id: 'my-panel-x', admin_preset_name: 'x', admin_preset_config: '{' });
    assert.equal(env.lastToast().type, 'error');
    assert.deepEqual(env.p.validatePresetData(null).valid, false);
    assert.deepEqual(env.p.validatePresetData({ name: ' ', type: 'hdmi', config: {} }).valid, false);
    assert.deepEqual(env.p.validatePresetData({ name: 'n', type: 'hdmi' }).valid, false);
    assert.deepEqual(env.p.validatePresetData({ name: 'n', type: 'dsi', config: {}, vc4_kms: 'no' }).valid, false);
    assert.deepEqual(env.p.validatePresetData({ name: 'n', type: 'dsi', config: {}, emit_dsi_overlay: 1 }).valid, false);
    assert.deepEqual(env.p.validatePresetData({ name: 'n', type: 'dsi', config: {}, vc4_kms: false, emit_dsi_overlay: false }).valid, true);

    await env.p.adminStoreSelection({ value: 'my-panel-x' });
    assert.equal(env.p.adminSelectedPresetId, 'my-panel-x');
    await env.p.adminStoreSelection('rpi-touch2-7inch');
    assert.equal(env.p.adminSelectedPresetId, 'rpi-touch2-7inch');
    await env.p.adminLoadPreset('my-panel-x');
    assert.equal(env.p.adminLoadedPreset.name, 'My Panel 2');
    await env.p.adminLoadPreset({ admin_preset_list: 'rpi-touch2-7inch' });
    assert.equal(env.p.adminLoadedPreset.id, 'rpi-touch2-7inch');
    await env.p.adminLoadPreset({ selected: 'hyperpixel4' });
    assert.equal(env.p.adminLoadedPreset.id, 'hyperpixel4');
    await env.p.adminLoadPreset({ anything: 'rpi-touch-7inch' });
    assert.equal(env.p.adminLoadedPreset.id, 'rpi-touch-7inch');
    await env.p.adminLoadPreset('--');
    assert.equal(env.p.adminLoadedPreset.id, 'rpi-touch-7inch', 'placeholder ignored');
    await env.p.adminLoadPreset('nope');
    assert.equal(env.lastToast().type, 'error');

    await env.p.adminUpdateVersion({ admin_draft_version: ' 9.9.9 ' });
    assert.equal(env.p.draftPresets.version, '9.9.9');
    await env.p.adminUpdateVersion({ admin_draft_version: '  ' });
    assert.equal(env.p.draftPresets.version, '9.9.9');
    await env.p.adminExportDraft();
    const exported = fs.readJsonSync(path.join(env.p.presetsCacheDir, 'display_presets_export.json'));
    assert.equal(exported.version, '9.9.9');
    assert.ok(exported.presets['my-panel-x']);
    await env.p.adminDeletePreset({ admin_preset_id: 'my-panel-x' });
    assert.equal(env.p.draftPresets.presets['my-panel-x'], undefined);
    await env.p.adminDeletePreset({ admin_preset_id: 'my-panel-x' });
    assert.equal(env.lastToast().type, 'error');

    const importFile = path.join(H.ROOT, 'import.json');
    fs.writeJsonSync(importFile, { version: '5.0.0', presets: { 'imp-1': { name: 'Imported', type: 'dsi', config: { dtoverlay: 'x' } } } });
    await env.p.adminImportFromFile({ admin_import_file: importFile });
    assert.equal(env.p.draftPresets.version, '5.0.0');
    await env.p.adminImportFromFile({ admin_import_file: '' });
    assert.equal(env.lastToast().type, 'error');
    await env.p.adminImportFromFile({ admin_import_file: path.join(H.ROOT, 'none.json') });
    assert.equal(env.lastToast().type, 'error');
    fs.writeJsonSync(importFile, { version: '5' });
    await env.p.adminImportFromFile({ admin_import_file: importFile });
    assert.equal(env.lastToast().type, 'error');
    fs.writeFileSync(importFile, '{');
    await env.p.adminImportFromFile({ admin_import_file: importFile });
    assert.equal(env.lastToast().type, 'error');

    const remote = await serve({ version: '6.0.0', presets: { 'imp-2': { name: 'Remote', type: 'hdmi', config: {} } } });
    await env.p.adminImportFromUrl({ admin_import_url: ' ' + remote.url + ' ' });
    assert.equal(env.p.draftPresets.version, '6.0.0');
    await env.p.adminImportFromUrl({ admin_import_url: '' });
    assert.equal(env.lastToast().type, 'error');
    await remote.close();
    const bad = await serve('nope');
    await env.p.adminImportFromUrl({ admin_import_url: bad.url });
    assert.equal(env.lastToast().type, 'error');
    await bad.close();
    const noP = await serve({ version: '1' });
    await env.p.adminImportFromUrl({ admin_import_url: noP.url });
    assert.equal(env.lastToast().type, 'error');
    await noP.close();
    const gone = await serve({}, 500);
    await env.p.adminImportFromUrl({ admin_import_url: gone.url });
    assert.ok(/500/.test(env.lastToast().message));
    await gone.close();
    await env.p.adminImportFromUrl({ admin_import_url: 'http://127.0.0.1:1/x' });
    assert.ok(/Network error/.test(env.lastToast().message));

    await env.p.adminPublishDraft();
    assert.equal(env.p.config.get('database.active_source'), 'cached');
    assert.equal(env.p.displayPresetsVersion, '6.0.0');
    assert.ok(env.p.getDisplayPreset('imp-2'));
    await env.p.adminDiscardDraft();
    assert.equal(env.p.draftPresets, null);
    assert.equal(fs.existsSync(path.join(env.p.presetsCacheDir, 'draft.json')), false);
    env.p.draftPresets = null;
    await env.p.adminPublishDraft();
    assert.equal(env.lastToast().type, 'error');
    env.p.initDraftPresets();
    assert.equal(env.p.draftPresets.version, '6.0.0', 'a new draft starts from the active database');
    await env.p.revertToBundledDatabase();

    await env.p.showDatabaseSettings();
    assert.equal(env.p.showDatabaseSettingsUI, true);
    await env.p.showAdvancedSettings();
    assert.equal(env.p.showAdvancedSettingsUI, true);
    await env.p.hideAdvancedSettings();
    assert.equal(env.p.showAdvancedSettingsUI, false);
    assert.equal(env.p.showAdminUI, false);
    await env.p.showAdvancedSettings();
    await env.p.hideDatabaseSettings();
    assert.equal(env.p.showDatabaseSettingsUI, false);
    assert.equal(env.p.showAdvancedSettingsUI, false);
    await env.p.toggleAdminMode();
    await env.p.toggleAdminMode();
    assert.equal(env.p.showAdminUI, false);
    assert.equal(env.p.getPresetNameByOverlay('vc4-kms-dsi-ili9881-7inch'), 'Raspberry Pi Touch Display 2 - 7"');
    assert.equal(env.p.getPresetNameByOverlay('no-such-overlay'), 'no-such-overlay');
    assert.equal(env.p.findDsiPresetByOverlay('vc4-kms-dsi-ili9881-7inch'), 'rpi-touch2-7inch');
    assert.equal(env.p.findDsiPresetByOverlay('vc4-kms-dpi-hyperpixel4', 'dpi'), 'hyperpixel4');
    assert.equal(env.p.findDsiPresetByOverlay('vc4-kms-dpi-hyperpixel4'), 'vc4-kms-dpi-hyperpixel4', 'a DPI overlay is not a DSI preset');
    assert.equal(env.p.findDpiPresetByOverlays(['vc4-kms-v3d', 'vc4-kms-dpi-2inch8', 'waveshare-28dpi-3b-4b', 'waveshare-touch-28dpi']), 'waveshare-2.8dpi');
    assert.equal(env.p.findDpiPresetByOverlays(['vc4-kms-v3d']), null);
    assert.equal(env.p.matchHdmiConfigToPreset({ group: 2, mode: 87, cvt: '1600 600 60 6 0 0 0' }).presetId, 'waveshare-9.3-hdmi');
    assert.equal(env.p.matchHdmiConfigToPreset({ group: 2, mode: 82 }).presetId, 'waveshare-11.6-hdmi-h');
    assert.equal(env.p.matchHdmiConfigToPreset({ group: 1, mode: 4 }).presetId, 'generic-720p');
    assert.equal(env.p.matchHdmiConfigToPreset({ group: 2, mode: 87, cvt: '1 2 3 4 5 6 7' }), null);
    await stop(env);
});

test('the management API over HTTP', async () => {
    const bundledDb = fs.readJsonSync(path.join(H.PLUGIN_DIR, 'display_presets.json'));
    H.seed({ board: 'pi4', lang: 'de' });
    const env = H.plugin({ lang: 'de' });
    await env.start();
    const base = 'http://127.0.0.1:' + env.port();
    const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: r.headers.get('content-type').includes('json') ? await r.json() : await r.text(), headers: r.headers }; };
    const send = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

    assert.ok((await get('/')).body.includes('<html'));
    assert.deepEqual((await get('/api/language')).body, { language: 'de' });
    assert.equal((await get('/api/i18n/de')).body.REBOOT_REQUIRED, env.p.getI18n('REBOOT_REQUIRED'), 'German strings, unwrapped from the namespace');
    assert.equal((await get('/api/i18n/xx')).body.PLUGIN_NAME, 'Pi Screen Setup', 'unknown language falls back to English');
    assert.equal((await get('/api/i18n/zz-bad')).body.PLUGIN_NAME, 'Pi Screen Setup', 'malformed code is treated as English');
    const info = (await get('/api/database/info')).body;
    assert.equal(info.source, 'bundled');
    assert.equal(info.presetCount, Object.keys(bundledDb.presets).filter((k) => !k.startsWith('_comment')).length, 'the count leaves out the section markers');

    const all = (await get('/api/presets')).body;
    assert.ok(all.presets['rpi-touch2-7inch']);
    assert.equal((await get('/api/presets/rpi-touch2-7inch')).body.preset.type, 'dsi');
    assert.equal((await get('/api/presets/none')).status, 404);
    assert.equal((await send('POST', '/api/presets', { name: 'x' })).status, 400);
    assert.equal((await send('POST', '/api/presets', { id: 'bad id', name: 'x' })).status, 400);
    assert.equal((await send('POST', '/api/presets', { id: 'api-1', name: 'API One', type: 'hdmi', config: { hdmi_group: 2, hdmi_mode: 82 }, version: '7.0.0' })).status, 200);
    assert.equal((await send('POST', '/api/presets', { id: 'api-1', name: 'again' })).status, 409);
    assert.equal(env.p.displayPresetsVersion, '7.0.0', 'the working copy follows the draft');
    assert.equal((await send('POST', '/api/presets/api-1', { name: 'API One b', notes: 'kept' })).status, 200);
    assert.equal(env.p.draftPresets.presets['api-1'].name, 'API One b');
    assert.equal(env.p.draftPresets.presets['api-1'].type, 'hdmi', 'fields not sent stay');
    assert.equal((await send('POST', '/api/presets/none', { name: 'x' })).status, 404);
    assert.equal((await send('DELETE', '/api/presets/none')).status, 404);
    assert.equal((await send('DELETE', '/api/presets/api-1?version=7.0.1')).status, 200);
    assert.equal(env.p.draftPresets.version, '7.0.1');

    const remote = await serve({ version: '8.0.0', presets: { 'r-1': { name: 'R', type: 'hdmi', config: {} } } });
    assert.equal((await send('POST', '/api/database/import-url', {})).status, 400);
    const imp = await send('POST', '/api/database/import-url', { url: remote.url });
    assert.equal(imp.status, 200);
    assert.equal(imp.body.version, '8.0.0');
    await remote.close();
    const noP = await serve({ version: '1' });
    assert.equal((await send('POST', '/api/database/import-url', { url: noP.url })).status, 500);
    await noP.close();
    assert.equal((await send('POST', '/api/database/import-path', { path: '/etc/passwd' })).status, 400);
    assert.equal((await send('POST', '/api/database/import-path', { path: '/data/no/such/file.json' })).status, 400);
    assert.equal((await send('POST', '/api/database/import-data', { version: '1' })).status, 400);
    assert.equal((await send('POST', '/api/database/import-data', { version: '8.1.0', presets: { 'd-1': { name: 'D', type: 'dsi', config: {} } } })).body.count, 1);
    const exp = await get('/api/database/export');
    assert.ok(exp.headers.get('content-disposition').includes('display_presets.json'));
    assert.equal(exp.body.version, '8.1.0');
    assert.ok(fs.existsSync((await send('POST', '/api/database/export-pr')).body.path));
    assert.equal((await send('POST', '/api/database/reload-cache')).status, 404);
    assert.equal((await send('POST', '/api/database/publish')).body.version, '8.1.0');
    assert.equal(env.p.config.get('database.active_source'), 'cached');
    assert.equal((await send('POST', '/api/database/reload-cache')).body.version, '8.1.0');
    assert.equal((await send('POST', '/api/database/revert')).status, 200);
    assert.equal(env.p.config.get('database.active_source'), 'bundled');
    env.p.draftPresets = null;
    assert.equal((await send('POST', '/api/database/publish')).status, 400);

    assert.deepEqual((await get('/api/backups')).body, { backups: [] });
    const created = (await send('POST', '/api/backups')).body;
    assert.ok(created.name.startsWith('presets_backup_'));
    assert.equal((await get('/api/backups')).body.backups.length, 1);
    assert.equal((await get('/api/backups/' + created.name)).status, 200);
    assert.equal((await get('/api/backups/../config.json')).status, 404);
    assert.equal((await get('/api/backups/none.json')).status, 404);
    assert.equal((await send('POST', '/api/backups/upload', { name: 'x/y.json', data: { presets: {} } })).status, 400);
    assert.equal((await send('POST', '/api/backups/upload', { name: 'up.json', data: {} })).status, 400);
    assert.equal((await send('POST', '/api/backups/upload', { name: 'up.json', data: { version: '2.0.0', presets: { 'u-1': { name: 'U', type: 'hdmi', config: {} } } } })).body.name, 'up.json');
    assert.equal((await send('POST', '/api/backups/upload', { data: { version: '2.0.1', presets: {} } })).status, 200, 'a name is made up when none is given');
    assert.equal((await send('POST', '/api/backups/restore', { name: 'none.json' })).status, 404);
    assert.equal((await send('POST', '/api/backups/restore', { name: 'up.json' })).body.version, '2.0.0');
    assert.equal(env.p.displayPresetsVersion, '2.0.0');
    fs.writeJsonSync(path.join(env.p.presetsBackupDir, 'bad.json'), { version: 'x' });
    assert.equal((await send('POST', '/api/backups/restore', { name: 'bad.json' })).status, 400);
    assert.equal((await send('DELETE', '/api/backups/up.json')).status, 200);
    assert.equal((await send('DELETE', '/api/backups/up.json')).status, 404);
    env.p.expressServer.closeAllConnections();
    await env.p.onStop();
    assert.equal(env.p.expressServer, null);
    await rejects(() => fetch(base + '/api/language'));
    flush(env);
    env.p.config.filePath = undefined;
});

test('wizard branches: detection choice, two HDMI ports, DPI, composite, custom, headless, going back; the reports', async () => {
    H.seed({ board: 'pi4', overlays: ['vc4-kms-v3d.dtbo', 'present.dtbo'] });
    let env = H.plugin();
    await env.start();
    env.p.saveStep0({ detect_mode: { value: 'auto' } });
    assert.equal(env.p.config.get('primary_output'), 'hdmi0');
    assert.equal(env.p.config.get('wizard_step'), 1);
    env.p.saveStep0({ detect_mode: { value: 'manual' } });
    env.p.saveStep0({});
    let ui = await env.p.getUIConfig();
    assert.equal(uiItem(ui, 'section_step1_output', 'primary_output').options.length, 7, 'one DSI port on a Pi 4');

    env.p.saveStep1({ primary_output: { value: 'hdmi0' } });
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step2_hdmi').hidden, false);
    assert.equal(uiItem(ui, 'section_step2_hdmi', 'hdmi_secondary_mode').hidden, false);
    const presetOptions = uiItem(ui, 'section_step2_hdmi', 'hdmi_display_preset').options;
    assert.equal(presetOptions[0].value, 'auto');
    assert.equal(presetOptions[presetOptions.length - 1].value, 'off');
    env.p.saveStep2Hdmi({ hdmi_mode: { value: 'screen' }, hdmi_display_preset: { value: 'waveshare-11.9-hdmi' }, hdmi_custom_timings: '', hdmi_custom_params: '', hdmi_force_hotplug: true, hdmi_ignore_edid: false, hdmi_boost: { value: 3 }, hdmi_secondary_mode: { value: 'audio' }, hdmi_secondary_display_preset: { value: 'auto' }, hdmi_secondary_boost: { value: 0 } });
    assert.equal(env.p.config.get('hdmi0.recommended_rotation'), 90, 'the preset recommends a rotation');
    assert.equal(env.p.config.get('hdmi1.enabled'), true);
    assert.equal(env.p.config.get('hdmi1.mode'), 'audio');
    ui = await env.p.getUIConfig();
    assert.equal(uiItem(ui, 'section_step3_rotation', 'cmdline_video').hidden, false);
    env.p.saveStep3({ rotation: { value: 90 }, cmdline_video: true, cmdline_fbcon: false, cmdline_plymouth: true });
    assert.equal(env.p.config.get('cmdline_rotation.fbcon'), false);
    env.p.goBack();
    assert.equal(env.p.config.get('wizard_step'), 3);
    env.p.goBack();
    env.p.goBack();
    assert.equal(env.p.config.get('wizard_step'), 1);
    env.p.goBack();
    assert.equal(env.p.config.get('wizard_step'), 1, 'step 1 is the floor');
    env.p.config.set('wizard_step', 4);
    env.p.wizardStepCache = 4;
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step4_kms').hidden, false);
    assert.equal(uiItem(ui, 'section_step4_kms', 'kms_preset_hint').value, env.p.getI18n('KMS_HINT_PRESET_ON'));
    env.p.saveStep4({ kms_mode: { value: 'on' }, cma_option: { value: 'custom' }, cma_custom_mb: '300' });
    assert.equal(env.p.config.get('kms.cma_custom_mb'), 300);
    env.p.saveStep5({});
    assert.equal(env.p.config.get('ota_behavior'), 'notify');
    await env.p.applyConfiguration();
    const vc = H.readBoot('videoconfig.txt');
    assert.ok(/^dtoverlay=vc4-kms-v3d-pi4,cma-300$/m.test(vc), vc);
    assert.ok(/^hdmi_timings=320 0 80/m.test(vc));
    assert.ok(/^max_framebuffer_height=1480$/m.test(vc));
    assert.ok(/^hdmi_drive=1$/m.test(vc), 'screen only is DVI');
    assert.ok(/^hdmi_force_hotplug:1=1$/m.test(vc) && /^hdmi_drive:1=2$/m.test(vc), 'HDMI1 audio');
    assert.ok(/^config_hdmi_boost=3$/m.test(vc));
    const cmd = H.readBoot('cmdline.txt');
    assert.ok(/ video=HDMI-A-1:320x1480M@60,rotate=90/.test(cmd), cmd);
    assert.ok(/ plymouth=90/.test(cmd));
    assert.equal(/fbcon=rotate/.test(cmd), false, 'fbcon switched off in step 3');
    ui = await env.p.getUIConfig();
    assert.ok(/Rotation: 90/.test(uiItem(ui, 'section_current_config', 'current_summary').value));

    env.p.writeDiagnosticsReport();
    const report = fs.readFileSync('/tmp/pi-screen-setup-diagnostics.txt', 'utf8');
    assert.ok(/Pi 4B/.test(report), report.slice(0, 400));
    assert.ok(/waveshare-11.9-hdmi/.test(report));
    assert.ok(/vc4-kms-v3d-pi4/.test(report));
    assert.ok(env.lastToast().message.includes('/tmp/pi-screen-setup-diagnostics.txt'));
    await stop(env);

    H.seed({ board: 'pi4', overlays: ['present.dtbo'] });
    env = H.plugin({ lang: 'de' });
    await env.start();
    assert.notEqual(env.p.getI18n('PLUGIN_NAME'), 'PLUGIN_NAME');
    assert.notEqual(env.p.getI18n('REBOOT_REQUIRED'), env.context.coreCommand.strings('en').PI_SCREEN_SETUP.REBOOT_REQUIRED, 'German, not English');
    assert.equal(env.p.getI18n('NO_SUCH_KEY'), 'NO_SUCH_KEY');
    env.p.saveStep1({ primary_output: { value: 'dpi' } });
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step2_dpi').hidden, false);
    assert.ok(uiItem(ui, 'section_step2_dpi', 'dpi_overlay').options.some((o) => o.value === 'hyperpixel4'));
    env.p.saveStep2Dpi({ dpi_overlay: { value: 'hyperpixel4' }, dpi_custom_timing: '' });
    assert.equal(env.p.step2ShowAudioCache, true);
    env.p.saveStep2Audio({ audio_hdmi0_mode: { value: 'none' } });
    assert.equal(env.p.config.get('hdmi0.enabled'), false);
    env.p.saveStep1({ primary_output: { value: 'composite' } });
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step2_composite').hidden, false);
    assert.ok(uiItem(ui, 'section_step2_composite', 'composite_mode').options.some((o) => o.value === 'ntsc'));
    env.p.saveStep2Composite({ composite_mode: { value: 'ntsc' }, composite_aspect: { value: '16:9' } });
    assert.equal(env.p.config.get('wizard_step'), 3);
    env.p.saveStep1({ primary_output: { value: 'custom' } });
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step2_custom').hidden, false);
    env.p.saveStep2Custom({ custom_overlay_line: 'dtoverlay=absent,x=1' });
    assert.equal(env.lastToast().type, 'warning', 'an overlay that is not in /boot/overlays is pointed out');
    assert.ok(env.lastToast().message.includes('absent'));
    env.toasts.length = 0;
    env.p.saveStep2Custom({ custom_overlay_line: 'dtoverlay=present' });
    assert.equal(env.toasts.length, 0, 'an overlay that exists draws no warning');
    env.p.saveStep1({ primary_output: { value: 'headless' } });
    assert.equal(env.p.config.get('wizard_step'), 5, 'headless skips to the OTA step');
    env.p.saveStep2Headless({});
    assert.equal(env.p.config.get('wizard_step'), 5);
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step3_rotation').hidden, true);
    env.p.config.set('wizard_step', 3);
    env.p.wizardStepCache = 3;
    ui = await env.p.getUIConfig();
    assert.equal(uiSection(ui, 'section_step3_rotation').hidden, true, 'headless has nothing to rotate');
    await stop(env);

    // a board without HDMI audio to offer, and one without KMS: the steps that are skipped
    H.seed({ board: 'zero2w', kms: false });
    env = H.plugin();
    await env.start();
    env.p.hardwareInfo.hdmi_ports = 0;
    env.p.saveStep1({ primary_output: { value: 'dpi' } });
    env.p.saveStep2Dpi({ dpi_overlay: { value: 'hyperpixel4' } });
    assert.equal(env.p.config.get('wizard_step'), 3, 'no HDMI: no audio question');
    env.p.saveStep2Custom({ custom_overlay_line: '' });
    assert.equal(env.p.config.get('wizard_step'), 3);
    env.p.saveStep1({ primary_output: { value: 'dsi1' } });
    env.p.saveStep2Dsi({});
    assert.equal(env.p.config.get('wizard_step'), 3);
    env.p.saveStep3({ rotation: { value: 180 } });
    assert.equal(env.p.config.get('wizard_step'), 5, 'no KMS: no KMS step');
    env.p.goBack();
    assert.equal(env.p.config.get('wizard_step'), 3, 'and none on the way back');
    env.p.hardwareInfo = null;
    assert.deepEqual(env.p.getHardwareCapabilities().outputs, []);
    ui = await env.p.getUIConfig();
    assert.ok(ui.sections.length > 10, 'the UI builds from stored hardware facts when detection has not run');
    await stop(env);
});

test('an OS update is named as such; lines in userconfig.txt that act on the display are pointed out', async () => {
    H.seed({ board: 'pi5', os: '4.231', boot: { 'userconfig.txt': H.USERCONFIG + '\n#### Touch Display rotation setting below: do not alter ####\ndisplay_lcd_rotate=3\ndisplay_hdmi_rotate=3\n' } });
    let env = H.plugin();
    await env.start();
    await configure(env, { primary_output: 'dsi1', 'dsi1.enabled': true, 'dsi1.overlay': 'rpi-touch2-7inch', 'dsi1.rotation': 270, 'kms.cma_option': '128' });
    const meta = fs.readJsonSync(path.join(H.INTERNAL, 'backups', 'current', 'metadata.json'));
    assert.equal(meta.os_version, '4.231', 'the reference copies name the OS they were taken on');
    assert.deepEqual(env.p.lastBoot.conflicts.map((c) => c.code), ['LEGACY_ROTATE', 'LEGACY_ROTATE']);
    let ui = await env.p.getUIConfig();
    assert.ok(uiItem(ui, 'section_hardware_info', 'hw_effective').value.includes('display_lcd_rotate=3'), 'the hardware line says what else is there');
    env.p.writeDiagnosticsReport();
    assert.ok(/userconfig_conflicts.*display_lcd_rotate/.test(fs.readFileSync('/tmp/pi-screen-setup-diagnostics.txt', 'utf8')));
    await stop(env);

    // Volumio moves to 4.300 and rewrites its boot files
    fs.writeFileSync(path.join(H.ROOT, 'etc', 'os-release'), 'VOLUMIO_VERSION="4.300"\n');
    fs.writeFileSync(path.join(H.BOOT, 'config.txt'), H.osFile('config-4.231.txt'));
    fs.writeFileSync(path.join(H.BOOT, 'volumioconfig.txt'), H.osFile('volumioconfig-4.231.txt'));
    env = H.plugin();
    await env.start();
    assert.equal(env.p.driftKind, 'os-update');
    assert.deepEqual(env.p.driftOs, { from: '4.231', to: '4.300' });
    await waitFor(() => env.modal(), 'reboot modal');
    const toast = env.toasts.find((t) => t.type === 'warning');
    assert.ok(toast.message.includes('4.300'), toast.message);
    assert.equal(fs.readJsonSync(path.join(H.INTERNAL, 'backups', 'current', 'metadata.json')).os_version, '4.300', 'the new reference names the new OS');
    const rec = fs.readFileSync(path.join(H.INTERNAL, 'strip', 'volumioconfig.txt.original'), 'utf8');
    assert.equal(rec, H.osFile('volumioconfig-4.231.txt'), 'the strip record holds the file the update wrote');
    await stop(env);

    // the same files touched without an OS change: not an update
    fs.writeFileSync(path.join(H.BOOT, 'config.txt'), H.readBoot('config.txt') + '# a line\n');
    env = H.plugin();
    await env.start();
    assert.equal(env.p.driftKind, 'changed');
    await waitFor(() => env.modal(), 'reboot modal');
    assert.equal(env.toasts.find((t) => t.type === 'warning').message, env.p.getI18n('CONFIG_DRIFT_DETECTED'));
    await stop(env);
});

test('every function index.js defines was exercised by this file', () => {
    const missed = H.methods.filter((m) => !H.called.has(m));
    assert.deepEqual(missed, [], 'index.js functions never called by the end-to-end suite');
});
