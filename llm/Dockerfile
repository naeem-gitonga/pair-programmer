# LLM Service Dockerfile
# Uses NVIDIA NGC PyTorch image for Qwen3-Coder-Next

FROM nvcr.io/nvidia/pytorch:25.12-py3

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files
COPY pyproject.toml ./

# Install build dependencies
RUN pip install --no-cache-dir hatchling setuptools wheel

# Install project dependencies
RUN pip install --no-cache-dir ".[all]" --no-build-isolation

# Install causal-conv1d for Qwen3-Next linear attention layers
RUN MAX_JOBS=8 pip install causal-conv1d --no-build-isolation --no-cache-dir

# Install transformers from source — qwen3_next requires 4.57.0.dev0+
# Must come last so nothing downgrades it
RUN pip install --no-cache-dir git+https://github.com/huggingface/transformers.git

# Prevent HuggingFace from downloading models during runtime
ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1

# Copy source code
COPY src/ ./src/

# Environment variables
ENV PYTHONPATH=/app
ENV LLM_MODEL_PATH=/app/models/qwen3-coder-next
ENV LLM_HOST=0.0.0.0
ENV LLM_PORT=8004

# Expose HTTP port
EXPOSE 8004

# Run the server
CMD ["python", "-u", "-m", "src"]
