#!/usr/bin/env node
'use strict';
// Writes test/overlay-tokens.json from the Raspberry Pi kernel's overlay README: for
// every overlay the parameters it accepts. test/check.js holds every dtoverlay line of
// the database against it, so a token that is not in the kernel cannot reach a player.
//
//   scripts/overlay-tokens.js                 fetches rpi-6.12.y (the Volumio kernel line)
//   scripts/overlay-tokens.js <README path>   reads a local copy
const fs = require('fs');
const path = require('path');
const https = require('https');

const BRANCH = process.env.RPI_BRANCH || 'rpi-6.12.y';
const URL = 'https://raw.githubusercontent.com/raspberrypi/linux/' + BRANCH + '/arch/arm/boot/dts/overlays/README';
const out = path.join(__dirname, '..', 'test', 'overlay-tokens.json');

function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve(body));
        }).on('error', reject);
    });
}

// Name: / Info: / Load: / Params: blocks; a parameter line starts with the name in the
// first column after the 8-character label gutter, continuation lines are indented past it.
function parse(text) {
    const overlays = {};
    let name = null;
    let inParams = false;
    text.split('\n').forEach((line) => {
        let m;
        if ((m = line.match(/^Name:\s+(\S+)/))) { name = m[1]; overlays[name] = []; inParams = false; return; }
        if (!name) return;
        if ((m = line.match(/^Params:\s*(.*)$/))) { inParams = true; param(m[1]); return; }
        if (/^(Info|Load):/.test(line)) { inParams = false; return; }
        if (inParams && /^\s{8}\S/.test(line)) param(line.slice(8));
        function param(rest) {
            const t = rest.match(/^(\S+)/);
            if (!t || t[1] === '<None>') return;
            if (!/^[A-Za-z0-9_.-]+$/.test(t[1])) return;
            if (overlays[name].indexOf(t[1]) === -1) overlays[name].push(t[1]);
        }
    });
    return overlays;
}

(async () => {
    const text = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : await fetch(URL);
    const overlays = parse(text);
    const names = Object.keys(overlays);
    if (names.length < 300 || !overlays['vc4-kms-dsi-waveshare-panel'] || overlays['vc4-kms-dsi-waveshare-panel'].indexOf('7_0_inchC') === -1) {
        throw new Error('the README did not parse as expected (' + names.length + ' overlays)');
    }
    fs.writeFileSync(out, JSON.stringify({ source: URL, fetched: new Date().toISOString().slice(0, 10), overlays }, null, 1) + '\n');
    console.log('overlay-tokens.json: ' + names.length + ' overlays from ' + BRANCH);
})().catch((e) => { console.error('overlay-tokens: ' + e.message); process.exit(1); });
