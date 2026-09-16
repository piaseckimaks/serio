import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { EVENTS, logStatus, startLog, stopLog, toSerialError } from "../lib/tauri";
import type { ErrorEventPayload, LogOptions, LogStatus } from "../types/serial";

/** How often the byte counter is refreshed while a log is open. */
const POLL_MS = 1000;

/**
 * Owns the session log lifecycle. The log lives in the backend and is
 * independent of the connection, so it survives reconnects and dev reloads.
 */
export function useSessionLog() {
  const [status, setStatus] = useState<LogStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await logStatus());
    } catch {
      // Not fatal; the next poll or action refreshes again.
    }
  }, []);

  useEffect(() => {
    const sub = { disposed: false, unlisten: null as UnlistenFn | null };
    void listen<ErrorEventPayload>(EVENTS.logError, ({ payload }) => {
      setError(`Logging stopped: ${payload.message}`);
      setStatus(null);
    }).then((unlisten) => {
      if (sub.disposed) unlisten();
      else sub.unlisten = unlisten;
    });
    void refresh();
    return () => {
      sub.disposed = true;
      sub.unlisten?.();
    };
  }, [refresh]);

  // Keep the byte counter moving while logging.
  const active = status !== null;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const start = useCallback(async (options: LogOptions) => {
    setError(null);
    try {
      setStatus(await startLog(options));
    } catch (err) {
      setError(toSerialError(err).message);
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await stopLog();
    } catch (err) {
      setError(toSerialError(err).message);
    }
    setStatus(null);
  }, []);

  return { status, error, start, stop };
}
