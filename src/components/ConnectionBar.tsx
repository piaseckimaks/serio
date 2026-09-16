import { useId } from "react";
import { LINE_ENDING_LABELS } from "../lib/lineEnding";
import {
  BAUD_RATES,
  type ConnectionState,
  type DataBits,
  type FlowControl,
  type LineEnding,
  type Parity,
  type PortInfo,
  type SerialConfig,
  type StopBits,
} from "../types/serial";

const CUSTOM_PATH = "__custom__";

interface Props {
  ports: PortInfo[];
  portsLoading: boolean;
  onRefresh: () => void;
  config: SerialConfig;
  onConfigChange: (config: SerialConfig) => void;
  /** Whether the path field is free text (for ptys and other unlisted devices). */
  customPath: boolean;
  onCustomPathChange: (custom: boolean) => void;
  lineEnding: LineEnding;
  onLineEndingChange: (mode: LineEnding) => void;
  state: ConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
}

function portLabel(port: PortInfo): string {
  const detail = port.product ?? port.manufacturer;
  return detail ? `${port.path}  ·  ${detail}` : port.path;
}

export function ConnectionBar({
  ports,
  portsLoading,
  onRefresh,
  config,
  onConfigChange,
  customPath,
  onCustomPathChange,
  lineEnding,
  onLineEndingChange,
  state,
  onConnect,
  onDisconnect,
}: Props) {
  const id = useId();
  const busy = state !== "disconnected";
  const canConnect = state === "disconnected" && config.path.trim().length > 0;

  const update = <K extends keyof SerialConfig>(key: K, value: SerialConfig[K]) =>
    onConfigChange({ ...config, [key]: value });

  const onPortSelect = (value: string) => {
    if (value === CUSTOM_PATH) {
      onCustomPathChange(true);
      return;
    }
    onCustomPathChange(false);
    update("path", value);
  };

  return (
    <header className="connection-bar">
      <div className="field field-port">
        <label htmlFor={`${id}-port`}>Port</label>
        <div className="port-row">
          {customPath ? (
            <input
              id={`${id}-port`}
              type="text"
              placeholder="/dev/ttyUSB0, /dev/pts/3, COM3 …"
              value={config.path}
              disabled={busy}
              spellCheck={false}
              onChange={(e) => update("path", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canConnect) onConnect();
              }}
            />
          ) : (
            <select
              id={`${id}-port`}
              value={config.path}
              disabled={busy}
              onChange={(e) => onPortSelect(e.target.value)}
            >
              {ports.length === 0 && (
                <option value="" disabled>
                  {portsLoading ? "Scanning…" : "No ports found"}
                </option>
              )}
              {ports.map((port) => (
                <option key={port.path} value={port.path}>
                  {portLabel(port)}
                </option>
              ))}
              <option value={CUSTOM_PATH}>Other path…</option>
            </select>
          )}
          {customPath ? (
            <button
              type="button"
              className="ghost"
              title="Back to the port list"
              disabled={busy}
              onClick={() => onCustomPathChange(false)}
            >
              List
            </button>
          ) : (
            <button
              type="button"
              className="ghost"
              title="Rescan ports"
              disabled={busy || portsLoading}
              onClick={onRefresh}
            >
              ↻
            </button>
          )}
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${id}-baud`}>Baud</label>
        <select
          id={`${id}-baud`}
          value={config.baudRate}
          disabled={busy}
          onChange={(e) => update("baudRate", Number(e.target.value))}
        >
          {BAUD_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${id}-data`}>Data</label>
        <select
          id={`${id}-data`}
          value={config.dataBits}
          disabled={busy}
          onChange={(e) => update("dataBits", Number(e.target.value) as DataBits)}
        >
          {[5, 6, 7, 8].map((bits) => (
            <option key={bits} value={bits}>
              {bits}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${id}-parity`}>Parity</label>
        <select
          id={`${id}-parity`}
          value={config.parity}
          disabled={busy}
          onChange={(e) => update("parity", e.target.value as Parity)}
        >
          <option value="none">None</option>
          <option value="even">Even</option>
          <option value="odd">Odd</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${id}-stop`}>Stop</label>
        <select
          id={`${id}-stop`}
          value={config.stopBits}
          disabled={busy}
          onChange={(e) => update("stopBits", Number(e.target.value) as StopBits)}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${id}-flow`}>Flow</label>
        <select
          id={`${id}-flow`}
          value={config.flowControl}
          disabled={busy}
          onChange={(e) => update("flowControl", e.target.value as FlowControl)}
        >
          <option value="none">None</option>
          <option value="software">XON/XOFF</option>
          <option value="hardware">RTS/CTS</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${id}-eol`}>Enter sends</label>
        <select
          id={`${id}-eol`}
          value={lineEnding}
          onChange={(e) => onLineEndingChange(e.target.value as LineEnding)}
        >
          {(Object.keys(LINE_ENDING_LABELS) as LineEnding[]).map((mode) => (
            <option key={mode} value={mode}>
              {LINE_ENDING_LABELS[mode]}
            </option>
          ))}
        </select>
      </div>

      <div className="field field-action">
        {state === "disconnected" ? (
          <button type="button" className="primary" disabled={!canConnect} onClick={onConnect}>
            Connect
          </button>
        ) : (
          <button
            type="button"
            className="danger"
            disabled={state === "connecting"}
            onClick={onDisconnect}
          >
            {state === "connecting" ? "Connecting…" : "Disconnect"}
          </button>
        )}
      </div>
    </header>
  );
}
