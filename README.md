# Pi Screen Setup for Volumio

Display configuration for Volumio 4 (Bookworm) on Raspberry Pi. A guided wizard sets up HDMI, DSI, DPI and SPI panels and composite output — resolution, rotation and HDMI audio — from a database of 228 display configurations, and keeps that configuration across Volumio updates.

## What it does

- A seven-step wizard: output, display model, rotation, graphics driver settings, advanced options, review, apply.
- A display database of 228 configurations under 285 names (vendor names and known rebrands), fetched from this repository when it changes, so new displays arrive without a plugin update.
- Every output a Raspberry Pi has: one or two HDMI ports, one or two DSI ports, panels on the GPIO header (DPI and SPI), composite video, a custom overlay line, or headless.
- Rotation in the place the kernel reads it: the panel overlay's own parameter where it has one, the kernel command line otherwise; the boot splash and the console follow.
- HDMI under the KMS driver: the mode the kernel needs for every display in the database, and a generated EDID for panels whose timings are not standard.
- Vendor overlay files bundled for the displays that need them (Waveshare DPI and 3.5" DSI panels); they are installed when such a display is applied and removed when it is not.
- Settings that survive: the display configuration is kept in Volumio's data partition, rebuilt from the boot files if the settings file is ever lost, and regenerated after a Volumio update rewrites the boot files.
- Restore points before every change, a reference copy of the boot files as found, and a single button (or command) that takes the plugin's configuration out again.
- A Preset Manager on port 4567 for authoring, importing and exporting display presets.
- Six languages: English, German, French, Spanish, Italian, Dutch.

## Supported hardware

Raspberry Pi 2, 3, 3+, 4, 400, 5, 500; Compute Modules 3, 3+, 4, 5; Zero 2 W. Volumio 4.x on Bookworm. The plugin reads the board from the device tree and offers only the outputs that board has (one or two HDMI ports, one or two DSI ports, composite where it exists).

The Zero 2 W boots without the KMS driver on Volumio; the plugin follows that and does not add one.

## The display database

`display_presets.json` carries one row per display configuration. Each row names the display, its interface (`hdmi`, `dsi`, `dpi`, `spi`, `composite`), the `config.txt` lines the vendor publishes for it, the resolution, where the lines come from (`provenance`: the vendor page, or community use) and, where it matters, other product names sold with the same panel (`aliases`), the boards it exists for (`boards`), the kernel it needs (`min_kernel`), the vendor overlay files it depends on (`requires_overlay`) and the rotation parameter its overlay takes (`rotation_param`).

The pickers list every row and every alias under its own name; selecting an alias selects the row. When a row does not fit this player, the picker says why before you apply it: a kernel that is too old for the overlay token (the Waveshare 10.1" DSI LCD (E) needs 6.18.55), a board the panel does not exist for, or a vendor file this release does not ship. Rows for which the plugin installs vendor overlay files or an EDID say so too.

Vendors covered: Waveshare (HDMI, DSI and DPI families, including the DSI-TOUCH V2 series), the official Raspberry Pi Touch Display and Touch Display 2, Pimoroni HyperPixel, Adafruit (HDMI, the DPI Kippah, the PiTFT SPI family), Hosyond, Seeed Studio, GeeekPi/52Pi, Spotpear, Joy-IT, LCDwiki/goodtft, Elecrow, UCTRONICS, Freenove, BIGTREETECH/BIQU, Sunfounder, Kuman, Longruner, HMTECH, Pollin, Luckfox, DFRobot, Geekworm, Innolux, JDI, OzzMaker, Watterott, the VGA666 adapter, generic HDMI rows by resolution (480x320 to 1920x1200, portrait sizes, 720p, 1080p, 4K) and custom timings for HDMI, DSI and DPI.

No row is ever removed: your settings name presets by their key, and the repository's checks refuse a database in which a key of any earlier release is missing or has changed type. A row that is superseded stays in place, leaves the picker, and keeps working for the settings that name it.

### Vendor overlay files

Eight Waveshare presets (2.8", 3.5", 4" (B), 4" (C), 5" and 7" DPI LCD; 3.5" DSI LCD (E) and (H)) depend on overlay files the vendor publishes and the Raspberry Pi kernel does not carry. The plugin ships them under `overlays/` as `pss-<name>.dtbo` — the vendor's bytes, unchanged — each beside its decompiled source (`.dts`) and listed in `overlays/manifest.json` with its download URL, archive member and SHA-256. When such a preset is applied the plugin installs its files into `/boot/overlays/` before writing the line that names them, and writes `dtoverlay=pss-<name>` with the vendor's parameters. The files are removed when a configuration no longer needs them, by the "remove the plugin's display configuration" button, and at uninstall. Nothing with another prefix is ever written to or removed from `/boot/overlays/`.

### HDMI under the KMS driver

With the `vc4-kms-v3d` driver the kernel drives the HDMI ports itself and ignores the firmware's `hdmi_group`, `hdmi_mode`, `hdmi_cvt` and `hdmi_timings` lines (the firmware still uses them for the boot splash). The plugin derives the kernel's mode from those lines for every HDMI row and for custom timings and puts it on the kernel command line as `video=HDMI-A-1:<width>x<height>M@<rate>`.

A panel whose timings are not standard (`hdmi_timings`) gets an EDID generated from that line: a VESA E-EDID 1.3 block carrying the one detailed timing and, when the port carries audio, a CTA-861 extension declaring an HDMI sink with two-channel PCM. It is installed as `/lib/firmware/edid/pss-<preset>.bin` and named on the kernel line with `drm.edid_firmware=`. The kernel then uses the panel's exact timing, and HDMI audio works on panels that have no EDID of their own. The file follows the configuration, is put back if a Volumio update has removed it, and goes with the plugin's configuration. Three rows have porches or a pixel clock the EDID format cannot hold; they use the computed mode.

### SPI panels

Panels on the SPI bus with an in-tree kernel overlay that offers a KMS path (Adafruit PiTFT 2.2", 2.8"/2.4"/3.2" resistive, 2.8" capacitive and 3.5" resistive; OzzMaker PiScreen; Watterott RPi-Display) are offered under the GPIO output beside the DPI panels. They are experimental: to the kernel such a panel is a display device of its own (connector `SPI-1`), and Volumio's screen may have to be pointed at it. Touch orientation parameters are not managed.

## Installation

### From the plugin store

When listed, install Pi Screen Setup from Volumio's plugin store (Settings → Plugins → Search Plugins, category System Hardware) and enable it.

### From a release

Each release on GitHub carries `pi_screen_setup-<version>.zip`, the plugin as the store would ship it. Over SSH:

```
wget https://github.com/foonerd/pi_screen_setup/releases/download/v<version>/pi_screen_setup-<version>.zip
mkdir pi_screen_setup && cd pi_screen_setup
miniunzip ../pi_screen_setup-<version>.zip
volumio plugin install
```

Then enable the plugin in Settings → Plugins → Installed Plugins. To update, run the same steps with the new version in a fresh directory and `volumio plugin update` in place of `volumio plugin install`.

### From source

```
git clone --depth=1 https://github.com/foonerd/pi_screen_setup.git
cd pi_screen_setup/plugin
npm install --omit=dev
volumio plugin install
```

### Updating from a release before 1.0

Releases before 1.0 kept the presets you authored or fetched inside the plugin folder, which Volumio deletes when it updates a plugin. If you authored presets in the Preset Manager on such a release, export them first (Preset Manager → Export, or `GET http://<player>:4567/api/database/export`) and import them after the update. From 1.0 on they live under `/data/INTERNAL/pi_screen_setup/`, which a plugin update leaves alone.

## Using the wizard

The wizard opens with a choice: let the plugin detect the connected display, or configure by hand. Then:

1. **Output** — the port the display is on: HDMI 0/1, DSI 0/1, DPI / SPI (GPIO), composite, a custom overlay line, or headless.
2. **Display** — the display model from the database, or custom timings; for HDMI also screen/audio mode, force hotplug, ignore EDID and signal boost, and the second port's role. The picker notes anything the database knows that matters on this player.
3. **Rotation** — 0, 90, 180 or 270 degrees. The plugin chooses the mechanism: the panel overlay's own parameter where it has one, otherwise the kernel command line (`video=…,rotate=`, `plymouth=`, `fbcon=rotate:`); each kernel-line switch can be turned off.
4. **Graphics memory** — the KMS driver on or off, and the CMA size: the kernel's default for the board, a preset, or a custom value.
5. **After a Volumio update** — notify, ask, or regenerate silently.
6. **Review and apply** — a summary of what will be written; apply creates a restore point, writes the files and offers a reboot.

Once applied, the plugin shows the current configuration, its summary and the effective boot files, and offers Edit, the restore points, the diagnostics report, the database update check and the removal of its configuration.

## What the plugin writes

| File | What |
|---|---|
| `/boot/videoconfig.txt` | The display configuration, generated from your settings; the only file the plugin owns. |
| `/boot/config.txt` | One line, `include videoconfig.txt`. |
| `/boot/cmdline.txt` | The kernel's display mode, rotation switches and EDID reference; nothing else on the line is touched. |
| `/boot/volumioconfig.txt`, `/boot/userconfig.txt` | Display lines are removed while the plugin manages the display, so they cannot fight with `videoconfig.txt`; the original and a digest of the result are kept so the lines can be put back. |
| `/boot/overlays/pss-*.dtbo` | Vendor overlay files, for the presets that need them. |
| `/lib/firmware/edid/pss-*.bin` | Generated EDID files, for HDMI panels with their own timings. |

Every write goes through one root helper, `/usr/local/bin/pi-screen-setup-root`, installed by the plugin and the only command its sudoers entry names. It writes the five boot files by name (atomically, never empty), removes `videoconfig.txt`, installs and removes the plugin's `pss-` files, and performs the removal described below. The plugin itself runs as the `volumio` user.

Lines in `userconfig.txt` that the plugin leaves alone but that act on the display (another plugin's `display_lcd_rotate`, for example) are pointed out in the hardware section and in the diagnostics report.

## Backup and restore

**Where things are kept.** Restore points, the reference copies of the boot files, the record of what was removed from Volumio's files, and the presets you authored or fetched live under `/data/INTERNAL/pi_screen_setup/` (the Internal Storage share). That directory survives a plugin update and an uninstall.

**Restore points.** Each apply saves `videoconfig.txt`, `config.txt` and `cmdline.txt` as they were. The last ten are kept and can be restored from the plugin UI.

**The boot files as found.** On first install `config.txt`, `cmdline.txt`, `volumioconfig.txt` and `userconfig.txt` are saved as they were under `backups/factory/`, for reference. They are not written back: after a Volumio update they describe an older system.

**Settings.** The configuration lives in Volumio's settings store. If it is ever lost — a settings file restored from an older backup, or reset — the plugin rebuilds it from its own `videoconfig.txt` and `cmdline.txt` at the next start and says so.

**Removing the plugin's display configuration.** The button in the Edit section, and uninstalling the plugin, take the plugin's lines out of `config.txt`, `videoconfig.txt` and `cmdline.txt`, remove its `pss-` files, and put back the lines removed from `volumioconfig.txt` and `userconfig.txt` when those files are still as the plugin left them (a file edited since is left alone and reported). The display then boots as Volumio ships it. From SSH the same is `sudo pi-screen-setup-root clean-exit`.

## After a Volumio update

A Volumio update rewrites the boot files. At the next start the plugin recognises the update (the OS version changed), and does what you chose in the wizard: shows a notice, asks, or regenerates the configuration silently and offers a reboot. A changed boot file without an OS update is reported as such. The vendor overlay and EDID files are reinstalled as part of the regeneration.

## Preset Manager and API

The Preset Manager at `http://<player>:4567/` lists the database, lets you add, edit, import and export presets, back up and restore the database, and revert to the bundled one. Presets you add there are used by the wizard at once. The same server exposes a REST API, documented in [API.md](API.md).

## Troubleshooting

**No picture after a reboot.** Over SSH, `sudo pi-screen-setup-root clean-exit` followed by `sudo reboot` returns the display to Volumio's own configuration. The restore points under `/data/INTERNAL/pi_screen_setup/backups/restore_points/` hold every `videoconfig.txt` that was applied.

**The display is not detected.** Enable Force Hotplug in the HDMI settings; if the display reports wrong capabilities, Ignore EDID.

**Rotation has no effect.** Rotation needs the KMS driver. Check the picker note for the preset: some overlays take the rotation themselves, and the kernel line then carries none.

**No HDMI audio.** The port mode must be Screen + Audio. On a panel without its own EDID, the generated EDID declares audio only in that mode.

**A picker entry carries a note.** The note says what is missing: a newer kernel, a board the panel exists for, or a vendor file. The configuration can still be applied; it will take effect when the condition is met.

**Diagnostics.** The Diagnostics button writes `/tmp/pi-screen-setup-diagnostics.txt`: the board, the boot files as they are, what the firmware applied, the connectors the kernel sees, and the plugin's state. Attach it to an issue.

## Technical reference

- KMS overlay by board: `vc4-kms-v3d` (Pi 2/3), `vc4-kms-v3d-pi4` (Pi 4/400/CM4), `vc4-kms-v3d-pi5` (Pi 5/500/CM5). CMA sizes as `cma-<MB>`; the kernel's defaults are 256 MB, 508 MB and 64 MB respectively.
- Connector names on the kernel line: `HDMI-A-1`, `HDMI-A-2`, `DSI-1` (and `DSI-2` for the second port on the Pi 5 family), `DPI-1`, `SPI-1`.
- HDMI port 1 settings carry the `:1` suffix in `videoconfig.txt` (`hdmi_group:1=…`).
- The kernel-line mode: `video=<connector>:<w>x<h>M@<rate>` (`M`: timings computed by CVT, `R`: reduced blanking, `e`: treat as connected); for an EDID panel the size alone, so the EDID's timing is taken.
- Rotation parameters: `rotation=` on the official and Waveshare DSI panel overlays, `rotate=` on the HyperPixels, `vc4-kms-dpi-panel` and the SPI panels; `video=…,rotate=`, `plymouth=` and `fbcon=rotate:` on the kernel line for the rest.
- Database channel: `https://raw.githubusercontent.com/foonerd/pi_screen_setup/refs/heads/main/display_presets.json`, checked every 24 hours when enabled.

## Contributing

Display presets are the most useful contribution. In the Preset Manager, add the preset, test it on the display, and use "Export for PR"; open a pull request with the exported file, or edit `display_presets.json` directly. Each row needs a name, a type, the vendor's lines and where they come from. The repository's checks run on every pull request: the database against the schema and the kernel's overlay list, the key snapshot, i18n parity, the shell scripts, the test suite, and the plugin zip.

## Licence

MIT. See [LICENSE](LICENSE).

The vendor overlay files under `plugin/overlays/` are Waveshare's, redistributed unchanged as published on the product pages listed in `overlays/manifest.json`, each with its SHA-256 and its decompiled source alongside. The EDID files are generated by the plugin from the timing lines in the database.

## Support

Pi Screen Setup is free and open source, designed, built and maintained by one developer in his own time. If it has earned a place on your player, you can support its development through [GitHub Sponsors](https://github.com/sponsors/foonerd) or [Ko-fi](https://ko-fi.com/justanerd). Sponsorship is a thank-you, not a purchase: it buys no priority, no features and no support agreement.

## Credits

Developed by Just a Nerd for the Volumio community.
