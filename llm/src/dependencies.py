"""
Dependency injection container for FastAPI.

Provides injectable dependencies that can be overridden in tests.
"""
from typing import Optional

from src.model import LLMService, LLMServiceProtocol, create_llm_service

# Application-level service instance
_llm_service: Optional[LLMService] = None


def get_llm_service() -> LLMServiceProtocol:
    """
    Dependency provider for LLMService.

    Usage in endpoints:
        @app.post("/v1/chat/completions")
        async def chat(request: Request, llm: LLMServiceProtocol = Depends(get_llm_service)):
            ...

    Override in tests:
        app.dependency_overrides[get_llm_service] = lambda: mock_service
    """
    global _llm_service
    if _llm_service is None:
        _llm_service = create_llm_service()
    return _llm_service


def set_llm_service(service: LLMService) -> None:
    """
    Set the LLM service instance.

    Useful for testing or custom initialization.
    """
    global _llm_service
    _llm_service = service


def reset_llm_service() -> None:
    """
    Reset the LLM service instance.

    Useful for testing to ensure clean state between tests.
    """
    global _llm_service
    _llm_service = None
