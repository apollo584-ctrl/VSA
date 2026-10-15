"use client";

import type { ReactNode } from "react";
import { useMarket } from "@/hooks/data";
import { useWorkspace } from "@/hooks/workspace";
import { Badge, Button, GLOSSARY, KeyValue, Term } from "@/components/ui/primitives";
import { auctionLabel, fmtPct, fmtPrice, humanize } from "@/lib/formatting";
import type { Analysis, Level } from "@/types";
import { EmptyChartState, ErrorState, InsufficientDataState, InvalidDataState, LoadingState, NoDatasetState, StateMessage } from "./states";
import { FlaskConical } from "lucide-react";

export type Market = ReturnType<typeof useMarket>;

/** Handles the "can we show anything at all" states before a screen renders its content. */
export function AnalysisGate({ market, children }: { market: Market; children: ReactNode }) {
  const { selectInstrument } = useWorkspace();
  if (!market.symbol) {
    return (
      <NoDatasetState
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {(market.instruments.data ?? []).map((i) => <Button key={i.symbol} onClick={() => selectInstrument(i.symbol)}>{i.label ?? i.symbol}</Button>)}
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
  const label = { above_value: "Above prior value", inside_value: "Inside prior value", below_value: "Below prior value", unknown: "Not classified" }[v.relativeTo];
  const prof = analysis.profiles.prior;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2"><Badge tone="neutral">{label}</Badge><span className="text-xs text-subtle">{v.referenceProfile}</span></div>
      <dl className="text-xs">
        <KeyValue k="Last close" v={fmtPrice(v.price)} />
        {prof && (<>
          <KeyValue k={<Term hint={GLOSSARY.VAH}>Prior VAH</Term>} v={fmtPrice(prof.vah)} />
          <KeyValue k={<Term hint={GLOSSARY.POC}>Prior POC</Term>} v={fmtPrice(prof.poc)} />
          <KeyValue k={<Term hint={GLOSSARY.VAL}>Prior VAL</Term>} v={fmtPrice(prof.val)} />
        </>)}
        <KeyValue k="vs prior POC" v={fmtPct(v.distanceFromPocPct)} />
      </dl>
      <p className="text-xs text-subtle">{v.relativeTo === "unknown" ? "The engine does not classify price location relative to value. The prior value area and last close are shown as supplied." : "Location describes where price is relative to value; it is not a directional signal."}</p>
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
