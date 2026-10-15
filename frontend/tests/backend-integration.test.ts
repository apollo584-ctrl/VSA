// @vitest-environment node
/**
 * Live integration: upload → bars → analysis → saved snapshot, against a running backend.
 * Run with:  MSI_LIVE=1 npx vitest run tests/backend-integration.test.ts
 * (backend on http://127.0.0.1:8000, see backend/README.md). Skipped otherwise.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";
const live = process.env.MSI_LIVE === "1";
const fixtures = path.resolve(__dirname, "../../backend/fixtures");

describe.skipIf(!live)("live backend integration", () => {
  it("upload → chart bars → analysis → as-of causality → saved snapshot", async () => {
    const { backendApi } = await import("@/lib/api/backend/client");
    const { analysisSchema, barsResponseSchema } = await import("@/lib/api/schemas");

    // 1. upload
    const csv = readFileSync(path.join(fixtures, "demo.csv"));
    const metadata = JSON.parse(readFileSync(path.join(fixtures, "upload_metadata.json"), "utf8"));
    const up = await backendApi.uploadDataset(new File([csv], "demo.csv", { type: "text/csv" }), metadata);
    expect(up.accepted).toBe(true);
    const id = up.datasetId!;

    // 2. dataset is listed and bars load with the UI's time convention
    const instruments = await backendApi.listInstruments();
    const inst = instruments.find((i) => i.symbol === id)!;
    expect(inst.source.kind).toBe("fixture");
    expect(inst.timeframes).toEqual(["5m"]);
    const bars = await backendApi.getBars({ symbol: id });
    expect(barsResponseSchema.safeParse(bars).success).toBe(true);
    expect(bars.bars).toHaveLength(468);

    // 3. analysis (latest)
    const a = await backendApi.getAnalysis({ symbol: id });
    expect(analysisSchema.safeParse(a).success).toBe(true);
    expect(a.status).toBe("ok");
    expect(a.snapshot?.id).toBeTruthy();
    expect(a.vsaEvents.length).toBeGreaterThan(0);
    expect(a.vsaEvents.every((e) => e.conditionSource === "instance" && e.conditions.length > 0 && e.conditions.every((c) => c.met === true))).toBe(true);
    expect(a.vsaEvents.every((e) => e.statusHistory.at(-1)!.status === e.status)).toBe(true);
    expect(Object.values(a.profiles).every((p) => p.estimated)).toBe(true);

    // 4. as-of causality: asking at an earlier bar must not contain later observations
    const cursor = bars.bars[200]!.t; // bar START, as the UI addresses bars
    const earlier = await backendApi.getAnalysis({ symbol: id, asOf: cursor });
    expect(earlier.status).toBe("ok");
    expect(earlier.asOf).toBe(cursor);
    for (const e of earlier.vsaEvents) expect(e.detectedAt).toBeLessThanOrEqual(cursor);
    for (const t of earlier.auctionTransitions) expect(t.detectedAt).toBeLessThanOrEqual(cursor);
    expect(earlier.persisted).toBe(false);
    expect(earlier.snapshot).toBeUndefined();
    expect(earlier.datasetId).toBe(id);
    const savedEarlier = await backendApi.getAnalysis({ symbol: id, asOf: cursor, persist: true });
    expect(savedEarlier.persisted).toBe(true);
    expect(await backendApi.getSnapshot(savedEarlier.snapshot!.id)).toEqual(savedEarlier);
    const { snapshot: _previewId, persisted: _previewMode, generatedAt: _previewTime, ...previewContent } = earlier;
    const { snapshot: _savedId, persisted: _savedMode, generatedAt: _savedTime, ...savedContent } = savedEarlier;
    expect(previewContent).toEqual(savedContent);

    // 5. saved snapshot reopens identically (immutable; not recomputed)
    const reopened = await backendApi.getSnapshot(a.snapshot!.id);
    expect(a.profiles["composite"]).toBeDefined();
    expect(a.profiles["composite"]!.startTime).toBe(bars.bars[0]!.t);
    expect(a.profiles["composite"]!.endTime).toBe(bars.bars.at(-1)!.t);
    expect(a.profiles["composite"]!.sessionHigh).toBe(Math.max(...bars.bars.map((b) => b.h)));
    expect(a.profiles["composite"]!.sessionLow).toBe(Math.min(...bars.bars.map((b) => b.l)));
    expect(reopened).toEqual(a); // includes the preserved composite
    expect(reopened.vsaEvents.every((e) => e.textSource === "catalog")).toBe(true);

    // 6. rejection path: as_of before the first bar completes → withheld analysis, not a crash
    const none = await backendApi.getAnalysis({ symbol: id, asOf: bars.bars[0]!.t - 3600 });
    expect(none.status).toBe("insufficient_data");

    // 7. knowledge catalog
    const k = await backendApi.listKnowledge();
    expect(k.length).toBeGreaterThan(20);
    expect(k.some((c) => c.detectorStatus === "knowledge_only")).toBe(true);
  }, 60000);

  it("malformed upload is rejected with the backend's reason and stores nothing", async () => {
    const { backendApi } = await import("@/lib/api/backend/client");
    const before = (await backendApi.listInstruments()).length;
    const r = await backendApi.uploadDataset(new File(["a,b,c\n1,2,3\n"], "bad.csv"), { instrument: "BAD", timeframe_minutes: 5, price_adjustment: "unadjusted", volume_adjustment: "raw", source_name: "x" });
    expect(r.accepted).toBe(false);
    expect(r.issues[0]!.message).toMatch(/header/i);
    expect((await backendApi.listInstruments()).length).toBe(before);
  });

  it("uploads and analyzes supported 60-minute extended-session bars", async () => {
    const { backendApi } = await import("@/lib/api/backend/client");
    const metadata = { ...JSON.parse(readFileSync(path.join(fixtures, "upload_metadata.json"), "utf8")), timeframe_minutes: 60, session_mode: "extended" };
    const csv = "timestamp,open,high,low,close,volume\n2025-03-10T04:00:00-04:00,100,101,99,100,1000\n2025-03-10T05:00:00-04:00,100,101,99,100,1000\n";
    const uploaded = await backendApi.uploadDataset(new File([csv], "hourly.csv"), metadata);
    expect(uploaded.accepted).toBe(true);
    const analysis = await backendApi.getAnalysis({ symbol: uploaded.datasetId! });
    expect(analysis.status).toBe("ok");
    expect(analysis.timeframe).toBe("60m");
    expect(analysis.profiles.volume!.startTime).toBe(Date.parse("2025-03-10T04:00:00-04:00") / 1000);
    expect(analysis.profiles.composite!.endTime).toBe(Date.parse("2025-03-10T05:00:00-04:00") / 1000);
    const reopened = await backendApi.getSnapshot(analysis.snapshot!.id);
    expect(reopened).toEqual(analysis);
  });
});
