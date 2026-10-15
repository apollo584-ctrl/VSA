"use client";

import { useSyncExternalStore } from "react";

const KEY = "mst.hiddenInstruments.v1";
const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let lastRaw: string | null | undefined;
let lastValue: string[] = EMPTY;

function parse(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : EMPTY;
  } catch {
    return EMPTY; // malformed: show everything
  }
}

// Reference-stable while the stored text is unchanged, as useSyncExternalStore requires.
function getSnapshot(): string[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  if (raw !== lastRaw) { lastRaw = raw; lastValue = parse(raw); }
  return lastValue;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}

function setHidden(next: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not persisted */ }
  listeners.forEach((l) => l());
}

/** Symbols the user cleared from the search list. Browser-local: nothing is deleted from the backend. */
export function useHiddenInstruments() {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return [hidden, setHidden] as const;
}
