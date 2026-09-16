# Handoff

Last updated: 2026-09-16, branch `claude/handoff-continuation-5qmlrl`.

## Where things stand

Everything in the original plan is implemented and committed on this branch:

| Commit | What |
| --- | --- |
| `28db0e4` | Bootstrap: core crate, Tauri glue, React frontend, README |
| `af844bd` | `pnpm-lock.yaml` and `Cargo.lock` |
| `9c24c3a` | Clippy fix (unused import) |
| `c659a16` | Hex view, per-line timestamps, Clear button (`src/lib/rxFormat.ts`, `Toolbar`) |
| `54d0b49` | Session logging (`SessionLog` in the core crate, `start_log`/`stop_log`/`log_status`, `tauri-plugin-dialog`) |
| `6dc011f` | Saved profiles and last-used settings (`src/lib/profiles.ts`, `ProfilePicker`) |

The `claude/serial-terminal-ui-awusv3` branch only adds `CLAUDE.md` and the first version
of this file on top of the bootstrap; both were cherry-picked here, so this branch supersedes it.

## What has been verified

This session had network access, so the previously unverified list is now checked:

- `pnpm install`, `pnpm typecheck`, `pnpm test` (28 tests in 4 files), `pnpm build`: all pass.
- `cargo test -p serio-serial --no-default-features`: 23 unit tests + 2 pty tests pass.
- `cargo clippy -p serio-serial --no-default-features --all-targets -- -D warnings` and
  `cargo fmt --check`: clean.
- `cargo check` on the Tauri crate fails only in `gdk-sys`'s build script (no GTK on the
  machine), exactly as predicted; it never reaches our code.

## What is NOT verified, and why

The container has no webkit2gtk/GTK and no display, so nothing in `src-tauri/src` has been
compiled, and the app has never been run. Those files were kept small and rustfmt-clean, and
they only use standard Tauri 2 APIs, but expect to touch them on the first real build:

- `src-tauri/src/lib.rs`: `.plugin(tauri_plugin_dialog::init())`, `app.manage(Arc<SessionLog>)`.
- `src-tauri/src/events.rs`: `TauriSink` now holds `Arc<SessionLog>` and calls
  `record_rx` before emitting `serial:data`; `emit_log_error` emits `serial:log-error`.
- `src-tauri/src/commands.rs`: `write_bytes` takes `AppHandle` and `State<Arc<SessionLog>>`
  (injected, not IPC args); `start_log`, `stop_log`, `log_status`.
- `src-tauri/capabilities/default.json`: `dialog:allow-save`. If the save dialog is refused
  at runtime, the permission identifier is the first thing to check.
- Frontend: `@tauri-apps/plugin-dialog` `save()` in `App.tsx` (`startLog`).

## First thing to do in the next session

1. On a machine with the Tauri prerequisites: `cd src-tauri && cargo check` (with
   `--no-default-features` if `libudev-dev` is missing), fix whatever the compiler says in
   the three glue files above, then `pnpm tauri dev`.
2. Run the socat smoke test from the README, then: Hex + Timestamps toggles, Clear,
   "Log to file…" (check `tail -f` on the file and the byte counter in the status bar),
   "Stop log", save a profile, restart the app and confirm the last settings and the
   profile come back.
3. Check the toolbar and connection bar layout at the 640 px minimum window width; the
   profile field is `flex: 0 1 300px` and may need to wrap earlier.

## Design notes for the new features

- `RxFormatter` (frontend) is stateful across chunks: text mode tracks "at line start"
  even while timestamps are off, hex mode buffers a partial 16-byte line and keeps a running
  offset. `TerminalPane` flushes a partial hex line after 100 ms of quiet and on disconnect.
  Text-mode timestamps are inserted as `\r[HH:MM:SS.mmm] ` so LF-only devices still get the
  stamp at column 0. Switching Text/Hex clears the screen.
- `SessionLog` (core crate, `log.rs`) writes raw bytes and flushes on every record. TX bytes
  are interleaved only when `includeTx` is set. A write failure closes the log and returns
  the error once; the Tauri layer turns that into `serial:log-error`, and `useSessionLog`
  shows it in the status bar. `append` is supported by the backend but the UI always
  truncates (the OS dialog already confirms overwrites).
- Profiles live in localStorage under `serio.profiles.v1`; last-used settings under
  `serio.lastSettings.v1`. Both are validated on read and corrupt data is dropped. The
  profile selection is derived by exact match against the current settings, so there is no
  "dirty" state to track.

## Open items and placeholders

- Icons in `src-tauri/icons` are generated placeholders. Replace with
  `pnpm tauri icon <1024px png>` once there is artwork.
- App identifier is `xyz.piasecki.serio`; change if wanted.
- No license file or `license` field yet.
- CSP is `null` in `tauri.conf.json`; tighten later.
- Possible follow-ups, not started: a send-line input box (type a line, send with a chosen
  ending) and hex input; local echo; log with timestamps or hex formatting (today the log is
  always raw); an "append" choice in the UI; a lint setup (there is no eslint yet).

## Decisions already made (do not re-litigate)

- Stack: Tauri 2 + Rust, React + TypeScript, xterm.js, pnpm (user's choice).
- Serial logic isolated in a Tauri-free crate for testability.
- Own `serialport` bindings via commands, not `tauri-plugin-serialplugin`.
- Base64 for byte payloads over IPC; line endings translated only in the frontend.
- The `SerialEvent` contract stays as is; logging and formatting hang off it from outside.
- `tauri-plugin-dialog` for the save dialog (the only Tauri plugin in use).
