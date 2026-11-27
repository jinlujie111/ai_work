from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_engine(
    settings.sqlalchemy_url(),
    pool_pre_ping=True,
    pool_recycle=3600,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401
    from sqlalchemy import text

    Base.metadata.create_all(bind=engine)

    # MySQL 5.5：已有表不会自动加列，启动时幂等补齐
    alters = [
        "ALTER TABLE zd_users ADD COLUMN membership_expires_at DATETIME NULL",
        "ALTER TABLE zd_users ADD COLUMN subscribe_daily INT DEFAULT 0",
        "ALTER TABLE zd_users ADD COLUMN subscribe_weekly INT DEFAULT 0",
        "ALTER TABLE zd_tasks ADD COLUMN depends_on_json TEXT",
        "ALTER TABLE zd_tasks ADD COLUMN resources_json TEXT",
        "ALTER TABLE zd_goals ADD COLUMN resources_json TEXT",
        "ALTER TABLE zd_goals ADD COLUMN learning_path_json TEXT",
        "ALTER TABLE zd_goals ADD COLUMN modules_json TEXT",
        "ALTER TABLE zd_goals ADD COLUMN priority_rank INT DEFAULT 100",
        "ALTER TABLE zd_goal_stages ADD COLUMN skippable INT DEFAULT 0",
        "ALTER TABLE zd_goal_stages ADD COLUMN skip_reason VARCHAR(255) DEFAULT ''",
        "ALTER TABLE zd_ai_usage ADD COLUMN tokens_accurate INT DEFAULT 0",
        "ALTER TABLE zd_goals ADD COLUMN plan_source VARCHAR(32) DEFAULT ''",
        # 历史开发态会员开通：从 paid 挪到 dev_paid，避免运营收入掺假
        "UPDATE zd_membership_orders SET status='dev_paid' WHERE status='paid' AND (note LIKE 'dev%' OR note='dev_activate')",
    ]
    with engine.connect() as conn:
        for sql in alters:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                conn.rollback()
