import { cleanup, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ValueMigrationTable } from "@/components/profiles/ProfileWorkspace";
import { analysisSchema } from "@/lib/api/schemas";
import { mapAnalysis } from "@/lib/api/backend/mappers";
import { rawAnalysisSchema, rawBarSchema, type RawAnalysis } from "@/lib/api/backend/schemas";
import type { Profile } from "@/types";

afterEach(cleanup);
const dir = path.resolve(__dirname, "../../backend/fixtures");
const have = existsSync(path.join(dir, "analysis_response.json"));
const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));

describe.skipIf(!have)("developing profile and value migration mapping", () => {
  const raw: RawAnalysis = rawAnalysisSchema.parse(read("analysis_response.json"));
  const bars = rawBarSchema.array().parse(read("bars_response.json"));

  it("maps the supplied developing path without computing anything", () => {
    const ui = mapAnalysis(raw, { bars });
    expect(analysisSchema.safeParse(ui).success).toBe(true);
    const track = ui.profiles["developing"]!.developingTrack!;
    expect(track.map((t) => [t.poc, t.vah, t.val])).toEqual(raw.developing_profile!.points.map((t) => [t.poc, t.vah, t.val]));
    expect(ui.profiles["developing"]!.label).toContain(raw.developing_profile!.session);
  });

  it("attaches the supplied relationship to each session", () => {
    const ui = mapAnalysis(raw, { bars });
    const rows = ui.profiles["volume"]!.valueMigration;
    const supplied = new Map(raw.value_migration!.map((s) => [s.session, s]));
    for (const r of rows.filter((x) => supplied.has(x.date))) {
      expect(r.relation).toBe(supplied.get(r.date)!.relationship);
      expect(r.final).toBe(supplied.get(r.date)!.final);
    }
    expect(rows.some((r) => r.relation)).toBe(true);
  });

  it("leaves legacy snapshots without a developing tab or relationships", () => {
    const legacy: RawAnalysis = { ...raw, developing_profile: undefined, value_migration: undefined };
    const ui = mapAnalysis(legacy, { bars });
    expect(ui.profiles["developing"]).toBeUndefined();
    expect(ui.profiles["volume"]!.valueMigration.every((r) => r.relation === undefined)).toBe(true);
  });
});

const profile = (valueMigration: Profile["valueMigration"]) => ({ valueMigration } as unknown as Profile);

describe("ValueMigrationTable", () => {
  it("shows supplied relations, provisional sessions and unavailable reasons", () => {
    render(<ValueMigrationTable profile={profile([
      { date: "2025-03-06", poc: 100, vah: 101, val: 99 },
      { date: "2025-03-07", poc: 103, vah: 104, val: 102, relation: "higher_value", final: true },
      { date: "2025-03-10", poc: 103.5, vah: 105, val: 102.5, relation: "overlapping_higher", final: false },
      { date: "2025-03-12", poc: 104, vah: 105, val: 103, relation: null, relationUnavailableReason: "prior_session_not_adjacent" },
    ])} />);
    expect(screen.getByText("Higher value")).toBeTruthy();
    expect(screen.getByText("Overlapping, higher (provisional)")).toBeTruthy();
    expect(screen.getByText(/Unavailable: the prior session in the data is not the previous scheduled session/)).toBeTruthy();
  });

  it("omits the relation column for legacy data", () => {
    render(<ValueMigrationTable profile={profile([{ date: "2025-03-06", poc: 100, vah: 101, val: 99 }, { date: "2025-03-07", poc: 103, vah: 104, val: 102 }])} />);
    expect(screen.queryByText("Relative to prior value")).toBeNull();
  });
});
