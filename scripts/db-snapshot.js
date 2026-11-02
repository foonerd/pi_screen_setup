#!/usr/bin/env node
'use strict';
// Writes test/db-keys.json: every preset key of display_presets.json with its type.
// test/check.js refuses a database in which any snapshotted key is missing or has
// another type, and a database with keys the snapshot does not know. So a preset can
// only be removed or renamed by editing the snapshot on purpose, in a reviewable diff;
// users' settings name these keys and must keep working across every update.
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(repo, 'display_presets.json'), 'utf8'));
const out = path.join(repo, 'test', 'db-keys.json');
const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { keys: {} };

const keys = {};
Object.keys(db.presets).filter((k) => !k.startsWith('_comment')).sort().forEach((k) => { keys[k] = db.presets[k].type; });

const removed = Object.keys(previous.keys).filter((k) => !(k in keys));
const retyped = Object.keys(previous.keys).filter((k) => k in keys && previous.keys[k] !== keys[k]);
const added = Object.keys(keys).filter((k) => !(k in previous.keys));
if ((removed.length || retyped.length) && process.argv.indexOf('--allow-removal') === -1) {
    console.error('db-snapshot: refusing to drop ' + removed.concat(retyped).join(', ') + ' from the snapshot; presets are kept and marked deprecated, not removed. Pass --allow-removal if this is a reviewed decision.');
    process.exit(1);
}
fs.writeFileSync(out, JSON.stringify({ database: db.version, count: Object.keys(keys).length, keys }, null, 2) + '\n');
console.log('db-keys.json: ' + Object.keys(keys).length + ' keys for database ' + db.version + (added.length ? '; added ' + added.join(', ') : '') + (removed.length ? '; REMOVED ' + removed.join(', ') : ''));
