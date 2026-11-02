'use strict';
// Writes to the boot partition. The plugin runs as volumio; /boot belongs to root.
//
// `sudo` is the production path and matches the sudoers entries install.sh writes
// (cp to a named file, chmod 644, rm). `direct` writes with the process's own rights and
// is used when the plugin is pointed at a relocated root (tests), where no sudoers exist.
// Arguments are passed as a vector, never through a shell.

const { execFileSync } = require('child_process');
const fs = require('fs-extra');

const sudo = {
    copy(src, dst) {
        execFileSync('sudo', ['cp', src, dst], { stdio: 'pipe' });
        execFileSync('sudo', ['chmod', '644', dst], { stdio: 'pipe' });
    },
    remove(p) {
        execFileSync('sudo', ['rm', '-f', p], { stdio: 'pipe' });
    },
};

const direct = {
    copy(src, dst) {
        fs.copySync(src, dst);
        fs.chmodSync(dst, 0o644);
    },
    remove(p) {
        fs.removeSync(p);
    },
};

module.exports = { sudo, direct };
