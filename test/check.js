'use strict';
// Static checks for the plugin, run by `npm test` and by CI. Fails on the first
// class of error that would reach a user: a file that does not parse, a UI key
// with no translation, a language missing keys, a button naming a method that
// does not exist, a presets database that is invalid or differs between the copy
// players fetch and the copy that ships, an install script that does not end as
// the store requires.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repo = path.join(__dirname, '..');
const root = path.join(repo, 'plugin');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const json = (f) => JSON.parse(read(f));
let failures = 0;
const fail = (msg) => { failures += 1; console.error('FAIL ' + msg); };

const libDir = path.join(root, 'lib');
const libs = fs.existsSync(libDir) ? fs.readdirSync(libDir).filter((n) => n.endsWith('.js')).map((n) => 'lib/' + n) : [];
for (const f of ['index.js', ...libs]) {
    try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); }
    catch (e) { fail(f + ': ' + e.stderr.toString().trim()); }
}

const languages = fs.readdirSync(path.join(root, 'i18n')).filter((f) => /^strings_[a-z]{2}(_[A-Z]{2})?\.json$/.test(f));
for (const f of ['package.json', 'config.json', 'UIConfig.json', 'display_presets.json', ...languages.map((l) => 'i18n/' + l)]) {
    try { json(f); if (!read(f).endsWith('\n')) fail(f + ': no final newline'); } catch (e) { fail(f + ': ' + e.message); }
}

// Volumio offers these languages (volumio3-backend app/plugins/miscellanea/appearance/languages.json);
// a file for any other code is never loaded.
const VOLUMIO_LANGUAGES = new Set(['ca', 'cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'gr', 'hr', 'hu', 'it', 'ja', 'ko', 'lt', 'nl', 'no', 'pl', 'pt', 'ru', 'sk', 'sv', 'th', 'tr', 'ua', 'vi', 'zh', 'zh_TW']);
for (const f of languages) {
    const code = f.slice('strings_'.length, -'.json'.length);
    if (!VOLUMIO_LANGUAGES.has(code)) fail(f + ': Volumio has no language ' + code);
}

const pkg = json('package.json');
if (pkg.name !== 'pi_screen_setup') fail('package.json: name is ' + pkg.name + ', the store knows pi_screen_setup');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail('package.json: version ' + pkg.version + ' is not X.Y.Z');
for (const k of ['prettyName', 'plugin_type', 'icon', 'architectures', 'os', 'details', 'changelog']) {
    if (!pkg.volumio_info || !(k in pkg.volumio_info)) fail('package.json: volumio_info.' + k + ' missing');
}
if (pkg.volumio_info && pkg.volumio_info.plugin_type !== 'system_hardware') fail('package.json: plugin_type is not system_hardware');

// Translations live under one namespace, so the core's merge of plugin strings never
// drops them as duplicates of its own keys: every TRANSLATE.PI_SCREEN_SETUP.<KEY>
// in the UI is a key of strings_en.json's PI_SCREEN_SETUP object.
const NS = 'PI_SCREEN_SETUP';
const ui = json('UIConfig.json');
const enFile = json('i18n/strings_en.json');
if (!enFile[NS] || Object.keys(enFile).length !== 1) fail('strings_en.json: must hold exactly the ' + NS + ' namespace');
const en = enFile[NS] || {};
const idx = read('index.js');
const walk = (o, where) => {
    if (typeof o === 'string') {
        if (o.startsWith('TRANSLATE.')) {
            const key = o.slice('TRANSLATE.'.length);
            if (!key.startsWith(NS + '.') || !(key.slice(NS.length + 1) in en)) fail(where + ': unresolvable key ' + o);
        }
    } else if (o && typeof o === 'object') {
        Object.entries(o).forEach(([k, v]) => walk(v, where + '.' + k));
    }
};
walk(ui, 'UIConfig');

// Every button names a method the plugin defines, on its own endpoint.
// Volumio's UI takes onSave as "controller" and a button's onClick as "plugin"; both call the plugin.
// "openUrl" and "emit" are handled by the UI itself (Volumio2-UI plugin.component.js) and name no method.
const methods = new Set([...idx.matchAll(/^\w+\.prototype\.(\w+)\s*=/gm)].map((m) => m[1]));
const endpoint = 'system_hardware/' + pkg.name;
const checkCall = (call, where) => {
    if (!call) return;
    if (call.type === 'openUrl') { if (typeof call.url !== 'string') fail(where + ': openUrl without url'); return; }
    if (call.type === 'emit') { if (typeof call.message !== 'string') fail(where + ': emit without message'); return; }
    if (call.type !== 'controller' && call.type !== 'plugin') fail(where + ': type is ' + call.type);
    if (call.endpoint !== endpoint) fail(where + ': endpoint ' + call.endpoint + ' is not ' + endpoint);
    if (!methods.has(call.method)) fail(where + ': method ' + call.method + ' is not defined in index.js');
};
for (const s of ui.sections) {
    checkCall(s.onSave, 'UIConfig section ' + s.id + ' onSave');
    for (const id of (s.saveButton && s.saveButton.data) || []) {
        if (!s.content.find((c) => c.id === id)) fail(`UIConfig section ${s.id}: saveButton names missing field ${id}`);
    }
    for (const c of s.content || []) checkCall(c.onClick, `UIConfig section ${s.id} field ${c.id} onClick`);
}

// Strings the code asks for by name must exist too: getI18n('KEY').
for (const m of idx.matchAll(/\bgetI18n\(\s*'([A-Z][A-Z_0-9]+)'/g)) {
    if (!(m[1] in en)) fail('code uses missing string ' + m[1]);
}

// Every language carries every English key with the same placeholders, and nothing else.
const placeholders = (s) => (String(s).match(/\{\{?\w+\}?\}/g) || []).sort().join(',');
for (const f of languages) {
    const file = json('i18n/' + f);
    if (!file[NS] || Object.keys(file).length !== 1) { fail(f + ': must hold exactly the ' + NS + ' namespace'); continue; }
    const b = file[NS];
    for (const k of Object.keys(en)) {
        if (!(k in b)) fail(`${f}: missing ${k}`);
        else if (placeholders(en[k]) !== placeholders(b[k])) fail(`${f}: placeholders differ in ${k}`);
        else if (typeof b[k] !== 'string' || b[k].trim() === '') fail(`${f}: empty ${k}`);
    }
    for (const k of Object.keys(b)) if (!(k in en)) fail(`${f}: extra key ${k}`);
}

// The presets database: the copy players fetch from the repository root and the copy
// that ships in plugin/ are the same bytes; every preset has what the code reads.
const dbShipped = read('display_presets.json');
const dbRoot = fs.readFileSync(path.join(repo, 'display_presets.json'), 'utf8');
if (dbShipped !== dbRoot) fail('display_presets.json differs between the repository root and plugin/ (cp display_presets.json plugin/)');
const db = JSON.parse(dbShipped);
if (!/^\d+\.\d+\.\d+$/.test(String(db.version))) fail('display_presets.json: version ' + db.version + ' is not X.Y.Z');
if (!db.presets || typeof db.presets !== 'object') fail('display_presets.json: no presets object');
const TYPES = new Set(['hdmi', 'dsi', 'dpi', 'composite']);
for (const [id, p] of Object.entries(db.presets || {})) {
    if (id.startsWith('_comment')) { if (typeof p !== 'string') fail(`presets.${id}: a _comment entry must be a string`); continue; }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) fail(`presets.${id}: id not in [A-Za-z0-9._-]`);
    if (!p || typeof p !== 'object') { fail(`presets.${id}: not an object`); continue; }
    if (typeof p.name !== 'string' || !p.name.trim()) fail(`presets.${id}: no name`);
    if (!TYPES.has(p.type)) fail(`presets.${id}: type ${p.type}`);
    if (!p.config || typeof p.config !== 'object') fail(`presets.${id}: no config object`);
    for (const k of ['vc4_kms', 'emit_dsi_overlay', 'overlay_rotation_param']) {
        if (k in p && typeof p[k] !== 'boolean') fail(`presets.${id}: ${k} must be boolean`);
    }
}

// No preset is ever lost. Users' settings name these keys (hdmi0.display_preset,
// dsi0.overlay, dpi.overlay) and deployed players fetch this file: a key that
// disappears or changes type breaks a display that was working. The snapshot in
// test/db-keys.json grows through scripts/db-snapshot.js, in a diff somebody reads.
const snapshotFile = path.join(repo, 'test', 'db-keys.json');
if (!fs.existsSync(snapshotFile)) fail('test/db-keys.json missing (scripts/db-snapshot.js)');
else {
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8')).keys || {};
    for (const [id, type] of Object.entries(snapshot)) {
        if (!(id in (db.presets || {}))) fail(`presets.${id}: removed — presets are never removed; keep the row and mark it deprecated`);
        else if (db.presets[id].type !== type) fail(`presets.${id}: type changed from ${type} to ${db.presets[id].type}`);
    }
    for (const id of Object.keys(db.presets || {})) {
        if (!id.startsWith('_comment') && !(id in snapshot)) fail(`presets.${id}: new key not in test/db-keys.json — run scripts/db-snapshot.js and review the diff`);
    }
}

// The store's installer waits for these words.
if (!/^echo "plugininstallend"\s*$/m.test(read('install.sh'))) fail('install.sh does not end with echo "plugininstallend"');
if (!/^echo "pluginuninstallend"\s*$/m.test(read('uninstall.sh'))) fail('uninstall.sh does not end with echo "pluginuninstallend"');

// The one root helper: ships, is POSIX sh (Volumio runs the scripts with sh), and is
// what install.sh installs and names in sudoers; nothing else gets a grant.
const helper = 'scripts/pi-screen-setup-root.sh';
if (!fs.existsSync(path.join(root, helper))) fail(helper + ' missing');
else {
    if (!read(helper).startsWith('#!/bin/sh\n')) fail(helper + ': must start with #!/bin/sh');
    const inst = read('install.sh');
    if (!inst.includes('/usr/local/bin/pi-screen-setup-root')) fail('install.sh does not install the root helper');
    const grants = (inst.match(/^volumio ALL=.*$/gm) || []);
    if (grants.length !== 1 || !/NOPASSWD: \/usr\/local\/bin\/pi-screen-setup-root \*$/.test(grants[0])) fail('install.sh: sudoers must grant the root helper alone, got ' + JSON.stringify(grants));
    if (/\bsudo\b/.test(read('uninstall.sh'))) fail('uninstall.sh runs as root; it must not call sudo');
}

// Volumio copies the shipped config.json to /data/configuration as it is; v-conf reads
// only { type, value } leaves. A raw value there is a setting the plugin can never store.
const conf = require(path.join(root, 'lib', 'conf.js'));
if (!conf.isNormalized(json('config.json'))) fail('config.json: not in the v-conf shape ({ type, value } leaves)');

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('check: ok');
