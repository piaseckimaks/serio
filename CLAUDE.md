# serio

A serial communication terminal (PuTTY's serial mode, with a modern UI).
Tauri 2 (Rust) + React 18 + TypeScript + Vite, xterm.js for the terminal pane, pnpm.

## Layout

- `src/` React frontend
  - `components/` ConnectionBar (port picker + settings + Connect), TerminalPane (xterm.js), StatusBar
  - `hooks/` `useSerialPorts` (enumeration), `useSerialConnection` (lifecycle, RX/TX counters)
  - `lib/tauri.ts` typed `invoke` wrappers and event names; `lib/bytes.ts` base64;
    `lib/lineEnding.ts` Enter translation (unit tests in `lib/__tests__`)
  - `types/serial.ts` mirrors the Rust serde contract (camelCase)
- `src-tauri/` Tauri app, thin glue only
  - `src/commands.rs` `list_ports`, `open_port`, `close_port`, `write_bytes`, `port_status`
  - `src/events.rs` forwards core events as `serial:data` / `serial:closed` / `serial:error`
  - `crates/serial-core/` the `serio-serial` crate: enumeration, `SerialManager`, reader
    thread, `Transport` trait, mock transport, pty integration test, `cat` example

## Architecture rules

- All serial logic lives in `serio-serial`. It must never depend on Tauri, so it builds and
  tests on any machine (including ones without webkit2gtk or libudev).
- One connection at a time. The reader thread never locks the manager; `close()` sets a stop
  flag, joins the thread (bounded by the 20 ms read timeout) and emits exactly one `Closed`.
- Incoming bytes are batched (16 ms / 8 KiB) before becoming events.
- Event payloads and `write_bytes` carry bytes as base64 strings, never `Vec<u8>` (serde_json
  would emit number arrays).
- Line endings are translated only in `src/lib/lineEnding.ts`; the backend is byte-transparent.
  xterm.js reports Enter as `\r`.
- Tauri commands are `async fn` returning `Result<_, SerialError>`; `SerialError` serializes
  as `{ kind, message }`.
- The `udev` feature (default on the app, off on the core crate) enables libudev enumeration;
  use `--no-default-features` on machines without `libudev-dev`.

## Commands

```sh
pnpm install
pnpm typecheck && pnpm test && pnpm build
cd src-tauri && cargo test -p serio-serial --no-default-features
cd src-tauri && cargo clippy -p serio-serial --no-default-features --all-targets -- -D warnings
cargo check            # in src-tauri; needs Tauri OS prerequisites
pnpm tauri dev
```

Hardware-free smoke test: `socat -d -d pty,raw,echo=0 pty,raw,echo=0`, connect to one pts
via "Other path…", talk to the other with `cat` / `echo` / `xxd` (details in README.md).

## Conventions

- Rust: rustfmt, clippy clean with `-D warnings` on the core crate, edition 2021.
- TypeScript: strict, no unused locals; keep helpers pure and unit-tested with vitest.
- Keep the MVP scope focused; planned features (hex view, timestamps, session logging,
  saved profiles) should slot in without changing the core crate's event contract.
- See `docs/HANDOFF.md` for current status and open items.
