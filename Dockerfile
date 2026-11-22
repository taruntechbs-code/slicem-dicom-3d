FROM python:3.11-slim

# Prevent interactive prompts and set runtime defaults
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    TOTALSEG_DISABLE_STATS=1 \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    PORT=7860 \
    SLICEM_WORKSPACE_DIR=/tmp/slicem_data

# Install system dependencies required by VTK, OpenGL, SimpleITK, Pillow, and health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libxrender1 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces runs containers as non-root user UID 1000
RUN useradd -m -u 1000 user && \
    mkdir -p /tmp/slicem_data /app && \
    chmod -R 777 /tmp/slicem_data

WORKDIR /app/backend

# Install lightweight CPU PyTorch wheel first to keep image lean and fast
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Copy backend requirements and install dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt && \
    pip install --no-cache-dir TotalSegmentator

# Copy backend application source
COPY backend/ /app/backend/

# Ensure workspace and application files are accessible by non-root user
RUN chown -R user:user /app /tmp/slicem_data && \
    chmod -R 777 /app /tmp/slicem_data

USER user

EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
