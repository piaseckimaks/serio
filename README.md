# serio

A serial communication terminal in the spirit of PuTTY's serial mode, with a modern UI.
Built with [Tauri 2](https://tauri.app) (Rust) and React + TypeScript, using
[xterm.js](https://xtermjs.org) for the terminal pane.

## Features

- Port picker with rescan, plus baud rate, data bits, parity, stop bits and flow control.
- Manual path entry for devices the OS does not enumerate (pseudo-terminals, socat ptys).
- Terminal pane: received bytes are rendered with full ANSI/VT support, keystrokes go to the
  port, and Enter is sent as none / CR / LF / CR+LF.
- Hex view: a classic 16-bytes-per-line dump with offset and ASCII column. Short messages
  show up after 100 ms of quiet instead of waiting for the line to fill.
- Timestamps: each line (text or hex) can be prefixed with the local time its first byte
  arrived, `[HH:MM:SS.mmm]`.
- Session logging: raw received bytes (optionally sent bytes too) go to a file of your
  choice. The log is flushed on every batch (`tail -f` works), is independent of the
  connection so it spans reconnects, and stops itself with a visible error if the disk
  fails.
- Saved connection profiles (port settings + Enter mode), plus the last-used settings are
  restored on launch. Stored in the webview's localStorage.
- Status bar with connection summary, RX/TX byte counters, log status and the last error.
- Disconnects cleanly when a device is unplugged.

## Layout

```
src/                      React frontend
  components/             ConnectionBar, ProfilePicker, Toolbar, TerminalPane, StatusBar
  hooks/                  useSerialPorts, useSerialConnection, useSessionLog, useProfiles
  lib/                    IPC wrappers, base64, line-ending translation, RX formatting
                          (text/hex/timestamps), profile storage (all unit-tested)
src-tauri/                Tauri app (thin glue: commands + event forwarding + log hookup)
  crates/serial-core/     `serio-serial`: port enumeration, connection manager, reader thread,
                          session log. No Tauri dependency, so it builds and tests anywhere.
```

Data flow: the Rust reader thread batches incoming bytes and emits `serial:data` events
(base64 payload); the Tauri sink appends each batch to the session log (if one is open) and
the terminal runs it through `RxFormatter` (text/hex, timestamps) before xterm.js. Keystrokes
go through `applyLineEnding` and `write_bytes`, which also records sent bytes when the log
asks for them. `serial:error` / `serial:closed` / `serial:log-error` events drive the UI state.

## Prerequisites

- Node 22+, [pnpm](https://pnpm.io) 10+
- Rust stable (1.80+)
- Tauri system dependencies for your OS: <https://tauri.app/start/prerequisites/>
  - Debian/Ubuntu additionally: `libudev-dev` (or build with `--no-default-features`,
    see below)
- Linux: add yourself to the `dialout` (Debian/Ubuntu) or `uucp` (Arch) group to open ports.

## Develop

```sh
pnpm install
pnpm tauri dev
```

## Verify

```sh
# Frontend
pnpm typecheck
pnpm test
pnpm build

# Serial core (no Tauri or GUI toolkit needed; works without libudev)
cd src-tauri
cargo test -p serio-serial --no-default-features
cargo clippy -p serio-serial --no-default-features -- -D warnings

# Whole app (needs the Tauri prerequisites above)
cargo check
```

The core tests include a round trip over a real pseudo-terminal pair, so the serial path is
exercised without hardware.

## Hardware-free smoke test

Create a linked pair of pseudo-terminals:

```sh
socat -d -d pty,raw,echo=0 pty,raw,echo=0
# prints two paths, e.g. /dev/pts/3 and /dev/pts/4
```

Then either run the app (`pnpm tauri dev`), choose "Other path…", enter `/dev/pts/3` and
Connect, or use the headless example:

```sh
cd src-tauri
cargo run -p serio-serial --no-default-features --example cat -- /dev/pts/3 115200
```

In another shell, talk to the other end:

```sh
cat /dev/pts/4            # shows what serio sends
echo "hello" > /dev/pts/4 # appears in serio
xxd < /dev/pts/4          # verify line-ending bytes
```

Killing `socat` while connected should surface an error and return the UI to Disconnected.

Things to try once connected: switch the toolbar to **Hex** and send a few bytes with
`printf 'ab\r\n' > /dev/pts/4`; turn on **Timestamps**; start a log with **Log to file…**
and `tail -f` it; save the settings as a profile and check they come back after a restart.

## Build

```sh
pnpm tauri build
```

The icons under `src-tauri/icons` are generated placeholders. Replace them with
`pnpm tauri icon path/to/icon.png` (1024x1024 source) when there is artwork.

## Building without libudev

`serio-serial` enables the `serialport` crate's libudev backend through the `udev` feature,
which is on by default in the app. On a Linux box without `libudev-dev`:

```sh
cargo check --no-default-features
```

Ports are still enumerated through sysfs; only some USB metadata is lost.
