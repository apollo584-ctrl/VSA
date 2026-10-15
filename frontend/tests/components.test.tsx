import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EstimatedBadge, StatusBadge } from "@/components/common/badges";
import { ErrorState, NoPatternsState, StateMessage } from "@/components/common/states";
import { NarrativeText, firstSentence } from "@/components/interpretation/InterpretationPanel";
import { VsaDetailPanel, VsaEventList } from "@/components/vsa/VsaPanels";
import { mockApi } from "@/fixtures/api";
import { ApiError } from "@/lib/api/errors";
import type { VsaEvent } from "@/types";

async function upthrust(): Promise<VsaEvent> {
  const a = await mockApi.getAnalysis({ symbol: "FIXA", timeframe: "30m", session: "RTH" });
  return a.vsaEvents.find((e) => e.type === "upthrust")!;
}

describe("VsaDetailPanel", () => {
  it("labels implications as hypotheses and shows measurements", async () => {
    render(<VsaDetailPanel event={await upthrust()} level="standard" />);
    expect(screen.getByRole("heading", { name: "Upthrust" })).toBeInTheDocument();
    expect(screen.getByText("Hypothesis")).toBeInTheDocument();
    expect(screen.getByText("Observation")).toBeInTheDocument();
    expect(screen.getByText(/Alternative explanations/i)).toBeInTheDocument();
    expect(screen.getAllByText("Provisional").length).toBeGreaterThan(0);
  });

  it("quick mode hides deeper sections; deep mode adds status history", async () => {
    const ev = await upthrust();
    const { rerender } = render(<VsaDetailPanel event={ev} level="quick" />);
    expect(screen.queryByText(/Alternative explanations/i)).not.toBeInTheDocument();
    rerender(<VsaDetailPanel event={ev} level="deep" />);
    expect(screen.getByText(/Detection status history/i)).toBeInTheDocument();
  });

  it("shows measured rule conditions while keeping catalog hypotheses generic", async () => {
    const event = await upthrust();
    event.conditionSource = "instance";
    event.textSource = "catalog";
    event.conditions = [{ label: "Elevated relative volume", met: true, detail: "relative_volume: 2.5 >= 1.8 (parameters.high_volume)" }];
    render(<VsaDetailPanel event={event} level="standard" />);
    expect(screen.getByText("Why the engine identified it")).toBeInTheDocument();
    expect(screen.getByText(/relative_volume: 2.5/)).toBeInTheDocument();
    expect(screen.getByLabelText("Condition met")).toBeInTheDocument();
    expect(screen.getByText(/Generic for this concept/)).toBeInTheDocument();
    expect(screen.queryByText(/no per-observation rule results/)).not.toBeInTheDocument();
  });
});

describe("VsaEventList", () => {
  it("selects an event on click", async () => {
    const onSelect = vi.fn();
    const ev = await upthrust();
    render(<VsaEventList events={[ev]} selectedId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Upthrust/ }));
    expect(onSelect).toHaveBeenCalledWith(ev.id);
  });

  it("shows the no-patterns state without implying a signal", () => {
    render(<VsaEventList events={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText("No patterns detected")).toBeInTheDocument();
    expect(screen.getByText(/not a signal in either direction/i)).toBeInTheDocument();
  });
});

describe("states", () => {
  it("unavailable API renders an alert", () => {
    render(<ErrorState error={new ApiError("unavailable", "could not be reached")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Analysis service unavailable");
  });
  it("invalid response renders as invalid data", () => {
    render(<ErrorState error={new ApiError("invalid_response", "bad shape")} />);
    expect(screen.getByText("Invalid data")).toBeInTheDocument();
  });
  it("basic messages", () => {
    render(<><StateMessage title="Hello" /><NoPatternsState /></>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});

describe("interpretation depth", () => {
  const n = { quick: "Q", standard: "S", deep: ["D1", "D2"] };
  it("changes presentation depth only", () => {
    const { rerender } = render(<NarrativeText n={n} level="quick" />);
    expect(screen.getByText("Q")).toBeInTheDocument();
    rerender(<NarrativeText n={n} level="standard" />);
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.queryByText("D1")).not.toBeInTheDocument();
    rerender(<NarrativeText n={n} level="deep" />);
    expect(screen.getByText("D2")).toBeInTheDocument();
  });
  it("firstSentence keeps decimals intact", () => {
    expect(firstSentence("POC 110.75 is high. Next.")).toBe("POC 110.75 is high");
  });
});

describe("badges", () => {
  it("estimated profile is explicit", () => {
    render(<EstimatedBadge profile={{ estimationMethod: "x" }} />);
    expect(screen.getByText("Estimated Profile")).toBeInTheDocument();
  });
  it("status badge uses text, not color alone", () => {
    render(<StatusBadge status="invalidated" />);
    expect(screen.getByText("Invalidated")).toBeInTheDocument();
  });
});
