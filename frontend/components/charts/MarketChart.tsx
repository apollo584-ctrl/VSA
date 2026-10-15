"use client";

import {
  ColorType, CrosshairMode, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useWorkspace } from "@/hooks/workspace";
import { readPalette, withAlpha, type ChartPalette } from "@/lib/charting/theme";
import { fmtDate, fmtDateTime, fmtPrice, fmtTime, fmtVolume, patternCode } from "@/lib/formatting";
import { barTimeContaining } from "@/lib/replay";
import { cn } from "@/lib/utils";
import type { Analysis, Bar, Layers, Profile, ProfileKind, VsaEvent } from "@/types";
import { ChartOverlay } from "./ChartOverlay";

const ABOVE = ["upthrust", "buying_climax", "no_demand", "high_volume_churn", "effort_vs_result", "volume_divergence"];
/** Volume expansion/contraction recolour their candle instead of carrying a text marker (the chart gets crowded otherwise). */
const BAR_TINT: Record<string, string> = { volume_expansion: "#22e07a", volume_contraction: "#8b1a1a" };
/** Stable empty list: a fresh [] each render would re-run the data effect, whose redraw re-renders (an update loop). */
const NO_EVENTS: VsaEvent[] = [];
const STATUS_MARK = { observed: "", provisional: "?", confirmed: "✓", invalidated: "×", expired: "~", historical: "" } as const;

/** Marker placement only anchors the label to the bar; engine direction (when given) picks the side. */
const placeAbove = (e: VsaEvent) => (e.direction ? e.direction !== "strength" : ABOVE.includes(e.type));

export function profileRefPrices(event: VsaEvent, profile: Profile | null): { label: string; price: number }[] {
  if (!profile) return [];
  const out: { label: string; price: number }[] = [];
  for (const r of event.profileRefs) {
    if (r === "poc") out.push({ label: "POC", price: profile.poc });
    else if (r === "vah") out.push({ label: "VAH", price: profile.vah });
    else if (r === "val") out.push({ label: "VAL", price: profile.val });
    else if (r === "session_high") out.push({ label: "Session high", price: profile.sessionHigh });
    else if (r === "session_low") out.push({ label: "Session low", price: profile.sessionLow });
    else if (r === "ib_high" && profile.initialBalance) out.push({ label: "IB high", price: profile.initialBalance.high });
    else if (r === "ib_low" && profile.initialBalance) out.push({ label: "IB low", price: profile.initialBalance.low });
    else if (r === "hvn" && profile.hvns[0] !== undefined) out.push({ label: "HVN", price: profile.hvns[0] });
    else if (r === "lvn" && profile.lvns[0] !== undefined) out.push({ label: "LVN", price: profile.lvns[0] });
  }
  return out;
}

interface Props {
  bars: Bar[];
  /** Changing this value re-fits the visible range (symbol / timeframe / date change). */
  fitKey: string;
  timeframe: string;
  analysis: Analysis | null;
  layers: Layers;
  profileKind: ProfileKind;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  className?: string;
  /** Show only VSA markers in a lean mode (used by the VSA workspace). */
  hideProfile?: boolean;
}

export function MarketChart({ bars, fitKey, timeframe, analysis, layers, profileKind, selectedEventId, onSelectEvent, className, hideProfile }: Props) {
  const { state } = useWorkspace();
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const lastFit = useRef<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const [hover, setHover] = useState<Bar | null>(null);
  const palette = useMemo<ChartPalette>(() => readPalette(), [state.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const profile = analysis?.profiles[profileKind] ?? analysis?.profiles.volume ?? null;
  const tpoProfile = analysis?.profiles.tpo ?? null;
  const events = analysis?.vsaEvents ?? NO_EVENTS;
  const selected = events.find((e) => e.id === selectedEventId) ?? null;
  const onSelectRef = useRef(onSelectEvent);
  onSelectRef.current = onSelectEvent;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const barsRef = useRef(bars);
  barsRef.current = bars;

  // ---- create chart once
  useEffect(() => {
    const host = hostRef.current!;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: palette.muted, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: palette.border, timeVisible: true, secondsVisible: false, rightOffset: 22, barSpacing: 9, minBarSpacing: 2 },
      localization: { timeFormatter: (t: Time) => fmtDateTime(t as number, true) },
    });
    const candle = chart.addCandlestickSeries({ priceLineVisible: false, lastValueVisible: true });
    const volume = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart; candleRef.current = candle; volumeRef.current = volume;

    const redraw = () => tick();
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) { setHover(null); return; }
      setHover(barsRef.current.find((b) => b.t === (param.time as number)) ?? null);
    });
    chart.subscribeClick((param) => {
      if (!param.time) { onSelectRef.current(null); return; }
      const t = param.time as number;
      const hit = eventsRef.current.find((e) => barTimeContaining(barsRef.current, e.barTime) === t);
      onSelectRef.current(hit ? hit.id : null);
    });
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(host);
    const onPointer = () => requestAnimationFrame(redraw);
    host.addEventListener("wheel", onPointer, { passive: true });
    host.addEventListener("pointerup", onPointer);
    host.addEventListener("pointermove", (e) => { if (e.buttons) onPointer(); });
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- theme / timeframe options
  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { textColor: palette.muted },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border },
      timeScale: {
        borderColor: palette.border,
        timeVisible: timeframe !== "1D",
        tickMarkFormatter: (t: Time) => (timeframe === "1D" ? fmtDate(t as number) : fmtTime(t as number)),
      },
    });
    candleRef.current?.applyOptions({
      upColor: palette.up, downColor: palette.down, borderUpColor: palette.up, borderDownColor: palette.down, wickUpColor: palette.up, wickDownColor: palette.down,
    });
  }, [palette, timeframe]);

  // ---- data
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candleRef.current || !volumeRef.current) return;
    const tint = new Map<number, string>();
    if (layers.vsa) for (const e of events) {
      const color = BAR_TINT[e.type];
      const t = color ? barTimeContaining(bars, e.barTime) : null;
      if (color && t !== null) tint.set(t, color);
    }
    candleRef.current.setData(bars.map((b) => {
      const color = tint.get(b.t);
      return { time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c, ...(color ? { color, borderColor: color, wickColor: color } : {}) };
    }));
    volumeRef.current.setData(bars.map((b) => ({ time: b.t as UTCTimestamp, value: b.v, color: withAlpha(b.c >= b.o ? palette.up : palette.down, 0.45) })));
    if (lastFit.current !== fitKey && bars.length) {
      chart.timeScale().fitContent();
      chart.timeScale().applyOptions({ rightOffset: layers.volumeProfile && !hideProfile ? 22 : 6 });
      lastFit.current = fitKey;
    }
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, fitKey, palette, events, layers.vsa]);

  useEffect(() => {
    candleRef.current?.applyOptions({ visible: layers.candles });
    volumeRef.current?.applyOptions({ visible: layers.volume });
    chartRef.current?.timeScale().applyOptions({ rightOffset: layers.volumeProfile && !hideProfile ? 22 : 6 });
    tick();
  }, [layers.candles, layers.volume, layers.volumeProfile, hideProfile]);

  // ---- price lines (profile references + structural levels)
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    for (const l of linesRef.current) series.removePriceLine(l);
    linesRef.current = [];
    const add = (price: number, title: string, color: string, style: LineStyle, width: 1 | 2 = 1, axis = false) =>
      linesRef.current.push(series.createPriceLine({ price, title, color, lineStyle: style, lineWidth: width, axisLabelVisible: axis }));
    if (!hideProfile && profile && layers.valueLevels) {
      add(profile.poc, "POC", palette.poc, LineStyle.Solid, 2, true);
      add(profile.vah, "VAH", palette.value, LineStyle.Dashed, 1, true);
      add(profile.val, "VAL", palette.value, LineStyle.Dashed, 1, true);
    }
    if (!hideProfile && profile && layers.nodes) {
      profile.hvns.forEach((p) => add(p, "HVN", palette.hvn, LineStyle.Dotted));
      profile.lvns.forEach((p) => add(p, "LVN", palette.lvn, LineStyle.Dotted));
    }
    if (analysis && layers.structure) {
      for (const l of analysis.levels) {
        if (l.kind === "hvn" || l.kind === "lvn" || l.kind === "prior_vah" || l.kind === "prior_val" || l.kind === "prior_poc") continue;
        add(l.price, l.label, l.kind.startsWith("ib") ? palette.ib : palette.muted, LineStyle.SparseDotted);
      }
      if (profile?.initialBalance && !analysis.levels.some((l) => l.kind === "ib_high")) {
        add(profile.initialBalance.high, "IB high", palette.ib, LineStyle.SparseDotted);
        add(profile.initialBalance.low, "IB low", palette.ib, LineStyle.SparseDotted);
      }
    }
    if (analysis && layers.structure && profileKind !== "prior") {
      const pv = analysis.levels.filter((l) => l.kind === "prior_vah" || l.kind === "prior_val");
      pv.forEach((l) => add(l.price, l.label, withAlpha(palette.value, 0.7), LineStyle.LargeDashed));
    }
  }, [analysis, profile, layers.valueLevels, layers.nodes, layers.structure, palette, hideProfile, profileKind]);

  // ---- VSA markers
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    if (!layers.vsa) { series.setMarkers([]); return; }
    const markers: SeriesMarker<Time>[] = [];
    for (const e of events) {
      if (e.type in BAR_TINT) continue;
      const t = barTimeContaining(bars, e.barTime);
      if (t === null) continue;
      const sel = e.id === selectedEventId;
      markers.push({
        time: t as UTCTimestamp,
        position: placeAbove(e) ? "aboveBar" : "belowBar",
        shape: "circle",
        color: sel ? palette.accent : e.status === "invalidated" ? withAlpha(palette.vsa, 0.45) : palette.vsa,
        text: `${patternCode(e.type)}${STATUS_MARK[e.status]}`,
        size: sel ? 1.6 : 1,
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    series.setMarkers(markers);
  }, [events, bars, layers.vsa, selectedEventId, palette]);

  // ---- overlay geometry
  const chart = chartRef.current, candle = candleRef.current;
  const plotWidth = chart ? Math.max(0, size.w - chart.priceScale("right").width()) : size.w;
  const barWidth = chart ? chart.timeScale().options().barSpacing * 0.5 : 4;
  const priceToY = (p: number) => candle?.priceToCoordinate(p) ?? null;
  const timeToX = (t: number) => chart?.timeScale().timeToCoordinate(t as UTCTimestamp) ?? null;
  const showVol = layers.volumeProfile && !hideProfile;
  const display = hover ?? bars[bars.length - 1] ?? null;

  return (
    <div className={cn("relative h-full min-h-72 w-full overflow-hidden rounded-md", className)}>
      <div ref={hostRef} className="absolute inset-0" role="img" aria-label={`Candlestick chart, ${bars.length} bars. VSA events are listed beside the chart.`} />
      {size.w > 0 && (
        <ChartOverlay
          width={size.w} height={size.h} plotWidth={plotWidth} palette={palette} priceToY={priceToY} timeToX={timeToX} barWidth={barWidth} bars={bars}
          volumeProfile={showVol ? profile : null} tpoProfile={!hideProfile && layers.tpo ? tpoProfile : null}
          showVolumeProfile={showVol} showTpo={!hideProfile && layers.tpo} showNodes={layers.nodes}
          showAuction={layers.auction} states={analysis?.auctionStates ?? []} selected={layers.vsa ? selected : null}
          selectedProfileRefs={selected ? profileRefPrices(selected, profile) : []}
          developing={profileKind === "developing" ? profile : null} showValueLevels={layers.valueLevels && !hideProfile}
        />
      )}
      {display && (
        <div className="pointer-events-none absolute left-2 top-1 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-x-3 rounded-md bg-surface/80 px-2 py-0.5 text-xs backdrop-blur-sm" style={{ top: layers.auction ? 38 : 4 }}>
          <span className="text-muted">{fmtDateTime(display.t, true)}</span>
          <span className="num">O {fmtPrice(display.o)}</span><span className="num">H {fmtPrice(display.h)}</span>
          <span className="num">L {fmtPrice(display.l)}</span>
          <span className={cn("num", display.c >= display.o ? "text-up" : "text-down")}>C {fmtPrice(display.c)}</span>
          <span className="num text-muted">V {fmtVolume(display.v)}</span>
        </div>
      )}
    </div>
  );
}
