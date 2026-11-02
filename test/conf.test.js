'use strict';
// lib/conf: the configuration file shape v-conf needs, and the one-time conversion of
// files written before 1.0.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const conf = require('../plugin/lib/conf');
const VConf = require(path.join('..', 'plugin', 'node_modules', 'v-conf'));

test('v-conf reads nothing from a raw file: the defect this module exists for', () => {
    const c = new VConf();
    c.data = { wizard_complete: false, hdmi0: { rotation: 0 }, name: 'x' };
    assert.equal(c.get('wizard_complete', 'default'), undefined, 'not false, not the default');
    assert.equal(c.get('hdmi0.rotation', 7), undefined);
    c.set('wizard_complete', true);
    c.set('hdmi0.rotation', 90);
    assert.equal(c.data.wizard_complete, false, 'the write was dropped');
    assert.equal(c.data.hdmi0.rotation, 0);
});

test('normalize converts primitives, namespaces, arrays and the migration documents; then v-conf works', () => {
    const data = {
        version: '0.6.2', wizard_step: 0, wizard_complete: false, applied_date: '',
        migration_raw_lines: [], migration_parsed: {}, migration_validation: [{ type: 'info', message: 'm' }],
        hardware: { model: '', ram_mb: 0, detected: false },
        hdmi0: { enabled: true, rotation: 0, boost: 0 },
        migration_pending: { type: 'boolean', value: false },
        leftover: { value: 'x' },
        gone: null,
        list: ['a', 'b'],
    };
    assert.equal(conf.isNormalized(data), false);
    assert.equal(conf.normalize(data), true);
    assert.equal(conf.isNormalized(data), true);
    assert.equal(conf.normalize(data), false, 'idempotent');
    assert.deepEqual(data.wizard_complete, { type: 'boolean', value: false });
    assert.deepEqual(data.wizard_step, { type: 'number', value: 0 });
    assert.deepEqual(data.hardware.model, { type: 'string', value: '' });
    assert.deepEqual(data.hdmi0.boost, { type: 'number', value: 0 });
    assert.deepEqual(data.migration_pending, { type: 'boolean', value: false }, 'already right, untouched');
    assert.deepEqual(data.migration_raw_lines, { type: 'string', value: '[]' });
    assert.deepEqual(data.migration_parsed, { type: 'string', value: '{}' });
    assert.deepEqual(data.migration_validation, { type: 'string', value: '[{"type":"info","message":"m"}]' });
    assert.deepEqual(data.leftover, { type: 'string', value: 'x' }, 'a bare { value } left by set() on a raw object is re-typed');
    assert.equal('gone' in data, false);
    assert.deepEqual(data.list, { type: 'string', value: '["a","b"]' });

    const c = new VConf();
    c.data = data;
    assert.equal(c.get('wizard_complete', 'default'), false);
    assert.equal(c.get('hdmi0.boost'), 0);
    c.set('wizard_complete', true);
    c.set('hdmi0.rotation', 270);
    assert.equal(c.get('wizard_complete'), true);
    assert.equal(c.get('hdmi0.rotation'), 270);
    assert.equal(c.get('missing', 'd'), 'd');
});

test('the migration documents stored by set() on a raw {} come back as JSON text', () => {
    const data = { migration_parsed: { value: { parsed: { a: 1 } } }, migration_raw_lines: { value: [{ line: 'x' }] } };
    conf.normalize(data);
    assert.deepEqual(JSON.parse(data.migration_parsed.value), { parsed: { a: 1 } });
    assert.deepEqual(JSON.parse(data.migration_raw_lines.value), [{ line: 'x' }]);
});

test('leaf and isLeaf', () => {
    assert.deepEqual(conf.leaf(1), { type: 'number', value: 1 });
    assert.deepEqual(conf.leaf('s'), { type: 'string', value: 's' });
    assert.deepEqual(conf.leaf(true), { type: 'boolean', value: true });
    assert.deepEqual(conf.leaf([1]), { type: 'string', value: '[1]' });
    assert.equal(conf.leaf(null), null);
    assert.equal(conf.isLeaf({ type: 'string', value: 'x' }), true);
    assert.equal(conf.isLeaf({ type: 'object', value: {} }), false);
    assert.equal(conf.isLeaf({ value: 'x' }), false);
    assert.equal(conf.isLeaf('x'), false);
    assert.equal(conf.isNormalized({ ns: {} }), false, 'an empty namespace is nothing v-conf can address');
    assert.equal(conf.isNormalized(null), false);
    assert.equal(conf.normalize(null), false);
});
