# serio

A serial communication terminal in the spirit of PuTTY's serial mode, with a modern UI.
Built with [Tauri 2](https://tauri.app) (Rust) and React + TypeScript, using
[xterm.js](https://xtermjs.org) for the terminal pane.

## Features (MVP)

- Port picker with rescan, plus baud rate, data bits, parity, stop bits and flow control.
- Manual path entry for devices the OS does not enumerate (pseudo-terminals, socat ptys).
- Terminal pane: received bytes are rendered with full ANSI/VT support, keystrokes go to the
  port, and Enter is sent as none / CR / LF / CR+LF.
- Status bar with connection summary, RX/TX byte counters and the last error.
- Disconnects cleanly when a device is unplugged.

Planned: hex view, timestamps, session logging, saved connection profiles.

## Layout

```
src/                      React frontend
  components/             ConnectionBar, TerminalPane, StatusBar
  hooks/                  useSerialPorts, useSerialConnection
  lib/                    IPC wrappers, base64, line-ending translation (unit-tested)
src-tauri/                Tauri app (thin glue: commands + event forwarding)
  crates/serial-core/     `serio-serial`: port enumeration, connection manager, reader thread.
                          No Tauri dependency, so it builds and tests anywhere.
```

Data flow: the Rust reader thread batches incoming bytes and emits `serial:data` events
(base64 payload); the terminal writes them to xterm.js. Keystrokes go through
`applyLineEnding` and `write_bytes`. `serial:error` / `serial:closed` events drive the UI state.

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
