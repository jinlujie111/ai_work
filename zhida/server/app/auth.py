from __future__ import annotations

from datetime import timedelta
from typing import Annotated

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User
from .timeutil import utc_now


def create_token(user_id: int, openid: str) -> str:
    settings = get_settings()
    payload = {
        "sub": str(user_id),
        "openid": openid,
        "exp": utc_now() + timedelta(days=settings.jwt_expire_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="invalid token") from exc


def get_current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token)
    user = db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="user not found")
    request.state.user_id = user.id
    return user


async def wx_code_to_openid(code: str) -> str:
    settings = get_settings()
    if not settings.wx_appid or not settings.wx_secret:
        raise HTTPException(status_code=400, detail="wx appid/secret not configured")
    url = "https://api.weixin.qq.com/sns/jscode2session"
    params = {
        "appid": settings.wx_appid,
        "secret": settings.wx_secret,
        "js_code": code,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(url, params=params)
        data = resp.json()
    openid = data.get("openid")
    if not openid:
        raise HTTPException(status_code=400, detail=data.get("errmsg") or "wx login failed")
    return openid
