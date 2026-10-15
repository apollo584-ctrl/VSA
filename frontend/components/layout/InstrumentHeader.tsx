"use client";

import type { ReactNode } from "react";
import { History } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui/primitives";
import type { Market } from "@/components/common/AnalysisGate";
import { fmtDateTime, fmtPrice } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import type { Bar } from "@/types";

const etDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** Last close and its change from the previous session's last close, both from visible bars only. */
function lastAndChange(bars: Bar[]) {
  const last = bars[bars.length - 1];
  if (!last) return null;
  const day = etDay.format(last.t * 1000);
  const prior = bars.findLast((b) => etDay.format(b.t * 1000) !== day);
  const change = prior ? last.c - prior.c : null;
  return { last, change, pct: prior && change !== null ? (change / prior.c) * 100 : null };
}

/** Page title plus the selected instrument, its latest visible price and the analysis point in time. */
export function AnalysisPageHeader({ title, description, market, actions }: { title: string; description?: ReactNode; market: Market; actions?: ReactNode }) {
  const inst = market.instrument;
  const px = lastAndChange(market.bars);
  const symbol = inst ? (inst.label ?? inst.symbol).split(" · ")[0] : null;
  return (
    <PageHeader title={title} description={description} actions={actions}>
      {inst && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2" aria-live="polite">
          <span className="text-xl font-semibold tracking-tight">{symbol}</span>
          {px && (
            <span className="flex items-baseline gap-2">
              <span className="num text-xl font-semibold">{fmtPrice(px.last.c)}</span>
              {px.change !== null && px.pct !== null && (
                <span className={cn("num text-sm font-medium", px.change >= 0 ? "text-up" : "text-down")}>
                  {px.change >= 0 ? "+" : ""}{fmtPrice(px.change)} ({px.pct >= 0 ? "+" : ""}{px.pct.toFixed(2)}%)
                </span>
              )}
            </span>
          )}
          <span className="text-sm text-subtle">{inst.name}</span>
          <Badge tone={inst.source.kind === "fixture" ? "warn" : inst.source.kind === "live" ? "ok" : "info"} title={inst.source.note}>
            {inst.source.kind === "fixture" ? "Fixture data" : inst.source.kind === "live" ? "Live" : "Historical"}
          </Badge>
          {market.replaying && market.asOf !== null && (
            <Badge tone="info" title="Only information available at this bar is shown."><History size={12} aria-hidden />Replay · as of {fmtDateTime(market.asOf, true)}</Badge>
          )}
        </div>
      )}
    </PageHeader>
  );
}
