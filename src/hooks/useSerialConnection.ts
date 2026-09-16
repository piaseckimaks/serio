import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { closePort, EVENTS, openPort, portStatus, toSerialError, writeBytes } from "../lib/tauri";
import type {
  ClosedEventPayload,
  ConnectionState,
  ErrorEventPayload,
  SerialConfig,
} from "../types/serial";

/**
 * Owns the connection lifecycle. Received bytes are consumed by the
 * terminal directly (see TerminalPane); this hook only counts them via
 * `countReceived`.
 */
export function useSerialConnection() {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [config, setConfig] = useState<SerialConfig | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [rxBytes, setRxBytes] = useState(0);
  const [txBytes, setTxBytes] = useState(0);

  useEffect(() => {
    // `listen` is async; if the effect is cleaned up before it resolves
    // (StrictMode double-mount), unsubscribe as soon as it does.
    const sub = { disposed: false, unlisten: [] as UnlistenFn[] };
    const register = <T,>(name: string, handler: (payload: T) => void) => {
      void listen<T>(name, (event) => handler(event.payload)).then((unlisten) => {
        if (sub.disposed) unlisten();
        else sub.unlisten.push(unlisten);
      });
    };

    register<ClosedEventPayload>(EVENTS.closed, ({ reason }) => {
      setState("disconnected");
      setConfig(null);
      if (reason === "error") {
        // The reader thread died on its own; reap the dead connection so a
        // new one can be opened. The backend emits nothing for this call.
        closePort().catch(() => undefined);
      }
    });
    register<ErrorEventPayload>(EVENTS.error, ({ message }) => setLastError(message));

    // Resync after a dev-server reload: the backend may still be connected.
    portStatus()
      .then((status) => {
        if (sub.disposed || !status) return;
        setConfig(status.config);
        setState(status.alive ? "connected" : "disconnected");
        if (!status.alive) closePort().catch(() => undefined);
      })
      .catch(() => undefined);

    return () => {
      sub.disposed = true;
      sub.unlisten.forEach((unlisten) => unlisten());
    };
  }, []);

  const connect = useCallback(async (next: SerialConfig) => {
    setLastError(null);
    setState("connecting");
    try {
      await openPort(next);
      setConfig(next);
      setRxBytes(0);
      setTxBytes(0);
      setState("connected");
    } catch (err) {
      setLastError(toSerialError(err).message);
      setState("disconnected");
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await closePort();
    } catch (err) {
      setLastError(toSerialError(err).message);
    }
    // The `serial:closed` event also does this; set it here so the UI
    // responds even if the event is delayed.
    setState("disconnected");
    setConfig(null);
  }, []);

  const write = useCallback(async (bytes: Uint8Array) => {
    if (bytes.length === 0) return;
    try {
      await writeBytes(bytes);
      setTxBytes((n) => n + bytes.length);
    } catch (err) {
      setLastError(toSerialError(err).message);
    }
  }, []);

  const countReceived = useCallback((count: number) => {
    setRxBytes((n) => n + count);
  }, []);

  return { state, config, lastError, rxBytes, txBytes, connect, disconnect, write, countReceived };
}
