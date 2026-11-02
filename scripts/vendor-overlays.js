#!/usr/bin/env node
'use strict';
// The vendor overlay files the database depends on (requires_overlay), fetched from
// the vendor's own pages, checked against the pinned hashes, and placed under
// plugin/overlays as pss-<name>.dtbo (the vendor's bytes, unchanged) beside
// pss-<name>.dts (dtc's reading of the same bytes, for review) and manifest.json
// (what each file is, where it came from, its hash). The plugin installs these into
// /boot/overlays through the root helper when a preset needs them, and writes the
// pss- name on the dtoverlay line.
//
//   node scripts/vendor-overlays.js            fetch, verify, write plugin/overlays
//   node scripts/vendor-overlays.js --from DIR use archives already in DIR
//
// Needs unzip and dtc on the PATH. A changed upstream file fails the hash check:
// read the vendor page, decide, then update the pin here.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const OUT = path.join(REPO, 'plugin', 'overlays');
const DB = JSON.parse(fs.readFileSync(path.join(REPO, 'plugin', 'display_presets.json'), 'utf8'));
const FETCHED = '2026-11-02';

// One entry per vendor download. `members`: the files inside the archive the database
// names (an archive may carry more; what no row needs is not shipped).
const SOURCES = [
    {
        page: 'https://www.waveshare.com/wiki/2.8inch_DPI_LCD',
        url: 'https://files.waveshare.com/wiki/2.8inc-DPI-LCD/28DPI-DTBO.zip',
        sha256: 'abcf510709b33eb97eadf03c8df42211880106c7309ecfac47000992038c810b',
        members: { '28DPI-DTBO/vc4-kms-dpi-2inch8.dtbo': 'vc4-kms-dpi-2inch8', '28DPI-DTBO/waveshare-28dpi-3b-4b.dtbo': 'waveshare-28dpi-3b-4b', '28DPI-DTBO/waveshare-touch-28dpi.dtbo': 'waveshare-touch-28dpi' },
    },
    {
        page: 'https://www.waveshare.com/wiki/3.5inch_DPI_LCD',
        url: 'https://files.waveshare.com/wiki/3.5inch%20DPI%20LCD/3.5DPI-dtbo.zip',
        sha256: '5661fb2d6aaf735be1321996f78dd0cbe25085cb81673afc9b57930cc865f67f',
        members: { '3.5DPI-dtbo/waveshare-35dpi.dtbo': 'waveshare-35dpi', '3.5DPI-dtbo/waveshare-touch-35dpi.dtbo': 'waveshare-touch-35dpi' },
    },
    {
        page: 'https://www.waveshare.com/wiki/4inch_DPI_LCD_(B)',
        url: 'https://www.waveshare.com/w/upload/d/d5/4DPIB_DTBO.zip',
        sha256: 'e3233029c8333220252f76eea1c48f034250c851998c52b463b38b925da14699',
        members: { 'waveshare-4dpib-3b-4b.dtbo': 'waveshare-4dpib-3b-4b', 'waveshare-4dpib-3b.dtbo': 'waveshare-4dpib-3b', 'waveshare-4dpib-4b.dtbo': 'waveshare-4dpib-4b' },
    },
    {
        page: 'https://www.waveshare.com/wiki/4inch_DPI_LCD_(C)',
        url: 'https://files.waveshare.com/upload/8/8a/4DPIC-DTBO.zip',
        sha256: 'b09a4934ca48d873ba00aed8b087698854538477787f56c19b4c1edfae080c1d',
        members: { '4DPIC-DTBO/vc4-kms-DPI-4inch.dtbo': 'vc4-kms-DPI-4inch', '4DPIC-DTBO/waveshare-4dpic-3b-4b.dtbo': 'waveshare-4dpic-3b-4b', '4DPIC-DTBO/waveshare-4dpi.dtbo': 'waveshare-4dpi', '4DPIC-DTBO/waveshare-touch-4dpi.dtbo': 'waveshare-touch-4dpi' },
    },
    {
        page: 'https://www.waveshare.com/wiki/5inch_DPI_LCD',
        url: 'https://files.waveshare.com/wiki/5inch%20DPI%20LCD/5DPI-DTBO.zip',
        sha256: 'e36edd47ec891f52b8766f3806af8249de884466ab378e75237e2cccff483dd2',
        members: { '5DPI-DTBO/vc4-kms-DPI-5inch.dtbo': 'vc4-kms-DPI-5inch', '5DPI-DTBO/waveshare-5dpi.dtbo': 'waveshare-5dpi' },
    },
    {
        page: 'https://www.waveshare.com/wiki/7inch_DPI_LCD',
        url: 'https://files.waveshare.com/wiki/7inch-DSI-LCD-(with-cam)/7DPI-DTBO.zip',
        sha256: '624d787bd20a7548a8778c314e8323887089ec5437fae6834cd5aebc558a0b95',
        members: { '7DPI-DTBO/vc4-kms-DPI-7inch.dtbo': 'vc4-kms-DPI-7inch', '7DPI-DTBO/waveshare-7dpi.dtbo': 'waveshare-7dpi' },
    },
    {
        page: 'https://www.waveshare.com/wiki/3.5inch_DSI_LCD_(E)',
        url: 'https://files.waveshare.com/wiki/common/Waveshare_35DSI.dtbo',
        sha256: 'ae09deaccceb80ced72519977fedc6d7becbd548a3043538c147ad40633b4611',
        members: { '': 'Waveshare_35DSI' },
    },
];

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const shippedName = (vendor) => 'pss-' + vendor.toLowerCase().replace(/[^a-z0-9-]+/g, '-');

function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'pi_screen_setup vendor-overlays' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(fetch(new URL(res.headers.location, url).href));
            if (res.statusCode !== 200) return reject(new Error(url + ': HTTP ' + res.statusCode));
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function archive(src, fromDir) {
    const file = decodeURIComponent(path.basename(new URL(src.url).pathname));
    let bytes;
    if (fromDir) bytes = fs.readFileSync(path.join(fromDir, file));
    else { process.stderr.write('fetch ' + src.url + '\n'); bytes = await fetch(src.url); }
    const got = sha256(bytes);
    if (got !== src.sha256) throw new Error(file + ': sha256 ' + got + ' is not the pinned ' + src.sha256 + ' — the vendor changed the file; read ' + src.page);
    return { file, bytes };
}

function member(arch, name, tmp) {
    if (name === '') return arch.bytes;
    const zip = path.join(tmp, arch.file);
    fs.writeFileSync(zip, arch.bytes);
    return execFileSync('unzip', ['-p', zip, name], { maxBuffer: 1 << 20 });
}

function decompile(dtbo, tmp) {
    const f = path.join(tmp, 'x.dtbo');
    fs.writeFileSync(f, dtbo);
    return execFileSync('dtc', ['-I', 'dtb', '-O', 'dts', '-q', f], { encoding: 'utf8', maxBuffer: 1 << 20 });
}

async function main() {
    const fromIdx = process.argv.indexOf('--from');
    const fromDir = fromIdx !== -1 ? process.argv[fromIdx + 1] : null;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pss-overlays-'));

    const required = new Set();
    for (const p of Object.values(DB.presets)) (p && p.requires_overlay || []).forEach((n) => required.add(n.toLowerCase()));

    const manifest = { schema: 1, fetched: FETCHED, overlays: {} };
    const seen = new Set();
    fs.mkdirSync(OUT, { recursive: true });
    for (const f of fs.readdirSync(OUT)) if (/^pss-.*\.(dtbo|dts)$/.test(f) || f === 'manifest.json') fs.unlinkSync(path.join(OUT, f));

    for (const src of SOURCES) {
        const arch = await archive(src, fromDir);
        for (const [memberName, vendor] of Object.entries(src.members)) {
            const bytes = member(arch, memberName, tmp);
            if (bytes.readUInt32BE(0) !== 0xd00dfeed) throw new Error(vendor + ': not a flattened device tree');
            const name = shippedName(vendor);
            if (seen.has(name)) throw new Error(name + ': two vendor files map to one shipped name');
            seen.add(name);
            if (!required.has(vendor.toLowerCase())) throw new Error(vendor + ': no preset names it in requires_overlay; not shipped');
            const hash = sha256(bytes);
            fs.writeFileSync(path.join(OUT, name + '.dtbo'), bytes);
            const header = [
                '// ' + name + '.dtbo — the vendor\'s file, unchanged. This is dtc\'s reading of it.',
                '// vendor name: ' + vendor,
                '// source: ' + src.url + (memberName ? ' (' + memberName + ')' : ''),
                '// page: ' + src.page,
                '// sha256: ' + hash,
                '// fetched: ' + FETCHED,
                '',
            ].join('\n');
            fs.writeFileSync(path.join(OUT, name + '.dts'), header + decompile(bytes, tmp));
            manifest.overlays[vendor] = { file: name, sha256: hash, source: src.url, member: memberName || null, page: src.page };
        }
    }
    const shipped = new Set(Object.keys(manifest.overlays).map((n) => n.toLowerCase()));
    for (const r of required) if (!shipped.has(r)) throw new Error(r + ': a preset requires it and no source here provides it');

    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.rmSync(tmp, { recursive: true });
    console.log(Object.keys(manifest.overlays).length + ' overlays written to plugin/overlays');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
