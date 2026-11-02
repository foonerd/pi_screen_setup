# Changelog

All notable changes to Pi Screen Setup are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The presets database (`display_presets.json`) carries its own version and is updated on players independently of the plugin.

## [Unreleased]

### Changed

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
