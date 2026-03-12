"""
Pytest fixtures for LLM service tests.
"""
import pytest
from typing import Iterator

from fastapi.testclient import TestClient

from src.model import LLMServiceProtocol
from src.server import app
from src.dependencies import get_llm_service, reset_llm_service


class MockLLMService:
    """Mock LLM service for testing."""

    def __init__(
        self,
        response: str = "Mock response",
        stream_tokens: list[str] | None = None,
        is_ready: bool = True,
    ):
        self._response = response
        self._stream_tokens = stream_tokens or ["Hello", " world", "!"]
        self._is_ready = is_ready
        self._generate_calls: list[dict] = []
        self._stream_calls: list[dict] = []

    @property
    def model_name(self) -> str:
        return "mock-model"

    @property
    def is_ready(self) -> bool:
        return self._is_ready

    def load_model(self) -> None:
        self._is_ready = True

    def generate(
        self,
        messages: list[dict],
        max_new_tokens: int = 2048,
        temperature: float = 0.7,
        top_p: float = 0.9,
    ) -> str:
        self._generate_calls.append({
            "messages": messages,
            "max_new_tokens": max_new_tokens,
            "temperature": temperature,
            "top_p": top_p,
        })
        return self._response

    def generate_stream(
        self,
        messages: list[dict],
        max_new_tokens: int = 2048,
        temperature: float = 0.7,
        top_p: float = 0.9,
    ) -> Iterator[str]:
        self._stream_calls.append({
            "messages": messages,
            "max_new_tokens": max_new_tokens,
            "temperature": temperature,
            "top_p": top_p,
        })
        for token in self._stream_tokens:
            yield token

    def set_response(self, response: str) -> None:
        """Set the mock response for subsequent calls."""
        self._response = response

    def set_stream_tokens(self, tokens: list[str]) -> None:
        """Set the mock stream tokens for subsequent calls."""
        self._stream_tokens = tokens

    def get_calls(self) -> list[dict]:
        """Get all calls made to generate()."""
        return self._generate_calls

    def get_stream_calls(self) -> list[dict]:
        """Get all calls made to generate_stream()."""
        return self._stream_calls

    def reset_calls(self) -> None:
        """Reset the call history."""
        self._generate_calls = []
        self._stream_calls = []


@pytest.fixture
def mock_llm_service():
    """Create a mock LLM service."""
    return MockLLMService()


@pytest.fixture
def client(mock_llm_service):
    """
    Create a test client with mocked LLM service.

    The mock service is injected via FastAPI's dependency override system.
    """
    # Override the dependency
    app.dependency_overrides[get_llm_service] = lambda: mock_llm_service

    yield TestClient(app)

    # Clean up
    app.dependency_overrides.clear()
    reset_llm_service()


@pytest.fixture
def client_not_ready():
    """Create a test client with LLM service not ready."""
    mock_service = MockLLMService(is_ready=False)
    app.dependency_overrides[get_llm_service] = lambda: mock_service

    yield TestClient(app)

    app.dependency_overrides.clear()
    reset_llm_service()
