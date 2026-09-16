import { useCallback, useEffect, useRef, useState } from "react";
import { listPorts, toSerialError } from "../lib/tauri";
import type { PortInfo } from "../types/serial";

/** Enumerates serial ports on mount, on window focus and on demand. */
export function useSerialPorts() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whether at least one scan has completed (successfully or not). */
  const [scanned, setScanned] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setPorts(await listPorts());
      setError(null);
    } catch (err) {
      setError(toSerialError(err).message);
    } finally {
      inFlight.current = false;
      setLoading(false);
      setScanned(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return { ports, loading, scanned, error, refresh };
}
