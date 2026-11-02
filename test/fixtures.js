'use strict';
// Captured files from real devices (boot directories, /proc/device-tree nodes,
// dmesg lines) live in the private journal repository, not here. Tests that
// need them skip when the journal is not beside this checkout (as on CI); on a
// development machine every test runs.
const fs = require('fs');
const path = require('path');

const DIR = process.env.PI_SCREEN_SETUP_FIXTURES
    || path.resolve(__dirname, '..', '..', 'pi_screen_setup-journal', 'fixtures', 'test');

const available = fs.existsSync(DIR);
const skip = available ? false : 'device captures not present (journal repository not beside this checkout)';

function fixture(name) {
    return fs.readFileSync(path.join(DIR, name), 'utf8');
}

module.exports = { DIR, available, skip, fixture };
