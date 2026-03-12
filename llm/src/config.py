"""
Centralized configuration for LLM service.
"""
import os


# Server Configuration
LLM_HOST = os.getenv("LLM_HOST", "0.0.0.0")
LLM_PORT = int(os.getenv("LLM_PORT", "8004"))

# Model Configuration
LLM_MODEL_PATH = os.getenv(
    "LLM_MODEL_PATH",
    "/home/naeemgtng/projects/example-rag/llm/models/qwen2.5-3b-instruct"
)
LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME", "Qwen/Qwen2.5-3B-Instruct")
LLM_DEVICE = os.getenv("LLM_DEVICE", "auto")
LLM_DTYPE = os.getenv("LLM_DTYPE", "auto")

# Generation Configuration
LLM_MAX_NEW_TOKENS = int(os.getenv("LLM_MAX_NEW_TOKENS", "2048"))
LLM_MAX_INPUT_LENGTH = int(os.getenv("LLM_MAX_INPUT_LENGTH", "8192"))
DEFAULT_TEMPERATURE = float(os.getenv("DEFAULT_TEMPERATURE", "0.7"))
DEFAULT_TOP_P = float(os.getenv("DEFAULT_TOP_P", "0.9"))

# Flash Attention
USE_FLASH_ATTENTION = os.getenv("USE_FLASH_ATTENTION", "true").lower() == "true"
