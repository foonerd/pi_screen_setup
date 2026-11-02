'use strict';
// display_presets.json 1.5.9 -> 1.6.0: the content update for deployed plugins (schema
// unchanged: the fields 0.8.x reads, nothing new). Corrections are in place where the old
// configuration cannot have worked for the named product (journal P10); every new row
// carries the vendor's own lines. Sources: journal research/*.md (2026-11-02) and the
// Waveshare wiki pages named in the notes.
const fs = require('fs');
const path = require('path');
const repo = path.resolve(__dirname, '..');
const file = path.join(repo, 'display_presets.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
let P = db.presets;
if (db.version !== '1.5.9') throw new Error('expected 1.5.9, found ' + db.version);

function hdmi(name, description, res, config, extra) {
    return Object.assign({ name, type: 'hdmi', description, native_resolution: res, config, recommended_rotation: 0 }, extra || {});
}
const cvt = (w, h, more) => Object.assign({ hdmi_group: 2, hdmi_mode: 87, hdmi_cvt: w + ' ' + h + ' 60 6 0 0 0' }, more || {});
const timings = (t, more) => Object.assign({ hdmi_group: 2, hdmi_mode: 87, hdmi_timings: t }, more || {});

// ---- corrections in place -------------------------------------------------------------
Object.assign(P['waveshare-dsi-5.0c-800x480'], {
    name: 'Waveshare 5" DSI LCD (C) (1024x600)',
    description: 'Waveshare 5-inch DSI LCD (C), IPS 1024x600, five-point capacitive touch',
    native_resolution: '1024x600',
    config: { dtoverlay: 'vc4-kms-dsi-waveshare-panel,7_0_inchC' },
    overlay_rotation_param: true,
    notes: 'Corrected in 1.6.0: the panel is 1024x600 and uses the 7_0_inchC token (waveshare.com/wiki/5inch_DSI_LCD_(C), oldid 109355); earlier entries said 800x480 with the official 7-inch overlay, which cannot drive this panel',
});
Object.assign(P['waveshare-dsi-5.0d-800x480'], {
    name: 'Waveshare 5" DSI LCD (D) (720x1280)',
    description: 'Waveshare 5-inch DSI LCD (D), IPS 720x1280 portrait, optical bonding, five-point capacitive touch',
    native_resolution: '720x1280',
    config: { dtoverlay: 'vc4-kms-dsi-waveshare-panel,5_0_inch' },
    overlay_rotation_param: true,
    notes: 'Corrected in 1.6.0: the panel is 720x1280 and uses the 5_0_inch token (waveshare.com/wiki/5inch_DSI_LCD_(D), oldid 109352); earlier entries said 800x480 with the official 7-inch overlay, which cannot drive this panel',
});
Object.assign(P['waveshare-dsi-7.0c'], {
    config: { dtoverlay: 'vc4-kms-dsi-waveshare-panel,7_0_inchC,i2c1' },
    notes: 'Touch is wired to I2C1 through the 4-pin cable (waveshare.com/wiki/7inch_DSI_LCD_(C)); the kernel overlay defaults to I2C0, so the i2c1 parameter is required. With the 0 ohm resistor moved to I2C0, remove ,i2c1 in the custom parameters. Corrected in 1.6.0',
});
Object.assign(P['hosyond-10.1-hdmi-h'], {
    config: { hdmi_group: 2, hdmi_mode: 87, hdmi_timings: '1024 1 50 18 50 600 1 15 3 15 0 0 0 60 0 40000000 3', config_hdmi_boost: 7 },
    video_mode: '1024x600M@60',
    notes: 'Touch via USB. OSD controls. External 12V power recommended. Vendor timings (Hosyond MPI1001 page on lcdwiki.com) replace the CVT line in 1.6.0',
});

// ---- new rows, inserted after a section marker -------------------------------------
function insertAfter(markerKey, rows) {
    const out = {};
    let placed = false;
    for (const key of Object.keys(P)) {
        out[key] = P[key];
        if (key === markerKey) { Object.keys(rows).forEach((k) => { if (P[k]) throw new Error('exists: ' + k); out[k] = rows[k]; }); placed = true; }
    }
    if (!placed) throw new Error('no marker ' + markerKey);
    db.presets = out;
    P = out;
}

// Same vendor, same lines, another product name: the existing row names it too (an
// alias once the schema has them); the product number goes into the description.
function alsoKnownAs(key, model) {
    if (!P[key]) throw new Error('missing ' + key);
    if (P[key].description.indexOf(model) === -1) P[key].description += ' (also ' + model + ')';
}
alsoKnownAs('elecrow-7-hdmi', 'RPD10246D');
alsoKnownAs('lcdwiki-3.5-hdmi', 'MPI3508 "3.5inch HDMI Display-B"');
alsoKnownAs('lcdwiki-7-hdmi-b', 'MPI7001');
alsoKnownAs('geeekpi-5-hdmi', '52Pi EP-0081');
alsoKnownAs('waveshare-8.8-hdmi', 'the 8.8inch Side Monitor, same lines');

insertAfter('_comment_hdmi_bar', {
    'waveshare-11.6-1768x828-hdmi': hdmi('Waveshare 11.6" 1768x828 LCD', 'Ultrawide bar display, HDMI or Type-C', '1768x828', timings('1768 0 80 16 204 828 0 9 6 28 0 0 0 60 0 108000000 0'), { video_mode: '1768x828M@60', notes: 'Vendor lines: waveshare.com/wiki/11.6inch_1768x828_LCD (2026-11-02)' }),
    'waveshare-12.3-hdmi': hdmi('Waveshare 12.3" HDMI LCD / 1920x720 LCD (1920x720)', 'Ultrawide bar display; the 12.3inch HDMI LCD and the 12.3inch 1920x720 LCD share these lines', '1920x720', cvt(1920, 720), { notes: 'Vendor lines: waveshare.com/wiki/12.3inch_HDMI_LCD and 12.3inch_1920x720_LCD (2026-11-02); the vendor sets hdmi_drive=2, which the HDMI mode "screen + audio" provides' }),
    'waveshare-10.4hp-capqled': hdmi('Waveshare 10.4HP-CAPQLED (1600x720)', 'Ultrawide QLED touch monitor', '1600x720', timings('1600 0 80 32 112 720 0 30 3 33 0 0 0 60 0 87000000 0'), { video_mode: '1600x720M@60', notes: 'Vendor lines: waveshare.com/wiki/10.4HP-CAPQLED (2026-11-02)' }),
});

insertAfter('_comment_hdmi_round', {
    'waveshare-3.4-800x800-hdmi': hdmi('Waveshare 3.4" 800x800 LCD (round)', 'Round IPS display, capacitive touch', '800x800', timings('800 0 68 32 200 800 0 68 32 200 0 0 0 60 0 59400000 0'), { video_mode: '800x800M@60', notes: 'Vendor lines: waveshare.com/wiki/3.4inch_800x800_LCD (2026-11-02); the vendor also sets hdmi_force_hotplug=1' }),
});

insertAfter('_comment_hdmi_small', {
    'waveshare-3.2-hdmi-h': hdmi('Waveshare 3.2" HDMI LCD (H) (480x800)', 'Portrait native small display', '480x800', timings('480 0 50 20 50 800 0 19 20 20 0 0 0 60 0 38000000 6'), { rotated_resolution: '800x480', video_mode: '480x800M@60', recommended_rotation: 90, notes: 'Vendor lines: waveshare.com/wiki/3.2inch_HDMI_LCD_(H) (2026-11-02)' }),
    'waveshare-3.5-480x800-hdmi': hdmi('Waveshare 3.5" 480x800 LCD', 'Portrait native small display, capacitive touch', '480x800', cvt(480, 800), { rotated_resolution: '800x480', recommended_rotation: 90, notes: 'Vendor lines: waveshare.com/wiki/3.5inch_480x800_LCD (2026-11-02); the vendor also sets hdmi_force_hotplug=1 and hdmi_drive=1 (HDMI mode "screen only")' }),
    'waveshare-5dp-caplcd': hdmi('Waveshare 5DP-CAPLCD (1024x600)', '5-inch DisplayPort/HDMI capacitive touch display', '1024x600', cvt(1024, 600, { config_hdmi_boost: 10 }), { notes: 'Vendor lines: waveshare.com/wiki/5DP-CAPLCD (2026-11-02); the vendor also sets hdmi_force_hotplug=1' }),
});

insertAfter('_comment_hdmi_standard', {
    'waveshare-8-768x1024-hdmi': hdmi('Waveshare 8" / 9.7" 768x1024 LCD', 'Portrait native 4:3 display; the 8inch and the 9.7inch 768x1024 LCD share these lines', '768x1024', timings('768 0 80 32 60 1024 0 10 10 10 0 0 0 60 0 59400000 0'), { rotated_resolution: '1024x768', video_mode: '768x1024M@60', recommended_rotation: 90, notes: 'Vendor lines: waveshare.com/wiki/8inch_768x1024_LCD (2026-11-02); the vendor also sets hdmi_force_hotplug=1' }),
    'waveshare-8-1536x2048-hdmi': hdmi('Waveshare 8" 1536x2048 LCD', 'Portrait native high-resolution display; needs the Pi 4 or Pi 5 pixel clock', '1536x2048', timings('1536 0 500 66 158 2048 0 60 10 10 0 0 0 60 0 295000000 3', { config_hdmi_boost: 4, hdmi_pixel_freq_limit: 356000000, max_framebuffer_width: 1536, max_framebuffer_height: 2048, framebuffer_width: 1536, framebuffer_height: 2048 }), { rotated_resolution: '2048x1536', video_mode: '1536x2048M@60', recommended_rotation: 90, notes: 'Vendor lines: waveshare.com/wiki/8inch_1536x2048_LCD (2026-11-02)' }),
    'waveshare-9hp-capqled': hdmi('Waveshare 9HP-CAPQLED / 10.1HP-CAPQLED (1280x720)', 'QLED capacitive touch displays; the 9HP and the 10.1HP share these lines', '1280x720', timings('1280 0 160 32 48 720 0 10 10 12 0 0 0 60 0 77000000 3'), { video_mode: '1280x720M@60', notes: 'Vendor lines: waveshare.com/wiki/9HP-CAPQLED (2026-11-02)' }),
    'waveshare-9hp-capqled-b': hdmi('Waveshare 9HP-CAPQLED-B (1280x720)', '9-inch QLED capacitive touch display, B revision', '1280x720', timings('1280 0 160 32 40 720 0 20 6 30 0 0 0 60 0 70400000 3'), { video_mode: '1280x720M@60', notes: 'Vendor lines: waveshare.com/wiki/9HP-CAPQLED-B (2026-11-02)' }),
    'waveshare-10.1ep-caplcd': hdmi('Waveshare 10.1EP-CAPLCD (1920x1200)', '10.1-inch capacitive touch display, HDMI', '1920x1200', timings('1920 0 48 32 80 1200 0 3 6 26 0 0 0 60 0 154000000 0', { config_hdmi_boost: 10 }), { video_mode: '1920x1200M@60', notes: 'Vendor lines: waveshare.com/wiki/10.1EP-CAPLCD (2026-11-02); the vendor also sets hdmi_force_hotplug=1' }),
});

insertAfter('_comment_hdmi_elecrow', {
    'elecrow-7-hdmi-d': hdmi('Elecrow 7" IPS Touch Screen-D DLH05170B (1024x600)', '7-inch IPS monitor, mini HDMI, USB touch', '1024x600', cvt(1024, 600, { config_hdmi_boost: 7 }), { notes: 'Vendor lines: elecrow.com DLH05170B page (2026-11-02); the vendor also sets hdmi_force_hotplug=1, max_usb_current=1 and hdmi_drive=1' }),
    'elecrow-10.1-hdmi-sf101c': hdmi('Elecrow 10.1" SF101C (1280x800)', '10.1-inch IPS display with case, USB touch', '1280x800', cvt(1280, 800), { notes: 'Vendor lines: elecrow.com SF101C (DRD01230D) page (2026-11-02); the vendor also sets max_usb_current=1 and hdmi_drive=1' }),
});

insertAfter('_comment_hdmi_generic', {
    'luckfox-7-hdmi': hdmi('Luckfox 7" HD Touchscreen (1024x600)', '7-inch HDMI display with USB capacitive touch', '1024x600', cvt(1024, 600), { notes: 'Vendor lines: wiki.luckfox.com 7inch-HD-Touchscreen (2026-11-02); the page writes hdmi_driver=1 (sic) for hdmi_drive=1' }),
});

insertAfter('_comment_dsi_official', {
    'rpi-touch2-10inch': {
        name: 'Raspberry Pi Touch Display 2 - 10"',
        type: 'dsi',
        description: 'Official 10.1-inch Touch Display 2, 1200x1920 portrait, four DSI lanes: Raspberry Pi 5, CM5 and CM4 IO board DISP1 only',
        native_resolution: '1200x1920',
        rotated_resolution: '1920x1200',
        config: { dtoverlay: 'vc4-kms-dsi-ili79600-10-1inch' },
        recommended_rotation: 0,
        overlay_rotation_param: true,
        notes: 'raspberrypi.com/documentation (2026-11-02): needs current firmware and EEPROM (apt full-upgrade, rpi-eeprom-update -a); on CM5 DISP0 add ,dsi0 in the custom parameters',
    },
});

insertAfter('_comment_dpi_other', {
    'adafruit-kippah-7inch': {
        name: 'Adafruit DPI Kippah + 5"/7" 800x480',
        type: 'dpi',
        description: 'Adafruit DPI Kippah with the 5-inch or 7-inch 800x480 TTL display (in-tree panel)',
        native_resolution: '800x480',
        config: { dtoverlay: 'vc4-kms-dpi-panel,kippah-7inch' },
        recommended_rotation: 0,
        notes: 'learn.adafruit.com, Bookworm 2024-04 (2026-11-02): dtoverlay=vc4-kms-dpi-panel,kippah-7inch',
    },
    'geekworm-mzp280': {
        name: 'Geekworm MZP280 2.8" DPI (480x640)',
        type: 'dpi',
        description: 'Geekworm MZP280 2.8-inch DPI display, portrait native (in-tree panel)',
        native_resolution: '480x640',
        rotated_resolution: '640x480',
        config: { dtoverlay: 'vc4-kms-dpi-panel,mzp280' },
        recommended_rotation: 90,
        notes: 'Kernel overlays README (rpi-6.12.y): vc4-kms-dpi-panel,mzp280',
    },
    'innolux-at056tn53v1': {
        name: 'Innolux AT056TN53 5.6" DPI (640x480)',
        type: 'dpi',
        description: 'Innolux AT056TN53 v1 5.6-inch VGA panel on DPI (in-tree panel)',
        native_resolution: '640x480',
        config: { dtoverlay: 'vc4-kms-dpi-panel,at056tn53v1' },
        recommended_rotation: 0,
        notes: 'Kernel overlays README (rpi-6.12.y): vc4-kms-dpi-panel,at056tn53v1',
    },
});

db.version = '1.6.0';
db.last_updated = '2026-11-02';
const text = JSON.stringify(db, null, 2) + '\n';
fs.writeFileSync(file, text);
fs.writeFileSync(path.join(repo, 'plugin', 'display_presets.json'), text);
console.log('1.6.0:', Object.keys(P).filter((k) => !k.startsWith('_comment')).length, 'presets');
