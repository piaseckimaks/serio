import { useId } from "react";
import type { DisplayMode, RxFormatOptions } from "../lib/rxFormat";
import type { LogStatus } from "../types/serial";
import { baseName } from "./StatusBar";

interface Props {
  format: RxFormatOptions;
  onFormatChange: (format: RxFormatOptions) => void;
  onClear: () => void;
  log: LogStatus | null;
  logIncludeTx: boolean;
  onLogIncludeTxChange: (include: boolean) => void;
  onStartLog: () => void;
  onStopLog: () => void;
}

const MODES: { value: DisplayMode; label: string; title: string }[] = [
  { value: "text", label: "Text", title: "Render received bytes as a terminal" },
  { value: "hex", label: "Hex", title: "Show received bytes as a hex dump" },
];

/** Row between the connection bar and the terminal: view and logging options. */
export function Toolbar({
  format,
  onFormatChange,
  onClear,
  log,
  logIncludeTx,
  onLogIncludeTxChange,
  onStartLog,
  onStopLog,
}: Props) {
  const id = useId();
  return (
    <div className="toolbar">
      <div className="toolbar-group" role="group" aria-label="Display mode">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            className="segment"
            aria-pressed={format.mode === mode.value}
            title={mode.title}
            onClick={() => onFormatChange({ ...format, mode: mode.value })}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <label className="toolbar-check" htmlFor={`${id}-ts`}>
        <input
          id={`${id}-ts`}
          type="checkbox"
          checked={format.timestamps}
          onChange={(e) => onFormatChange({ ...format, timestamps: e.target.checked })}
        />
        Timestamps
      </label>

      <button type="button" className="ghost" title="Clear the screen and scrollback" onClick={onClear}>
        Clear
      </button>

      <span className="toolbar-spacer" />

      <div className="toolbar-log">
        {log ? (
          <>
            <span className="log-path" title={log.path}>
              ● Logging to {baseName(log.path)}
              {log.includeTx && " (RX+TX)"}
            </span>
            <button type="button" className="ghost" title="Close the log file" onClick={onStopLog}>
              Stop log
            </button>
          </>
        ) : (
          <>
            <label className="toolbar-check" htmlFor={`${id}-tx`}>
              <input
                id={`${id}-tx`}
                type="checkbox"
                checked={logIncludeTx}
                onChange={(e) => onLogIncludeTxChange(e.target.checked)}
              />
              Log sent bytes too
            </label>
            <button
              type="button"
              className="ghost"
              title="Record raw received bytes to a file"
              onClick={onStartLog}
            >
              Log to file…
            </button>
          </>
        )}
      </div>
    </div>
  );
}
