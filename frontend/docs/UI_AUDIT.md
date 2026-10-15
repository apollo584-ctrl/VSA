# Frontend visual and functional audit

Audited every route (Overview, Chart & Profile, VSA, Auction, Interpretation, Knowledge, History, Settings) at 1440×900 against the live backend with a real AAPL 30m dataset.

## Visual findings

| # | Finding | Effect | Change |
|---|---|---|---|
| V1 | Base text 13px; most content 11–12px; 10px labels | Hard to read; "terminal" feel | 14px body, 13px secondary; no text under 12px. Inter font with tabular numerals. |
| V2 | Every block is a bordered box with an uppercase micro-header bar | Uniform, form-like (Streamlit-like) hierarchy | Soft cards with rounded corners, light elevation, sentence-case titles and optional descriptions; no header rule. |
| V3 | No page titles; the instrument identity lives in a crowded top bar | Unclear where you are | Each page has a header: title, description, instrument and as-of status. |
| V4 | Top bar holds brand, search, instrument text, timeframe, session, date, source, settings, quit and theme | Crowded and wraps early | Brand moves to the sidebar; top bar keeps search and context controls; duplicate settings icon removed. |
| V5 | 8px/12px gaps and 12px padding everywhere | Bunched | 20–24px page padding, 20px gaps, 20px card padding. |
| V6 | Monospace for all numbers | Busy, dated | Sans tabular numerals; monospace only for codes. |
| V7 | Sidebar items small and ungrouped | Weak navigation | Grouped sections (Analysis / Library), larger targets, brand on top. |
| V8 | Layer toggles, quality badges, replay bar and snapshot line stacked loosely around the chart | Chart area feels cluttered | Chart is one card: toolbar row, chart, footer with replay and provenance. |
| V9 | Badges are square, small, all bordered | Noisy | Pill badges, softer tones. |

## Functional findings

| # | Finding | Fix |
|---|---|---|
| F1 | Unrounded floats in text: interpretation ("last close 343.0400085449219"), auction evidence ("Close: 340.7950134277344") and condition receipts ("2.9579439188372203 >= 1.8") | Rounded for display (prices 2 dp, condition values 3 dp); stored snapshots unchanged. |
| F2 | Compact profile cuts off its POC/VAH/VAL labels ("VAH 346.") | Wider label gutter. |
| F3 | Auction state strip renders 30+ truncated chips ("Upwar…") that cannot be read | Proportional colour timeline with legend and per-segment tooltip; evolution list grouped by session. |
| F4 | VSA legend still describes VE/VC as text markers after they became candle tints | Legend updated. |
| F5 | Settings has no hint that symbols can be loaded from the search | Added a short note. |
| F6 | Chart could loop on re-render ("Maximum update depth exceeded") while analysis was loading, introduced with the VE/VC candle tints | Stable empty event list. |
| F7 | The whole window could scroll past the app shell (absolutely positioned text escaped the scroll area), and several pages scrolled sideways on phones | Scroll area contains its children; grids and long values shrink and wrap. All routes measured at 375px with no horizontal overflow. |
| F8 | Session-reset text read "restarted from Indeterminate (no complete prior session)" | Plain "Indeterminate" in resets. |

Behaviour, data and analytical wording are otherwise unchanged.
