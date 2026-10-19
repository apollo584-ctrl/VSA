"use client";

import { useId } from "react";
import { PROFILE_KINDS } from "@/components/profiles/ProfileVisual";
import { fmtDate, fmtPrice } from "@/lib/formatting";
import type { Analysis, ProfileKind } from "@/types";

const LABELS: Record<ProfileKind, string> = {
  volume: "Current session · Volume",
  tpo: "Current session · TPO",
  developing: "Current session · Developing",
  prior: "Prior session",
  composite: "All analysed sessions · Composite",
};

/** Inside the fullscreen frame, so scope and controls remain visible in both modes. */
export function ChartProfileControls({ profiles, kind, onChange, visible, onVisibleChange }: {
  profiles: Analysis["profiles"] | null;
  kind: ProfileKind;
  onChange: (kind: ProfileKind) => void;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}) {
  const id = useId();
  const profile = profiles?.[kind];
  return (
    <div className="shrink-0 space-y-1.5 border-b border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={id} className="text-xs font-medium text-muted">Profile range</label>
        <select id={id} value={kind} disabled={!profiles} onChange={(event) => onChange(event.target.value as ProfileKind)}
          className="h-8 max-w-full rounded-lg border border-border bg-surface-2 px-2 text-xs text-fg disabled:opacity-50">
          {PROFILE_KINDS.map((option) => <option key={option.value} value={option.value} disabled={!profiles?.[option.value]}>
            {LABELS[option.value]}{profiles && !profiles[option.value] ? " (unavailable)" : ""}
          </option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={visible} onChange={(event) => onVisibleChange(event.target.checked)} className="accent-accent" />
          Show profile histogram
        </label>
      </div>
      <p className="text-xs text-muted" role="status">
        {!profiles ? "Profile unavailable until matching analysis is loaded." : profile
          ? `${profile.label} · ${fmtDate(profile.startTime)} – ${fmtDate(profile.endTime)} (ET) · price range ${fmtPrice(profile.sessionLow)}–${fmtPrice(profile.sessionHigh)}${profile.estimated ? " · estimated" : ""}`
          : "Selected profile unavailable for this analysis. Choose another range; no substitute is shown."}
      </p>
      <p className="text-xs text-subtle">Uses the analysed sessions and replay cutoff. Zooming or panning does not recalculate the profile.</p>
    </div>
  );
}
