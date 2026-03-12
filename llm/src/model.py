"""
Model loading and LLM service with dependency injection support.
"""
import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from threading import Lock, Thread
from typing import Iterator, Optional, Protocol

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer

from src.config import (
    LLM_MODEL_PATH,
    LLM_MODEL_NAME,
    LLM_DEVICE,
    LLM_DTYPE,
    LLM_MAX_NEW_TOKENS,
    LLM_MAX_INPUT_LENGTH,
    DEFAULT_TEMPERATURE,
    DEFAULT_TOP_P,
    USE_FLASH_ATTENTION,
)

logger = logging.getLogger(__name__)


@dataclass
class ToolCallResult:
    """A parsed tool call from model output."""
    id: str
    name: str
    arguments: str  # JSON string


@dataclass
class GenerationResult:
    """Result from a generate() call."""
    content: Optional[str]
    tool_calls: Optional[list[ToolCallResult]] = None
    finish_reason: str = "stop"  # "stop" or "tool_calls"


class LLMServiceProtocol(Protocol):
    """Protocol for LLM service - enables dependency injection and testing."""

    def generate(
        self,
        messages: list[dict],
        max_new_tokens: int = LLM_MAX_NEW_TOKENS,
        temperature: float = DEFAULT_TEMPERATURE,
        top_p: float = DEFAULT_TOP_P,
        tools: Optional[list[dict]] = None,
    ) -> GenerationResult:
        """Generate a chat completion response."""
        ...

    def generate_stream(
        self,
        messages: list[dict],
        max_new_tokens: int = LLM_MAX_NEW_TOKENS,
        temperature: float = DEFAULT_TEMPERATURE,
        top_p: float = DEFAULT_TOP_P,
    ) -> Iterator[str]:
        """Generate a streaming chat completion response (text only, no tool calls)."""
        ...

    @property
    def model_name(self) -> str:
        """Return the model name."""
        ...

    @property
    def is_ready(self) -> bool:
        """Return whether the model is loaded and ready."""
        ...


@dataclass
class ModelConfig:
    """Configuration for model loading."""
    model_path: str = LLM_MODEL_PATH
    model_name: str = LLM_MODEL_NAME
    device: str = LLM_DEVICE
    dtype: str = LLM_DTYPE
    max_input_length: int = LLM_MAX_INPUT_LENGTH
    use_flash_attention: bool = USE_FLASH_ATTENTION


class LLMService:
    """
    LLM service for chat completions.

    Supports dependency injection - pass model and tokenizer directly for testing,
    or use load_model() to load from disk.
    """

    def __init__(
        self,
        model: Optional[AutoModelForCausalLM] = None,
        tokenizer: Optional[AutoTokenizer] = None,
        config: Optional[ModelConfig] = None,
    ):
        self._model = model
        self._tokenizer = tokenizer
        self._config = config or ModelConfig()
        self._device: Optional[torch.device] = None
        self._lock = Lock()
        self._ready = model is not None and tokenizer is not None

    @property
    def model_name(self) -> str:
        return self._config.model_name

    @property
    def is_ready(self) -> bool:
        return self._ready

    def _resolve_device(self) -> torch.device:
        if self._config.device == "auto":
            return torch.device("cuda" if torch.cuda.is_available() else "cpu")
        return torch.device(self._config.device)

    def _resolve_dtype(self) -> Optional[torch.dtype]:
        if self._config.dtype == "auto":
            return None
        return getattr(torch, self._config.dtype, None)

    def load_model(self) -> None:
        """Load the model from disk. Thread-safe."""
        if self._ready:
            return

        with self._lock:
            if self._ready:
                return

            self._device = self._resolve_device()
            dtype = self._resolve_dtype()

            logger.info(
                "Loading LLM model from %s (%s)",
                self._config.model_path,
                self._config.model_name,
            )

            self._tokenizer = AutoTokenizer.from_pretrained(
                self._config.model_path,
                local_files_only=True,
            )

            model_kwargs = {"local_files_only": True}
            if dtype is not None:
                model_kwargs["torch_dtype"] = dtype
            if self._config.use_flash_attention:
                model_kwargs["attn_implementation"] = "flash_attention_2"
                logger.info("Flash Attention 2 enabled")

            self._model = AutoModelForCausalLM.from_pretrained(
                self._config.model_path,
                **model_kwargs,
            )
            self._model = self._model.to(self._device)
            self._model.eval()

            self._ready = True
            logger.info("LLM model loaded on %s", self._device)

    def _prepare_inputs(
        self,
        messages: list[dict],
        tools: Optional[list[dict]] = None,
    ) -> dict:
        """Prepare model inputs from messages, optionally with tool definitions."""
        template_kwargs: dict = {
            "tokenize": False,
            "add_generation_prompt": True,
        }
        if tools:
            template_kwargs["tools"] = tools

        text = self._tokenizer.apply_chat_template(messages, **template_kwargs)
        return self._tokenizer(
            [text],
            return_tensors="pt",
            truncation=True,
            max_length=self._config.max_input_length,
        ).to(self._device)

    def _get_generation_kwargs(
        self,
        model_inputs: dict,
        max_new_tokens: int,
        temperature: float,
        top_p: float,
    ) -> dict:
        """Build generation kwargs."""
        kwargs = {
            **model_inputs,
            "max_new_tokens": max_new_tokens,
            "pad_token_id": self._tokenizer.eos_token_id,
        }
        if temperature > 0:
            kwargs["temperature"] = temperature
            kwargs["top_p"] = top_p
            kwargs["do_sample"] = True
        else:
            kwargs["do_sample"] = False
        return kwargs

    def _parse_tool_calls(self, text: str) -> Optional[list[ToolCallResult]]:
        """
        Parse Qwen-format tool calls from model output.

        Qwen2.5 outputs tool calls as:
            <tool_call>{"name": "fn_name", "arguments": {...}}</tool_call>
        """
        pattern = r"<tool_call>\s*(.*?)\s*</tool_call>"
        matches = re.findall(pattern, text, re.DOTALL)
        if not matches:
            return None

        tool_calls = []
        for match in matches:
            try:
                data = json.loads(match)
                tool_calls.append(ToolCallResult(
                    id=f"call_{uuid.uuid4().hex[:8]}",
                    name=data["name"],
                    arguments=json.dumps(data.get("arguments", {})),
                ))
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning("Failed to parse tool call: %s — %s", match, e)

        return tool_calls if tool_calls else None

    def generate(
        self,
        messages: list[dict],
        max_new_tokens: int = LLM_MAX_NEW_TOKENS,
        temperature: float = DEFAULT_TEMPERATURE,
        top_p: float = DEFAULT_TOP_P,
        tools: Optional[list[dict]] = None,
    ) -> GenerationResult:
        """
        Generate a chat completion response.

        Returns a GenerationResult with either text content or tool calls (or both).
        """
        if not self._ready:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        model_inputs = self._prepare_inputs(messages, tools)
        generation_kwargs = self._get_generation_kwargs(
            model_inputs, max_new_tokens, temperature, top_p
        )

        with self._lock:
            with torch.no_grad():
                generated_ids = self._model.generate(**generation_kwargs)

        input_length = model_inputs.input_ids.shape[1]
        generated_ids = generated_ids[:, input_length:]
        response = self._tokenizer.batch_decode(
            generated_ids,
            skip_special_tokens=True,
        )[0].strip()

        tool_calls = self._parse_tool_calls(response) if tools else None

        if tool_calls:
            # Strip tool call markup from any surrounding text
            content = re.sub(r"<tool_call>.*?</tool_call>", "", response, flags=re.DOTALL).strip()
            return GenerationResult(
                content=content or None,
                tool_calls=tool_calls,
                finish_reason="tool_calls",
            )

        return GenerationResult(content=response, finish_reason="stop")

    def generate_stream(
        self,
        messages: list[dict],
        max_new_tokens: int = LLM_MAX_NEW_TOKENS,
        temperature: float = DEFAULT_TEMPERATURE,
        top_p: float = DEFAULT_TOP_P,
    ) -> Iterator[str]:
        """
        Generate a streaming chat completion response.

        Yields tokens as they are generated. For tool-calling requests,
        use generate() instead — the server routes accordingly.
        """
        if not self._ready:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        model_inputs = self._prepare_inputs(messages)

        streamer = TextIteratorStreamer(
            self._tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
        )

        generation_kwargs = self._get_generation_kwargs(
            model_inputs, max_new_tokens, temperature, top_p
        )
        generation_kwargs["streamer"] = streamer

        def generate_in_thread():
            with self._lock:
                with torch.no_grad():
                    self._model.generate(**generation_kwargs)

        thread = Thread(target=generate_in_thread)
        thread.start()

        for token in streamer:
            if token:
                yield token

        thread.join()


def create_llm_service(config: Optional[ModelConfig] = None) -> LLMService:
    """Factory function to create an LLMService instance (model not yet loaded)."""
    return LLMService(config=config)
