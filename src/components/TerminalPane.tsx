import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { fromBase64 } from "../lib/bytes";
import { applyLineEnding } from "../lib/lineEnding";
import { RxFormatter, type RxFormatOptions } from "../lib/rxFormat";
import { EVENTS } from "../lib/tauri";
import type { DataEventPayload, LineEnding } from "../types/serial";

interface Props {
  connected: boolean;
  lineEnding: LineEnding;
  /** How received bytes are rendered (text/hex, timestamps). */
  format: RxFormatOptions;
  /** Bytes to send to the port (already line-ending translated). */
  onInput: (bytes: Uint8Array) => void;
  /** Called with the byte count of every received chunk. */
  onReceived: (count: number) => void;
}

export interface TerminalHandle {
  /** Wipe the screen and scrollback and restart the hex offset. */
  clear: () => void;
}

/** How long a partial hex line waits for more bytes before being shown. */
const HEX_FLUSH_DELAY_MS = 100;

const THEME = {
  background: "#0b1120",
  foreground: "#e2e8f0",
  cursor: "#2dd4bf",
  cursorAccent: "#0b1120",
  selectionBackground: "rgba(45, 212, 191, 0.3)",
  black: "#1e293b",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e2e8f0",
  brightBlack: "#64748b",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f8fafc",
};

export const TerminalPane = forwardRef<TerminalHandle, Props>(function TerminalPane(
  { connected, lineEnding, format, onInput, onReceived },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const formatterRef = useRef(new RxFormatter(format));
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest props, readable from the long-lived xterm callbacks.
  const connectedRef = useRef(connected);
  const lineEndingRef = useRef(lineEnding);
  const onInputRef = useRef(onInput);
  const onReceivedRef = useRef(onReceived);
  connectedRef.current = connected;
  lineEndingRef.current = lineEnding;
  onInputRef.current = onInput;
  onReceivedRef.current = onReceived;

  const flushPending = () => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const formatter = formatterRef.current;
    if (formatter.hasPending) termRef.current?.write(formatter.flush());
  };

  const clear = () => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    formatterRef.current.reset();
    termRef.current?.reset();
  };

  useImperativeHandle(ref, () => ({ clear }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      convertEol: false,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    const refit = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        try {
          fit.fit();
        } catch {
          // The container can be mid-layout; the next resize will fit again.
        }
      }
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(container);

    const encoder = new TextEncoder();
    const inputSub = term.onData((input) => {
      if (!connectedRef.current) return;
      const out = applyLineEnding(input, lineEndingRef.current);
      if (out.length > 0) onInputRef.current(encoder.encode(out));
    });

    const sub = { disposed: false, unlisten: null as UnlistenFn | null };
    void listen<DataEventPayload>(EVENTS.data, (event) => {
      const bytes = fromBase64(event.payload.data);
      const formatter = formatterRef.current;
      term.write(formatter.push(bytes));
      onReceivedRef.current(bytes.length);
      // A short message in hex mode would otherwise sit unseen until the
      // line fills; show it once the stream goes quiet.
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = formatter.hasPending ? setTimeout(flushPending, HEX_FLUSH_DELAY_MS) : null;
    }).then((unlisten) => {
      if (sub.disposed) unlisten();
      else sub.unlisten = unlisten;
    });

    termRef.current = term;
    return () => {
      sub.disposed = true;
      sub.unlisten?.();
      if (flushTimer.current) clearTimeout(flushTimer.current);
      inputSub.dispose();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (connected) termRef.current?.focus();
    else flushPending();
  }, [connected]);

  // Switching text/hex clears the screen: the two views are not continuous.
  useEffect(() => {
    flushPending();
    if (formatterRef.current.setOptions(format)) termRef.current?.reset();
  }, [format.mode, format.timestamps]);

  return (
    <div className="terminal-pane" data-connected={connected}>
      <div className="terminal-host" ref={containerRef} />
      {!connected && (
        <div className="terminal-overlay" aria-hidden="true">
          Not connected. Pick a port and press Connect.
        </div>
      )}
    </div>
  );
});
