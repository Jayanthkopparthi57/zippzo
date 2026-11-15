"""Shared bootstrap for the local-only developer scripts in this folder.

These scripts create or delete real records, so they must never touch a shared
or production database by accident. Importing this module makes the repository
root importable and :func:`require_local_database` refuses to continue unless
the configured database is local Postgres (or the operator has explicitly
opted in with ``ALLOW_REMOTE_DEV_SCRIPTS=1``).
"""
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def require_local_database():
    """Abort unless the active database is safe for destructive scripts."""
    from django.conf import settings

    db = settings.DATABASES["default"]
    name = str(db.get("NAME") or "")
    host = str(db.get("HOST") or "")
    local_host = host in {"", "localhost", "127.0.0.1", "::1"}
    looks_remote = "neon" in name.lower() or "neon.tech" in host.lower()

    if os.environ.get("ALLOW_REMOTE_DEV_SCRIPTS") == "1":
        print(
            "WARNING: ALLOW_REMOTE_DEV_SCRIPTS=1 — running against "
            f"{name!r} on {host!r}",
            file=sys.stderr,
        )
        return
    if local_host and not looks_remote:
        return

    raise SystemExit(
        "Refusing to run a destructive development script against "
        f"database {name!r} on host {host!r}.\n"
        "Point DB_* at local Postgres, or set ALLOW_REMOTE_DEV_SCRIPTS=1 if "
        "you are certain this is a disposable database."
    )
