export interface ChartPalette {
  bg: string; fg: string; muted: string; grid: string; border: string;
  up: string; down: string; poc: string; value: string; hvn: string; lvn: string; ib: string; vsa: string; accent: string; hyp: string;
}

const FALLBACK: ChartPalette = {
  bg: "#11151c", fg: "#e6e9ef", muted: "#9aa4b4", grid: "rgba(255,255,255,0.05)", border: "#252c38",
  up: "#2bb8a3", down: "#ef6b5f", poc: "#f2b84b", value: "#a98bff", hvn: "#4cc3e6", lvn: "#8793a6", ib: "#ee8fc0", vsa: "#c9d1e0", accent: "#5b9dff", hyp: "#b48cff",
};

/** Resolve design tokens to concrete colors (canvas libraries cannot read CSS variables). */
export function readPalette(): ChartPalette {
  if (typeof document === "undefined") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    bg: v("--surface", FALLBACK.bg), fg: v("--fg", FALLBACK.fg), muted: v("--fg-muted", FALLBACK.muted), grid: v("--chart-grid", FALLBACK.grid), border: v("--border", FALLBACK.border),
    up: v("--up", FALLBACK.up), down: v("--down", FALLBACK.down), poc: v("--poc", FALLBACK.poc), value: v("--value", FALLBACK.value), hvn: v("--hvn", FALLBACK.hvn),
    lvn: v("--lvn", FALLBACK.lvn), ib: v("--ib", FALLBACK.ib), vsa: v("--vsa", FALLBACK.vsa), accent: v("--accent", FALLBACK.accent), hyp: v("--hyp", FALLBACK.hyp),
  };
}

export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith("#") && (c.length === 7 || c.length === 4)) {
    const full = c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
    const n = parseInt(full.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return c;
}
