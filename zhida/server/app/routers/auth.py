from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import create_token, wx_code_to_openid
from ..config import get_settings
from ..db import get_db
from ..models import User
from ..schemas import DevLoginIn, TokenOut, WxLoginIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _issue(db: Session, user: User) -> TokenOut:
    token = create_token(user.id, user.openid)
    return TokenOut(
        token=token,
        user_id=user.id,
        nickname=user.nickname,
        membership=user.membership,
    )


@router.get("/mode")
def auth_mode():
    settings = get_settings()
    wx_ready = bool(settings.wx_appid and settings.wx_secret)
    return {
        "app_env": settings.app_env,
        "wx_configured": wx_ready,
        "dev_login_enabled": settings.dev_tools_enabled(),
        "dev_activate_enabled": settings.dev_tools_enabled(),
        # 配齐微信后，wx-login 不再接受假 code
        "wx_requires_real_code": wx_ready,
    }


@router.post("/dev-login", response_model=TokenOut)
def dev_login(body: DevLoginIn, db: Session = Depends(get_db)):
    settings = get_settings()
    if not settings.dev_tools_enabled():
        raise HTTPException(status_code=403, detail="dev login disabled")
    openid = f"dev_{body.device_id}"
    user = db.query(User).filter(User.openid == openid).first()
    if not user:
        user = User(openid=openid, nickname=body.nickname or "学习者")
        db.add(user)
        db.commit()
        db.refresh(user)
    return _issue(db, user)


@router.post("/wx-login", response_model=TokenOut)
async def wx_login(body: WxLoginIn, db: Session = Depends(get_db)):
    settings = get_settings()
    if settings.wx_appid and settings.wx_secret:
        openid = await wx_code_to_openid(body.code)
    else:
        raise HTTPException(
            status_code=400,
            detail="wx not configured; set WX_APPID/WX_SECRET or use /api/auth/dev-login",
        )

    user = db.query(User).filter(User.openid == openid).first()
    if not user:
        user = User(openid=openid, nickname="学习者")
        db.add(user)
        db.commit()
        db.refresh(user)
    return _issue(db, user)
