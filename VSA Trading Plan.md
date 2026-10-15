# VSA Dashboard Trading Plan

Version 1.0 | 15 October 2026 | Research and paper-trading template

## 1. Purpose and operating rules

**Objective:** determine whether a repeatable setup using prior value and completed-bar evidence has an advantage after realistic trading costs. The dashboard has not established a profitable edge. This document proposes research rules; it does not change the app into a trading-signal engine.

**Working assumption:** intraday, long-only trading in liquid US-listed stocks, regular sessions, with no leverage or overnight positions. These are editable starting assumptions because your capital, experience and preferred holding period have not been supplied. Numerical thresholds below are trial parameters, not validated or personally suitable limits.

### What to pair with the dashboard

| Tool | Use |
|---|---|
| VSA dashboard | Prior VAH/VAL/POC, auction context, observations, contradictions, replay and snapshots. |
| Broker chart, quotes and paper account | Current bid/ask, quote freshness, execution and order controls. Yahoo-backed dashboard data are unsuitable as the sole execution feed. |
| Daily chart plus index/sector chart | Record broader trend and comparable market direction outside the app; the current engine does not ingest daily bars. |
| Earnings and economic calendar | Check scheduled catalysts before planning an entry. Unexpected news remains possible. |
| Journal or spreadsheet | Record every qualifying setup, skipped trade and outcome, including costs. |

### Freeze these choices before the trial

- Data: one consistent, adjusted 5-minute dataset; 30-minute TPO periods, 0.25 price bins and 70% value area as initial engine settings. Freeze all engine defaults and record the actual configuration. If the bin size is unsuitable, change it before the trial and start a new version.
- Context: daily chart for background; completed 5-minute bars for setup decisions. Use identical symbol, session and adjustment conventions across sources.
- Entry window: 10:00-15:00 New York time on full regular sessions only. Close any remaining paper position at 15:55. Skip early-close days in this first trial.
- Universe: fix a small watchlist before each session. Trial eligibility: share price at least $10, prior 20-session average daily volume at least one million shares, and current spread no more than 0.10% of price. Verify these outside the dashboard.
- First phase: paper trading only. No shorts, options, leverage, averaging down or adding to losing positions. One position at a time and one attempt per symbol per day.

---

## 2. Setup A: acceptance above prior value, then retest

**Research hypothesis:** after price holds above the prior complete session's value area, a retest that closes back above VAH may provide a defined location for testing continuation. This is an unproven hypothesis, not a probability claim.

### Eligibility and trigger

1. The dashboard has a usable, adjacent, complete prior-session reference. Record its VAH, VAL and POC before evaluating the setup. No missing bars or split warnings in the setup window.
2. Beginning in the entry window, observe three consecutive completed 5-minute closes strictly above prior VAH. An intrabar touch does not count. If an intervening close is at or below VAH, restart the count.
3. In the next five completed bars, look for the first retest bar with low at or below prior VAH, low above prior VAL, and close strictly above VAH. Any close at or below VAH before this qualifying bar cancels the attempt. No qualifying retest within five bars means no trade.
4. At the retest close, record the auction state, active VSA observations and engine contradictions. Skip if the engine reports contradicting evidence. Do not require an additional VSA pattern in this first version; record it for later analysis rather than adding a discretionary filter.
5. For the paper simulation, proposed entry is the next bar's open. Initial stop is the retest low minus one verified minimum price increment. Skip if the entry is at/below the stop or more than 0.25 times the planned stop distance above the retest close. Size from the actual simulated entry, not the earlier close.

### Exit rules for this trial

- Define price risk per share as entry minus initial stop. Place the paper target at entry plus twice this distance. This is a fixed 2:1 gross price objective; costs reduce the net outcome.
- Exit at stop, target or 15:55, whichever occurs first. Use simulated bid/ask and realistic costs when available. Never move the stop farther away, average down or reclassify the trade after entry.
- If a historical OHLC bar touches both stop and target and intrabar sequence is unknown, record the ambiguity and assume the stop was hit first in the primary result. Also report how many cases were ambiguous.
- A market halt or data failure is an exception, not an ordinary stop fill. Record actual available execution information separately; do not invent a fill at the requested price.

**No-trade conditions:** stale or mismatched quotes; unusable prior reference; spread/liquidity failure; unexpected major news; earnings-release day for the stock; within 15 minutes before or after a scheduled high-impact economic release; missing setup bars; daily risk limit reached; or any rule that cannot be verified.

This setup is a manual research checklist. The app does not automatically implement its entry, stop, target, news filters or broker execution. Its scanner's majority count does not replace these rules.

---

## 3. Risk, sizing and execution worksheet

### Illustrative paper-account limits

- Planned risk budget per trade: 0.25% of session-start paper equity.
- Maximum position notional: 20% of session-start equity, subject to available funds; no borrowing.
- Stop new entries after three losing trades, or when realized net daily P/L reaches -1% of session-start equity, whichever occurs first. Before each entry, reduce its planned risk so a modeled loss would not exceed the remaining daily allowance.
- Stop the session immediately after an execution-control failure or a serious rule violation. A planned loss limit is not a guarantee: gaps, halts and slippage can exceed it.

### Position-size calculation

Let E be equity, b the chosen risk fraction, d the entry-to-stop distance, and c the estimated round-trip costs/slippage per share. Let F be any fixed round-trip fees.

**Risk budget B = minimum(E x b, remaining daily loss allowance).**

**Risk-sized shares = floor((B - F) / (d + c)).**

**Final shares = minimum(risk-sized shares, floor(0.20 x E / entry), affordable shares).**

Skip if B is at/below F, d is nonpositive, final size is zero, or the expected fill is unreliable. Use a conservative estimate for c and avoid counting the same cost twice. These calculations model planned loss; they cannot bound actual gap or halt losses.

### Worked example: hypothetical paper trade

| Item | Calculation |
|---|---|
| Equity and trade budget | $10,000 x 0.25% = $25 |
| Entry / stop / target | $50.00 / $49.50 / $51.00 |
| Costs and slippage allowance | $0.05 per share round trip; no fixed fee in this example |
| Risk-sized shares | floor($25 / $0.55) = 45 |
| Notional cap | floor($2,000 / $50) = 40 shares |
| Final shares and modeled loss | 40 shares; 40 x $0.55 = $22 |
| Target profit after modeled costs | 40 x ($1.00 - $0.05) = $38, about 1.73 times modeled initial loss |

### Order controls

Before live use, confirm with your broker how stops trigger, how bracket/OCO orders behave, what happens on partial fills and disconnects, and which account/funding restrictions apply. A stop becomes a market order and its execution can differ materially from the stop price; a stop-limit order can remain unfilled. Neither removes market risk. See [FINRA's stop-order guidance](https://www.finra.org/investors/insights/stop-orders-factors-consider-during-volatile-markets).

The next-bar-open rule is a backtest convention. Paper fills must include spreads and slippage; a real entry requires a separately specified broker order procedure before any live trial.

---

## 4. Daily operating checklist

### Before the session

- [ ] Confirm this is a full XNYS regular session and record session-start equity.
- [ ] Record today's scheduled economic releases and each watchlist stock's earnings status.
- [ ] Freeze the watchlist and note daily, index and sector context as observations, not extra untested filters.
- [ ] Confirm data source, adjustment basis, timeframe, engine settings and last completed-bar time.
- [ ] Verify the prior session is adjacent and complete; record VAH, VAL and POC.
- [ ] Calculate the day's trade-risk budget and loss allowance. Verify paper order controls.

### Before each paper entry

- [ ] Three qualifying closes and the retest satisfy the exact rules on page 2.
- [ ] Quote freshness, spread, liquidity, news and time-window checks pass.
- [ ] No engine contradiction is present; record supportive and opposing observations without selective omission.
- [ ] Record proposed entry, stop, target, shares, estimated costs and modeled initial loss.
- [ ] Check available funds, one-position rule and remaining daily allowance.
- [ ] Save the analysis/screenshot as known at the decision time; retain dataset ID, as-of time and parameters.

### During and after the trade

- [ ] Follow the fixed exit rules. Record partial fills, execution exceptions and any rule breach.
- [ ] Record entry/exit times, prices, costs, reason and net P/L. Do not omit losing or skipped qualifying setups.
- [ ] Recompute daily P/L and eligibility before considering another entry.
- [ ] At session end, confirm no open paper positions or orders, and complete the journal.

### Dashboard reading order

**Data quality -> prior value -> auction state -> VSA/price action -> contradictions -> execution feasibility.** A scanner flag is a watchlist prompt. Several readings may be driven by the same prices, so their agreement is not independent proof. Profile volume is estimated from OHLCV and cannot establish exact traded volume at each price.

### When to stand aside

If a required field is missing, a signal is ambiguous, data disagree, or you cannot write the invalidation condition before entry, record a skip. Do not relax the rules because no trade has appeared. A no-trade session is a valid result.

---

## 5. Journal, evaluation and next decision

### One record per qualifying opportunity

Copy these fields into your journal, including opportunities you skip:

- Date, symbol, setup version, dataset ID, data source and engine/knowledge versions.
- As-of time, timeframe, parameters and saved analysis or screenshot reference.
- Prior VAH/VAL/POC; acceptance-close times; retest OHLC; contradiction status.
- Daily/index/sector context, news checks, quote age and bid/ask spread.
- Entry, stop, target, shares, planned initial loss and modeled costs.
- Actual/simulated fills, timestamps, commissions, slippage, net P/L and exit reason.
- Trade R = net P/L divided by the initial modeled dollar loss recorded at entry. Preserve the denominator after the trade.
- Skip reason, rule adherence, ambiguous intrabar fills, exceptions and one short lesson.

### Evaluation protocol

1. Use an initial historical development period to clarify feasibility and lock rules. Any changed threshold creates a new version; do not present development results as independent validation.
2. Freeze the setup and evaluate a later, untouched period. Log every qualifying opportunity with the information then available. Include realistic costs, missed fills and conservative ambiguous-bar treatment.
3. Collect an initial 50 qualifying opportunities across at least 20 sessions as an organizational milestone, not proof of an edge. If opportunities are sparse or outcomes vary widely, extend observation rather than forcing a verdict.
4. Report opportunity count, executed/skipped count, rule adherence, win rate, average win/loss in R, mean net R, worst drawdown and cost sensitivity. Separate development, holdout and forward paper results.
5. Calculate expectancy as win fraction x average winning R minus loss fraction x average losing R magnitude. Include all trades in mean net R, including flat outcomes; never use win rate alone.
6. Check whether results depend on a few outliers, a particular market period or optimistic fills. Compare with simple alternatives and examine uncertainty; a positive sample average alone is insufficient.

### Decision after review

**Continue paper trading** if execution is uncertain, rules are inconsistent, the later-period result is weak, or the sample is inadequate. **Revise and restart evaluation** when a rule changes. **Consider a separately approved small live trial** only after credible holdout and forward evidence, explicit live order rules, suitable account limits and broker checks. No trade count or target return automatically authorizes live trading.

### Sources and scope

- [FINRA: Stop Orders - Factors to Consider During Volatile Markets](https://www.finra.org/investors/insights/stop-orders-factors-consider-during-volatile-markets). Supports order-execution cautions, not this setup's effectiveness.
- [SEC Investor.gov: Thinking of Day Trading? Know the Risks](https://www.investor.gov/additional-resources/spotlight/formerdirectorlorischock-directors-take/thinking-day-trading-know-risks). General risk context; it does not validate these numerical rules.
- Local project references: `docs/API_CONTRACT.md`, `docs/PROJECT_GUIDE.md` and the versioned knowledge catalog. This plan is a separate manual research protocol; it does not claim the dashboard implements these trading rules.

Prepared 15 October 2026. Review parameters and assumptions before use. This template does not assess your personal finances or establish that active trading is appropriate for you.
