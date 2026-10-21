"use client";

import {
  ColorType, CrosshairMode, LineStyle, LineType, TickMarkType, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useWorkspace } from "@/hooks/workspace";
import { readPalette, withAlpha, type ChartPalette } from "@/lib/charting/theme";
import { fmtDate, fmtDateTime, fmtPrice, fmtTime, fmtVolume, patternCode } from "@/lib/formatting";
import { MA_PERIODS, dailySmaForBars, smaUpTo, type DailyBar } from "@/lib/charting/movingAverages";
import { barTimeContaining } from "@/lib/replay";
import { cn } from "@/lib/utils";
import type { Analysis, Bar, Layers, Profile, ProfileKind, VsaEvent } from "@/types";
import { ChartOverlay } from "./ChartOverlay";
import { ChartProfileControls } from "./ChartProfileControls";
import { ExternalLink, Maximize2, Minimize2, Minus, Plus } from "lucide-react";

const ABOVE = ["upthrust", "buying_climax", "no_demand", "high_volume_churn", "effort_vs_result", "volume_divergence"];
/** Volume expansion/contraction recolour their candle instead of carrying a text marker (the chart gets crowded otherwise). */
const BAR_TINT: Record<string, string> = { volume_expansion: "#22e07a", volume_contraction: "#8b1a1a" };
/** Stable empty list: a fresh [] each render would re-run the data effect, whose redraw re-renders (an update loop). */
const ZOOM_STEP = 1.25;

/** The chart draws its own axis text in pixels, so follow the page's rem scale (11px at the 16px baseline). */
function chartFontSize() {
  const root = typeof window === "undefined" ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return Math.round((11 * root) / 16);
}
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
  /** Every loaded bar (before any replay cut); the moving averages are computed on these so the 200 line has history. */
  allBars?: Bar[];
  /** Hide the pop-out button (set inside the pop-out window itself). */
  hidePopout?: boolean;
  /** Completed daily bars: when set on an intraday chart the averages are daily, drawn as a step line. */
  dailyBars?: DailyBar[] | null;
}

/** Opens the chart-only window; a fixed name reuses the same window on repeat clicks. */
export function openChartPopout() {
  window.open("/chart/popout", "mst-chart-popout", "popup=yes,width=1100,height=750");
}

/** Bars shown when a chart first opens: about five 30-minute sessions, or six months of daily bars. */
const RECENT_INTRADAY_BARS = 70;
const RECENT_DAILY_BARS = 125;

export function MarketChart({ bars, fitKey, timeframe, analysis, layers, profileKind, selectedEventId, onSelectEvent, className, hideProfile, allBars, hidePopout, dailyBars }: Props) {
  const { state, set } = useWorkspace();
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maRefs = useRef<Record<"ma50" | "ma200", ISeriesApi<"Line"> | null>>({ ma50: null, ma200: null });
  const linesRef = useRef<IPriceLine[]>([]);
  const lastFit = useRef<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const [hover, setHover] = useState<Bar | null>(null);
  const palette = useMemo<ChartPalette>(() => readPalette(), [state.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const profile = analysis?.profiles[profileKind] ?? null;
  const tpoProfile = analysis?.profiles.tpo ?? null;
  const events = analysis?.vsaEvents ?? NO_EVENTS;
  const selected = events.find((e) => e.id === selectedEventId) ?? null;
  const onSelectRef = useRef(onSelectEvent);
  onSelectRef.current = onSelectEvent;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const barsRef = useRef(bars);
  barsRef.current = bars;

  // Full screen applies to the chart frame only; the chart autosizes to it via its ResizeObserver.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  /** Scale the bar spacing around the current view; lightweight-charts clamps to minBarSpacing/maxBarSpacing. */
  const zoom = (factor: number) => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    ts.applyOptions({ barSpacing: Math.min(60, Math.max(2, ts.options().barSpacing * factor)) });
  };

  // ---- create chart once
  useEffect(() => {
    const host = hostRef.current!;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: palette.muted, fontSize: chartFontSize(), attributionLogo: false },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.14, bottom: 0.22 } },
      timeScale: { borderColor: palette.border, timeVisible: true, secondsVisible: false, rightOffset: 22, barSpacing: 9, minBarSpacing: 2 },
      localization: { timeFormatter: (t: Time) => fmtDateTime(t as number, true) },
    });
    const candle = chart.addCandlestickSeries({ priceLineVisible: false, lastValueVisible: true });
    const volume = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    for (const key of ["ma50", "ma200"] as const) {
      maRefs.current[key] = chart.addLineSeries({ lineWidth: 1, lineType: LineType.Curved, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: false });
    }
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
      const atBar = eventsRef.current.filter((e) => barTimeContaining(barsRef.current, e.barTime) === t);
      const hit = atBar.find((e) => e.direction === "strength" || e.direction === "weakness") ?? atBar[0];
      onSelectRef.current(hit ? hit.id : null);
    });
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
      chart.applyOptions({ layout: { fontSize: chartFontSize() } });
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
        // Intraday: the first tick of each day shows the date, the rest the time (otherwise every day reads "09:30").
        tickMarkFormatter: (t: Time, type: TickMarkType) => (timeframe === "1D" || type < TickMarkType.Time ? fmtDate(t as number) : fmtTime(t as number)),
      },
    });
    candleRef.current?.applyOptions({
      upColor: palette.up, downColor: palette.down, borderUpColor: palette.up, borderDownColor: palette.down, wickUpColor: palette.up, wickDownColor: palette.down,
    });
  }, [palette, timeframe]);

  // ---- moving averages (computed on all loaded bars, cut at the last visible bar so a replay never looks ahead)
  const maSource = allBars ?? bars;
  useEffect(() => {
    for (const key of ["ma50", "ma200"] as const) {
      const series = maRefs.current[key];
      if (!series) continue;
      const on = layers[key] && !hideProfile;
      series.applyOptions({ visible: on, color: key === "ma50" ? palette.hvn : palette.poc });
      const points = !on ? [] : dailyBars && timeframe !== "1D" ? dailySmaForBars(dailyBars, bars, MA_PERIODS[key]) : smaUpTo(maSource, bars, MA_PERIODS[key]);
      series.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    }
  }, [maSource, bars, dailyBars, timeframe, layers.ma50, layers.ma200, hideProfile, palette]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const offset = layers.volumeProfile && !hideProfile ? 22 : 6;
      chart.timeScale().applyOptions({ rightOffset: offset });
      // Open on the most recent bars at a readable width; zoom out or scroll left for older history.
      const recent = timeframe === "1D" ? RECENT_DAILY_BARS : RECENT_INTRADAY_BARS;
      if (bars.length > recent) chart.timeScale().setVisibleLogicalRange({ from: bars.length - recent, to: bars.length - 1 + offset });
      else chart.timeScale().fitContent();
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
      // Every LVN is drawn, but only the nearest above and below the last close is labelled; a label per line piles up.
      const last = barsRef.current[barsRef.current.length - 1]?.c;
      const lvns = [...profile.lvns].sort((a, b) => a - b);
      const above = last === undefined ? undefined : lvns.find((p) => p >= last);
      const below = last === undefined ? undefined : [...lvns].reverse().find((p) => p < last);
      lvns.forEach((p) => add(p, p === above || p === below ? "LVN" : "", palette.lvn, LineStyle.Dotted));
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
      const position = placeAbove(e) ? "aboveBar" : "belowBar";
      // Neutral measurements (compression, relative volume, ...) draw nothing unless selected.
      if (!sel && e.direction !== "strength" && e.direction !== "weakness") continue;
      markers.push({
        time: t as UTCTimestamp,
        position,
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
    <div ref={frameRef} className={cn("relative flex h-full min-h-56 w-full flex-col overflow-hidden rounded-md", fullscreen && "h-screen w-screen bg-surface", className)}>
      {!hideProfile && <ChartProfileControls
        profiles={analysis?.profiles ?? null} kind={profileKind} visible={layers.volumeProfile}
        onChange={(kind) => set({ profileKind: kind })}
        onVisibleChange={(visible) => set({ layers: { ...state.layers, volumeProfile: visible } })}
      />}
      <div className="relative min-h-0 flex-1">
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
      <div role="group" aria-label="Zoom" style={{ right: size.w - plotWidth + 8 }} className="absolute bottom-9 z-10 flex flex-col overflow-hidden rounded-lg border border-border bg-surface/90 opacity-60 shadow-sm backdrop-blur-sm transition-opacity hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={() => zoom(ZOOM_STEP)} aria-label="Zoom in" title="Zoom in" className="grid h-8 w-8 place-items-center text-muted hover:bg-surface-2 hover:text-fg">
          <Plus size={16} aria-hidden />
        </button>
        <span aria-hidden className="h-px bg-border" />
        <button type="button" onClick={() => zoom(1 / ZOOM_STEP)} aria-label="Zoom out" title="Zoom out" className="grid h-8 w-8 place-items-center text-muted hover:bg-surface-2 hover:text-fg">
          <Minus size={16} aria-hidden />
        </button>
        <span aria-hidden className="h-px bg-border" />
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          aria-pressed={fullscreen}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          className="grid h-8 w-8 place-items-center text-muted hover:bg-surface-2 hover:text-fg"
        >
          {fullscreen ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
        </button>
        {!hidePopout && (
          <>
            <span aria-hidden className="h-px bg-border" />
            <button type="button" onClick={openChartPopout} aria-label="Open chart in a new window" title="Open chart in a new window" className="grid h-8 w-8 place-items-center text-muted hover:bg-surface-2 hover:text-fg">
              <ExternalLink size={15} aria-hidden />
            </button>
          </>
        )}
      </div>
      {display && (
        <div className="pointer-events-none absolute left-2 top-1 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-x-3 rounded-md bg-surface/80 px-2 py-0.5 text-xs backdrop-blur-sm" style={{ top: layers.auction ? 38 : 4 }}>
          <span className="text-muted">{fmtDateTime(display.t, true)}</span>
          <span className="num">O {fmtPrice(display.o)}</span><span className="num">H {fmtPrice(display.h)}</span>
          <span className="num">L {fmtPrice(display.l)}</span>
          <span className={cn("num", display.c >= display.o ? "text-up" : "text-down")}>C {fmtPrice(display.c)}</span>
          <span className="num text-muted">V {fmtVolume(display.v)}</span>
          {!hideProfile && layers.ma50 && <span className="num" style={{ color: palette.hvn }}>MA 50</span>}
          {!hideProfile && layers.ma200 && <span className="num" style={{ color: palette.poc }}>MA 200</span>}
        </div>
      )}
      </div>
    </div>
  );
}
