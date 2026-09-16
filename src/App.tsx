import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { ConnectionBar } from "./components/ConnectionBar";
import { ProfilePicker } from "./components/ProfilePicker";
import { StatusBar } from "./components/StatusBar";
import { TerminalPane, type TerminalHandle } from "./components/TerminalPane";
import { Toolbar } from "./components/Toolbar";
import { useProfiles } from "./hooks/useProfiles";
import { useSerialConnection } from "./hooks/useSerialConnection";
import { useSerialPorts } from "./hooks/useSerialPorts";
import { useSessionLog } from "./hooks/useSessionLog";
import {
  findMatchingProfile,
  loadLastSettings,
  saveLastSettings,
  suggestProfileName,
} from "./lib/profiles";
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
  const profilesApi = useProfiles();
  const terminal = useRef<TerminalHandle>(null);
  // Restore what was used last time; profiles are explicit snapshots on top.
  const [last] = useState(() => loadLastSettings(profilesApi.storage));
  const [draft, setDraft] = useState<SerialConfig>(last?.config ?? DEFAULT_CONFIG);
  const [customPath, setCustomPath] = useState(false);
  const [lineEnding, setLineEnding] = useState<LineEnding>(last?.lineEnding ?? "crlf");
  const [format, setFormat] = useState<RxFormatOptions>(last?.format ?? DEFAULT_RX_FORMAT);
  const log = useSessionLog();
  const [logIncludeTx, setLogIncludeTx] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Pick the first enumerated port when nothing is selected yet.
  useEffect(() => {
    if (customPath || draft.path || portsApi.ports.length === 0) return;
    setDraft((d) => ({ ...d, path: portsApi.ports[0].path }));
  }, [portsApi.ports, draft.path, customPath]);

  // A remembered or profile path that the OS does not list (a pty, an
  // unplugged adapter) is shown in the free-text field rather than silently
  // replaced by the first enumerated port.
  useEffect(() => {
    if (customPath || !portsApi.scanned || portsApi.loading || !draft.path) return;
    if (!portsApi.ports.some((p) => p.path === draft.path)) setCustomPath(true);
  }, [portsApi.ports, portsApi.scanned, portsApi.loading, draft.path, customPath]);

  // If the backend reports an existing connection (dev reload), show its settings.
  useEffect(() => {
    if (conn.config) setDraft(conn.config);
  }, [conn.config]);

  useEffect(() => {
    saveLastSettings(profilesApi.storage, { config: draft, lineEnding, format });
  }, [profilesApi.storage, draft, lineEnding, format]);

  const activeProfile = findMatchingProfile(profilesApi.profiles, draft, lineEnding);

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
        leading={
          <ProfilePicker
            profiles={profilesApi.profiles}
            activeName={activeProfile?.name ?? ""}
            suggestedName={suggestProfileName(draft)}
            disabled={conn.state !== "disconnected"}
            onSelect={(profile) => {
              setDraft(profile.config);
              setLineEnding(profile.lineEnding);
              setCustomPath(!portsApi.ports.some((p) => p.path === profile.config.path));
            }}
            onSave={(name) => profilesApi.save({ name, config: draft, lineEnding })}
            onDelete={(name) => profilesApi.remove(name)}
          />
        }
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
