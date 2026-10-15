"""Rebuild app/universe/sp500.json from the Wikipedia constituents table.

Run from backend/: .venv/Scripts/python.exe -m scripts.refresh_sp500
Writes only when the parsed list looks sane (roughly 495-510 unique symbols); otherwise it stops and changes nothing.
"""
import json
import re
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

URL = ("https://en.wikipedia.org/w/api.php?action=parse&page=List_of_S%26P_500_companies"
       "&prop=wikitext&section=1&format=json")
OUT = Path(__file__).resolve().parents[1] / "app" / "universe" / "sp500.json"
SYMBOL = re.compile(r"[A-Z][A-Z0-9.\-]{0,9}")


def fetch() -> str:
    request = urllib.request.Request(URL, headers={"User-Agent": "market-structure-refresh/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)["parse"]["wikitext"]["*"]


def parse(wikitext: str) -> list[dict]:
    rows, out = wikitext.split("\n|-\n")[1:], []
    for row in rows:
        cells = [c.strip() for c in re.split(r"\n\|\|?", "\n" + row) if c.strip()]
        if len(cells) < 3:
            continue
        match = re.search(r"\{\{[^|}]+\|([^|}]+)", cells[0])
        symbol = (match.group(1) if match else cells[0]).strip()
        if not SYMBOL.fullmatch(symbol):
            continue
        name = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", cells[1]).strip()
        out.append({"symbol": symbol.replace(".", "-"), "name": name, "sector": cells[2].strip()})
    return out


def main() -> None:
    constituents = parse(fetch())
    unique = {c["symbol"] for c in constituents}
    if not 495 <= len(unique) <= 510 or len(unique) != len(constituents):
        raise SystemExit(f"Refusing to write: {len(constituents)} rows, {len(unique)} unique symbols.")
    payload = {"as_of": date.today().isoformat(), "source": "Wikipedia: List of S&P 500 companies", "constituents": constituents}
    OUT.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(constituents)} constituents to {OUT}")


if __name__ == "__main__":
    main()
