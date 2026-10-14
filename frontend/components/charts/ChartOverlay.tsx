"use client";

import type { AuctionState, Bar, Profile, VsaEvent } from "@/types";
import type { ChartPalette } from "@/lib/charting/theme";
import { withAlpha } from "@/lib/charting/theme";
import { AUCTION_LABELS } from "@/lib/formatting";
import { barTimeContaining } from "@/lib/replay";

export interface OverlayProps {
  width: number;
  height: number;
  /** Width of the plot area (excluding the price scale). */
  plotWidth: number;
  palette: ChartPalette;
  priceToY: (p: number) => number | null;
  timeToX: (t: number) => number | null;
  barWidth: number;
  bars: Bar[];
  volumeProfile: Profile | null;
  tpoProfile: Profile | null;
  showVolumeProfile: boolean;
  showTpo: boolean;
  showNodes: boolean;
  showAuction: boolean;
  states: AuctionState[];
  selected: VsaEvent | null;
  selectedProfileRefs: { label: string; price: number }[];
  developing: Profile | null;
  showValueLevels: boolean;
}

/**
 * SVG layer drawn above the Lightweight Chart canvas. Pure presentation of backend-supplied bins, levels and
 * states; it performs coordinate conversion only.
 */
export function ChartOverlay(p: OverlayProps) {
  const { palette: c } = p;
  const els: React.ReactNode[] = [];
  const profMaxW = Math.min(190, p.plotWidth * 0.2);

  const drawHist = (profile: Profile, anchor: "right" | "left", weightKey: "volume" | "tpo", color: string, keyPrefix: string) => {
    const max = Math.max(...profile.bins.map((b) => b[weightKey]), 1);
    const x0 = anchor === "right" ? p.plotWidth - 4 : 4;
    const half = Math.abs((p.priceToY(profile.bins[0]!.price) ?? 0) - (p.priceToY(profile.bins[0]!.price + profile.binSize) ?? 0)) / 2;
    for (const bin of profile.bins) {
      const y = p.priceToY(bin.price);
      if (y === null) continue;
      const w = (bin[weightKey] / max) * profMaxW;
      const inVA = bin.price >= profile.val && bin.price <= profile.vah;
      const isPoc = Math.abs(bin.price - profile.poc) < profile.binSize / 2;
      const h = Math.max(1, half * 2 - 0.8);
      els.push(
        <rect
          key={`${keyPrefix}-${bin.price}`}
          x={anchor === "right" ? x0 - w : x0}
          y={y - h / 2}
          width={Math.max(0.5, w)}
          height={h}
          fill={isPoc ? c.poc : color}
          opacity={isPoc ? 0.85 : inVA ? 0.5 : 0.28}
        />,
      );
    }
    if (p.showNodes) {
      for (const price of profile.hvns) {
        const y = p.priceToY(price);
        if (y !== null) els.push(<text key={`${keyPrefix}-hvn-${price}`} x={anchor === "right" ? p.plotWidth - 8 - profMaxW - 4 : 8 + profMaxW + 4} y={y + 3} fontSize={10} fill={c.hvn} textAnchor={anchor === "right" ? "end" : "start"}>HVN</text>);
      }
      for (const price of profile.lvns) {
        const y = p.priceToY(price);
        if (y !== null) els.push(<text key={`${keyPrefix}-lvn-${price}`} x={anchor === "right" ? p.plotWidth - 8 - profMaxW - 4 : 8 + profMaxW + 4} y={y + 3} fontSize={10} fill={c.lvn} textAnchor={anchor === "right" ? "end" : "start"}>LVN</text>);
      }
    }
  };

  if (p.showVolumeProfile && p.volumeProfile && p.volumeProfile.bins.length) drawHist(p.volumeProfile, "right", p.volumeProfile.kind === "tpo" ? "tpo" : "volume", c.value, "vp");
  if (p.showTpo && p.tpoProfile && p.tpoProfile.bins.length) drawHist(p.tpoProfile, "left", "tpo", c.accent, "tpo");

  // Developing POC/VAH/VAL path (only populated for "developing" profiles)
  if (p.developing?.developingTrack?.length && p.showValueLevels) {
    const line = (key: "poc" | "vah" | "val", color: string, dash?: string) => {
      const pts = p.developing!.developingTrack!.map((t) => {
        const x = p.timeToX(t.time), y = p.priceToY(t[key]);
        return x === null || y === null ? null : `${x},${y}`;
      }).filter(Boolean);
      if (pts.length > 1) els.push(<polyline key={`dev-${key}`} points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.2} strokeDasharray={dash} opacity={0.9} />);
    };
    line("poc", c.poc); line("vah", c.value, "4 3"); line("val", c.value, "4 3");
  }

  // Auction-state bands along the top edge
  if (p.showAuction) {
    const lastT = p.bars[p.bars.length - 1]?.t;
    p.states.forEach((s, i) => {
      const startT = barTimeContaining(p.bars, s.startTime);
      const endT = s.endTime === null ? lastT : barTimeContaining(p.bars, s.endTime);
      if (startT == null || endT == null) return;
      const x1 = p.timeToX(startT), x2 = p.timeToX(endT);
      if (x1 === null || x2 === null || x2 < x1) return;
      const y = 4 + (i % 2) * 15;
      els.push(
        <g key={`st-${s.id}`}>
          <rect x={x1} y={y} width={Math.max(2, x2 - x1)} height={13} rx={2} fill={withAlpha(c.fg, 0.07)} stroke={withAlpha(c.fg, 0.28)} strokeDasharray={s.endTime === null ? "3 2" : undefined} />
          <text x={x1 + 4} y={y + 10} fontSize={9.5} fill={c.muted} style={{ pointerEvents: "none" }}>{AUCTION_LABELS[s.kind]}</text>
        </g>,
      );
    });
  }

  // Selected pattern highlight: candle band + associated profile references
  if (p.selected) {
    const t = barTimeContaining(p.bars, p.selected.barTime);
    const x = t === null ? null : p.timeToX(t);
    if (x !== null) {
      const bw = Math.max(p.barWidth, 6);
      els.push(<rect key="sel-band" x={x - bw} y={0} width={bw * 2} height={p.height} fill={withAlpha(c.accent, 0.1)} stroke={withAlpha(c.accent, 0.55)} strokeDasharray="3 3" />);
    }
    for (const ref of p.selectedProfileRefs) {
      const y = p.priceToY(ref.price);
      if (y === null) continue;
      els.push(
        <g key={`ref-${ref.label}`}>
          <line x1={0} x2={p.plotWidth} y1={y} y2={y} stroke={c.accent} strokeWidth={1} strokeDasharray="1 4" opacity={0.8} />
          <text x={6} y={y - 3} fontSize={10} fill={c.accent}>{ref.label}</text>
        </g>,
      );
    }
  }

  return (
    <svg aria-hidden width={p.width} height={p.height} className="pointer-events-none absolute inset-0">
      {els}
    </svg>
  );
}
