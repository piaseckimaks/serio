import { useEffect, useId, useRef, useState } from "react";
import type { Profile } from "../lib/profiles";

interface Props {
  profiles: Profile[];
  /** Name of the profile matching the current settings, or empty. */
  activeName: string;
  /** Default name offered when saving. */
  suggestedName: string;
  disabled: boolean;
  onSelect: (profile: Profile) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}

/**
 * Profile dropdown with inline save/delete. The selection is derived from
 * the current settings, so editing any field deselects the profile until
 * it is saved again.
 */
export function ProfilePicker({
  profiles,
  activeName,
  suggestedName,
  disabled,
  onSelect,
  onSave,
  onDelete,
}: Props) {
  const id = useId();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) inputRef.current?.select();
  }, [naming]);

  const beginSave = () => {
    setName(activeName || suggestedName);
    setNaming(true);
  };

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
    setNaming(false);
  };

  const exists = profiles.some((p) => p.name === name.trim());

  return (
    <div className="field field-profile">
      <label htmlFor={`${id}-profile`}>Profile</label>
      <div className="port-row">
        {naming ? (
          <>
            <input
              ref={inputRef}
              id={`${id}-profile`}
              type="text"
              value={name}
              placeholder="Profile name"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setNaming(false);
              }}
            />
            <button
              type="button"
              className="primary"
              disabled={name.trim().length === 0}
              title={exists ? "Overwrite this profile" : "Save as a new profile"}
              onClick={commit}
            >
              {exists ? "Overwrite" : "Save"}
            </button>
            <button type="button" className="ghost" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <select
              id={`${id}-profile`}
              value={activeName}
              disabled={disabled}
              onChange={(e) => {
                const profile = profiles.find((p) => p.name === e.target.value);
                if (profile) onSelect(profile);
              }}
            >
              <option value="">{profiles.length === 0 ? "No saved profiles" : "Custom settings"}</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghost"
              title="Save the current settings as a profile"
              disabled={disabled}
              onClick={beginSave}
            >
              Save…
            </button>
            {activeName && (
              <button
                type="button"
                className="ghost"
                title={`Delete profile "${activeName}"`}
                disabled={disabled}
                onClick={() => onDelete(activeName)}
              >
                Delete
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
