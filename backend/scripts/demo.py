"""Reproducible synthetic fixtures and API receipts; never live market data."""
import csv
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import pandas as pd
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Source

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures"


def demo_csv() -> bytes:
    import io
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
    for session in range(6):
        start = pd.Timestamp("2025-03-03 09:30", tz="America/New_York") + pd.DateOffset(days=session if session < 5 else 7)
        for i in range(78):
            mid = 100 + session * 0.5 + i * 0.025 + (i % 5 - 2) * 0.03
            o, c = round(mid - 0.04, 3), round(mid + 0.04, 3)
            high, low = round(mid + 0.14, 3), round(mid - 0.14, 3)
            volume = 1000 + (i % 7) * 50
            # Final session: several contextual candidates and a high-volume upthrust.
            if session == 5 and i == 55:
                high, low, o, c, volume = 105.0, 103.6, 104.6, 103.7, 6000
            if session == 5 and i == 76:
                high, low, o, c, volume = 106.0, 104.25, 104.5, 104.3, 6500
            if session == 5 and i == 77:
                high, low, o, c, volume = 104.5, 104.15, 104.3, 104.2, 1600
            writer.writerow([(start + pd.Timedelta(minutes=i * 5)).isoformat(), o, high, low, c, volume])
    return output.getvalue().encode()


def demo_source() -> Source:
    return Source(instrument="DEMO", timeframe_minutes=5, source_name="deterministic_synthetic_v1",
                  price_adjustment="unadjusted", volume_adjustment="raw", is_demo=True)


def generate():
    FIXTURES.mkdir(exist_ok=True)
    raw, metadata = demo_csv(), demo_source().model_dump(mode="json")
    (FIXTURES / "demo.csv").write_bytes(raw)
    (FIXTURES / "upload_metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    with TemporaryDirectory() as temp:
        with TestClient(create_app(Path(temp) / "demo.sqlite3")) as client:
            uploaded = client.post("/api/v1/datasets/upload", files={"file": ("demo.csv", raw, "text/csv")},
                                   data={"metadata": json.dumps(metadata)})
            uploaded.raise_for_status()
            dataset = uploaded.json()
            # Stable IDs/timestamps in checked-in frontend mocks; actual API IDs are random.
            new_id = "00000000-0000-0000-0000-000000000001"
            result = client.post("/api/v1/analyze", json={"dataset_id": dataset["id"]})
            result.raise_for_status()
            analysis = result.json()
            dataset.update(id=new_id, created_at="2025-03-10T20:00:00Z")
            analysis.update(id="00000000-0000-0000-0000-000000000002", dataset_id=new_id, created_at="2025-03-10T20:00:00Z")
            for filename, value in [("dataset_response.json", dataset), ("analysis_response.json", analysis),
                                    ("analyze_request.json", {"dataset_id": new_id}),
                                    ("bars_response.json", client.get("/api/v1/market/bars", params={"dataset_id": uploaded.json()["id"]}).json()),
                                    ("openapi.json", client.get("/openapi.json").json())]:
                (FIXTURES / filename).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Generated synthetic fixtures in {FIXTURES}")


if __name__ == "__main__":
    generate()
