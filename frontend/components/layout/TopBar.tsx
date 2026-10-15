"use client";

import { Moon, Power, Search, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Button, Segmented } from "@/components/ui/primitives";
import { API_MODE } from "@/lib/api/client";
import { useInstruments, useLoadSymbol } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";
import { cn } from "@/lib/utils";
import type { Instrument } from "@/types";

function InstrumentSearch({ instruments, current, onSelect }: { instruments: Instrument[]; current: string | null; onSelect: (s: string) => void }) {
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
    <div className="relative w-56 max-md:w-full">
      <Search size={13} aria-hidden className="pointer-events-none absolute left-2 top-2 text-subtle" />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Search instruments (press / to focus)"
        placeholder={current ? `${currentLabel} — search…` : "Search symbol…  ( / )"}
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
        className="h-8 w-full rounded-md border border-border bg-surface-2 pl-7 pr-2 text-xs placeholder:text-subtle"
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute left-0 top-9 z-50 max-h-72 w-80 overflow-auto rounded-md border border-border-strong bg-surface-2 p-1 shadow-xl">
          {canLoad && (
            <li role="option" aria-selected={active === 0} onMouseDown={(e) => { e.preventDefault(); loadSymbol(); }} className={cn("cursor-pointer rounded px-2 py-1.5", active === 0 && "bg-surface-3")}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{load.isPending ? `Loading ${typed}…` : `Load ${typed} from Yahoo Finance`}</span>
                <Badge tone="info">30m · 1 month</Badge>
              </div>
              <div className="text-[11px] text-muted">Recent completed regular-session bars, delayed. Not a live feed.</div>
              {load.isError && <div role="alert" className="mt-0.5 text-[11px] text-danger">{load.error instanceof Error ? load.error.message : "Could not load this symbol."}</div>}
            </li>
          )}
          {results.length === 0 && !canLoad && <li className="px-2 py-2 text-xs text-muted">No matching datasets. Upload one in Settings.</li>}
          {results.map((i, n) => (
            <li key={i.symbol} role="option" aria-selected={n + offset === active} onMouseDown={(e) => { e.preventDefault(); choose(i); }} className={cn("cursor-pointer rounded px-2 py-1.5", n + offset === active && "bg-surface-3")}>
              <div className="flex items-center justify-between gap-2"><span className="num font-semibold">{i.label ?? i.symbol}</span><Badge tone={i.source.kind === "fixture" ? "warn" : "neutral"}>{i.source.kind}</Badge></div>
              <div className="text-[11px] text-muted">{i.name}</div>
            </li>
          ))}
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
      const res = await fetch("/api/quit", { method: "POST", headers: { "X-MSI-Action": "quit" } });
      setStatus(res.ok ? "stopped" : "unavailable");
    } catch {
      setStatus("stopped"); // the server going down mid-request is the expected outcome
    }
  }
  if (status === "stopped") return <span role="status" className="text-xs text-muted">Stopped. You can close this tab.</span>;
  if (status === "unavailable") return <span role="status" className="text-xs text-danger">Quit needs start.bat. Stop the servers manually.</span>;
  return (
    <Button variant="ghost" size="sm" onClick={quit} disabled={status === "stopping"} title="Stop the frontend and backend (same as stop.bat)">
      <Power size={14} aria-hidden /> {status === "stopping" ? "Stopping…" : "Quit"}
    </Button>
  );
}

export function TopBar() {
  const { state, set, selectInstrument } = useWorkspace();
  const { data: instruments = [] } = useInstruments();
  const inst = instruments.find((i) => i.symbol === state.symbol) ?? null;
  const dates = inst ? [...inst.availableDates].sort().reverse() : [];

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2">
      <Link href="/" className="flex items-center gap-2 pr-1 font-semibold tracking-tight">
        <span aria-hidden className="grid h-6 w-6 place-items-center rounded bg-accent-soft text-[11px] font-bold text-accent">MS</span>
        <span className="max-sm:sr-only">Market Structure <span className="text-subtle">Terminal</span></span>
      </Link>

      <InstrumentSearch instruments={instruments} current={state.symbol} onSelect={selectInstrument} />

      <div className="min-w-0 max-md:order-last max-md:w-full">
        {inst ? (
          <div className="flex items-center gap-2" aria-live="polite">
            <span className="num text-sm font-semibold">{inst.label ?? inst.symbol}</span>
            <span className="truncate text-xs text-muted max-w-72">{inst.name}</span>
          </div>
        ) : <span className="text-xs text-subtle">No instrument selected</span>}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
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
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <span className="max-lg:sr-only">As of</span>
          <select
            aria-label="Historical date"
            disabled={!inst}
            value={state.date ?? ""}
            onChange={(e) => set({ date: e.target.value || null, replayTime: null, selectedEventId: null })}
            className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs disabled:opacity-50"
          >
            <option value="">Latest available</option>
            {dates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        {inst && (
          <Badge tone={inst.source.kind === "fixture" ? "warn" : inst.source.kind === "live" ? "ok" : "info"} title={inst.source.note}>
            {inst.source.kind === "fixture" ? "Fixture data" : inst.source.kind === "live" ? "Live" : "Historical"} · {inst.source.name}
          </Badge>
        )}
        <Link href="/settings" aria-label="Settings" className="inline-grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"><Settings size={15} aria-hidden /></Link>
        <QuitButton />
        <Button variant="ghost" size="icon" aria-label={state.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => set({ theme: state.theme === "dark" ? "light" : "dark" })}>
          {state.theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
        </Button>
      </div>
    </header>
  );
}
