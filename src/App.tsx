import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { ConnectionBar } from "./components/ConnectionBar";
import { StatusBar } from "./components/StatusBar";
import { TerminalPane, type TerminalHandle } from "./components/TerminalPane";
import { Toolbar } from "./components/Toolbar";
import { useSerialConnection } from "./hooks/useSerialConnection";
import { useSerialPorts } from "./hooks/useSerialPorts";
import { useSessionLog } from "./hooks/useSessionLog";
import { DEFAULT_RX_FORMAT, type RxFormatOptions } from "./lib/rxFormat";
import { DEFAULT_CONFIG, type LineEnding, type SerialConfig } from "./types/serial";

/** `serio-YYYYMMDD-HHMMSS.log` in local time. */
function defaultLogName(now: Date): string {
  const p = (n: number, w = 2) => n.toString().padStart(w, "0");
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `serio-${date}-${time}.log`;
}

export default function App() {
  const portsApi = useSerialPorts();
  const conn = useSerialConnection();
  const terminal = useRef<TerminalHandle>(null);
  const [draft, setDraft] = useState<SerialConfig>(DEFAULT_CONFIG);
  const [customPath, setCustomPath] = useState(false);
  const [lineEnding, setLineEnding] = useState<LineEnding>("crlf");
  const [format, setFormat] = useState<RxFormatOptions>(DEFAULT_RX_FORMAT);
  const log = useSessionLog();
  const [logIncludeTx, setLogIncludeTx] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Pick the first enumerated port when nothing is selected yet.
  useEffect(() => {
    if (customPath || draft.path || portsApi.ports.length === 0) return;
    setDraft((d) => ({ ...d, path: portsApi.ports[0].path }));
  }, [portsApi.ports, draft.path, customPath]);

  // If the backend reports an existing connection (dev reload), show its settings.
  useEffect(() => {
    if (conn.config) setDraft(conn.config);
  }, [conn.config]);

  const startLog = async () => {
    setDialogError(null);
    let path: string | null;
    try {
      path = await save({
        title: "Save session log",
        defaultPath: defaultLogName(new Date()),
        filters: [
          { name: "Log files", extensions: ["log", "txt"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
    } catch (err) {
      setDialogError(`Cannot open the save dialog: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (path) await log.start({ path, includeTx: logIncludeTx, append: false });
  };

  return (
    <div className="app">
      <ConnectionBar
        ports={portsApi.ports}
        portsLoading={portsApi.loading}
        onRefresh={() => void portsApi.refresh()}
        config={draft}
        onConfigChange={setDraft}
        customPath={customPath}
        onCustomPathChange={(custom) => {
          setCustomPath(custom);
          if (!custom) setDraft((d) => ({ ...d, path: portsApi.ports[0]?.path ?? "" }));
        }}
        lineEnding={lineEnding}
        onLineEndingChange={setLineEnding}
        state={conn.state}
        onConnect={() => void conn.connect(draft)}
        onDisconnect={() => void conn.disconnect()}
      />
      <Toolbar
        format={format}
        onFormatChange={setFormat}
        onClear={() => terminal.current?.clear()}
        log={log.status}
        logIncludeTx={logIncludeTx}
        onLogIncludeTxChange={setLogIncludeTx}
        onStartLog={() => void startLog()}
        onStopLog={() => void log.stop()}
      />
      <TerminalPane
        ref={terminal}
        connected={conn.state === "connected"}
        lineEnding={lineEnding}
        format={format}
        onInput={conn.write}
        onReceived={conn.countReceived}
      />
      <StatusBar
        state={conn.state}
        config={conn.config}
        rxBytes={conn.rxBytes}
        txBytes={conn.txBytes}
        log={log.status}
        error={dialogError ?? log.error ?? conn.lastError ?? portsApi.error}
      />
    </div>
  );
}
