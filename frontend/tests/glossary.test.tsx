import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlossaryBrowser } from "@/components/knowledge/Glossary";

vi.mock("@/hooks/data", () => ({
  useKnowledge: () => ({
    isPending: false, error: null, refetch: vi.fn(),
    data: [{ slug: "upthrust", name: "Upthrust", summary: "s", definition: "A rejection above a range.", category: "vsa_weakness", detectorStatus: "implemented" }],
  }),
}));

afterEach(cleanup);

describe("GlossaryBrowser", () => {
  it("leads with search and filters, shows the entry count, and lists terms alphabetically", () => {
    const { container } = render(<GlossaryBrowser />);
    const sections = container.querySelectorAll("section");
    expect(sections[0]?.getAttribute("aria-label")).toBe("Glossary search and filters");
    expect(screen.getByText(/entries$/)).toBeTruthy();
    const terms = [...container.querySelectorAll("dt")].map((d) => d.textContent ?? "");
    expect(terms).toEqual([...terms].sort((a, b) => a.localeCompare(b)));
    expect(terms).toContain("Upthrust");
  });

  it("filters by search text and shows how many match", () => {
    render(<GlossaryBrowser />);
    const box = screen.getByPlaceholderText(/Search a term/);
    (box as HTMLInputElement).focus();
    // use the native setter so React sees the change
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(box, "value area");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(screen.getByText("Value area")).toBeTruthy();
    expect(screen.queryByText("Upthrust")).toBeNull();
    expect(screen.getByText(/ of \d+$/)).toBeTruthy();
  });
});
