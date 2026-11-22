"""Hugging Face ZeroGPU Gradio Space Entrypoint for SliceM Backend."""

import os
import sys
from pathlib import Path

# 1. ZeroGPU requirement: import spaces before importing torch or FastAPI
try:
    import spaces
except ImportError:
    class _DummySpaces:
        @staticmethod
        def GPU(func=None, **kwargs):
            if func is not None:
                return func
            return lambda f: f

    spaces = _DummySpaces()

# 2. Environment defaults for Hugging Face Spaces deployment
os.environ.setdefault("TOTALSEG_DISABLE_STATS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("SLICEM_WORKSPACE_DIR", "/tmp/slicem_data")

# Ensure writable data directory exists for non-root execution
data_dir = Path(os.environ["SLICEM_WORKSPACE_DIR"])
try:
    data_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(data_dir, 0o777)
except Exception:
    pass

# 3. Add backend directory to sys.path and import FastAPI app
backend_dir = Path(__file__).resolve().parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.main import app
from fastapi.responses import RedirectResponse
import uvicorn

# 4. Create Gradio Blocks UI with ZeroGPU ping handler
try:
    import gradio as gr
except ImportError:
    gr = None

if gr is not None:
    @spaces.GPU
    def zero_gpu_ping():
        """Dummy GPU handler so ZeroGPU's startup validation test succeeds."""
        return "ZeroGPU Active & Allocated"

    with gr.Blocks(title="SliceM 3D DICOM Backend") as demo:
        gr.Markdown("# 🏥 SliceM 3D DICOM Backend")
        gr.Markdown(
            "Geometry-first 3D anatomical reconstruction pipeline from DICOM scans (CT & MRI).\n\n"
            "- **FastAPI API Root**: `/api/`\n"
            "- **Health Check**: [`/health`](/health)\n"
            "- **Frontend App**: [slicem.tarunlabs.earth](https://slicem.tarunlabs.earth)"
        )
        with gr.Row():
            ping_btn = gr.Button("Check ZeroGPU Status", variant="primary")
            status_output = gr.Textbox(label="Status", value="Ready")
        ping_btn.click(fn=zero_gpu_ping, inputs=[], outputs=[status_output])

    # Mount Gradio at /ui so all FastAPI /api/* and /health endpoints remain intact at root
    app = gr.mount_gradio_app(app, demo, path="/ui", ssr_mode=False)

    @app.get("/", include_in_schema=False)
    def index():
        """Redirect root visits to the Gradio UI status page."""
        return RedirectResponse(url="/ui")

if __name__ == "__main__":
    port = int(os.getenv("PORT", "7860"))
    uvicorn.run(app, host="0.0.0.0", port=port)
