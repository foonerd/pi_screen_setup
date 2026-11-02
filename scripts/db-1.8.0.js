'use strict';
// display_presets.json 1.7.0 -> 1.8.0: generic HDMI rows by resolution for the panel
// sizes the survey met without vendor lines (plug-and-play by EDID, or no lines
// published): a wide 1520x720, WUXGA 1920x1200, and the two portrait sizes. Nothing
// else changes. Under KMS the plugin turns hdmi_cvt into the kernel's mode (lib/hdmi).
const fs = require('fs');
const path = require('path');
const presets = require('../plugin/lib/presets');

const repo = path.resolve(__dirname, '..');
const file = path.join(repo, 'display_presets.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const tokens = JSON.parse(fs.readFileSync(path.join(repo, 'test', 'overlay-tokens.json'), 'utf8')).overlays;
if (db.version !== '1.7.0') throw new Error('expected 1.7.0, found ' + db.version);

const generic = (w, h, aspect, description, notes) => ({
    name: 'Generic ' + w + 'x' + h + ' HDMI',
    type: 'hdmi',
    description,
    native_resolution: w + 'x' + h,
    config: { hdmi_group: 2, hdmi_mode: 87, hdmi_cvt: w + ' ' + h + ' 60 ' + aspect + ' 0 0 0' },
    recommended_rotation: 0,
    notes,
    provenance: 'community',
});

const added = {
    'generic-1520x720': generic(1520, 720, 7, 'Wide 10.1" bars (Elecrow DLH61101B and similar)', 'CVT 1520x720@60; 21:9 class panel'),
    'generic-1920x1200': generic(1920, 1200, 5, 'WUXGA 10.1"-16" panels (UPERFECT UPi B7 class) when the panel\'s EDID is not read', 'CVT 1920x1200@60; prefer Auto Detect when the panel has a working EDID'),
    'generic-720x1280': generic(720, 1280, 3, 'Portrait 5"-7" panels without vendor lines', 'CVT 720x1280@60; rotate in the plugin for landscape use'),
    'generic-1080x1920': generic(1080, 1920, 3, 'Portrait FHD panels without vendor lines', 'CVT 1080x1920@60; rotate in the plugin for landscape use'),
};

// Insert after generic-1366x768, keeping the file's order readable
const out = {};
Object.keys(db.presets).forEach((k) => {
    out[k] = db.presets[k];
    if (k === 'generic-1366x768') Object.keys(added).forEach((a) => { if (db.presets[a]) throw new Error(a + ' exists'); out[a] = added[a]; });
});
db.presets = out;

db.version = '1.8.0';
db.last_updated = '2026-11-02';
const ordered = { schema: db.schema, version: db.version, last_updated: db.last_updated, presets: db.presets };
const errors = presets.validate(ordered, tokens);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
const text = JSON.stringify(ordered, null, 2) + '\n';
fs.writeFileSync(file, text);
fs.writeFileSync(path.join(repo, 'plugin', 'display_presets.json'), text);
console.log('1.8.0:', presets.count(db.presets), 'presets,', presets.nameCount(db.presets), 'names');
