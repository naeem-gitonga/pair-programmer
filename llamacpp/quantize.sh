#!/bin/bash
# Quantize Qwen3-Coder-Next from safetensors to Q4_K_M GGUF
#
# Step 1: convert_hf_to_gguf.py  →  F16 GGUF  (~149GB, lossless)
# Step 2: llama-quantize          →  Q4_K_M     (~45GB, compressed)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT_DIR="$SCRIPT_DIR/../llm/models/qwen3-coder-next"
OUTPUT_DIR="$SCRIPT_DIR/models"
IMAGE_NAME="llama-cpp-quantize"
F16_GGUF="qwen3-coder-next-f16.gguf"
Q4_GGUF="qwen3-coder-next-q4_k_m.gguf"

echo "==> Building llama.cpp quantize image..."
docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile.quantize" "$SCRIPT_DIR"

echo ""
echo "==> Step 1: Converting safetensors → F16 GGUF"
echo "    Input:  $INPUT_DIR"
echo "    Output: $OUTPUT_DIR/$F16_GGUF"
echo "    (This will produce a ~149GB file)"
echo ""

docker run --rm --gpus all \
    -v "$INPUT_DIR":/input \
    -v "$OUTPUT_DIR":/output \
    "$IMAGE_NAME" \
    python3 /app/convert_hf_to_gguf.py \
        /input \
        --outfile /output/$F16_GGUF \
        --outtype f16

echo ""
echo "==> Step 2: Quantizing F16 GGUF → Q4_K_M"
echo "    Input:  $OUTPUT_DIR/$F16_GGUF"
echo "    Output: $OUTPUT_DIR/$Q4_GGUF"
echo "    (CPU-bound, will take 20-40 minutes)"
echo ""

docker run --rm \
    -v "$OUTPUT_DIR":/output \
    "$IMAGE_NAME" \
    llama-quantize \
        /output/$F16_GGUF \
        /output/$Q4_GGUF \
        Q4_K_M

echo ""
echo "==> Done! Q4_K_M model saved to: $OUTPUT_DIR/$Q4_GGUF"
echo "    You can now delete the F16 intermediate file to free ~149GB:"
echo "    rm $OUTPUT_DIR/$F16_GGUF"
