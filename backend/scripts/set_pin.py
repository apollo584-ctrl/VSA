"""Set the shared dashboard PIN: python -m scripts.set_pin"""
import getpass
import os
import sys
from pathlib import Path

from app.auth import auth_path, valid_pin, write_pin_file
from app.store import Store


def main():
    while True:
        pin = getpass.getpass("New PIN (6-12 digits): ")
        if not valid_pin(pin):
            print("PIN must be 6 to 12 digits, numbers only.")
            continue
        if getpass.getpass("Repeat PIN: ") != pin:
            print("PINs did not match.")
            continue
        break
    db = Path(os.getenv("MSI_DB_PATH", str(Path(__file__).resolve().parents[1] / "data/market.sqlite3")))
    path = auth_path(db)
    write_pin_file(path, pin)
    store = Store(db)
    store.initialize()
    store.clear_sessions()
    print(f"PIN saved to {path}. Every device must log in again.")


if __name__ == "__main__":
    sys.exit(main())
