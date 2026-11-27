from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient

# 测试默认走开发态；勿用 prod，否则启动自检会拦
os.environ.setdefault("APP_ENV", "dev")
os.environ.setdefault("AUTH_DEV_MODE", "true")
os.environ.setdefault("CORS_ORIGINS", "*")


@pytest.fixture()
def client():
    from app.config import get_settings

    get_settings.cache_clear()
    from app.main import app

    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


@pytest.fixture()
def auth_header(client: TestClient):
    device_id = f"test_{uuid.uuid4().hex[:16]}"
    resp = client.post(
        "/api/auth/dev-login",
        json={"device_id": device_id, "nickname": "pytest"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}
