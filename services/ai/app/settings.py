from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Env validation for the AI service. Fails fast on import if a required
    var is missing or malformed, instead of surfacing as a runtime KeyError
    deep in a WebSocket handler mid-transport."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Phase 1: required now ---
    supabase_url: str = Field(alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(alias="SUPABASE_SERVICE_ROLE_KEY")
    ai_service_shared_secret: str = Field(alias="AI_SERVICE_SHARED_SECRET")

    # --- Later phases: optional until that phase is built ---
    asr_provider: str = Field(default="cartesia", alias="ASR_PROVIDER")
    cartesia_api_key: str | None = Field(default=None, alias="CARTESIA_API_KEY")
    deepgram_api_key: str | None = Field(default=None, alias="DEEPGRAM_API_KEY")

    llm_provider: str = Field(default="deepseek", alias="LLM_PROVIDER")
    deepseek_api_key: str | None = Field(default=None, alias="DEEPSEEK_API_KEY")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")

    livekit_url: str | None = Field(default=None, alias="LIVEKIT_URL")
    livekit_api_key: str | None = Field(default=None, alias="LIVEKIT_API_KEY")
    livekit_api_secret: str | None = Field(default=None, alias="LIVEKIT_API_SECRET")

    upstash_redis_rest_url: str | None = Field(default=None, alias="UPSTASH_REDIS_REST_URL")
    upstash_redis_rest_token: str | None = Field(default=None, alias="UPSTASH_REDIS_REST_TOKEN")

    r2_account_id: str | None = Field(default=None, alias="R2_ACCOUNT_ID")
    r2_access_key_id: str | None = Field(default=None, alias="R2_ACCESS_KEY_ID")
    r2_secret_access_key: str | None = Field(default=None, alias="R2_SECRET_ACCESS_KEY")
    r2_bucket: str | None = Field(default=None, alias="R2_BUCKET")

    twilio_account_sid: str | None = Field(default=None, alias="TWILIO_ACCOUNT_SID")
    twilio_auth_token: str | None = Field(default=None, alias="TWILIO_AUTH_TOKEN")
    twilio_from_number: str | None = Field(default=None, alias="TWILIO_FROM_NUMBER")

    phi_encryption_key: str | None = Field(default=None, alias="PHI_ENCRYPTION_KEY")
    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")


settings = Settings()  # type: ignore[call-arg]
