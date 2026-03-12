"""
FastAPI server for LLM chat completion service.
"""
import json
import logging
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
from contextlib import asynccontextmanager
from threading import Thread
from typing import Annotated, AsyncIterator, Optional

from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.config import (
    LLM_MAX_NEW_TOKENS,
    DEFAULT_TEMPERATURE,
    DEFAULT_TOP_P,
)
from src.model import LLMServiceProtocol
from src.dependencies import get_llm_service

logger = logging.getLogger(__name__)


def load_model_background(llm_service: LLMServiceProtocol) -> None:
    """Load model in background thread."""
    try:
        logger.info("Loading model in background...")
        llm_service.load_model()
        logger.info("Model loaded and ready")
    except Exception as e:
        logger.error("Failed to load model: %s", e)
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    llm_service = get_llm_service()
    thread = Thread(target=load_model_background, args=(llm_service,), daemon=True)
    thread.start()
    yield


app = FastAPI(
    title="LLM Service",
    description="OpenAI-compatible chat completion service with tool calling",
    version="0.2.0",
    lifespan=lifespan,
)

LLMServiceDep = Annotated[LLMServiceProtocol, Depends(get_llm_service)]


# ── Request / Response Models ─────────────────────────────────────────────────

class ToolCallFunction(BaseModel):
    name: str
    arguments: str  # JSON string


class ToolCall(BaseModel):
    id: str
    type: str = "function"
    function: ToolCallFunction


class Message(BaseModel):
    """Chat message — supports user, assistant, system, and tool roles."""
    role: str
    content: Optional[str] = None
    tool_calls: Optional[list[ToolCall]] = None   # assistant → tool call
    tool_call_id: Optional[str] = None             # tool → result


class FunctionDefinition(BaseModel):
    name: str
    description: Optional[str] = None
    parameters: Optional[dict] = None


class Tool(BaseModel):
    type: str = "function"
    function: FunctionDefinition


class ChatCompletionRequest(BaseModel):
    messages: list[Message] = Field(..., description="Conversation history")
    tools: Optional[list[Tool]] = None
    tool_choice: Optional[str] = "auto"
    max_tokens: int = Field(LLM_MAX_NEW_TOKENS, description="Max tokens to generate")
    temperature: float = Field(DEFAULT_TEMPERATURE, ge=0.0, le=2.0)
    top_p: float = Field(DEFAULT_TOP_P, ge=0.0, le=1.0)
    stream: bool = Field(False, description="Stream response via SSE")


class AssistantMessage(BaseModel):
    role: str = "assistant"
    content: Optional[str] = None
    tool_calls: Optional[list[ToolCall]] = None


class ChatCompletionChoice(BaseModel):
    index: int
    message: AssistantMessage
    finish_reason: str


class ChatCompletionUsage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[ChatCompletionChoice]
    usage: ChatCompletionUsage


class HealthResponse(BaseModel):
    status: str
    model: str
    model_loaded: bool


# ── Helpers ───────────────────────────────────────────────────────────────────

def message_to_dict(m: Message) -> dict:
    """Convert a Message pydantic model to a plain dict for the tokenizer."""
    d: dict = {"role": m.role}
    if m.content is not None:
        d["content"] = m.content
    if m.tool_calls is not None:
        d["tool_calls"] = [tc.model_dump() for tc in m.tool_calls]
    if m.tool_call_id is not None:
        d["tool_call_id"] = m.tool_call_id
    return d


def create_stream_chunk(
    chunk_id: str,
    model: str,
    content: Optional[str] = None,
    tool_calls: Optional[list[dict]] = None,
    finish_reason: Optional[str] = None,
) -> dict:
    """Create an OpenAI-compatible SSE chunk."""
    delta: dict = {}
    if content is not None:
        delta["content"] = content
        delta["role"] = "assistant"
    if tool_calls is not None:
        delta["tool_calls"] = tool_calls

    return {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason,
            }
        ],
    }


async def stream_text(
    llm: LLMServiceProtocol,
    messages: list[dict],
    max_tokens: int,
    temperature: float,
    top_p: float,
) -> AsyncIterator[str]:
    """Stream plain text tokens as SSE chunks."""
    chunk_id = f"chatcmpl-{int(time.time())}"
    model = llm.model_name

    for token in llm.generate_stream(
        messages=messages,
        max_new_tokens=max_tokens,
        temperature=temperature,
        top_p=top_p,
    ):
        chunk = create_stream_chunk(chunk_id, model, content=token)
        yield f"data: {json.dumps(chunk)}\n\n"

    final = create_stream_chunk(chunk_id, model, finish_reason="stop")
    yield f"data: {json.dumps(final)}\n\n"
    yield "data: [DONE]\n\n"


async def stream_tool_calls(
    chunk_id: str,
    model: str,
    tool_calls: list[dict],
    content: Optional[str],
) -> AsyncIterator[str]:
    """Emit tool calls as a single SSE chunk (tool calls are not streamed incrementally)."""
    if content:
        text_chunk = create_stream_chunk(chunk_id, model, content=content)
        yield f"data: {json.dumps(text_chunk)}\n\n"

    tc_chunk = create_stream_chunk(chunk_id, model, tool_calls=tool_calls, finish_reason="tool_calls")
    yield f"data: {json.dumps(tc_chunk)}\n\n"
    yield "data: [DONE]\n\n"


def _sse_response(generator: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health(llm: LLMServiceDep):
    """Health check endpoint."""
    return HealthResponse(
        status="ok" if llm.is_ready else "loading",
        model=llm.model_name,
        model_loaded=llm.is_ready,
    )


@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest, llm: LLMServiceDep):
    """
    OpenAI-compatible chat completion endpoint.

    Supports:
    - Streaming (stream=true) via Server-Sent Events
    - Tool calling (pass tools=[...])
    - Combined streaming + tool calling
    """
    if not llm.is_ready:
        raise HTTPException(status_code=503, detail="Model not ready")

    messages = [message_to_dict(m) for m in request.messages]
    tools = [t.model_dump() for t in request.tools] if request.tools else None

    # ── Tool calling: always use non-streaming generate internally ────────────
    if tools:
        result = llm.generate(
            messages=messages,
            max_new_tokens=request.max_tokens,
            temperature=request.temperature,
            top_p=request.top_p,
            tools=tools,
        )

        if result.tool_calls:
            tool_calls_payload = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.name, "arguments": tc.arguments},
                }
                for tc in result.tool_calls
            ]

            if request.stream:
                chunk_id = f"chatcmpl-{int(time.time())}"
                return _sse_response(
                    stream_tool_calls(chunk_id, llm.model_name, tool_calls_payload, result.content)
                )

            prompt_tokens = int(sum(len(str(m)) for m in messages) / 4)
            return ChatCompletionResponse(
                id=f"chatcmpl-{int(time.time())}",
                created=int(time.time()),
                model=llm.model_name,
                choices=[
                    ChatCompletionChoice(
                        index=0,
                        message=AssistantMessage(
                            content=result.content,
                            tool_calls=[
                                ToolCall(
                                    id=tc.id,
                                    function=ToolCallFunction(name=tc.name, arguments=tc.arguments),
                                )
                                for tc in result.tool_calls
                            ],
                        ),
                        finish_reason="tool_calls",
                    )
                ],
                usage=ChatCompletionUsage(
                    prompt_tokens=prompt_tokens,
                    completion_tokens=int(len(result.content or "") / 4),
                    total_tokens=prompt_tokens + int(len(result.content or "") / 4),
                ),
            )

        # Model responded with text despite tools being available — fall through
        # to normal response handling below using result.content
        if request.stream:
            # Re-stream the already-generated text as SSE chunks
            chunk_id = f"chatcmpl-{int(time.time())}"

            async def stream_pregenerated() -> AsyncIterator[str]:
                chunk = create_stream_chunk(chunk_id, llm.model_name, content=result.content)
                yield f"data: {json.dumps(chunk)}\n\n"
                final = create_stream_chunk(chunk_id, llm.model_name, finish_reason="stop")
                yield f"data: {json.dumps(final)}\n\n"
                yield "data: [DONE]\n\n"

            return _sse_response(stream_pregenerated())

        prompt_tokens = int(sum(len(str(m)) for m in messages) / 4)
        completion_tokens = int(len(result.content or "") / 4)
        return ChatCompletionResponse(
            id=f"chatcmpl-{int(time.time())}",
            created=int(time.time()),
            model=llm.model_name,
            choices=[
                ChatCompletionChoice(
                    index=0,
                    message=AssistantMessage(content=result.content),
                    finish_reason="stop",
                )
            ],
            usage=ChatCompletionUsage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
            ),
        )

    # ── No tools: streaming ───────────────────────────────────────────────────
    if request.stream:
        return _sse_response(
            stream_text(
                llm=llm,
                messages=messages,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                top_p=request.top_p,
            )
        )

    # ── No tools: non-streaming ───────────────────────────────────────────────
    result = llm.generate(
        messages=messages,
        max_new_tokens=request.max_tokens,
        temperature=request.temperature,
        top_p=request.top_p,
    )

    prompt_tokens = int(sum(len(str(m)) for m in messages) / 4)
    completion_tokens = int(len(result.content or "") / 4)

    return ChatCompletionResponse(
        id=f"chatcmpl-{int(time.time())}",
        created=int(time.time()),
        model=llm.model_name,
        choices=[
            ChatCompletionChoice(
                index=0,
                message=AssistantMessage(content=result.content),
                finish_reason="stop",
            )
        ],
        usage=ChatCompletionUsage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        ),
    )


def serve():
    """Run the FastAPI server."""
    import uvicorn
    from src.config import LLM_HOST, LLM_PORT

    uvicorn.run(app, host=LLM_HOST, port=LLM_PORT, log_level="info")


if __name__ == "__main__":
    serve()
