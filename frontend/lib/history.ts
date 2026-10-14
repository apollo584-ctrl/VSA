/** Local-only record of analyses the user has viewed. Stored in the browser; never sent anywhere. */
export interface HistoryEntry {
  id: string;
  symbol: string;
  /** Display label (instrument ticker) when the key is a dataset id. */
  label?: string;
  /** Backend snapshot id, when the analysis was persisted. */
  snapshotId?: string;
  timeframe: string;
  session: string;
  date: string | null;
  asOf: number;
  headline: string;
  viewedAt: number; // ms epoch
}

const KEY = "mst.history.v1";
const MAX = 50;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function pushHistory(entry: Omit<HistoryEntry, "id" | "viewedAt">, now = Date.now()): HistoryEntry[] {
  const id = `${entry.symbol}|${entry.timeframe}|${entry.session}|${entry.asOf}`;
  const list = loadHistory().filter((e) => e.id !== id);
  const next = [{ ...entry, id, viewedAt: now }, ...list].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}

export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
