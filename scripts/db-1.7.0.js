'use strict';
// display_presets.json 1.6.0 -> 1.7.0, schema 2. Every field added here is optional
// and unknown to releases before 1.0, which keep reading name/type/config as before.
// Lines are not changed; what changes is what the database knows about them:
//   rotation_param   from the kernel's overlay README (test/overlay-tokens.json)
//   requires_overlay the overlays a row uses that the kernel does not carry
//   provenance       the vendor page already named in the notes, else "community"
//   aliases          the other product names found by the survey for the same lines
//   boards           panels that exist for one board family only
// plus the Waveshare 10.1" DSI LCD (E) rows, which need a kernel the plugin can see is
// not there yet (min_kernel).
const fs = require('fs');
const path = require('path');
const presets = require('../plugin/lib/presets');

const repo = path.resolve(__dirname, '..');
const file = path.join(repo, 'display_presets.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const tokens = JSON.parse(fs.readFileSync(path.join(repo, 'test', 'overlay-tokens.json'), 'utf8')).overlays;
let P = db.presets;
if (db.version !== '1.6.0') throw new Error('expected 1.6.0, found ' + db.version);

const rows = () => Object.keys(P).filter(presets.isPresetKey);
const base = (p) => (p.config && p.config.dtoverlay ? String(p.config.dtoverlay).split(',')[0] : null);

// ---- rotation_param and requires_overlay, from the kernel list ---------------------
rows().forEach((k) => {
    const p = P[k];
    if (p.type !== 'dsi' && p.type !== 'dpi') return;
    const b = base(p);
    const t = b && tokens[b];
    if (p.type === 'dsi') p.rotation_param = t && t.indexOf('rotation') !== -1 ? 'rotation' : null;
    else p.rotation_param = t && t.indexOf('rotate') !== -1 ? 'rotate' : null;
    if (p.rotation_param === 'rotation') p.overlay_rotation_param = true;
    else if ('overlay_rotation_param' in p) p.overlay_rotation_param = false;
    const missing = [];
    Object.keys(p.config).filter((c) => /^dtoverlay(_\d+)?$/.test(c)).forEach((c) => {
        const name = String(p.config[c]).split(',')[0];
        if (!tokens[name] && missing.indexOf(name) === -1) missing.push(name);
    });
    if (missing.length) p.requires_overlay = missing;
});

// ---- provenance ------------------------------------------------------------------------
const SOURCES = [
    [/waveshare\.com\/wiki\/([^\s,;)]+)/, (m) => 'https://www.waveshare.com/wiki/' + m[1]],
    [/lcdwiki\.com/, () => 'vendor'],
    [/elecrow\.com/, () => 'vendor'],
    [/wiki\.luckfox\.com[^\s,;)]*/, (m) => 'https://wiki.luckfox.com/Display/7inch-HD-Touchscreen'],
    [/wiki\.52pi\.com/, () => 'vendor'],
    [/raspberrypi\.com\/documentation/, () => 'https://www.raspberrypi.com/documentation/accessories/touch-display-2.html'],
    [/learn\.adafruit\.com/, () => 'https://learn.adafruit.com/adafruit-dpi-display-kippah-ttl-tft/'],
    [/Kernel overlays README/, () => 'https://github.com/raspberrypi/linux/blob/rpi-6.12.y/arch/arm/boot/dts/overlays/README'],
];
rows().forEach((k) => {
    const p = P[k];
    const notes = p.notes || '';
    for (const [re, url] of SOURCES) {
        const m = notes.match(re);
        if (m) { p.provenance = url(m); return; }
    }
    p.provenance = 'community';
});
// Verified against the vendor in the survey (gap analysis: DB-OK)
['btt-hdmi5-v1.0', 'btt-hdmi7-v1.0', 'btt-hdmi7-v1.2'].forEach((k) => { P[k].provenance = 'vendor'; });
P['waveshare-dsi-7.0c'].provenance = 'https://www.waveshare.com/wiki/7inch_DSI_LCD_(C)';
P['rpi-touch-7inch'].provenance = 'https://www.raspberrypi.com/documentation/accessories/display.html';
P['rpi-touch2-7inch'].provenance = 'https://www.raspberrypi.com/documentation/accessories/touch-display-2.html';
P['rpi-touch2-5inch'].provenance = 'https://www.raspberrypi.com/documentation/accessories/touch-display-2.html';

// ---- aliases: the same lines under another product name (survey, 2026-11-02) ------
const ALIASES = {
    'rpi-touch-7inch': ['Waveshare 43H-800480-IPS-CT', 'Waveshare 50H-800480-IPS-CT', 'Waveshare CM4-DISP-BASE-5A', 'Waveshare CM4-DISP-BASE-7A-BOX', 'Luckfox 4.3-DSI-Touchscreen', 'Luckfox 5-DSI-Touchscreen', 'Luckfox 7-DSI-Touchscreen', 'OSOYOO DSI 5 inch (v1.1, v2.0, v2.1)', 'DFRobot DFR0550-V2 5" DSI', 'DFRobot DFR0678 7" DSI'],
    'rpi-touch2-7inch': ['Pollin 811844 7" 720x1280 DSI', 'Joy-IT RB-LCD-7V2-Case', 'Seeed 104990902'],
    'rpi-touch2-5inch': ['Waveshare 5inch Touch Display 2 class (720x1280)'],
    'waveshare-dsi-5.0c-800x480': ['Spotpear 5inch-DSI-LCD-(C)'],
    'waveshare-dsi-8.8': ['Spotpear 8.8inch DSI LCD'],
    'waveshare-dsi-3.5e': ['Spotpear 3.5inch DSI LCD (E)'],
    'waveshare-dsi-10.1': ['Waveshare RPI-HMI-080D-101D'],
    'waveshare-dsi-v2-7.0a': ['Waveshare RPI-HMI-7A', 'Luckfox 7-DSI-TOUCH-A'],
    'waveshare-dsi-v2-8.0a': ['Luckfox 8-DSI-TOUCH-A'],
    'waveshare-dsi-v2-9.0b': ['Luckfox 9-DSI-TOUCH-B'],
    'waveshare-dsi-v2-10.1a': ['Luckfox 10.1-DSI-TOUCH-A'],
    'waveshare-dsi-v2-10.1b': ['Luckfox 10.1-DSI-TOUCH-B'],
    'waveshare-dsi-v2-7.0c': ['Waveshare 7-DSI-TOUCH-C'],
    'waveshare-dsi-v2-12.3a-4lane': ['Waveshare 12.3-DSI-TOUCH-A'],
    'waveshare-5-hdmi-b': ['Seeed 114990834', 'Joy-IT 5 Inch HDMI LCD V2 (RB-LCD-5)', 'Pollin 810817'],
    'waveshare-10.1-hdmi-b': ['Seeed 114990836', 'Waveshare 7EP-CAPLCD', 'Waveshare 8DP-CAPLCD', 'Waveshare 8HP-CAPLCD Monitor', 'Waveshare 10.1DP-CAPLCD', 'Waveshare 10.1HP-CAPLCD Monitor'],
    'waveshare-7-hdmi-c': ['Waveshare 70H-1024600'],
    'waveshare-15.6-hdmi': ['Waveshare 15.6inch HDMI LCD (H)', 'Waveshare 15.6HP-CAPQLED'],
    'waveshare-8.8-hdmi': ['Waveshare 8.8inch Side Monitor'],
    'waveshare-8-768x1024-hdmi': ['Waveshare 9.7inch 768x1024 LCD'],
    'waveshare-9hp-capqled': ['Waveshare 10.1HP-CAPQLED'],
    'waveshare-12.3-hdmi': ['Waveshare 12.3inch 1920x720 LCD'],
    'waveshare-4-720x720-hdmi': ['Spotpear 4inch-720x720 round HDMI'],
    'waveshare-3.5-480x800-hdmi': ['Spotpear 3.5inch 480x800 HDMI'],
    'elecrow-5-hdmi': ['Elecrow RPA05010R', 'Elecrow RC050'],
    'elecrow-7-hdmi': ['Elecrow RPD10246D'],
    'lcdwiki-3.5-hdmi': ['LCDwiki MPI3508 3.5inch HDMI Display-B'],
    'lcdwiki-7-hdmi-b': ['LCDwiki MPI7001'],
    'lcdwiki-5-hdmi': ['LCDwiki MPI5008', 'Hosyond MPI5001'],
    'lcdwiki-7-hdmi-c': ['LCDwiki MPI7002'],
    'geeekpi-5-hdmi': ['52Pi EP-0081'],
};
Object.keys(ALIASES).forEach((k) => {
    if (!P[k]) throw new Error('alias target missing: ' + k);
    P[k].aliases = ALIASES[k];
});

// ---- boards: panels for one board family ------------------------------------------
P['rpi-touch2-10inch'].boards = ['pi5', 'cm5', 'cm4'];
P['waveshare-dsi-v2-7.0c'].boards = ['pi5', 'cm5'];
P['waveshare-dsi-v2-12.3a-4lane'].boards = ['pi5', 'cm5'];
rows().filter((k) => /4lane$/.test(k) || /13_3_inch_4lane/.test(String((P[k].config || {}).dtoverlay))).forEach((k) => { if (!P[k].boards) P[k].boards = ['pi5', 'cm4', 'cm5']; });
['jdi-lt070me05000', 'jdi-lt070me05000-v2'].forEach((k) => { P[k].boards = ['cm3', 'cm4', 'cm5']; });

// ---- Waveshare 10.1inch DSI LCD (E): in-tree token from kernel 6.18.55 (journal P5) ----
function insertAfter(markerKey, add) {
    const out = {};
    let placed = false;
    Object.keys(P).forEach((key) => { out[key] = P[key]; if (key === markerKey) { Object.assign(out, add); placed = true; } });
    if (!placed) throw new Error('no marker ' + markerKey);
    db.presets = out; P = out;
}
insertAfter('_comment_dsi_waveshare_std', {
    'waveshare-dsi-10.1e-2lane': {
        name: 'Waveshare 10.1" DSI LCD (E) 2-lane (1920x1200)',
        type: 'dsi',
        description: 'Waveshare 10.1-inch DSI LCD (E), 1920x1200, two-lane cable for Pi 4B / 3B+ / 3A+',
        native_resolution: '1920x1200',
        config: { dtoverlay: 'vc4-kms-dsi-waveshare-panel,10_1_inchE_2lane' },
        recommended_rotation: 0,
        overlay_rotation_param: true,
        rotation_param: 'rotation',
        min_kernel: '6.18.55',
        provenance: 'https://www.waveshare.com/wiki/10.1inch_DSI_LCD_(E)',
        aliases: ['Spotpear 10.1inch DSI LCD (E) 2-lane'],
        notes: 'The 10_1_inchE tokens enter the kernel at 6.18.55 (vendor: rpi-update pulls/7662); on an older kernel the plugin says so and the line does nothing',
    },
    'waveshare-dsi-10.1e-4lane': {
        name: 'Waveshare 10.1" DSI LCD (E) 4-lane (1920x1200)',
        type: 'dsi',
        description: 'Waveshare 10.1-inch DSI LCD (E), 1920x1200, four-lane cable for Pi 5 / CM4 / CM5',
        native_resolution: '1920x1200',
        config: { dtoverlay: 'vc4-kms-dsi-waveshare-panel,10_1_inchE_4lane' },
        recommended_rotation: 0,
        overlay_rotation_param: true,
        rotation_param: 'rotation',
        min_kernel: '6.18.55',
        boards: ['pi5', 'cm4', 'cm5'],
        provenance: 'https://www.waveshare.com/wiki/10.1inch_DSI_LCD_(E)',
        aliases: ['Spotpear 10.1inch DSI LCD (E) 4-lane'],
        notes: 'The 10_1_inchE tokens enter the kernel at 6.18.55 (vendor: rpi-update pulls/7662); on an older kernel the plugin says so and the line does nothing',
    },
});

db.schema = 2;
db.version = '1.7.0';
db.last_updated = '2026-11-02';
const ordered = { schema: db.schema, version: db.version, last_updated: db.last_updated, presets: db.presets };
const errors = presets.validate(ordered, tokens);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
const text = JSON.stringify(ordered, null, 2) + '\n';
fs.writeFileSync(file, text);
fs.writeFileSync(path.join(repo, 'plugin', 'display_presets.json'), text);
console.log('1.7.0 schema 2:', presets.count(P), 'presets,', presets.nameCount(P), 'names,', rows().filter((k) => P[k].requires_overlay).length, 'rows needing a vendor overlay');
