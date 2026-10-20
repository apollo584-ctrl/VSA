"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { DetailLevel, LayerKey, Layers, ProfileKind } from "@/types";

export type Theme = "dark" | "light";

export interface WorkspaceState {
  symbol: string | null;
  timeframe: string;
  session: string;
  /** Selected historical date (YYYY-MM-DD) or null for the latest available. */
  date: string | null;
  /** Replay cursor (unix seconds). null = at the end of the loaded window. */
  replayTime: number | null;
  layers: Layers;
  detailLevel: DetailLevel;
  profileKind: ProfileKind;
  selectedEventId: string | null;
  navCollapsed: boolean;
  theme: Theme;
}

export const DEFAULT_LAYERS: Layers = {
  candles: true, volume: true, tpo: false, volumeProfile: true, valueLevels: true, nodes: true, vsa: true, structure: true, auction: false,
};

const DEFAULT_STATE: WorkspaceState = {
  symbol: null, timeframe: "30m", session: "RTH", date: null, replayTime: null,
  layers: DEFAULT_LAYERS, detailLevel: "standard", profileKind: "volume", selectedEventId: null, navCollapsed: false, theme: "dark",
};

type Action =
  | { type: "hydrate"; state: Partial<WorkspaceState> }
  | { type: "set"; patch: Partial<WorkspaceState> }
  | { type: "toggleLayer"; key: LayerKey }
  | { type: "selectInstrument"; symbol: string };

function reducer(s: WorkspaceState, a: Action): WorkspaceState {
  switch (a.type) {
    case "hydrate": return { ...s, ...a.state, layers: { ...s.layers, ...(a.state.layers ?? {}) } };
    case "set": return { ...s, ...a.patch };
    case "toggleLayer": return { ...s, layers: { ...s.layers, [a.key]: !s.layers[a.key] } };
    case "selectInstrument": return { ...s, symbol: a.symbol, date: null, replayTime: null, selectedEventId: null };
  }
}

const STORAGE_KEY = "mst.workspace.v1";
const PERSISTED: (keyof WorkspaceState)[] = ["symbol", "timeframe", "session", "layers", "detailLevel", "profileKind", "navCollapsed", "theme"];

interface Ctx {
  state: WorkspaceState;
  /** True once saved preferences have been read from storage (the symbol is final only after this). */
  ready: boolean;
  set: (patch: Partial<WorkspaceState>) => void;
  toggleLayer: (k: LayerKey) => void;
  selectInstrument: (symbol: string) => void;
}

const WorkspaceContext = createContext<Ctx | null>(null);

export function WorkspaceProvider({ children, initial }: { children: ReactNode; initial?: Partial<WorkspaceState> }) {
  const [state, dispatch] = useReducer(reducer, { ...DEFAULT_STATE, ...initial });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) dispatch({ type: "hydrate", state: JSON.parse(raw) as Partial<WorkspaceState> });
      else if (window.matchMedia?.("(prefers-color-scheme: light)").matches) dispatch({ type: "set", patch: { theme: "light" } });
    } catch { /* storage unavailable — defaults apply */ }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return; // never overwrite stored preferences with defaults before hydration
    try {
      const out: Record<string, unknown> = {};
      for (const k of PERSISTED) out[k] = state[k];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch { /* ignore */ }
    document.documentElement.dataset.theme = state.theme;
  }, [state, ready]);

  const set = useCallback((patch: Partial<WorkspaceState>) => dispatch({ type: "set", patch }), []);
  const toggleLayer = useCallback((key: LayerKey) => dispatch({ type: "toggleLayer", key }), []);
  const selectInstrument = useCallback((symbol: string) => dispatch({ type: "selectInstrument", symbol }), []);
  const value = useMemo(() => ({ state, ready, set, toggleLayer, selectInstrument }), [state, ready, set, toggleLayer, selectInstrument]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceContext);
  if (!c) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return c;
}
