from fastapi import FastAPI

from app.settings import settings

app = FastAPI(title="Relay AI Service")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "asr_provider": settings.asr_provider, "llm_provider": settings.llm_provider}
