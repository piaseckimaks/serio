import { framing, type ConnectionState, type LogStatus, type SerialConfig } from "../types/serial";

interface Props {
  state: ConnectionState;
  config: SerialConfig | null;
  rxBytes: number;
  txBytes: number;
  log: LogStatus | null;
  error: string | null;
}

const STATE_LABEL: Record<ConnectionState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
};

function formatBytes(count: number): string {
  if (count < 1024) return `${count} B`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KiB`;
  return `${(count / (1024 * 1024)).toFixed(2)} MiB`;
}

/** Last path component, for compact display. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function StatusBar({ state, config, rxBytes, txBytes, log, error }: Props) {
  return (
    <footer className="status-bar">
      <span className={`state-pill state-${state}`}>{STATE_LABEL[state]}</span>
      {config && (
        <span className="status-item mono">
          {config.path} @ {config.baudRate} {framing(config)}
          {config.flowControl !== "none" && ` · ${config.flowControl}`}
        </span>
      )}
      {error && (
        <span className="status-item status-error" title={error}>
          {error}
        </span>
      )}
      <span className="status-spacer" />
      {log && (
        <span className="status-item mono status-log" title={`Logging to ${log.path}`}>
          ● {baseName(log.path)} {formatBytes(log.bytesWritten)}
        </span>
      )}
      <span className="status-item mono" title="Bytes received">
        RX {formatBytes(rxBytes)}
      </span>
      <span className="status-item mono" title="Bytes sent">
        TX {formatBytes(txBytes)}
      </span>
    </footer>
  );
}
