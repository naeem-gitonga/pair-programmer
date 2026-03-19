FROM nvcr.io/nvidia/pytorch:25.12-py3

RUN apt-get update && apt-get install -y \
    git \
    cmake \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN git clone https://github.com/ggerganov/llama.cpp .

# Build llama-server with CUDA support
RUN cmake -B build \
    -DGGML_CUDA=ON \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_SERVER=ON \
    && cmake --build build --config Release --target llama-server -j$(nproc)

ENV PATH="/app/build/bin:$PATH"

CMD [ \
    "llama-server", \
    "--model", "/models/qwen3-coder-next-q4_k_m.gguf", \
    "--host", "0.0.0.0", \
    "--port", "8004", \
    "--ctx-size", "262144", \
    "--n-gpu-layers", "999", \
    "--alias", "local", \
    "--jinja" \
]
