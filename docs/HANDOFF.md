# Handoff

Last updated: 2026-09-16, branch `claude/serial-terminal-ui-awusv3`.

## Where things stand

The repository started empty. Commit `28db0e4` bootstrapped the whole MVP:

- `serio-serial` core crate with port enumeration, `SerialManager`, batching reader thread,
  mock-based unit tests, a pty round-trip integration test and a `cat` example.
- Tauri glue (five commands, three events, capabilities, config, placeholder icons).
- React frontend: connection bar, xterm.js terminal pane, status bar, vitest tests for the
  pure helpers.
- README with prerequisites, verification commands and a socat smoke test.

## What is NOT verified yet, and why

The session that wrote this ran in the Claude Code environment named "Default", which has
no network access. npm, crates.io and GitHub all returned `Host not in allowlist`. So none
of this has been run:

- `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- `cargo test -p serio-serial --no-default-features`, clippy
- `cargo check` on the Tauri crate, `pnpm tauri dev`

What was checked: every Rust file parses and is rustfmt-clean, every TypeScript file
transpiles (bun), JSON configs are valid, and the pure helpers pass equivalent tests under
bun's runner. Expect small compile or type errors on the first real run; none of the code
has been through a compiler.

To unblock in Claude Code on the web: edit the environment (or create one) with network
access that allows at least `registry.npmjs.org`, `index.crates.io`, `static.crates.io`.
Changes apply to new sessions only.

## First thing to do in the next session

1. Probe the three hosts with curl; stop and report if any still returns 403.
2. `pnpm install`, then `pnpm typecheck`, `pnpm test`, `pnpm build`. Fix type errors in
   `src/` (likely spots: the generic `update` helper in `ConnectionBar.tsx`, xterm theme
   keys in `TerminalPane.tsx`, vitest config typing in `vite.config.ts`).
3. `cd src-tauri && cargo test -p serio-serial --no-default-features`, then clippy with
   `--all-targets -- -D warnings`. Likely spots: `serialport` API details (`Error::new`,
   `TTYPort::pair`, `From<serialport::Error> for io::Error`), the `Transport` impl for
   `Box<dyn SerialPort>`.
4. `cargo check` in `src-tauri` will fail without webkit2gtk; confirm the only failure is a
   build script in `webkit2gtk-sys`/`gtk-sys`, not our code. If the machine has the Tauri
   prerequisites, run `pnpm tauri dev` and the socat smoke test from the README.
5. Commit `pnpm-lock.yaml`, `src-tauri/Cargo.lock` and any fixes; push.

## Open items and placeholders

- Icons in `src-tauri/icons` are generated placeholders (dark square, teal `>_`). Replace
  with `pnpm tauri icon <1024px png>` once there is artwork.
- App identifier is `xyz.piasecki.serio` in `src-tauri/tauri.conf.json`; change if wanted.
- No license file or `license` field yet; the owner has not chosen one.
- CSP is `null` in `tauri.conf.json` for the MVP; tighten later.
- `pnpm-lock.yaml` and `Cargo.lock` are not committed yet (never generated).

## Planned next features (agreed scope, in rough order)

1. Hex view toggle and optional per-line timestamps in the terminal pane.
2. Session logging to a file.
3. Saved connection profiles.

All three should be frontend/Tauri-layer additions; the core crate's `SerialEvent` contract
should not need to change.

## Decisions already made (do not re-litigate)

- Stack: Tauri 2 + Rust, React + TypeScript, xterm.js, pnpm (user's choice).
- Serial logic isolated in a Tauri-free crate for testability.
- Own `serialport` bindings via commands, not `tauri-plugin-serialplugin`.
- Base64 for byte payloads over IPC; line endings translated only in the frontend.
