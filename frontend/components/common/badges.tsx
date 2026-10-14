"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Eye, FlaskConical, History, Tag, TimerOff, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { STATUS_LABELS, fmtDateTime } from "@/lib/formatting";
import type { DataQuality, DetectionStatus, Profile } from "@/types";

export function EstimatedBadge({ profile }: { profile: Pick<Profile, "estimationMethod"> }) {
  return (
    <Badge tone="warn" title={profile.estimationMethod ?? "Derived from OHLCV bars; not exact volume-at-price."}>
      <FlaskConical size={11} aria-hidden /> Estimated Profile
    </Badge>
  );
}

const STATUS_ICON = { observed: Eye, provisional: CircleDashed, confirmed: CheckCircle2, invalidated: XCircle, expired: TimerOff, historical: History } as const;
const STATUS_TONE = { observed: "neutral", provisional: "warn", confirmed: "ok", invalidated: "danger", expired: "neutral", historical: "neutral" } as const;

/** Status uses icon + text, never color alone. */
export function StatusBadge({ status }: { status: DetectionStatus }) {
  const Icon = STATUS_ICON[status];
  return <Badge tone={STATUS_TONE[status]}><Icon size={11} aria-hidden />{STATUS_LABELS[status]}</Badge>;
}

export function ClassificationBadge() {
  return <Badge tone="info" title="A deterministic rule label applied to measured values. Participant intent is not observed."><Tag size={11} aria-hidden />Rule classification</Badge>;
}

export function HypothesisBadge() {
  return <Badge tone="hypothesis" title="An interpretation that cannot be verified from price and volume alone.">Hypothesis</Badge>;
}

export function ObservationBadge() {
  return <Badge tone="neutral" title="Measured directly from the data.">Observation</Badge>;
}

export function QualityIndicators({ quality, asOf }: { quality: DataQuality | undefined; asOf?: number | null }) {
  if (!quality) return null;
  const warnings = quality.issues.filter((i) => i.severity !== "info");
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Data quality">
      {quality.stale
        ? <Badge tone="warn"><Clock size={11} aria-hidden />Stale data</Badge>
        : <Badge tone="neutral" title="Freshness relative to the requested date"><Clock size={11} aria-hidden />Last bar {quality.lastBarAt ? fmtDateTime(quality.lastBarAt) : "—"}</Badge>}
      <Badge tone="neutral">{quality.barCount} bars</Badge>
      {!quality.hasVolume && <Badge tone="warn"><AlertTriangle size={11} aria-hidden />Volume incomplete</Badge>}
      {quality.profileEstimated && <Badge tone="warn" title="Volume-at-price is not exact.">Estimated profiles</Badge>}
      {warnings.map((w, n) => <Badge key={`${w.code}-${n}`} tone={w.severity === "error" ? "danger" : "warn"} title={w.message}><AlertTriangle size={11} aria-hidden />{w.code.replace(/_/g, " ")}</Badge>)}
      {asOf ? <span className="sr-only">Analysis as of {fmtDateTime(asOf, true)}</span> : null}
    </div>
  );
}
