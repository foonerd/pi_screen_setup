'use strict';
// display_presets.json 1.8.0 -> 1.9.0: SPI panels with an in-tree overlay that has a DRM
// path (`,drm`: the panel becomes a KMS connector, SPI-1), as the vendors publish the
// lines — Adafruit's PiTFT family from adafruit-pitft.py, OzzMaker's PiScreen and
// Watterott's RPi-Display from the kernel's overlay README. Type `spi`; they are offered
// under the GPIO output beside the DPI panels and rotate through the overlay's rotate=.
// `owootecc-dpi-4.3` carried the PiScreen line under a name no product matches; it stays
// (settings may name it) but is superseded by the PiScreen row and leaves the picker.
const fs = require('fs');
const path = require('path');
const presets = require('../plugin/lib/presets');

const repo = path.resolve(__dirname, '..');
const file = path.join(repo, 'display_presets.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const tokens = JSON.parse(fs.readFileSync(path.join(repo, 'test', 'overlay-tokens.json'), 'utf8')).overlays;
if (db.version !== '1.8.0') throw new Error('expected 1.8.0, found ' + db.version);

const ADAFRUIT = 'https://github.com/adafruit/Raspberry-Pi-Installer-Scripts/blob/main/adafruit-pitft.py';
const README = 'https://github.com/raspberrypi/linux/blob/rpi-6.12.y/arch/arm/boot/dts/overlays/README';
const SPI_NOTE = 'KMS connector SPI-1, a display device of its own beside the HDMI/DSI one; the UI may need Volumio\'s screen pointed at it. Touch orientation parameters are not set here.';

const spi = (name, resolution, dtoverlay, provenance, description, extra) => Object.assign({
    name,
    type: 'spi',
    description,
    native_resolution: resolution,
    config: { dtoverlay },
    recommended_rotation: 0,
    rotation_param: 'rotate',
    provenance,
    notes: SPI_NOTE,
}, extra || {});

const added = {
    'adafruit-pitft22': spi('Adafruit PiTFT 2.2" (320x240)', '320x240', 'pitft22,speed=64000000,fps=30,drm', ADAFRUIT, 'ILI9341 over SPI, no touch; lines from adafruit-pitft.py with the drm option'),
    'adafruit-pitft28-resistive': spi('Adafruit PiTFT 2.8"/2.4"/3.2" resistive (320x240)', '320x240', 'pitft28-resistive,speed=64000000,fps=30,drm', ADAFRUIT, 'ILI9341 over SPI, STMPE resistive touch; lines from adafruit-pitft.py with the drm option', { aliases: ['Adafruit PiTFT 2.4" resistive', 'Adafruit PiTFT 3.2" resistive'] }),
    'adafruit-pitft28-capacitive': spi('Adafruit PiTFT 2.8" capacitive (320x240)', '320x240', 'pitft28-capacitive,speed=64000000,fps=30,drm', ADAFRUIT, 'ILI9341 over SPI, FocalTech capacitive touch; lines from adafruit-pitft.py with the drm option'),
    'adafruit-pitft35-resistive': spi('Adafruit PiTFT 3.5" resistive (480x320)', '480x320', 'pitft35-resistive,speed=20000000,fps=20,drm', ADAFRUIT, 'HX8357D over SPI, STMPE resistive touch; lines from adafruit-pitft.py with the drm option'),
    'ozzmaker-piscreen': spi('OzzMaker PiScreen 3.5" (480x320)', '480x320', 'piscreen,speed=16000000,drm,xohms=100', README, 'ILI9486 over SPI, ADS7846 resistive touch; the piscreen overlay with its drm option'),
    'watterott-rpi-display': spi('Watterott RPi-Display 2.8" (320x240)', '320x240', 'watterott-display,drm', README, 'ILI9341 over SPI, ADS7846 resistive touch; the watterott-display overlay with its drm option'),
};

// Insert after the last DPI row so the file stays grouped by type
const dpiKeys = Object.keys(db.presets).filter((k) => db.presets[k] && db.presets[k].type === 'dpi');
const lastDpi = dpiKeys[dpiKeys.length - 1];
const out = {};
Object.keys(db.presets).forEach((k) => {
    out[k] = db.presets[k];
    if (k === lastDpi) Object.keys(added).forEach((a) => { if (db.presets[a]) throw new Error(a + ' exists'); out[a] = added[a]; });
});
db.presets = out;

const odd = db.presets['owootecc-dpi-4.3'];
if (!odd || odd.config.dtoverlay !== 'piscreen,speed=16000000,drm,xohms=100') throw new Error('owootecc-dpi-4.3 is not the row this script expects');
odd.deprecated = true;
odd.superseded_by = 'ozzmaker-piscreen';
odd.notes = 'The PiScreen overlay under a name no product matches; see ozzmaker-piscreen. Kept so settings that name it keep working.';

db.version = '1.9.0';
db.last_updated = '2026-11-02';
const ordered = { schema: db.schema, version: db.version, last_updated: db.last_updated, presets: db.presets };
const errors = presets.validate(ordered, tokens);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
const text = JSON.stringify(ordered, null, 2) + '\n';
fs.writeFileSync(file, text);
fs.writeFileSync(path.join(repo, 'plugin', 'display_presets.json'), text);
console.log('1.9.0:', presets.count(db.presets), 'presets,', presets.nameCount(db.presets), 'names');
