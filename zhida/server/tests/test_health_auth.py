from __future__ import annotations

from app.config import Settings, get_settings


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["service"] == "zhida"


def test_dev_login_and_me(client, auth_header):
    resp = client.get("/api/me", headers=auth_header)
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] > 0
    assert "goal_quota" in body


def test_dev_login_disabled_when_auth_dev_mode_false(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_dev_mode", False)
    monkeypatch.setattr(settings, "app_env", "dev")
    resp = client.post(
        "/api/auth/dev-login",
        json={"device_id": "test_disabled_xxxx", "nickname": "x"},
    )
    assert resp.status_code == 403


def test_membership_activate_disabled_when_dev_tools_off(client, auth_header, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_dev_mode", False)
    resp = client.post(
        "/api/me/membership/activate",
        headers=auth_header,
        json={"plan": "month"},
    )
    assert resp.status_code == 403


def test_prod_startup_rejects_weak_config(monkeypatch):
    s = Settings()
    monkeypatch.setattr(s, "app_env", "prod")
    monkeypatch.setattr(s, "auth_dev_mode", True)
    monkeypatch.setattr(s, "jwt_secret", "zhida-dev-secret")
    monkeypatch.setattr(s, "wx_appid", "")
    monkeypatch.setattr(s, "wx_secret", "")
    monkeypatch.setattr(s, "cors_origins", "*")
    try:
        s.validate_startup()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        msg = str(exc)
        assert "AUTH_DEV_MODE" in msg or "JWT_SECRET" in msg or "WX_" in msg
