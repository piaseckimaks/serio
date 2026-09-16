import { useId } from "react";
import type { DisplayMode, RxFormatOptions } from "../lib/rxFormat";

interface Props {
  format: RxFormatOptions;
  onFormatChange: (format: RxFormatOptions) => void;
  onClear: () => void;
}

const MODES: { value: DisplayMode; label: string; title: string }[] = [
  { value: "text", label: "Text", title: "Render received bytes as a terminal" },
  { value: "hex", label: "Hex", title: "Show received bytes as a hex dump" },
];

/** Row between the connection bar and the terminal: view options. */
export function Toolbar({ format, onFormatChange, onClear }: Props) {
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

      <span className="toolbar-spacer" />

      <button type="button" className="ghost" title="Clear the screen and scrollback" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
