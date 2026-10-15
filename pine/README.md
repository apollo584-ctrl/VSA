# Market Structure Intelligence — TradingView indicator

`market_structure_intelligence.pine` (Pine Script v5) ports the backend engine to a chart and adds one panel that
combines every factor into a single reading. **It has not been compiled or run yet.** Paste it into the Pine Editor,
add it to an intraday chart (1–30 min, regular hours, US equities/ETFs), and report any compile error.

## What is on the chart

| Mark | Meaning (backend rule) |
|---|---|
| Green label below bar `SV SC SP NS EFF+` | Strength candidates: stopping volume, selling climax, spring, no supply, bullish effort/result |
| Red label above bar `ND UT BC EFF-` | Weakness candidates: no demand, upthrust, buying climax, bearish effort/result |
| `?` `✓` `×` `~` after the code | Provisional → confirmed (a close beyond the bar's extreme within 3 bars), invalidated (a close through the opposite extreme), or expired. Price follow-through only, not proof of intent |
| Orange ▲ ▼ | Breakout: close beyond the prior rolling high or low |
| ✕ | Failed breakout: pierced the rolling extreme but closed back inside |
| Orange `HH HL LH LL` | Swing pivots, drawn only after their right-hand bars close |
| Blue box and lines | Prior complete session's value area (VAH, POC, VAL) |
| Orange dotted/dashed lines | This session's developing value area |
| Purple labels | Auction state changes against prior value: breakout attempt, accepted, rejected, balance |
| Dotted vertical line + `RESET` | Session boundary: state restarts at Indeterminate, with the previous state and whether the prior value reference was usable |

## The interpretation panel

It does not just label bars. It reads six factors and says whether they agree: **background** trend, **location**
versus prior value, **auction** state, **profile** shape, active **VSA** observations, and swing **structure**. Each
is ▲, ▼, ● (neutral) or ○ (not established). The Reading row then states one of: aligned, leaning with named dissent,
conflicted, or balanced, followed by the backend's own scenario rule (mixed evidence, potential strength or weakness,
or no significant pattern) and what would support or weaken it.

The factor alignment is new in this indicator; the backend has only the scenario rule. It is a transparent count, not
a validated model.

## Differences from the backend

- Completed bars only: the engine runs on bar close, matching the backend's as-of rule. The panel does not use the
  forming bar.
- Volume profile only (the auction rules use the volume value area). TPO and the composite profile are not ported.
- No calendar: a prior session counts as adjacent if it is within 4 days, and complete if it started at the open,
  ended at the close and has no missing bars. Holidays and half days are not checked against an exchange calendar.
- Evidence records, saved snapshots and the knowledge catalog do not exist here.
- Bin size defaults to about 0.03% of price (the backend uses a fixed 0.25).

## Limits

Labels, lines and boxes are capped at 500 each by TradingView, so very long histories keep only the most recent.
Thresholds are uncalibrated heuristics from OHLCV only; nothing here is a forecast or trade advice.
