"""Shared-PIN login: PBKDF2 hash file, login rate limits, session checks and the global FastAPI dependency."""
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
import time
from pathlib import Path

from fastapi import HTTPException, Request

ITERATIONS = 600_000
COOKIE = "msi_session"
SESSION_SECONDS = 30 * 24 * 3600
LOCAL_HOSTS = {"127.0.0.1", "::1"}
LOCAL_NAMES = {"localhost", "127.0.0.1", "::1"}
EXEMPT = {("GET", "/api/v1/health"), ("GET", "/api/v1/auth/status"),
          ("POST", "/api/v1/auth/login"), ("POST", "/api/v1/auth/logout")}
PIN_RE = re.compile(r"[0-9]{6,12}")
IP_FAILS, IP_WINDOW, IP_BASE_LOCK, IP_MAX_LOCK = 5, 15 * 60, 60, 15 * 60
GLOBAL_FAILS, GLOBAL_WINDOW, GLOBAL_LOCK = 20, 60 * 60, 30 * 60


def valid_pin(pin) -> bool:
    return isinstance(pin, str) and PIN_RE.fullmatch(pin) is not None


def auth_path(db_path: Path) -> Path:
    env = os.getenv("MSI_AUTH_PATH")
    return Path(env) if env else Path(db_path).parent / "auth.json"


def hash_pin(pin: str, salt: bytes | None = None) -> dict:
    salt = salt if salt is not None else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, ITERATIONS)
    return {"algorithm": "pbkdf2_sha256", "iterations": ITERATIONS, "salt_hex": salt.hex(), "hash_hex": digest.hex()}


def write_pin_file(path: Path, pin: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".auth-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(hash_pin(pin), f)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def load_pin_file(path: Path) -> dict | None:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if data["algorithm"] != "pbkdf2_sha256":
            return None
        bytes.fromhex(data["salt_hex"]); bytes.fromhex(data["hash_hex"])
        int(data["iterations"])
        return data
    except (OSError, ValueError, KeyError, TypeError):
        return None


def verify_pin(data: dict, pin: str) -> bool:
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(data["salt_hex"]), int(data["iterations"]))
    return hmac.compare_digest(digest, bytes.fromhex(data["hash_hex"]))


def host_name(value: str | None) -> str:
    """Hostname of a Host header or Origin URL, lowercased, without port or IPv6 brackets."""
    value = (value or "").strip().lower()
    if "://" in value:
        value = value.split("://", 1)[1]
    value = value.split("/", 1)[0]
    if value.startswith("["):
        return value[1:value.find("]")] if "]" in value else ""
    return value.rsplit(":", 1)[0] if value.count(":") == 1 else value


def is_local(request: Request) -> bool:
    """Loopback client addressing the server by a loopback name; a rebound DNS name never counts as local."""
    return (request.client is not None and request.client.host in LOCAL_HOSTS
            and host_name(request.headers.get("host")) in LOCAL_NAMES)


def same_host_origin(request: Request) -> bool:
    """A browser Origin, when sent, must name the host this server was reached on (the dashboard runs on the same PC)."""
    origin = request.headers.get("origin")
    return origin is None or host_name(origin) == host_name(request.headers.get("host"))


def token_hash(token: str, pin_data: dict) -> str:
    """Session key bound to the PIN generation (each set_pin draws a new salt), so a login that verified the old PIN
    but finished after a PIN change stores a key that never matches again."""
    return hashlib.sha256(f"{pin_data['salt_hex']}:{token}".encode()).hexdigest()


class LoginLimiter:
    """In-memory, thread-safe per-IP and global login failure limits (non-local clients only)."""

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.ips: dict[str, dict] = {}
        self.global_fails: list[float] = []
        self.global_locked_until = 0.0

    def retry_after(self, ip: str) -> int:
        """Seconds the client must wait, or 0."""
        with self.lock:
            now = self.clock()
            wait = max(self.global_locked_until - now, self.ips.get(ip, {}).get("locked_until", 0.0) - now)
            return int(wait) + 1 if wait > 0 else 0

    def attempt(self, ip: str) -> int:
        """Atomically refuse a locked client (returns seconds to wait) or count this attempt as a failure up front,
        so parallel guesses cannot all pass the lock check before any of them is recorded."""
        with self.lock:
            now = self.clock()
            wait = max(self.global_locked_until - now, self.ips.get(ip, {}).get("locked_until", 0.0) - now)
            if wait > 0:
                return int(wait) + 1
            self._record(ip, now)
            return 0

    def failure(self, ip: str):
        with self.lock:
            self._record(ip, self.clock())

    def _record(self, ip: str, now: float):
        for key in [k for k, s in self.ips.items() if s["locked_until"] <= now and not [t for t in s["fails"] if now - t < IP_WINDOW]]:
            del self.ips[key]
        state = self.ips.setdefault(ip, {"fails": [], "locked_until": 0.0, "level": 0})
        state["fails"] = [t for t in state["fails"] if now - t < IP_WINDOW] + [now]
        if len(state["fails"]) >= IP_FAILS:
            state["level"] += 1
            state["locked_until"] = now + min(IP_BASE_LOCK * 2 ** (state["level"] - 1), IP_MAX_LOCK)
        self.global_fails = [t for t in self.global_fails if now - t < GLOBAL_WINDOW] + [now]
        if len(self.global_fails) >= GLOBAL_FAILS:
            self.global_locked_until = now + GLOBAL_LOCK
            self.global_fails = []

    def success(self, ip: str):
        """A correct PIN clears the client and undoes its up-front count."""
        with self.lock:
            self.ips.pop(ip, None)
            if self.global_fails:
                self.global_fails.pop()


def require_auth(request: Request):
    """Global dependency for /api/v1: CSRF header for non-local writes, then session check."""
    if is_local(request):
        return
    if not same_host_origin(request):
        raise HTTPException(403, "Origin not allowed")
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-msi-request") != "1":
        raise HTTPException(403, "Missing X-MSI-Request header")
    if (request.method, request.url.path) in EXEMPT:
        return
    if load_pin_file(request.app.state.auth_path) is None:
        raise HTTPException(401, "No PIN is set on the host PC")
    if not has_session(request):
        raise HTTPException(401, "Login required")


def has_session(request: Request) -> bool:
    token = request.cookies.get(COOKIE)
    data = load_pin_file(request.app.state.auth_path) if token else None
    return data is not None and request.app.state.store.session_valid(token_hash(token, data))
