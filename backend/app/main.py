"""FastAPI application entrypoint for SliceM backend."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router as api_router
from app.config import ALLOWED_ORIGINS, SERVICE_NAME, VERSION, ensure_workspace
from app.models.schemas import HealthResponse

# Ensure workspace folder is available at startup
ensure_workspace()

app = FastAPI(
    title="SliceM 3D DICOM Backend",
    description="Geometry-first 3D anatomical reconstruction pipeline from DICOM (CT and MRI)",
    version=VERSION,
)

# CORS configuration: allow local dev, production tarunlabs.earth domains, and any extra ALLOWED_ORIGINS
origins = list(ALLOWED_ORIGINS)
extra_origins = os.getenv("ALLOWED_ORIGINS", "")
if extra_origins:
    for o in extra_origins.split(","):
        cleaned = o.strip()
        if cleaned and cleaned not in origins:
            origins.append(cleaned)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Slice-Count"],
)


@app.get("/health", response_model=HealthResponse, tags=["health"])
def health_check() -> HealthResponse:
    """Top-level health check endpoint."""
    return HealthResponse(status="ok", service=SERVICE_NAME, version=VERSION)


# Mount API routes under /api
app.include_router(api_router, prefix="/api")
