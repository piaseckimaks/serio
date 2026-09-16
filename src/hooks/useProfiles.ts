import { useCallback, useMemo, useState } from "react";
import {
  type KeyValueStorage,
  loadProfiles,
  type Profile,
  removeProfile,
  saveProfile,
} from "../lib/profiles";

/** localStorage, or a throwaway store when the webview refuses access. */
export function defaultStorage(): KeyValueStorage {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Fall through.
  }
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Saved connection profiles, kept in sync with storage. */
export function useProfiles(storage?: KeyValueStorage) {
  const store = useMemo(() => storage ?? defaultStorage(), [storage]);
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles(store));

  const save = useCallback((profile: Profile) => setProfiles(saveProfile(store, profile)), [store]);
  const remove = useCallback((name: string) => setProfiles(removeProfile(store, name)), [store]);

  return { profiles, save, remove, storage: store };
}
