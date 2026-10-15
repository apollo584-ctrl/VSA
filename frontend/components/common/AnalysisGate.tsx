"use client";

import type { ReactNode } from "react";
import { useMarket } from "@/hooks/data";
import { useHiddenInstruments } from "@/hooks/hiddenInstruments";
import { useWorkspace } from "@/hooks/workspace";
import { Badge, Button, GLOSSARY, InfoTip, KeyValue, Term } from "@/components/ui/primitives";
import { auctionLabel, fmtPct, fmtPrice, humanize } from "@/lib/formatting";
import type { Analysis, Level } from "@/types";
import { LOCATION_LABEL, locationReason } from "@/lib/location";
import { EmptyChartState, ErrorState, InsufficientDataState, InvalidDataState, LoadingState, NoDatasetState, StateMessage } from "./states";
import { FlaskConical } from "lucide-react";

export type Market = ReturnType<typeof useMarket>;

/** Handles the "can we show anything at all" states before a screen renders its content. */
export function AnalysisGate({ market, children }: { market: Market; children: ReactNode }) {
  const { selectInstrument } = useWorkspace();
  const [hidden] = useHiddenInstruments();
  if (!market.symbol) {
    const listed = (market.instruments.data ?? []).filter((i) => !hidden.includes(i.symbol));
    return (
      <NoDatasetState
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {listed.map((i) => <Button key={i.symbol} onClick={() => selectInstrument(i.symbol)}>{i.label ?? i.symbol}</Button>)}
            {market.instruments.isSuccess && market.instruments.data.length > 0 && listed.length === 0 && <span className="text-xs text-muted">List cleared. Search above to load a symbol, or show the cleared ones from the search list.</span>}
            {market.instruments.isSuccess && market.instruments.data.length === 0 && <span className="text-xs text-muted">No datasets yet. <a className="text-accent hover:underline" href="/settings">Upload a CSV in Settings</a>.</span>}
            {market.instruments.isError && <span className="text-xs text-danger">Instrument list unavailable.</span>}
          </div>
        }
      />
    );
  }
  if (market.error && !market.barsResponse) return <ErrorState error={market.error} onRetry={market.refetch} />;
  if (market.isLoading && !market.barsResponse) return <LoadingState />;
  if (market.barsResponse && market.allBars.length === 0) return <EmptyChartState />;
  return <>{children}</>;
}

/** Non-fatal analysis problems (chart remains viewable). */
export function AnalysisStatusBanner({ analysis, error }: { analysis: Analysis | null; error: Error | null }) {
  if (error) return <div className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger" role="alert">Analysis could not be refreshed: {error.message.replace(/\.+$/, "")}. Chart data may be shown without current annotations.</div>;
  if (!analysis) return null;
  if (analysis.status === "insufficient_data") return <InsufficientDataState message={analysis.statusMessage} />;
  if (analysis.status === "invalid_data") return <InvalidDataState message={analysis.statusMessage} />;
  return null;
}

export function ValueLocationCard({ analysis }: { analysis: Analysis }) {
  const v = analysis.valueLocation;
  if (!v) return <p className="text-xs text-subtle">Value location unavailable.</p>;
  const ctx = v.context;
  const label = ctx ? LOCATION_LABEL[ctx.state] : "Not classified";
  // Levels come with the classification when supplied, so they always belong to the reference session used.
  const prof = ctx ? (ctx.state === "unavailable" ? null : { vah: ctx.vah, poc: ctx.poc, val: ctx.val }) : analysis.profiles.prior;
  const note = ctx
    ? (ctx.state === "unavailable" ? `No usable prior value area: ${locationReason(ctx.unavailableReason)}.` : "Inside value includes the VAL and VAH boundaries. Location describes where price is relative to value; it is not a directional signal.")
    : "This snapshot was saved before price location was recorded, so it is not classified. The last close and prior value area are shown as supplied.";
  const classified = !!ctx && ctx.state !== "unavailable";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={ctx?.state === "unavailable" ? "warn" : "neutral"}>{label}</Badge>
        <span className="text-sm">Close <b className="num font-semibold">{fmtPrice(v.price)}</b></span>
        {classified ? <InfoTip>{note}</InfoTip> : null}
      </div>
      {prof ? (
        <dl className="grid grid-cols-3 gap-2 text-center">
          {([["VAH", GLOSSARY.VAH, prof.vah], ["POC", GLOSSARY.POC, prof.poc], ["VAL", GLOSSARY.VAL, prof.val]] as const).map(([k, hint, value]) => (
            <div key={k} className="rounded-lg bg-surface-2 px-2 py-1.5">
              <dt className="text-xs text-subtle"><Term hint={hint}>Prior {k}</Term></dt>
              <dd className="num text-sm font-medium">{fmtPrice(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {v.distanceFromPocPct !== null && <p className="text-xs text-muted">vs prior POC {fmtPct(v.distanceFromPocPct)}</p>}
      <p className="text-xs text-subtle">{v.referenceProfile}</p>
      {!classified && <p className="text-xs text-subtle">{note}</p>}
    </div>
  );
}

export function AuctionSummaryCard({ analysis }: { analysis: Analysis }) {
  const s = analysis.auctionStates[analysis.auctionStates.length - 1];
  if (!s) return <p className="text-xs text-subtle">No auction state classified yet.</p>;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2"><span className="text-sm font-semibold">{auctionLabel(s.kind)}</span>{s.endTime === null && <Badge tone="info">Current</Badge>}</div>
      <p className="text-xs text-muted">{s.summary}</p>
    </div>
  );
}

export function KeyLevelsTable({ levels }: { levels: Level[] }) {
  if (!levels.length) return <p className="text-xs text-subtle">No structural levels available.</p>;
  const sorted = [...levels].sort((a, b) => b.price - a.price);
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Structural levels</caption>
      <tbody>
        {sorted.map((l) => (
          <tr key={l.id} className="border-t border-border first:border-0" title={l.note}>
            <td className="py-0.5 text-muted">{l.label}</td>
            <td className="num text-right">{fmtPrice(l.price)}</td>
            <td className="pl-2 text-xs text-subtle">{humanize(l.kind)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MockNotice() {
  return (
    <StateMessage icon={FlaskConical} tone="warn" title="Mock mode">Responses come from synthetic fixtures.</StateMessage>
  );
}

/** Renders children only for a usable analysis; otherwise the right loading / insufficient / invalid state. */
export function AnalysisBody({ analysis, error, children }: { analysis: Analysis | null; error?: Error | null; children: (a: Analysis) => ReactNode }) {
  if (!analysis) return error ? <ErrorState error={error} /> : <LoadingState label="Loading analysis…" />;
  if (analysis.status === "insufficient_data") return <InsufficientDataState message={analysis.statusMessage} />;
  if (analysis.status === "invalid_data") return <InvalidDataState message={analysis.statusMessage} />;
  return <>{children(analysis)}</>;
}
