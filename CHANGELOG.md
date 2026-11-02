# Changelog

All notable changes to Pi Screen Setup are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The presets database (`display_presets.json`) carries its own version and is updated on players independently of the plugin.

## [Unreleased]

### Added

- `lib/board.js`: the board is read from the revision code the firmware publishes (`/proc/device-tree/system/linux,revision`, else `/proc/cpuinfo`), decoded against the documented type, processor and memory fields. Pi Zero 2 W, Pi 400, Pi 500, CM4S, CM5 and CM5 Lite are now recognised as themselves; installed memory is exact instead of rounded from `MemTotal`.
- `lib/configtxt.js`: a reader for `config.txt` and its includes that applies the firmware's conditional-filter rules (`[all]`, `[none]`, model filters, `[board-type=]`, serial `[0x…]`, `[EDID=]`, `[gpioN=]`, `[HDMI:n]`, `[tryboot]`, expression filters; same type replaces, different types combine, state carries across `include`) and reports what actually applies to this board. Tests cover Volumio's 4.119 and 4.231 `volumioconfig.txt`: the 4.231 file leaves KMS unapplied on every Pi 3, 4 and 5 because its `[0x9020e0]`/`[0x9020e1]` serial filters precede the model filters.
- `lib/verify.js`: what the running system shows — whether the vc4 driver is bound, the DRM connectors and their state, the CMA in use, the kernel command line — and a diagnostics report built from that, the boot files as found and as they apply to the board, the plugin's settings and the display-related kernel messages. The hardware section gets a "Write a diagnostics report" button (`/tmp/pi-screen-setup-diagnostics.txt`) and a line stating what the boot files apply to this board right now.
- When the plugin is enabled but not yet configured and the boot files apply no display driver (KMS) on a board that has one, the plugin writes the one driver line itself under its own banner and says so (reversible, replaced by the wizard's file).
- `lib/cma.js`: graphics memory (CMA) per board. "Kernel default" is a choice (no `cma-` parameter: 256 MB on Pi 2/3, 508 MB on Pi 4, 64 MB on Pi 5), 512 MB boards are held to 128 MB as Volumio intends for the 3A+, sizes above a board's limit are not offered, custom values are 4 MB aligned. The KMS step shows the board, the CMA in use now (from `/proc/meminfo`) and the one that applies after the next reboot.

### Changed

- The KMS driver line is written with the board's own overlay and the chosen CMA; on a Pi 5 the second DSI port is named `DSI-2` as the kernel does. `videoconfig.txt` now opens with `[all]`, so a conditional filter left open by the file before it cannot capture its lines.
- Boot validation evaluates what the boot files apply to this board (not whether a line is present somewhere): a configured display driver that the files do not actually apply, or one applied when none is configured, is drift. After drift the files are regenerated from the current settings; the previous behaviour copied back the copies taken at install, which after a system update were stale.
- New installs start with the CMA at "Kernel default".
- Installs that still carried the old "Default (64 MB)" CMA setting are moved once to "Kernel default", with a notice; explicit choices are left alone.

### Fixed

- Editing a preset (preset editor or the Volumio UI) no longer discards the fields the form does not show (`native_resolution`, `recommended_rotation`, `overlay_rotation_param`, `vc4_kms`, `emit_dsi_overlay`, `notes`, …); a saved preset keeps everything it had.
- The repository is laid out as `plugin/` (what ships), `test/` (the static check and the module tests), `scripts/` (packaging, release notes) and `.github/` (CI on every push, a release on every `vX.Y.Z` tag, the test-report issue form). `display_presets.json` stays at the repository root as well, because players fetch it from there.

## [0.8.2] - 2026-11-02

### Fixed

- The preset editor's HTTP API on port 4567 took file names and paths from the request as given: a backup name could point outside the backups directory (download, delete, upload, restore) and import-from-path read any JSON file on the device. Both now accept a bare `.json` file name, or a path under `/data`, `/mnt`, `/media` or `/home/volumio`, only.
- Import from URL in the preset editor always failed (it called a function that did not exist). It works: http or https, 30 seconds, 10 MB.
- Preset ids are limited to letters, digits, dot, dash and underscore; the translations route accepts language codes only.

### Removed

- The `Access-Control-Allow-Origin: *` header on the preset editor's API; the page is same-origin and never needed it.

## [0.8.1] - 2026-03-24

The plugin as the Volumio store ships it, the starting point of this repository's rework.

- HDMI (single and dual), DSI, DPI and composite outputs on Raspberry Pi 2 to 5 and Compute Modules, written to `/boot/videoconfig.txt` and `/boot/cmdline.txt`, with the display lines of `/boot/volumioconfig.txt` moved out of the way.
- A presets database of 197 screens (Waveshare, Raspberry Pi, Elecrow, Adafruit, BIGTREETECH, Hosyond, LCDwiki and others) with a remote update channel, and a preset editor served on port 4567.
- A first-run wizard, rotation, KMS/CMA settings, migration of existing display settings, detection of configuration drift after a system update with restore, backups and restore points.
- Six languages: English, German, Spanish, French, Italian, Dutch.
