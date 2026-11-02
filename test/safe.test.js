'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeJsonName, isPresetId, resolveImportPath } = require('../plugin/lib/safe');

test('a backup name is a bare .json file name', () => {
    assert.equal(safeJsonName('presets_backup_2026-11-02T10-00-00-000Z.json'), 'presets_backup_2026-11-02T10-00-00-000Z.json');
    assert.equal(safeJsonName('uploaded_1.json'), 'uploaded_1.json');
    for (const bad of ['../x.json', 'a/b.json', '/etc/passwd', '.hidden.json', 'x.txt', 'x.json/', '', null, undefined, 42]) {
        assert.equal(safeJsonName(bad), null, JSON.stringify(bad));
    }
});

test('a preset id is letters, digits, dot, dash, underscore', () => {
    for (const ok of ['auto', 'waveshare-dsi-7.0c', 'btt-pitft50-v1.0', 'A1', 'x'.repeat(64)]) assert.equal(isPresetId(ok), true, ok);
    for (const bad of ['', 'a b', '__proto__', '-lead', '.lead', 'x'.repeat(65), 'a/b', null, 7]) assert.equal(isPresetId(bad), false, String(bad));
});

test('an import path is a .json under an allowed root, after symlinks', () => {
    const roots = ['/data', '/mnt'];
    const realpath = (p) => {
        if (p === '/data/INTERNAL/presets.json') return '/data/INTERNAL/presets.json';
        if (p === '/mnt/USB/stick/db.json') return '/mnt/USB/stick/db.json';
        if (p === '/data/link.json') return '/etc/secret.json';
        if (p === '/datafake/x.json') return '/datafake/x.json';
        const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e;
    };
    assert.equal(resolveImportPath('/data/INTERNAL/presets.json', roots, realpath), '/data/INTERNAL/presets.json');
    assert.equal(resolveImportPath('/mnt/USB/stick/db.json', roots, realpath), '/mnt/USB/stick/db.json');
    assert.equal(resolveImportPath('/data/link.json', roots, realpath), null, 'symlink out of the roots');
    assert.equal(resolveImportPath('/datafake/x.json', roots, realpath), null, 'prefix is not a directory boundary');
    assert.equal(resolveImportPath('/data/missing.json', roots, realpath), null);
    assert.equal(resolveImportPath('/data/notjson.txt', roots, realpath), null);
    assert.equal(resolveImportPath(undefined, roots, realpath), null);
});
