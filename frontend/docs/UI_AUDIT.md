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

## Second audit: layout and information order (2026-10-15)

Audited every tab at 1280x720, 1440x900 and 1920x1080 against the live backend (AAPL 30m). Each tab is now ordered by importance: the current reading at the top, supporting detail lower, explanations and limitations last.

### Findings and fixes

| # | Finding | Fix |
|---|---|---|
| L1 | Overview at 1440x900: the chart overflowed onto the panels below it, and three side-by-side detail panels were too narrow to read (one word per line). | Overview rebuilt (below). The chart frame's fixed minimum height was lowered so it can shrink in fit layouts. |
| L2 | Chart and Auction right columns: panels shrank inside the scrolling column and drew over each other (profile statistics over the shape explanation; session resets over transition evidence). | Panels in scrolling columns keep their height; the column scrolls instead. |
| L3 | The chart card's footer wrapped onto two lines, taking chart height. | Data quality and a short snapshot link share one row; full provenance is in the link's tooltip. |
| F1 | VSA observation lists put neutral measurements (volume expansion, compression) ahead of strength and weakness signals. | Lists are grouped: strength and weakness signals first, then measurements, newest first in each. |
| F2 | Auction evolution opened at the oldest session, and the current state was not shown at the top. | A Current state card sits beside the timeline; the evolution list opens scrolled to the current state. |
| F3 | Scanner said auto-scan runs "while this app is open"; it runs while the backend runs and resets on restart. | Corrected, and moved into a collapsible "How the scan works" panel below the results. |

### Information order by tab

| Tab | Top → bottom |
|---|---|
| Overview | Price header → at a glance (value location, auction state, signals this session) → chart beside interpretation → details tabs (VSA, profile, levels) |
| Chart & Profile | Chart → profile key levels → profile drawing → shape explanation → value migration |
| VSA | Chart → strength/weakness signals → measurements → pattern detail → chart legend |
| Auction | Current state and timeline → evolution (opens at newest) → transition evidence → session resets → explainer |
| Interpretation | Scenario → what to observe next → supporting and contradicting evidence → component readings → uncertainty and limitations |
| Scanner | Scan status and controls → flagged symbols → how the scan works |
| Knowledge, History, Settings | Unchanged; already ordered by use. |

Remaining: Interpretation scrolls about 1.2 screens at 1440x900 (it is a reading page). At 1280x720 the Overview chart is short (about 200px) and the page scrolls slightly.

### Follow-up: Overview chart height, card overlap and Glossary (2026-10-15)

| # | Finding | Fix |
|---|---|---|
| L4 | Overview chart squeezed to about 220px because the fit layout gave it only the leftover height; the right-hand Interpretation card's text ran under the Details card. | The Overview no longer forces one screen. The chart has an explicit height (26rem on wide screens, about 410px at 1440x900), the right-hand cards clip their contents and scroll inside themselves, and the page scrolls about 1.2 screens. |
| G1 | Glossary led with a large intro card that repeated the page header, with search second. | Search and category filters come first, with the entry count beside them; the "no recommendations" note moved to the footer line. |

Checked at 1440x900 and 1920x1080: no overlapping panels on any tab. Chart heights at 1440x900: Overview 410px, Chart 422px, VSA 462px. Glossary and Knowledge are long reference lists and scroll by design.
