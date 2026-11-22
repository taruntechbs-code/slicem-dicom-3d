"""SliceM Backend Configuration."""

from pathlib import Path
import os
from typing import List

# Base directories
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

# Runtime Case Storage
WORKSPACE_DIR_ENV = os.getenv("SLICEM_WORKSPACE_DIR")
if WORKSPACE_DIR_ENV:
    WORKSPACE_DIR = Path(WORKSPACE_DIR_ENV).resolve()
else:
    WORKSPACE_DIR = REPO_ROOT / "workspace"

# Server configuration
HOST = os.getenv("SLICEM_HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", os.getenv("SLICEM_PORT", "8000")))
DEBUG = os.getenv("SLICEM_DEBUG", "true").lower() in ("1", "true", "yes")

# Service metadata
SERVICE_NAME = "slicem-backend"
VERSION = "0.1.0"

# CORS configuration
ALLOWED_ORIGINS: List[str] = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://tarunlabs.earth",
    "https://www.tarunlabs.earth",
    "https://slicem.tarunlabs.earth",
]

# Append extra comma-separated origins from environment if provided
_extra_origins = os.getenv("ALLOWED_ORIGINS", "")
if _extra_origins:
    for origin in _extra_origins.split(","):
        cleaned = origin.strip()
        if cleaned and cleaned not in ALLOWED_ORIGINS:
            ALLOWED_ORIGINS.append(cleaned)


def ensure_workspace() -> Path:
    """Ensure the workspace directory exists and return its path."""
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    return WORKSPACE_DIR

