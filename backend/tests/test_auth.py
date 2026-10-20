import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import create_app

PIN = "123456"
LAN = ("192.168.1.50", 50000)
H = {"X-MSI-Request": "1"}


@pytest.fixture(autouse=True)
def fast_hash(monkeypatch):
    monkeypatch.setattr(auth, "ITERATIONS", 1000)
    monkeypatch.delenv("MSI_AUTH_PATH", raising=False)


HOST = "192.168.1.20"


def make(tmp_path, ip=LAN, pin=PIN):
    tmp_path.mkdir(parents=True, exist_ok=True)
    if pin:
        auth.write_pin_file(tmp_path / "auth.json", pin)
    base = "http://localhost" if ip[0] in auth.LOCAL_HOSTS else f"http://{HOST}:8000"
    return TestClient(create_app(tmp_path / "t.sqlite3"), client=ip, base_url=base)


def login(c, pin=PIN):
    return c.post("/api/v1/auth/login", json={"pin": pin}, headers=H)


def test_local_needs_no_login(tmp_path):
    with make(tmp_path, ("127.0.0.1", 1)) as c, make(tmp_path / "x", ("::1", 1), pin=None) as c6:
        assert c.get("/api/v1/instruments").status_code == 200
        assert c.get("/api/v1/auth/status").json() == {"local": True, "pin_set": True, "authenticated": False}
        assert c6.get("/api/v1/instruments").status_code == 200
        assert c6.get("/docs").status_code == 200


def test_lan_requires_login(tmp_path):
    with make(tmp_path) as c:
        r = c.get("/api/v1/instruments")
        assert r.status_code == 401 and r.json() == {"detail": "Login required"}
        assert c.get("/api/v1/health").status_code == 200
        assert c.get("/api/v1/auth/status").json() == {"local": False, "pin_set": True, "authenticated": False}


def test_no_pin_file_fails_closed(tmp_path):
    with make(tmp_path, pin=None) as c:
        r = c.get("/api/v1/instruments")
        assert r.status_code == 401 and r.json()["detail"] == "No PIN is set on the host PC"
        assert login(c).status_code == 401
        assert c.get("/docs").status_code == 401


def test_wrong_and_malformed_pin(tmp_path):
    with make(tmp_path) as c:
        r = login(c, "654321")
        assert r.status_code == 401 and r.json()["detail"] == "Wrong PIN"
        for bad in ["12345", "1234567890123", "12a456", "", 123456, None]:
            r = login(c, bad)
            assert r.status_code == 422 and "123456" not in r.text
        assert c.post("/api/v1/auth/login", content=b"nope", headers=H).status_code == 422


def test_ip_lockout(tmp_path):
    with make(tmp_path) as c:
        for _ in range(5):
            assert login(c, "000000").status_code == 401
        r = login(c)
        assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0
        with TestClient(c.app, client=("192.168.1.99", 1), base_url=f"http://{HOST}:8000") as other:
            assert login(other).status_code == 200


def test_ip_lock_doubles_and_success_resets():
    now = [0.0]
    lim = auth.LoginLimiter(clock=lambda: now[0])
    for _ in range(5):
        lim.failure("a")
    assert 59 <= lim.retry_after("a") <= 61
    now[0] = 62
    lim.failure("a")
    assert 119 <= lim.retry_after("a") <= 121
    now[0] = 200
    lim.success("a")
    assert lim.retry_after("a") == 0


def test_global_lockout(tmp_path):
    with make(tmp_path, ("192.168.1.1", 1)) as first:
        for i in range(20):
            with TestClient(first.app, client=(f"192.168.2.{i}", 1), base_url=f"http://{HOST}:8000") as c:
                assert login(c, "000000").status_code == 401
        with TestClient(first.app, client=("192.168.3.3", 1), base_url=f"http://{HOST}:8000") as c:
            assert login(c).status_code == 429
        with TestClient(first.app, client=("127.0.0.1", 1), base_url="http://localhost") as local:
            assert login(local).status_code == 200


def test_login_session_logout(tmp_path):
    with make(tmp_path) as c:
        r = login(c)
        assert r.status_code == 200
        cookie = r.headers["set-cookie"].lower()
        assert "msi_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
        assert "path=/api/v1" in cookie and "secure" not in cookie
        assert c.get("/api/v1/instruments").status_code == 200
        assert c.get("/api/v1/auth/status").json()["authenticated"] is True
        assert c.get("/docs").status_code == 401  # cookie path is /api/v1, so docs stay closed to LAN
        assert c.post("/api/v1/auth/logout", headers=H).status_code == 200
        assert c.get("/api/v1/instruments").status_code == 401


def test_token_stored_hashed_and_expiry(tmp_path):
    with make(tmp_path) as c:
        token = login(c).cookies.get("msi_session")
        with c.app.state.store.connect() as db:
            rows = db.execute("SELECT token_hash FROM sessions").fetchall()
            data = auth.load_pin_file(tmp_path / "auth.json")
            assert rows == [(auth.token_hash(token, data),)] and token not in rows[0][0]
            db.execute("UPDATE sessions SET expires_at=?", ((datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),))
        assert c.get("/api/v1/instruments").status_code == 401


def test_csrf_header_required_for_lan_writes(tmp_path):
    with make(tmp_path) as c:
        assert c.post("/api/v1/auth/login", json={"pin": PIN}).status_code == 403
        assert login(c).status_code == 200
        assert c.post("/api/v1/scan/auto", json={"minutes": 0}).status_code == 403
        assert c.post("/api/v1/auth/logout").status_code == 403


def test_docs_protected_for_lan(tmp_path):
    with make(tmp_path) as c:
        for p in ("/docs", "/redoc", "/openapi.json"):
            assert c.get(p).status_code == 401


def test_cors_credentials(tmp_path):
    with make(tmp_path) as c:
        origin = f"http://{HOST}:3000"
        r = c.options("/api/v1/auth/login", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                                      "Access-Control-Request-Headers": "x-msi-request,content-type"})
        assert r.headers["access-control-allow-origin"] == origin
        assert r.headers["access-control-allow-credentials"] == "true"
        r = c.get("/api/v1/instruments", headers={"Origin": origin})
        assert r.status_code == 401 and r.headers["access-control-allow-origin"] == origin
        assert "access-control-allow-origin" not in c.get("/api/v1/health", headers={"Origin": "http://8.8.8.8:3000"}).headers


def test_pin_file_format_and_set_pin(tmp_path, monkeypatch, capsys):
    from scripts import set_pin
    monkeypatch.setenv("MSI_AUTH_PATH", str(tmp_path / "a" / "auth.json"))
    answers = iter(["abc", "12345", "424242", "424242"])
    monkeypatch.setattr("getpass.getpass", lambda prompt="": next(answers))
    set_pin.main()
    assert "424242" not in capsys.readouterr().out
    data = json.loads((tmp_path / "a" / "auth.json").read_text())
    assert set(data) == {"algorithm", "iterations", "salt_hex", "hash_hex"} and len(bytes.fromhex(data["salt_hex"])) == 16
    assert auth.verify_pin(data, "424242") and not auth.verify_pin(data, "424243")


def test_real_iterations_constant():
    assert auth.ITERATIONS == 1000  # patched by fixture
    import importlib.util
    spec = importlib.util.spec_from_file_location("auth_fresh", auth.__file__)
    fresh = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fresh)
    assert fresh.ITERATIONS == 600_000


def test_rebound_dns_name_is_not_local(tmp_path):
    with make(tmp_path, ("127.0.0.1", 1)) as c:
        r = c.get("/api/v1/instruments", headers={"Host": "attacker.example:8000"})
        assert r.status_code == 401
        assert c.get("/api/v1/auth/status", headers={"Host": "attacker.example"}).json()["local"] is False


def test_origin_must_match_host(tmp_path):
    with make(tmp_path) as c:
        assert login(c).status_code == 200
        assert c.get("/api/v1/instruments").status_code == 200
        assert c.get("/api/v1/instruments", headers={"Origin": f"http://{HOST}:3000"}).status_code == 200
        r = c.get("/api/v1/instruments", headers={"Origin": "http://192.168.1.77:3000"})
        assert r.status_code == 403


def test_attempts_are_counted_before_checking():
    lim = auth.LoginLimiter(clock=lambda: 0.0)
    assert [lim.attempt("a") for _ in range(5)] == [0] * 5
    assert lim.attempt("a") > 0
    other = auth.LoginLimiter(clock=lambda: 0.0)
    for _ in range(4):
        other.attempt("b")
    other.success("b")
    assert other.attempt("b") == 0


def test_set_pin_logs_everyone_out(tmp_path, monkeypatch):
    from app.store import Store
    from scripts import set_pin
    db = tmp_path / "market.sqlite3"
    store = Store(db)
    store.initialize()
    store.create_session("h", "2026-01-01T00:00:00+00:00", "2999-01-01T00:00:00+00:00")
    monkeypatch.setenv("MSI_DB_PATH", str(db))
    monkeypatch.setattr(set_pin.getpass, "getpass", lambda prompt="": "654321")
    set_pin.main()
    assert store.session_valid("h") is False


def test_cors_allows_private_tunnel_range(tmp_path):
    with make(tmp_path) as c:
        ok, bad = "http://100.101.102.103:3000", "http://100.200.1.1:3000"
        h = {"Access-Control-Request-Method": "POST"}
        assert c.options("/api/v1/auth/login", headers={"Origin": ok, **h}).headers.get("access-control-allow-origin") == ok
        assert "access-control-allow-origin" not in c.options("/api/v1/auth/login", headers={"Origin": bad, **h}).headers


def test_login_straddling_pin_change_gets_no_session(tmp_path, monkeypatch):
    with make(tmp_path) as c:
        real_verify = auth.verify_pin

        def verify_then_rotate(data, pin):
            ok = real_verify(data, pin)
            auth.write_pin_file(tmp_path / "auth.json", "999999")  # set_pin runs while this login is paused
            return ok

        monkeypatch.setattr(auth, "verify_pin", verify_then_rotate)
        assert login(c).status_code == 200
        assert c.get("/api/v1/instruments").status_code == 401


def test_retry_after_is_readable_cross_origin(tmp_path):
    with make(tmp_path) as c:
        origin = f"http://{HOST}:3000"
        for _ in range(5):
            login(c, "000000")
        r = c.post("/api/v1/auth/login", json={"pin": PIN}, headers={**H, "Origin": origin})
        assert r.status_code == 429 and "retry-after" in r.headers["access-control-expose-headers"].lower()


def test_quit_is_host_pc_only(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setenv("MSI_STOP_SCRIPT", "C:/x/stop.bat")
    with make(tmp_path) as lan, make(tmp_path / "l", ("127.0.0.1", 1)) as local:
        for c in (lan, local):
            c.app.state.launch_stop = calls.append
        assert login(lan).status_code == 200
        assert lan.post("/api/v1/app/quit", headers=H).status_code == 403
        assert lan.post("/api/v1/app/quit", headers={**H, "Host": "localhost"}).status_code == 403
        assert local.post("/api/v1/app/quit", headers={"Host": "attacker.example"}).status_code == 403
        assert local.post("/api/v1/app/quit").status_code == 403  # header required even locally
        assert calls == []
        assert local.post("/api/v1/app/quit", headers=H).status_code == 200
        assert calls == ["C:/x/stop.bat"]
