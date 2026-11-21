"""FastAPI application entrypoint for SliceM backend."""

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

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse, tags=["health"])
def health_check() -> HealthResponse:
    """Top-level health check endpoint."""
    return HealthResponse(status="ok", service=SERVICE_NAME, version=VERSION)


# Mount API routes under /api
app.include_router(api_router, prefix="/api")
