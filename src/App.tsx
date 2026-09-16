import { useEffect, useRef, useState } from "react";
import { ConnectionBar } from "./components/ConnectionBar";
import { StatusBar } from "./components/StatusBar";
import { TerminalPane, type TerminalHandle } from "./components/TerminalPane";
import { Toolbar } from "./components/Toolbar";
import { useSerialConnection } from "./hooks/useSerialConnection";
import { useSerialPorts } from "./hooks/useSerialPorts";
import { DEFAULT_RX_FORMAT, type RxFormatOptions } from "./lib/rxFormat";
import { DEFAULT_CONFIG, type LineEnding, type SerialConfig } from "./types/serial";

export default function App() {
  const portsApi = useSerialPorts();
  const conn = useSerialConnection();
  const terminal = useRef<TerminalHandle>(null);
  const [draft, setDraft] = useState<SerialConfig>(DEFAULT_CONFIG);
  const [customPath, setCustomPath] = useState(false);
  const [lineEnding, setLineEnding] = useState<LineEnding>("crlf");
  const [format, setFormat] = useState<RxFormatOptions>(DEFAULT_RX_FORMAT);

  // Pick the first enumerated port when nothing is selected yet.
  useEffect(() => {
    if (customPath || draft.path || portsApi.ports.length === 0) return;
    setDraft((d) => ({ ...d, path: portsApi.ports[0].path }));
  }, [portsApi.ports, draft.path, customPath]);

  // If the backend reports an existing connection (dev reload), show its settings.
  useEffect(() => {
    if (conn.config) setDraft(conn.config);
  }, [conn.config]);

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
        error={conn.lastError ?? portsApi.error}
      />
    </div>
  );
}
