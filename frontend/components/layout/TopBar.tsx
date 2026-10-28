"use client";

import { Lock, Moon, Power, RefreshCw, Search, Sun, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Segmented } from "@/components/ui/primitives";
import { API_MODE, api } from "@/lib/api/client";
import { backendApi } from "@/lib/api/backend/client";
import { ApiError } from "@/lib/api/errors";
import { useAuthStatus, useInstruments, useLoadSymbol, useLogout } from "@/hooks/data";
import { useHiddenInstruments } from "@/hooks/hiddenInstruments";
import { useWorkspace } from "@/hooks/workspace";
import { cn } from "@/lib/utils";
import type { Instrument } from "@/types";

function InstrumentSearch({ instruments, current, onSelect, hiddenCount, onClearList, onRestore }: {
  instruments: Instrument[]; current: string | null; onSelect: (s: string) => void;
  hiddenCount: number; onClearList: () => void; onRestore: () => void;
}) {
  const currentLabel = instruments.find((i) => i.symbol === current)?.label ?? current;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const load = useLoadSymbol();
  const typed = query.trim().toUpperCase();
  const canLoad = API_MODE === "http" && /^[A-Z][A-Z0-9.\-]{0,15}$/.test(typed);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return instruments.filter((i) => !q || i.symbol.toLowerCase().includes(q) || (i.label ?? "").toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
  }, [instruments, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = (i: Instrument) => { load.reset(); onSelect(i.symbol); setQuery(""); setOpen(false); inputRef.current?.blur(); };
  // Row 0 is the "load this symbol" action when the typed text looks like a ticker.
  const loadSymbol = () => {
    if (!canLoad || load.isPending) return;
    load.mutate(typed, { onSuccess: ({ datasetId }) => { onSelect(datasetId); setQuery(""); setOpen(false); inputRef.current?.blur(); } });
  };
  const offset = canLoad ? 1 : 0;

  return (
    <div className="relative w-full max-w-md">
      <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Search instruments (press / to focus)"
        placeholder={current ? `Search or load a symbol — now ${currentLabel}` : "Search or load a symbol, e.g. AAPL"}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1 + offset)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && canLoad && active === 0) loadSymbol();
          else if (e.key === "Enter" && results[active - offset]) choose(results[active - offset]!);
          else if (e.key === "Escape") setOpen(false);
        }}
        className="h-10 w-full rounded-xl border border-border bg-surface-2 pl-10 pr-10 text-sm placeholder:text-subtle focus:border-accent/60 focus:bg-surface focus:outline-none"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          // mousedown keeps focus in the box, so the list stays open after clearing
          onMouseDown={(e) => { e.preventDefault(); setQuery(""); setActive(0); setOpen(true); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-subtle hover:bg-surface-3 hover:text-fg"
        >
          <X size={15} aria-hidden />
        </button>
      ) : (
        <kbd aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-border px-1.5 text-xs text-subtle">/</kbd>
      )}
      {open && (
        <ul id={listId} role="listbox" className="absolute left-0 top-12 z-50 max-h-96 w-full min-w-80 overflow-auto rounded-xl border border-border-strong bg-surface p-1.5 shadow-2xl">
          {canLoad && (
            <li role="option" aria-selected={active === 0} onMouseDown={(e) => { e.preventDefault(); loadSymbol(); }} className={cn("cursor-pointer rounded-lg px-3 py-2.5", active === 0 && "bg-surface-2")}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{load.isPending ? `Loading ${typed}…` : `Load ${typed} from Yahoo Finance`}</span>
                <Badge tone="info">30m · 1 month</Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted">Recent completed regular-session bars, delayed. Not a live feed.</div>
              {load.isError && <div role="alert" className="mt-0.5 text-xs text-danger">{load.error instanceof Error ? load.error.message : "Could not load this symbol."}</div>}
            </li>
          )}
          {results.length === 0 && !canLoad && <li className="px-3 py-3 text-sm text-muted">{hiddenCount > 0 && !query ? "List cleared. Type a ticker to load one, or show the cleared symbols below." : "No matching datasets. Type a ticker to load one, or upload a CSV in Settings."}</li>}
          {results.map((i, n) => (
            <li key={i.symbol} role="option" aria-selected={n + offset === active} onMouseDown={(e) => { e.preventDefault(); choose(i); }} className={cn("cursor-pointer rounded-lg px-3 py-2.5", n + offset === active && "bg-surface-2")}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{i.label ?? i.symbol}</span><Badge tone={i.source.kind === "fixture" ? "warn" : "neutral"}>{i.source.kind}</Badge></div>
              <div className="mt-0.5 text-xs text-muted">{i.name}</div>
            </li>
          ))}
          {!query && (results.length > 0 || hiddenCount > 0) && (
            <li role="presentation" className="sticky -bottom-1.5 z-10 mt-1 flex items-center justify-between gap-3 border-t border-border bg-surface px-3 pb-2 pt-2 text-xs">
              {results.length > 0 ? (
                <button type="button" title="Hide every symbol in this list. Saved data and analyses are kept." onMouseDown={(e) => { e.preventDefault(); onClearList(); setOpen(true); }} className="text-muted hover:text-fg">Clear all</button>
              ) : <span />}
              {hiddenCount > 0 && <button type="button" onMouseDown={(e) => { e.preventDefault(); onRestore(); setOpen(true); }} className="text-accent hover:underline">Show {hiddenCount} cleared</button>}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Stops the frontend and backend, the same as stop.bat. Only works when started with start.bat. */
function QuitButton() {
  const [status, setStatus] = useState<"idle" | "stopping" | "stopped" | "unavailable">("idle");
  async function quit() {
    if (!window.confirm("Stop the terminal and the analysis backend? Close this tab afterwards.")) return;
    setStatus("stopping");
    try {
      await backendApi.quit();
      setStatus("stopped");
    } catch (e) {
      // status 0 = the server went down mid-request, the expected outcome; anything else was refused
      setStatus(e instanceof ApiError && e.status !== 0 ? "unavailable" : "stopped");
    }
  }
  if (status === "stopped") return <span role="status" className="text-xs text-muted">Stopped. You can close this tab.</span>;
  if (status === "unavailable") return <span role="status" className="text-xs text-danger">Quit needs start.bat. Stop the servers manually.</span>;
  return (
    <Button variant="ghost" onClick={quit} disabled={status === "stopping"} title="Stop the frontend and backend (same as stop.bat)">
      <Power size={16} aria-hidden /> <span className="max-sm:sr-only">{status === "stopping" ? "Stopping…" : "Quit"}</span>
    </Button>
  );
}

const tickerOf = (label: string) => label.split(" · ")[0]!;

/** Re-fetches every listed stock (3 at a time), selects the new copy of the one on screen, then starts the 503-stock history update. */
function RefreshButton({ instruments, current, onLoaded }: { instruments: Instrument[]; current: string | null; onLoaded: (datasetId: string) => void }) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<{ ticker: string; message: string }[]>([]);
  const [total, setTotal] = useState(0);
  const running = progress !== null;
  // The selection at the end of the run decides: a stock picked while refreshing is not replaced.
  const currentRef = useRef(current);
  currentRef.current = current;

  async function refreshAll() {
    const tickers = [...new Set(instruments.map((i) => tickerOf(i.label ?? i.symbol)))];
    const currentTicker = tickerOf(instruments.find((i) => i.symbol === current)?.label ?? current ?? "");
    const ids = new Map<string, string>();
    const failed: { ticker: string; message: string }[] = [];
    let next = 0, done = 0;
    setFailures([]); setTotal(tickers.length); setProgress({ done: 0, total: tickers.length });
    const worker = async () => {
      while (next < tickers.length) {
        const ticker = tickers[next++]!;
        try { ids.set(ticker, (await api.loadSymbol(ticker)).datasetId); }
        catch (e) { failed.push({ ticker, message: e instanceof Error ? e.message : "Could not refresh." }); }
        setProgress({ done: ++done, total: tickers.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, tickers.length) }, worker));
    await qc.invalidateQueries({ queryKey: ["instruments"] });
    const newId = ids.get(currentTicker);
    if (newId && currentRef.current === current) onLoaded(newId);
    try { await api.collectIntraday(); } catch { /* already running or unavailable: the list refresh still counts */ }
    void qc.invalidateQueries({ queryKey: ["intraday"] });
    setFailures(failed); setProgress(null);
  }

  return (
    <>
      {failures.length > 0 && !running && (
        <span role="alert" className="max-w-48 truncate text-xs text-danger" title={failures.map((f) => `${f.ticker}: ${f.message}`).join("\n")}>
          {failures.length} of {total} stocks could not refresh
        </span>
      )}
      <Button variant="ghost" onClick={refreshAll} disabled={running} title="Fetch the latest bars for every stock in your list and update the 503-stock history in the background">
        <RefreshCw size={16} aria-hidden className={cn(running && "animate-spin")} /> <span className="max-sm:sr-only">{running ? `Refreshing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "Refresh"}</span>
      </Button>
    </>
  );
}

/** Remote devices only: ends the PIN session and returns to the PIN screen. */
function LockButton() {
  const { data } = useAuthStatus(API_MODE === "http");
  const logout = useLogout();
  if (!data || data.local || !data.authenticated) return null;
  return (
    <Button variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending} title="Lock this device (asks for the PIN again)">
      <Lock size={16} aria-hidden /> <span className="max-sm:sr-only">Lock</span>
    </Button>
  );
}

export function TopBar() {
  const { state, set, selectInstrument } = useWorkspace();
  const { data: instruments = [] } = useInstruments();
  const [hidden, setHidden] = useHiddenInstruments();
  const visible = useMemo(() => instruments.filter((i) => !hidden.includes(i.symbol)), [instruments, hidden]);
  const hiddenCount = instruments.length - visible.length;
  const inst = instruments.find((i) => i.symbol === state.symbol) ?? null;
  const select = (id: string) => { if (hidden.includes(id)) setHidden(hidden.filter((h) => h !== id)); selectInstrument(id); };
  const clearList = () => {
    setHidden([...new Set([...hidden, ...instruments.map((i) => i.symbol)])]);
    if (state.symbol) set({ symbol: null, date: null, replayTime: null, selectedEventId: null });
  };
  const dates = inst ? [...inst.availableDates].sort().reverse() : [];

  return (
    <header className="relative z-40 flex min-h-16 shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-border bg-surface/80 px-6 py-3 backdrop-blur max-sm:gap-y-2 max-sm:px-4">
      <InstrumentSearch instruments={visible} current={state.symbol} onSelect={select} hiddenCount={hiddenCount} onClearList={clearList} onRestore={() => setHidden([])} />

      <div className="ml-auto flex flex-wrap items-center gap-3 max-sm:ml-0 max-sm:gap-2">
        <Segmented
          label="Timeframe"
          value={state.timeframe}
          onChange={(v) => set({ timeframe: v, replayTime: null })}
          options={(inst?.timeframes ?? ["30m", "1D"]).map((t) => ({ value: t, label: t }))}
        />
        <Segmented
          label="Session"
          value={state.session}
          onChange={(v) => set({ session: v, replayTime: null })}
          options={["RTH", "ETH", "ALL"].map((s) => ({ value: s, label: s, disabled: !!inst && !inst.sessions.includes(s), title: inst && !inst.sessions.includes(s) ? "Not available for this dataset" : undefined }))}
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <span className="max-lg:sr-only">As of</span>
          <select
            aria-label="Historical date"
            disabled={!inst}
            value={state.date ?? ""}
            onChange={(e) => set({ date: e.target.value || null, replayTime: null, selectedEventId: null })}
            className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg disabled:opacity-50"
          >
            <option value="">Latest available</option>
            {dates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <span aria-hidden className="h-6 w-px bg-border max-sm:hidden" />
        <Button variant="ghost" size="icon" aria-label={state.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => set({ theme: state.theme === "dark" ? "light" : "dark" })}>
          {state.theme === "dark" ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
        </Button>
        {API_MODE === "http" && visible.length > 0 && <RefreshButton instruments={visible} current={state.symbol} onLoaded={select} />}
        <LockButton />
        <QuitButton />
      </div>
    </header>
  );
}
