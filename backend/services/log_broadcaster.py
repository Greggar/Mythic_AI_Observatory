"""SSE-based log broadcaster.

Captures log records via a custom logging handler and streams them
to SSE subscribers over asyncio queues. Also persists to a rotating
file for crash recovery and retrospective analysis.
"""

import asyncio
import logging
import os
from collections import Counter
from datetime import UTC, datetime, timedelta
from logging.handlers import RotatingFileHandler
from typing import Any

logger = logging.getLogger("conductor")

_MAX_BUFFER = 500  # ring buffer size for new subscribers
_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
_LOG_FILE = os.path.join(_LOG_DIR, "conductor.log")
_LOG_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_LOG_BACKUP_COUNT = 3


class LogBroadcaster:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue[dict[str, Any]]] = []
        self._ring: list[dict[str, Any]] = []

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        for entry in self._ring:
            q.put_nowait(entry)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    def broadcast(self, entry: dict[str, Any]) -> None:
        self._ring.append(entry)
        if len(self._ring) > _MAX_BUFFER:
            self._ring.pop(0)
        dead: list[asyncio.Queue[dict[str, Any]]] = []
        for q in self._subscribers:
            try:
                q.put_nowait(entry)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)

    def get_recent(
        self,
        limit: int = 100,
        level: str | None = None,
        since: float | None = None,
    ) -> list[dict[str, Any]]:
        """Return recent entries from the ring buffer, newest first.

        Args:
            limit: Max entries to return.
            level: Optional filter by log level name (e.g. \"ERROR\").
            since: Unix timestamp — only entries after this time.
        """
        result = list(reversed(self._ring))
        if since:
            cutoff = datetime.fromtimestamp(since, tz=UTC)
            result = [e for e in result if _parse_ts(e["ts"]) >= cutoff]
        if level:
            result = [e for e in result if e.get("level") == level.upper()]
        return result[:limit]

    def get_summary(self, window_seconds: float = 300) -> dict[str, Any]:
        """Aggregate log stats over a sliding window (default 5 min)."""
        now = datetime.now(tz=UTC)
        cutoff = now - timedelta(seconds=window_seconds)
        window_entries = [e for e in self._ring if _parse_ts(e["ts"]) >= cutoff]

        level_counts: Counter[str] = Counter()
        logger_counts: Counter[str] = Counter()
        for e in window_entries:
            level_counts[e.get("level", "UNKNOWN")] += 1
            logger_counts[e.get("name", "unknown")] += 1

        total = len(window_entries)
        errors = level_counts.get("ERROR", 0)
        warnings = level_counts.get("WARNING", 0)

        return {
            "total_entries": len(self._ring),
            "errors_24h": sum(1 for e in self._ring if e.get("level") == "ERROR"),
            "warnings_24h": sum(1 for e in self._ring if e.get("level") == "WARNING"),
            "errors_last_5m": errors,
            "warnings_last_5m": warnings,
            "entries_per_min": round(total / max(window_seconds / 60, 1), 1),
            "top_loggers": logger_counts.most_common(5),
        }


def _parse_ts(ts_str: str) -> datetime:
    try:
        return datetime.fromisoformat(ts_str)
    except Exception:
        return datetime.min.replace(tzinfo=UTC)


_broadcaster = LogBroadcaster()


class SSELogHandler(logging.Handler):
    """Logging handler that pushes records to the LogBroadcaster."""

    def __init__(self, level: int = logging.INFO) -> None:
        super().__init__(level)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry: dict[str, Any] = {
                "ts": datetime.now(tz=UTC).isoformat(),
                "level": record.levelname,
                "name": record.name,
                "msg": self.format(record),
            }
            _broadcaster.broadcast(entry)
        except Exception:
            self.handleError(record)


def get_broadcaster() -> LogBroadcaster:
    return _broadcaster


def install_handler() -> None:
    """Install the SSE handler + rotating file handler on the root logger."""
    fmt = logging.Formatter("%(message)s")

    sse_handler = SSELogHandler()
    sse_handler.setFormatter(fmt)

    os.makedirs(_LOG_DIR, exist_ok=True)
    file_handler = RotatingFileHandler(
        _LOG_FILE,
        maxBytes=_LOG_MAX_BYTES,
        backupCount=_LOG_BACKUP_COUNT,
    )
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    ))
    file_handler.setLevel(logging.INFO)

    root = logging.getLogger()
    root.addHandler(sse_handler)
    root.addHandler(file_handler)
    root.setLevel(logging.INFO)

    logger.info("Logging to %s (max %d MB, %d backups)", _LOG_FILE, _LOG_MAX_BYTES // 1024 // 1024, _LOG_BACKUP_COUNT)
