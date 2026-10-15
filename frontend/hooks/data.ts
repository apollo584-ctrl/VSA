"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import { toApiError } from "@/lib/api/errors";
import { endOfDate } from "@/lib/formatting";
import { clipBars, knownEvents, knownResets, knownStates, knownTransitions } from "@/lib/replay";
import { useWorkspace } from "./workspace";
import type { Analysis } from "@/types";

export function useInstruments() {
  return useQuery({ queryKey: ["instruments"], queryFn: () => api.listInstruments(), staleTime: 5 * 60_000 });
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
  const { symbol, timeframe, session, date, replayTime } = state;
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
    if (a.timeframe !== timeframe || a.session !== session) return null;
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
    symbol, instrument, instruments,
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
