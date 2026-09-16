import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { fromBase64 } from "../lib/bytes";
import { applyLineEnding } from "../lib/lineEnding";
import { EVENTS } from "../lib/tauri";
import type { DataEventPayload, LineEnding } from "../types/serial";

interface Props {
  connected: boolean;
  lineEnding: LineEnding;
  /** Bytes to send to the port (already line-ending translated). */
  onInput: (bytes: Uint8Array) => void;
  /** Called with the byte count of every received chunk. */
  onReceived: (count: number) => void;
}

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

export function TerminalPane({ connected, lineEnding, onInput, onReceived }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  // Latest props, readable from the long-lived xterm callbacks.
  const connectedRef = useRef(connected);
  const lineEndingRef = useRef(lineEnding);
  const onInputRef = useRef(onInput);
  const onReceivedRef = useRef(onReceived);
  connectedRef.current = connected;
  lineEndingRef.current = lineEnding;
  onInputRef.current = onInput;
  onReceivedRef.current = onReceived;

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
      term.write(bytes);
      onReceivedRef.current(bytes.length);
    }).then((unlisten) => {
      if (sub.disposed) unlisten();
      else sub.unlisten = unlisten;
    });

    termRef.current = term;
    return () => {
      sub.disposed = true;
      sub.unlisten?.();
      inputSub.dispose();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (connected) termRef.current?.focus();
  }, [connected]);

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
}
