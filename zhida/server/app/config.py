from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env"

_WEAK_JWT_SECRETS = frozenset(
    {
        "",
        "zhida-dev-secret",
        "change-me",
        "secret",
        "jwt-secret",
    }
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    llm_provider: str = "deepseek"
    llm_profile: str = "office"
    llm_model: str = ""
    llm_temperature: float = 0.2
    llm_max_tokens: int = 4096
    llm_timeout: int = 60
    llm_max_retries: int = 2

    deepseek_personal_api_key: str = ""
    deepseek_personal_base_url: str = "https://api.deepseek.com/v1"
    deepseek_personal_model: str = "deepseek-chat"

    deepseek_office_api_key: str = ""
    deepseek_office_base_url: str = ""
    deepseek_office_model: str = "deepseek-chat"

    minimax_personal_api_key: str = ""
    minimax_personal_base_url: str = "https://api.minimax.cn/v1"
    minimax_personal_model: str = "MiniMax-M3.1-Flash"

    mysql_host: str = "127.0.0.1"
    mysql_port: int = 3306
    mysql_user: str = "root"
    mysql_password: str = ""
    mysql_database: str = "ai_work_zd"
    mysql_charset: str = "utf8mb4"
    database_url: str = ""

    app_host: str = "0.0.0.0"
    app_port: int = 7102
    # dev | prod；prod 启动时强制校验密钥与微信配置
    app_env: str = "dev"
    # 逗号分隔；本地可用 * ；prod 应写显式域名
    cors_origins: str = "*"

    wx_appid: str = ""
    wx_secret: str = ""
    auth_dev_mode: bool = True
    jwt_secret: str = "zhida-dev-secret"
    jwt_expire_days: int = 30

    # 运营看板登录（/ops）
    admin_username: str = ""
    admin_password: str = ""
    # 可选：机器调用仍可用 X-Admin-Token；网页以账号密码为准
    admin_token: str = ""
    # LLM 成本估算（人民币 / 百万 token），默认对齐 DeepSeek Flash 峰值约价×7.2
    llm_input_cny_per_1m: float = 2.16
    llm_output_cny_per_1m: float = 8.64
    # 月固定成本（服务器等），单位：分；用于利润粗算
    ops_fixed_cost_cents_month: int = 50000

    def is_prod(self) -> bool:
        return (self.app_env or "dev").strip().lower() == "prod"

    def dev_tools_enabled(self) -> bool:
        """开发登录 / 一键开通会员等仅非 prod 且 AUTH_DEV_MODE 开启时可用。"""
        return bool(self.auth_dev_mode) and not self.is_prod()

    def cors_origin_list(self) -> list[str]:
        raw = (self.cors_origins or "*").strip()
        if not raw or raw == "*":
            return ["*"]
        return [part.strip() for part in raw.split(",") if part.strip()]

    def jwt_secret_is_weak(self) -> bool:
        secret = (self.jwt_secret or "").strip()
        if secret.lower() in _WEAK_JWT_SECRETS:
            return True
        return len(secret) < 16

    def validate_startup(self) -> None:
        """prod 缺项时拒绝启动。"""
        if not self.is_prod():
            return
        errors: list[str] = []
        if self.auth_dev_mode:
            errors.append("AUTH_DEV_MODE must be false when APP_ENV=prod")
        if self.jwt_secret_is_weak():
            errors.append("JWT_SECRET is weak or default; set a strong secret (>=16 chars)")
        if not (self.wx_appid and self.wx_secret):
            errors.append("WX_APPID and WX_SECRET are required when APP_ENV=prod")
        origins = self.cors_origin_list()
        if origins == ["*"]:
            errors.append("CORS_ORIGINS must be explicit domains when APP_ENV=prod (not *)")
        if errors:
            raise RuntimeError("prod startup check failed: " + "; ".join(errors))

    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"mysql+pymysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
            f"?charset={self.mysql_charset}"
        )

    def resolve_llm(self) -> dict:
        provider = (self.llm_provider or "deepseek").lower()
        profile = (self.llm_profile or "personal").lower()

        if provider == "minimax":
            return {
                "api_key": self.minimax_personal_api_key,
                "base_url": self.minimax_personal_base_url.rstrip("/"),
                "model": self.llm_model or self.minimax_personal_model,
            }

        if profile == "office":
            return {
                "api_key": self.deepseek_office_api_key or self.deepseek_personal_api_key,
                "base_url": (self.deepseek_office_base_url or self.deepseek_personal_base_url).rstrip("/"),
                "model": self.llm_model or self.deepseek_office_model or self.deepseek_personal_model,
            }

        return {
            "api_key": self.deepseek_personal_api_key,
            "base_url": self.deepseek_personal_base_url.rstrip("/"),
            "model": self.llm_model or self.deepseek_personal_model,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
