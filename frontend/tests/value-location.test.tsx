import { cleanup, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ValueLocationCard } from "@/components/common/AnalysisGate";
import { VsaDetailPanel } from "@/components/vsa/VsaPanels";
import { analysisSchema } from "@/lib/api/schemas";
import { mapAnalysis, mapLocation } from "@/lib/api/backend/mappers";
import { rawAnalysisSchema, rawBarSchema, type RawAnalysis, type RawValueLocation } from "@/lib/api/backend/schemas";
import type { Analysis, VsaEvent } from "@/types";

afterEach(cleanup);

const dir = path.resolve(__dirname, "../../backend/fixtures");
const have = existsSync(path.join(dir, "analysis_response.json"));
const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));

const loc = (over: Partial<RawValueLocation> = {}): RawValueLocation => ({
  state: "above_value", price: 101.25, price_basis: "bar_close", as_of: "2025-03-10T14:35:00Z",
  reference_session: "2025-03-07", val: 99.5, vah: 100.75, poc: 100, unavailable_reason: null, ...over,
});

describe.skipIf(!have)("supplied price location", () => {
  const raw: RawAnalysis = rawAnalysisSchema.parse(read("analysis_response.json"));
  const bars = rawBarSchema.array().parse(read("bars_response.json"));

  it("maps the backend classification and levels without re-deriving them", () => {
    const ui = mapAnalysis(raw, { bars });
    expect(analysisSchema.safeParse(ui).success).toBe(true);
    const c = ui.valueLocation!.context!;
    expect(c).toMatchObject({ state: raw.value_location!.state, price: raw.value_location!.price, val: raw.value_location!.val, vah: raw.value_location!.vah, poc: raw.value_location!.poc });
    expect(ui.valueLocation!.relativeTo).toBe(raw.value_location!.state);
    const supplied = [...raw.vsa_observations].map((e) => e.value_location);
    expect(ui.vsaEvents.map((e) => e.valueLocation?.state)).toEqual(supplied.map((l) => l!.state));
    expect(ui.vsaEvents.every((e) => e.valueLocation!.asOf > 0)).toBe(true);
  });

  it("keeps a snapshot saved before price location existed unclassified", () => {
    const legacy: RawAnalysis = { ...raw, value_location: undefined, vsa_observations: raw.vsa_observations.map(({ value_location: _drop, ...rest }) => rest) };
    const ui = mapAnalysis(legacy, { bars });
    expect(ui.valueLocation?.relativeTo).toBe("unknown");
    expect(ui.valueLocation?.context).toBeUndefined();
    expect(ui.vsaEvents.every((e) => e.valueLocation === null)).toBe(true);
    expect(analysisSchema.safeParse(ui).success).toBe(true);
  });

  it("maps an unavailable location with its reason and no levels", () => {
    const ui = mapAnalysis({ ...raw, value_location: loc({ state: "unavailable", reference_session: null, val: null, vah: null, poc: null, unavailable_reason: "prior_session_incomplete" }) }, { bars });
    expect(ui.valueLocation!.relativeTo).toBe("unknown");
    expect(ui.valueLocation!.context).toMatchObject({ state: "unavailable", unavailableReason: "prior_session_incomplete", val: null, vah: null });
    expect(ui.valueLocation!.referenceProfile).toContain("the prior session was incomplete");
  });
});

describe("mapLocation", () => {
  it("returns null for missing context and converts the as-of time", () => {
    expect(mapLocation(undefined)).toBeNull();
    expect(mapLocation(null)).toBeNull();
    expect(mapLocation(loc())!.asOf).toBe(Date.parse("2025-03-10T14:35:00Z") / 1000);
  });
});

const analysisWith = (context: ReturnType<typeof mapLocation>, state: Analysis["valueLocation"] extends infer T ? T : never): Analysis => ({
  valueLocation: state ? { ...state, context } : null, profiles: {},
} as unknown as Analysis);

const base = { price: 101.25, referenceProfile: "ref", distanceFromPocPct: null } as const;

describe("ValueLocationCard", () => {
  it.each([
    ["above_value", "Above prior value"], ["inside_value", "Inside prior value"], ["below_value", "Below prior value"],
  ] as const)("shows the supplied %s classification with the reference levels", (state, label) => {
    const context = mapLocation(loc({ state }));
    render(<ValueLocationCard analysis={analysisWith(context, { ...base, relativeTo: state })} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("100.75")).toBeTruthy();
    expect(screen.getByText("99.50")).toBeTruthy();
    expect(screen.getByText(/includes the VAL and VAH boundaries/)).toBeTruthy();
  });

  it("explains an unavailable reference instead of guessing", () => {
    const context = mapLocation(loc({ state: "unavailable", reference_session: null, val: null, vah: null, poc: null, unavailable_reason: "no_prior_session" }));
    render(<ValueLocationCard analysis={analysisWith(context, { ...base, relativeTo: "unknown" })} />);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText(/No usable prior value area: there is no earlier session in the data/)).toBeTruthy();
    expect(screen.queryByText("Prior VAH")).toBeNull();
  });

  it("says a legacy snapshot was not classified", () => {
    render(<ValueLocationCard analysis={analysisWith(null, { ...base, relativeTo: "unknown" })} />);
    expect(screen.getByText("Not classified")).toBeTruthy();
    expect(screen.getByText(/saved before price location was recorded/)).toBeTruthy();
  });
});

const event = (valueLocation: VsaEvent["valueLocation"], priceLocation: string | null = null): VsaEvent => ({
  id: "vsa:x", type: "no_demand", barTime: 0, detectedAt: 0, status: "provisional", statusHistory: [], kind: "classified", direction: "weakness",
  description: "d", valueLocation, measurements: { priceLocation }, conditions: [], conditionSource: "instance", implications: [], alternatives: [],
  confirmation: [], invalidation: [], textSource: "catalog", profileRefs: [], referencePrices: [], knowledgeSlugs: [],
} as unknown as VsaEvent);

describe("VsaDetailPanel price location", () => {
  it("shows the location frozen at the observation's first-observable time", () => {
    render(<VsaDetailPanel event={event(mapLocation(loc({ state: "below_value", price: 98.75 })))} level="standard" />);
    expect(screen.getByText(/Below prior value \(close 98\.75 vs prior value 99\.50–100\.75, session 2025-03-07\)/)).toBeTruthy();
  });

  it("shows the reason when unavailable and a plain note for legacy observations", () => {
    const { unmount } = render(<VsaDetailPanel event={event(mapLocation(loc({ state: "unavailable", reference_session: null, val: null, vah: null, poc: null, unavailable_reason: "prior_session_not_adjacent" })))} level="standard" />);
    expect(screen.getByText(/Unavailable: the prior session in the data is not the previous scheduled session/)).toBeTruthy();
    unmount();
    render(<VsaDetailPanel event={event(null)} level="standard" />);
    expect(screen.getByText("not recorded in this snapshot")).toBeTruthy();
  });
});
