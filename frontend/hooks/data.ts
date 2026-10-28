"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_MODE, api } from "@/lib/api/client";
import { toApiError } from "@/lib/api/errors";
import { endOfDate } from "@/lib/formatting";
import { clipBars, knownEvents, knownResets, knownStates, knownTransitions } from "@/lib/replay";
import { useWorkspace } from "./workspace";
import type { JournalInput } from "@/lib/planTypes";
import type { Analysis } from "@/types";

export function useInstruments() {
  return useQuery({ queryKey: ["instruments"], queryFn: () => api.listInstruments(), staleTime: 5 * 60_000 });
}

/** Completed daily closes (30 min cache) for the daily-basis moving averages; disabled until a ticker is known. */
export function useDailyBars(ticker: string | null, enabled = true) {
  return useQuery({
    queryKey: ["daily-bars", ticker], queryFn: () => api.getDailyBars(ticker!),
    enabled: !!ticker && enabled, staleTime: 30 * 60_000, retry: 1,
  });
}

export function useKnowledge() {
  return useQuery({ queryKey: ["knowledge"], queryFn: () => api.listKnowledge(), staleTime: 30 * 60_000 });
}

export function useLoadSymbol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (symbol: string) => api.loadSymbol(symbol),
    // The instrument list must contain the new dataset before it is selected.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instruments"] }),
  });
}

export function useAuthStatus(enabled = true) {
  return useQuery({ queryKey: ["auth"], queryFn: () => api.getAuthStatus(), enabled, retry: false, staleTime: 0 });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (pin: string) => api.login(pin), onSuccess: () => qc.invalidateQueries() });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.logout(), onSuccess: () => qc.invalidateQueries({ queryKey: ["auth"] }) });
}

export function useScan() {
  return useQuery({
    queryKey: ["scan"], queryFn: () => api.getScan(), staleTime: 0,
    // Poll quickly while a scan is running, slowly otherwise so a background auto-scan shows up.
    refetchInterval: (q) => (q.state.data?.status.running ? 3_000 : 60_000),
  });
}

export function useRunScan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.runScan(), onSuccess: () => qc.invalidateQueries({ queryKey: ["scan"] }) });
}

export function useScanAuto() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (minutes: number) => api.setScanAuto(minutes), onSuccess: () => qc.invalidateQueries({ queryKey: ["scan"] }) });
}

export function useOutcomes() {
  return useQuery({
    queryKey: ["outcomes"], queryFn: () => api.getOutcomes(), staleTime: 0,
    refetchInterval: (q) => (q.state.data?.status.running ? 3_000 : 60_000),
  });
}

export function useRunOutcomes() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.runOutcomes(), onSuccess: () => qc.invalidateQueries({ queryKey: ["outcomes"] }) });
}

export function useAlerts(date?: string) {
  return useQuery({ queryKey: ["alerts", date ?? "latest"], queryFn: () => api.getAlerts(date), staleTime: 0, refetchInterval: 60_000 });
}

export function useTrackRecord() {
  return useQuery({ queryKey: ["track-record"], queryFn: () => api.getTrackRecord(), staleTime: 0, refetchInterval: 60_000 });
}

export function useAlertStatus() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["alert-status"], queryFn: () => api.getAlertStatus(), staleTime: 0,
    refetchInterval: (q) => (q.state.data?.running ? 3_000 : 60_000),
  });
  // When a run ends, refresh the data it produced.
  const running = q.data?.running;
  const was = useRef(false);
  useEffect(() => {
    if (was.current && running === false) { qc.invalidateQueries({ queryKey: ["alerts"] }); qc.invalidateQueries({ queryKey: ["track-record"] }); }
    was.current = !!running;
  }, [running, qc]);
  return q;
}

export function useRunAlerts() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.runAlerts(), onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-status"] }) });
}

export function useIntraday() {
  return useQuery({
    queryKey: ["intraday"], queryFn: () => api.getIntraday(), staleTime: 0,
    refetchInterval: (q) => (q.state.data?.status.running ? 3_000 : 60_000),
  });
}

export function useCollectIntraday() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.collectIntraday(), onSuccess: () => qc.invalidateQueries({ queryKey: ["intraday"] }) });
}

export function useUpload() {
  return useMutation({ mutationFn: (v: { file: File; metadata: Record<string, unknown> }) => api.uploadDataset(v.file, v.metadata) });
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Single source for the analysis screens: bars for the selected window, the backend analysis as of the replay
 * cursor, and defensive no-look-ahead filtering.
 */
export function useMarket() {
  const { state } = useWorkspace();
  const { symbol, timeframe, session, date } = state;
  // Real backend on 1D: display-only daily candles; the panels use the 30-minute analysis and replay does not apply.
  const dailyView = timeframe === "1D" && API_MODE === "http";
  const replayTime = dailyView ? null : state.replayTime;
  const instruments = useInstruments();
  const instrument = instruments.data?.find((i) => i.symbol === symbol) ?? null;

  const windowEnd = date ? endOfDate(date) : undefined;
  const barsQuery = useQuery({
    queryKey: ["bars", symbol, timeframe, session, windowEnd ?? "latest"],
    queryFn: () => api.getBars({ symbol: symbol!, timeframe, session, to: windowEnd }),
    enabled: !!symbol,
  });

  const debouncedReplay = useDebounced(replayTime, 180);
  const cursorSettled = replayTime === debouncedReplay;
  const asOfParam = debouncedReplay ?? windowEnd;
  const analysisQuery = useQuery({
    queryKey: ["analysis", symbol, timeframe, session, asOfParam ?? "latest"],
    queryFn: () => api.getAnalysis({ symbol: symbol!, timeframe, session, asOf: asOfParam }),
    enabled: !!symbol && cursorSettled,
  });

  const allBars = barsQuery.data?.bars;
  const bars = useMemo(() => (allBars ? clipBars(allBars, replayTime) : []), [allBars, replayTime]);
  const asOf = replayTime ?? bars[bars.length - 1]?.t ?? null;

  const analysis: Analysis | null = useMemo(() => {
    const a = analysisQuery.data;
    // Withhold the entire previous analysis, including during the debounce interval.
    if (!a || !cursorSettled || analysisQuery.isError || !barsQuery.data) return null;
    // On 1D the panels keep using the 30-minute analysis (the daily candles are display-only).
    if ((a.timeframe !== timeframe && timeframe !== "1D") || a.session !== session) return null;
    if ((a.datasetId ?? a.snapshot?.datasetId ?? a.symbol) !== symbol) return null;
    const cut = replayTime ?? windowEnd ?? null;
    if (cut !== null && a.asOf > cut) return null;
    return {
      ...a,
      vsaEvents: knownEvents(a.vsaEvents, cut),
      auctionStates: knownStates(a.auctionStates, cut),
      auctionTransitions: knownTransitions(a.auctionTransitions, cut),
      auctionResets: knownResets(a.auctionResets, cut),
    };
  }, [analysisQuery.data, analysisQuery.isError, barsQuery.data, cursorSettled, timeframe, session, symbol, replayTime, windowEnd]);

  const analysisIsStale = !!symbol && !analysis && !analysisQuery.isError;

  return {
    symbol, instrument, instruments, dailyView,
    allBars: allBars ?? [], bars, asOf, replaying: replayTime !== null,
    barsResponse: barsQuery.data ?? null,
    analysis,
    analysisIsStale,
    isLoading: barsQuery.isPending || analysisQuery.isPending,
    isFetchingAnalysis: analysisQuery.isFetching,
    error: barsQuery.error ? toApiError(barsQuery.error) : analysisQuery.error ? toApiError(analysisQuery.error) : null,
    refetch: () => { void barsQuery.refetch(); void analysisQuery.refetch(); },
  };
}

// ---- Today's Plan
export function useSetupA(symbols: string[]) {
  return useQuery({
    queryKey: ["setup-a", symbols.join(",")], queryFn: () => api.getSetupA(symbols), enabled: symbols.length > 0,
    staleTime: 0, retry: false,
  });
}

export function useJournal(date?: string) {
  return useQuery({ queryKey: ["journal", date ?? "all"], queryFn: () => api.getJournal(date), staleTime: 0, retry: false });
}

export function useDaySummary(date: string) {
  return useQuery({ queryKey: ["day-summary", date], queryFn: () => api.getDaySummary(date), staleTime: 0, retry: false });
}

function invalidateJournal(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["journal"] });
  void qc.invalidateQueries({ queryKey: ["day-summary"] });
}

export function useCreateJournal() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: JournalInput) => api.createJournal(b), onSuccess: () => invalidateJournal(qc) });
}

export function useUpdateJournal() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: number; body: JournalInput }) => api.updateJournal(v.id, v.body), onSuccess: () => invalidateJournal(qc) });
}
