'use strict';
// A Volumio-shaped environment for the plugin, end to end: a relocated root with the
// boot files of a Volumio release, a /proc and /sys that describe one board and what
// its kernel shows, the plugin's configuration file seeded the way Volumio's plugin
// manager seeds it (a verbatim copy of the shipped file), the real v-conf, and a
// command router that records toasts, modals and UI pushes. Every prototype method
// of the plugin is wrapped so a test can assert that none went unexercised.
//
// PI_SCREEN_SETUP_ROOT is fixed per process: index.js reads it when it is required,
// so this module sets it before the first require and `seed()` empties and rebuilds
// the same tree for each scenario.

const os = require('os');
const path = require('path');
const PLUGIN_DIR = path.resolve(__dirname, '..', 'plugin');
const fs = require(path.join(PLUGIN_DIR, 'node_modules', 'fs-extra'));

if (!process.env.PI_SCREEN_SETUP_ROOT) {
    process.env.PI_SCREEN_SETUP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'pi_screen_setup-'));
}
const ROOT = process.env.PI_SCREEN_SETUP_ROOT;
const FIXTURES = path.join(__dirname, 'fixtures');
const libQ = require(path.join(PLUGIN_DIR, 'node_modules', 'kew'));
const PiScreenSetup = require(path.join(PLUGIN_DIR, 'index.js'));

const PLUGIN_DATA = path.join(ROOT, 'data', 'plugins', 'system_hardware', 'pi_screen_setup');
const CONFIG_DIR = path.join(ROOT, 'data', 'configuration', 'system_hardware', 'pi_screen_setup');
const BOOT = path.join(ROOT, 'boot');

// The boards the tests run on; the revision code drives everything in lib/board.js.
const BOARDS = {
    pi5: { revision: 'e04171', model: 'Raspberry Pi 5 Model B Rev 1.1', compatible: ['raspberrypi,5-model-b', 'brcm,bcm2712'], memKb: 16388900, cmaKb: 131072, connectors: { 'card1-DSI-2': { status: 'connected', enabled: 'enabled', modes: '720x1280' }, 'card1-HDMI-A-1': { status: 'disconnected', enabled: 'disabled', modes: '' }, 'card1-HDMI-A-2': { status: 'disconnected', enabled: 'disabled', modes: '' } } },
    pi4: { revision: 'c03111', model: 'Raspberry Pi 4 Model B Rev 1.1', compatible: ['raspberrypi,4-model-b', 'brcm,bcm2711'], memKb: 3884800, cmaKb: 520192, connectors: { 'card1-HDMI-A-1': { status: 'connected', enabled: 'enabled', modes: '1920x1080' }, 'card1-HDMI-A-2': { status: 'disconnected', enabled: 'disabled', modes: '' } } },
    pi3bplus: { revision: 'a020d3', model: 'Raspberry Pi 3 Model B Plus Rev 1.3', compatible: ['raspberrypi,3-model-b-plus', 'brcm,bcm2837'], memKb: 945000, cmaKb: 131072, connectors: { 'card1-HDMI-A-1': { status: 'connected', enabled: 'enabled', modes: '1920x1080' } } },
    zero2w: { revision: '902120', model: 'Raspberry Pi Zero 2 W Rev 1.0', compatible: ['raspberrypi,model-zero-2-w', 'brcm,bcm2837'], memKb: 433000, cmaKb: 0, connectors: {} },
};

const CMDLINE = 'splash plymouth.ignore-serial-consoles dwc_otg.fiq_enable=1 dwc_otg.fiq_fsm_enable=1 dwc_otg.fiq_fsm_mask=0xF dwc_otg.nak_holdoff=1 quiet console=serial0,115200 console=tty1 imgpart=UUID=b35e75b2-30a3-4ee6-a74f-e6b8aa5962f2 imgfile=/volumio_current.sqsh bootpart=UUID=FD65-DD2F datapart=UUID=65af2384-fa72-4c86-b734-c0408cf339cf uuidconfig=cmdline.txt rootwait bootdelay=7 logo.nologo vt.global_cursor_default=0 net.ifnames=0 snd_bcm2835.enable_hdmi=1 snd_bcm2835.enable_headphones=1 loglevel=0 nodebug use_kmsg=no';
const USERCONFIG = '# Add your custom config.txt options to this file, which will be preserved during updates\n';

const osFile = (name) => fs.readFileSync(path.join(FIXTURES, 'os', name), 'utf8');

// Builds the tree for one scenario. Everything has a default; `opts` overrides:
//   board: key of BOARDS            os: Volumio release of the boot files ('4.231')
//   config: 'shipped' | 'raw' | object | null   (the plugin's configuration file)
//   boot: { 'videoconfig.txt': text, ... }      (replaces or, with null, removes a file)
//   current: { files: {name: text}, metadata }  (backups/current, as after an apply)
//   factory: false                              (install.sh's factory copies; default on)
//   kms: false                                  (no vc4 in /sys: driver not up)
//   overlays: ['name.dtbo']                     (files present in /boot/overlays)
function seed(opts) {
    opts = opts || {};
    const board = BOARDS[opts.board || 'pi5'];
    const release = opts.os || '4.231';
    fs.emptyDirSync(ROOT);

    // /boot
    fs.ensureDirSync(path.join(BOOT, 'overlays'));
    const boot = Object.assign({
        'config.txt': osFile('config-' + release + '.txt'),
        'volumioconfig.txt': osFile('volumioconfig-' + release + '.txt'),
        'userconfig.txt': USERCONFIG,
        'cmdline.txt': CMDLINE,
    }, opts.boot || {});
    Object.keys(boot).forEach((name) => { if (boot[name] !== null) fs.writeFileSync(path.join(BOOT, name), boot[name]); });
    fs.writeFileSync(path.join(BOOT, 'overlays', 'README'), '## Overlays\n');
    (opts.overlays || ['vc4-kms-v3d.dtbo', 'vc4-kms-v3d-pi5.dtbo', 'vc4-kms-dsi-7inch.dtbo']).forEach((n) => fs.writeFileSync(path.join(BOOT, 'overlays', n), ''));

    // /proc
    const proc = path.join(ROOT, 'proc');
    fs.ensureDirSync(path.join(proc, 'device-tree'));
    fs.writeFileSync(path.join(proc, 'cpuinfo'), 'processor\t: 0\nmodel name\t: ARMv7 Processor rev 4 (v7l)\n\nHardware\t: BCM2835\nRevision\t: ' + board.revision + '\nSerial\t\t: 10000000a1b2c3d4\nModel\t\t: ' + board.model + '\n');
    fs.writeFileSync(path.join(proc, 'device-tree', 'model'), board.model + '\0');
    fs.writeFileSync(path.join(proc, 'device-tree', 'compatible'), board.compatible.join('\0') + '\0');
    fs.writeFileSync(path.join(proc, 'device-tree', 'serial-number'), '10000000a1b2c3d4\0');
    fs.writeFileSync(path.join(proc, 'meminfo'), 'MemTotal:       ' + board.memKb + ' kB\nMemFree:        ' + Math.floor(board.memKb / 2) + ' kB\nCmaTotal:       ' + board.cmaKb + ' kB\nCmaFree:        ' + Math.floor(board.cmaKb / 2) + ' kB\n');
    fs.writeFileSync(path.join(proc, 'cmdline'), (opts.procCmdline || boot['cmdline.txt'] || CMDLINE) + '\n');

    // /sys: the driver and the connectors the kernel shows
    if (opts.kms !== false) {
        fs.ensureDirSync(path.join(ROOT, 'sys', 'module', 'vc4'));
        fs.writeFileSync(path.join(ROOT, 'sys', 'module', 'vc4', 'initstate'), 'live\n');
        fs.ensureDirSync(path.join(ROOT, 'sys', 'bus', 'platform', 'drivers', 'vc4-drm', 'axi:gpu'));
        Object.keys(board.connectors).forEach((name) => {
            const dir = path.join(ROOT, 'sys', 'class', 'drm', name);
            fs.ensureDirSync(dir);
            const c = board.connectors[name];
            fs.writeFileSync(path.join(dir, 'status'), c.status + '\n');
            fs.writeFileSync(path.join(dir, 'enabled'), c.enabled + '\n');
            fs.writeFileSync(path.join(dir, 'modes'), c.modes ? c.modes + '\n' : '');
        });
    }

    // /data: what install.sh and the plugin manager leave behind
    fs.ensureDirSync(path.join(PLUGIN_DATA, 'backups', 'restore_points'));
    fs.ensureDirSync(path.join(PLUGIN_DATA, 'backups', 'factory'));
    fs.ensureDirSync(path.join(PLUGIN_DATA, 'presets_cache'));
    if (opts.factory !== false) {
        ['config.txt', 'cmdline.txt', 'volumioconfig.txt', 'userconfig.txt'].forEach((n) => {
            if (fs.existsSync(path.join(BOOT, n))) fs.copySync(path.join(BOOT, n), path.join(PLUGIN_DATA, 'backups', 'factory', n));
        });
    }
    if (opts.current) {
        const cur = path.join(PLUGIN_DATA, 'backups', 'current');
        fs.ensureDirSync(cur);
        Object.keys(opts.current.files || {}).forEach((n) => fs.writeFileSync(path.join(cur, n), opts.current.files[n]));
        if (opts.current.metadata) fs.writeJsonSync(path.join(cur, 'metadata.json'), opts.current.metadata);
    }
    fs.ensureDirSync(CONFIG_DIR);
    const configFile = path.join(CONFIG_DIR, 'config.json');
    const config = opts.config === undefined ? 'shipped' : opts.config;
    if (config === 'shipped') fs.copySync(path.join(PLUGIN_DIR, 'config.json'), configFile);
    else if (config === 'raw') fs.copySync(path.join(FIXTURES, 'config', 'raw-0.6.2.json'), configFile);
    else if (config) fs.writeJsonSync(configFile, config);
    // The shipped file points the update check at GitHub; tests stay on this machine.
    if (config && fs.existsSync(configFile)) {
        const doc = fs.readJsonSync(configFile);
        const setLeaf = (obj, key, value) => { if (obj[key] && typeof obj[key] === 'object' && 'value' in obj[key]) obj[key].value = value; else obj[key] = value; };
        if (doc.database) {
            setLeaf(doc.database, 'auto_check', opts.autoCheck === true);
            if (opts.remoteUrl) setLeaf(doc.database, 'remote_url', opts.remoteUrl);
        }
        fs.writeJsonSync(configFile, doc);
    }
    return { root: ROOT, boot: BOOT, data: PLUGIN_DATA, configFile };
}

// Volumio's command router, reduced to what the plugin calls.
function makeContext(lang) {
    const toasts = [];
    const broadcasts = [];
    const logs = [];
    const strings = (code) => { try { return fs.readJsonSync(path.join(PLUGIN_DIR, 'i18n', 'strings_' + code + '.json')); } catch (e) { return null; } };
    const translate = (parent, dict, def) => {
        Object.keys(parent).forEach((k) => {
            const v = parent[k];
            if (v && typeof v === 'object') translate(v, dict, def);
            else if (typeof v === 'string' && v.startsWith('TRANSLATE.')) {
                const key = v.slice('TRANSLATE.'.length);
                const dot = key.indexOf('.');
                const cat = key.slice(0, dot);
                const name = key.slice(dot + 1);
                parent[k] = (dict[cat] && dict[cat][name] !== undefined) ? dict[cat][name] : def[cat][name];
            }
        });
    };
    const coreCommand = {
        pushToastMessage(type, title, message) { toasts.push({ type, title, message }); },
        broadcastMessage(event, data) { broadcasts.push({ event, data }); },
        sharedVars: { get(k) { return k === 'language_code' ? (lang || 'en') : (k === 'system.name' ? 'hanger' : undefined); } },
        i18nJson(dictFile, defaultFile, jsonFile) {
            try {
                const dict = fs.existsSync(dictFile) ? fs.readJsonSync(dictFile) : fs.readJsonSync(defaultFile);
                const def = fs.readJsonSync(defaultFile);
                const doc = fs.readJsonSync(jsonFile);
                translate(doc, dict, def);
                return libQ.resolve(doc);
            } catch (e) { return libQ.reject(e); }
        },
        pluginManager: { getConfigurationFile(context, name) { return path.join(CONFIG_DIR, name); } },
        getI18nString(k) { return k; },
        strings,
    };
    const logger = {
        info(m) { logs.push(['info', String(m)]); },
        warn(m) { logs.push(['warn', String(m)]); },
        error(m) { logs.push(['error', String(m)]); },
    };
    return { context: { coreCommand, logger, configManager: {} }, toasts, broadcasts, logs };
}

// Every prototype method, wrapped once to record that it ran.
const called = new Set();
const methods = Object.getOwnPropertyNames(PiScreenSetup.prototype).filter((n) => n !== 'constructor' && typeof PiScreenSetup.prototype[n] === 'function');
methods.forEach((name) => {
    const original = PiScreenSetup.prototype[name];
    PiScreenSetup.prototype[name] = function () { called.add(name); return original.apply(this, arguments); };
});

function plugin(opts) {
    opts = opts || {};
    const env = makeContext(opts.lang);
    const p = new PiScreenSetup(env.context);
    p.MANAGEMENT_PORT = 0;
    return Object.assign({ p }, env, {
        async start() { await p.onVolumioStart(); await p.onStart(); return p; },
        port() { return p.expressServer && p.expressServer.address() ? p.expressServer.address().port : null; },
        lastToast() { return env.toasts[env.toasts.length - 1] || null; },
        modal() { return env.broadcasts.filter((b) => b.event === 'openModal').pop() || null; },
        pushes() { return env.broadcasts.filter((b) => b.event === 'pushUiConfig'); },
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The migration handlers defer refreshUIConfig by 100 ms, which defers the push by another 100 ms.
const settle = () => sleep(320);
const readBoot = (name) => fs.readFileSync(path.join(BOOT, name), 'utf8');
const readConfigFile = () => fs.readJsonSync(path.join(CONFIG_DIR, 'config.json'));

module.exports = { ROOT, BOOT, PLUGIN_DATA, CONFIG_DIR, PLUGIN_DIR, BOARDS, CMDLINE, USERCONFIG, osFile, seed, plugin, makeContext, called, methods, sleep, settle, readBoot, readConfigFile, PiScreenSetup, fs };
