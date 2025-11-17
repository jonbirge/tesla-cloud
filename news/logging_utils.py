#!/usr/bin/env python3
"""
Utilities for mirroring stdout/stderr output to a log file.
"""

import atexit
import sys
from pathlib import Path
from threading import Lock


class TeeStream:
    """Mirror writes to the original stream and the shared log file."""

    def __init__(self, stream, log_file, lock):
        self._stream = stream
        self._log_file = log_file
        self._lock = lock

    def write(self, data):
        if not data:
            return 0

        written = self._stream.write(data)
        self._stream.flush()
        with self._lock:
            if self._log_file and not self._log_file.closed:
                try:
                    self._log_file.write(data)
                    self._log_file.flush()
                except Exception:
                    pass
        return written

    def flush(self):
        self._stream.flush()
        with self._lock:
            if self._log_file and not self._log_file.closed:
                try:
                    self._log_file.flush()
                except Exception:
                    pass


_log_file_handle = None
_log_lock = Lock()


def _close_log_file():
    global _log_file_handle
    if _log_file_handle and not _log_file_handle.closed:
        _log_file_handle.close()
    _log_file_handle = None


def setup_dual_logging(log_filename="news.log"):
    """
    Mirror stdout and stderr into a log file alongside the script.

    Returns:
        Path to the log file.
    """
    global _log_file_handle

    # Avoid reconfiguring if already wrapped
    if getattr(sys.stdout, "_news_dual_logging", False):
        return Path(sys.stdout._log_path)  # type: ignore[attr-defined]

    script_dir = Path(__file__).resolve().parent
    log_path = script_dir / log_filename

    if _log_file_handle is None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        _log_file_handle = open(log_path, "a", encoding="utf-8")
        atexit.register(_close_log_file)

    sys.stdout = TeeStream(sys.stdout, _log_file_handle, _log_lock)  # type: ignore[assignment]
    sys.stdout._news_dual_logging = True  # type: ignore[attr-defined]
    sys.stdout._log_path = str(log_path)  # type: ignore[attr-defined]

    sys.stderr = TeeStream(sys.stderr, _log_file_handle, _log_lock)  # type: ignore[assignment]
    sys.stderr._news_dual_logging = True  # type: ignore[attr-defined]
    sys.stderr._log_path = str(log_path)  # type: ignore[attr-defined]

    return log_path
