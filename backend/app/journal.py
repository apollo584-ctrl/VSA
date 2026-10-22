"""Paper-trade journal helpers: server-side R multiple, day summary and spreadsheet-safe CSV. Study tool only; it places no orders."""
import csv
import io

COLUMNS = ["id", "created_at", "updated_at", "trade_date", "symbol", "kind", "setup_version", "prior_vah", "prior_val", "prior_poc",
           "entry", "stop", "target", "shares", "est_costs_per_share", "planned_loss", "exit_price", "exit_time", "exit_reason",
           "fees", "net_pnl", "r_multiple", "skip_reason", "notes", "rule_breach"]


def r_multiple(net_pnl, planned_loss):
    """Net result in units of the planned loss; None unless both exist and the planned loss is positive."""
    if net_pnl is None or planned_loss is None or planned_loss <= 0:
        return None
    return round(net_pnl / planned_loss, 4)


def day_summary(rows: list[dict], date: str) -> dict:
    taken = [r for r in rows if r["kind"] == "taken"]
    pnl = [r["net_pnl"] for r in taken if r["net_pnl"] is not None]
    return {"date": date, "trades": len(taken), "losses": sum(1 for v in pnl if v < 0), "realized_pnl": round(sum(pnl), 2)}


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value  # stop spreadsheets running typed text as a formula
    return value


def to_csv(rows: list[dict]) -> str:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(COLUMNS)
    for row in rows:
        writer.writerow([_cell(row.get(name)) for name in COLUMNS])
    return output.getvalue()
