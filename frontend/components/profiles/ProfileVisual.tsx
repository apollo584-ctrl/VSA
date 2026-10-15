"use client";

import { useMemo } from "react";
import type { Profile, ProfileKind } from "@/types";
import { fmtPrice } from "@/lib/formatting";
import { cn } from "@/lib/utils";

/**
 * Standalone Market Profile rendering (SVG). Draws the backend's bins horizontally with POC / value area /
 * HVN / LVN / initial balance / session extremes, and marks distributions. Pure presentation.
 */
export function ProfileVisual({ profile, weight, currentPrice, className, compact = false }: {
  profile: Profile; weight: "tpo" | "volume"; currentPrice?: number | null; className?: string; compact?: boolean;
}) {
  const W = compact ? 340 : 480;
  const rowH = compact ? 6 : 8;
  const bins = useMemo(() => [...profile.bins].sort((a, b) => b.price - a.price), [profile.bins]);
  const H = Math.max(120, bins.length * rowH + 24);
  const labelW = 64;
  // Right gutter fits "VAH 1234.56" at the label font size, so level labels are never clipped.
  const plotX = labelW, plotW = W - labelW - 96;
  const max = Math.max(...bins.map((b) => b[weight]), 1);
  const yOf = (price: number) => 12 + (bins.findIndex((b) => b.price <= price) === -1 ? bins.length : bins.findIndex((b) => b.price <= price)) * rowH;
  const lines: { price: number; label: string; color: string; dash?: string }[] = [
    { price: profile.poc, label: "POC", color: "var(--poc)" },
    { price: profile.vah, label: "VAH", color: "var(--value)", dash: "4 3" },
    { price: profile.val, label: "VAL", color: "var(--value)", dash: "4 3" },
    ...(profile.initialBalance && !compact ? [{ price: profile.initialBalance.high, label: "IB hi", color: "var(--ib)", dash: "2 3" }, { price: profile.initialBalance.low, label: "IB lo", color: "var(--ib)", dash: "2 3" }] : []),
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("w-full", className)} role="img" aria-label={`${profile.label} profile: POC ${fmtPrice(profile.poc)}, value area ${fmtPrice(profile.val)} to ${fmtPrice(profile.vah)}${profile.estimated ? ", estimated" : ""}`}>
      {bins.map((b, i) => {
        const y = 12 + i * rowH;
        const w = (b[weight] / max) * plotW;
        const inVA = b.price >= profile.val && b.price <= profile.vah;
        const isPoc = Math.abs(b.price - profile.poc) < profile.binSize / 2;
        return <rect key={b.price} x={plotX} y={y} width={Math.max(0.5, w)} height={rowH - 1} fill={isPoc ? "var(--poc)" : "var(--value)"} opacity={isPoc ? 0.9 : inVA ? 0.55 : 0.25} />;
      })}
      {profile.shape.distributions.length > 1 && profile.shape.distributions.map((d, i) => (
        <g key={i}>
          <rect x={plotX - 4} y={yOf(d.high)} width={2} height={Math.max(2, yOf(d.low) - yOf(d.high))} fill="var(--hvn)" />
          {!compact && <text x={plotX - 7} y={(yOf(d.high) + yOf(d.low)) / 2 + 3} fontSize={10} fill="var(--hvn)" textAnchor="end">D{i + 1}</text>}
        </g>
      ))}
      {lines.map((l) => (
        <g key={l.label}>
          <line x1={plotX} x2={plotX + plotW} y1={yOf(l.price)} y2={yOf(l.price)} stroke={l.color} strokeWidth={1} strokeDasharray={l.dash} />
          <text x={plotX + plotW + 4} y={yOf(l.price) + 3} fontSize={11} fill={l.color}>{l.label} {fmtPrice(l.price)}</text>
        </g>
      ))}
      {!compact && profile.hvns.map((p) => <text key={`h${p}`} x={plotX + plotW + 4} y={yOf(p) + 12} fontSize={10} fill="var(--hvn)">HVN {fmtPrice(p)}</text>)}
      {!compact && profile.lvns.map((p) => <text key={`l${p}`} x={plotX + plotW + 4} y={yOf(p) + 3} fontSize={10} fill="var(--lvn)">LVN {fmtPrice(p)}</text>)}
      {currentPrice != null && currentPrice >= profile.sessionLow - profile.binSize && currentPrice <= profile.sessionHigh + profile.binSize && (
        <g>
          <line x1={2} x2={plotX + 6} y1={yOf(currentPrice)} y2={yOf(currentPrice)} stroke="var(--fg)" strokeWidth={1.2} />
          <text x={2} y={yOf(currentPrice) - 3} fontSize={11} fill="var(--fg)">Last {fmtPrice(currentPrice)}</text>
        </g>
      )}
      {[profile.sessionHigh, profile.sessionLow].map((p, i) => (
        <text key={i} x={plotX} y={yOf(p) + (i ? 11 : -2)} fontSize={10} fill="var(--fg-muted)">{i ? "Low" : "High"} {fmtPrice(p)}</text>
      ))}
    </svg>
  );
}

export const PROFILE_KINDS: { value: ProfileKind; label: string; hint: string }[] = [
  { value: "tpo", label: "TPO", hint: "Time at price — one count per bar per price bin." },
  { value: "volume", label: "Volume", hint: "Volume at price for the current session to date." },
  { value: "developing", label: "Developing", hint: "Session to date, with POC/VAH/VAL path as it formed." },
  { value: "prior", label: "Prior session", hint: "The previous completed session." },
  { value: "composite", label: "Composite", hint: "Several sessions combined." },
];
