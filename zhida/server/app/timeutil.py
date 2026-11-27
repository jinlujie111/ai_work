"""UTC 时间工具：避免 datetime.utcnow() 弃用，并对齐 MySQL 无时 DateTime。"""

from __future__ import annotations

from datetime import datetime, timezone

UTC = timezone.utc


def utc_now() -> datetime:
    """返回 naive UTC，便于写入/比较现有 DateTime 列。"""
    return datetime.now(UTC).replace(tzinfo=None)
