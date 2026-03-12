"""
Tests for the LLM server endpoints.
"""
import json
import pytest


class TestHealthEndpoint:
    """Tests for /health endpoint."""

    def test_health_returns_ok_when_ready(self, client):
        """Health check returns ok status when model is loaded."""
        response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["model"] == "mock-model"
        assert data["model_loaded"] is True

    def test_health_returns_loading_when_not_ready(self, client_not_ready):
        """Health check returns loading status when model not ready."""
        response = client_not_ready.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "loading"
        assert data["model_loaded"] is False


class TestChatCompletionsEndpoint:
    """Tests for /v1/chat/completions endpoint."""

    def test_chat_completion_success(self, client, mock_llm_service):
        """Chat completion returns expected response."""
        mock_llm_service.set_response("Hello! How can I help you?")

        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [
                    {"role": "system", "content": "You are helpful."},
                    {"role": "user", "content": "Hi"},
                ],
                "max_tokens": 256,
                "temperature": 0.5,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["object"] == "chat.completion"
        assert data["model"] == "mock-model"
        assert len(data["choices"]) == 1
        assert data["choices"][0]["message"]["role"] == "assistant"
        assert data["choices"][0]["message"]["content"] == "Hello! How can I help you?"
        assert data["choices"][0]["finish_reason"] == "stop"

    def test_chat_completion_passes_parameters(self, client, mock_llm_service):
        """Chat completion passes correct parameters to service."""
        client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Test"}],
                "max_tokens": 100,
                "temperature": 0.3,
                "top_p": 0.8,
            },
        )

        calls = mock_llm_service.get_calls()
        assert len(calls) == 1
        assert calls[0]["messages"] == [{"role": "user", "content": "Test"}]
        assert calls[0]["max_new_tokens"] == 100
        assert calls[0]["temperature"] == 0.3
        assert calls[0]["top_p"] == 0.8

    def test_chat_completion_returns_503_when_not_ready(self, client_not_ready):
        """Chat completion returns 503 when model not ready."""
        response = client_not_ready.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Hi"}],
            },
        )

        assert response.status_code == 503
        assert "not ready" in response.json()["detail"].lower()

    def test_chat_completion_validates_temperature_range(self, client):
        """Chat completion validates temperature is within range."""
        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Hi"}],
                "temperature": 3.0,  # Invalid: > 2.0
            },
        )

        assert response.status_code == 422  # Validation error

    def test_chat_completion_validates_top_p_range(self, client):
        """Chat completion validates top_p is within range."""
        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Hi"}],
                "top_p": 1.5,  # Invalid: > 1.0
            },
        )

        assert response.status_code == 422  # Validation error

    def test_chat_completion_requires_messages(self, client):
        """Chat completion requires messages field."""
        response = client.post(
            "/v1/chat/completions",
            json={},
        )

        assert response.status_code == 422  # Validation error


class TestStreamingEndpoint:
    """Tests for streaming chat completions."""

    def test_streaming_returns_sse_content_type(self, client):
        """Streaming response has correct content type."""
        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Hi"}],
                "stream": True,
            },
        )

        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

    def test_streaming_yields_tokens(self, client, mock_llm_service):
        """Streaming yields individual tokens."""
        mock_llm_service.set_stream_tokens(["Hello", " ", "world", "!"])

        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Hi"}],
                "stream": True,
            },
        )

        # Parse SSE events
        events = []
        for line in response.text.split("\n"):
            if line.startswith("data: ") and line != "data: [DONE]":
                events.append(json.loads(line[6:]))

        # Check tokens were streamed
        tokens = [e["choices"][0]["delta"].get("content") for e in events if e["choices"][0]["delta"].get("content")]
        assert tokens == ["Hello", " ", "world", "!"]

    def test_streaming_ends_with_done(self, client):
        """Streaming ends with [DONE] signal."""
        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Hi"}],
                "stream": True,
            },
        )

        assert "data: [DONE]" in response.text

    def test_streaming_includes_finish_reason(self, client):
        """Streaming includes finish_reason in final chunk."""
        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Hi"}],
                "stream": True,
            },
        )

        # Find the chunk with finish_reason
        for line in response.text.split("\n"):
            if line.startswith("data: ") and line != "data: [DONE]":
                event = json.loads(line[6:])
                if event["choices"][0]["finish_reason"] == "stop":
                    return  # Found it

        pytest.fail("No chunk with finish_reason='stop' found")

    def test_streaming_passes_parameters(self, client, mock_llm_service):
        """Streaming passes correct parameters to service."""
        client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Test"}],
                "max_tokens": 100,
                "temperature": 0.3,
                "top_p": 0.8,
                "stream": True,
            },
        )

        calls = mock_llm_service.get_stream_calls()
        assert len(calls) == 1
        assert calls[0]["messages"] == [{"role": "user", "content": "Test"}]
        assert calls[0]["max_new_tokens"] == 100
        assert calls[0]["temperature"] == 0.3
        assert calls[0]["top_p"] == 0.8

    def test_streaming_returns_503_when_not_ready(self, client_not_ready):
        """Streaming returns 503 when model not ready."""
        response = client_not_ready.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Hi"}],
                "stream": True,
            },
        )

        assert response.status_code == 503

    def test_streaming_chunk_format(self, client, mock_llm_service):
        """Streaming chunks have correct OpenAI-compatible format."""
        mock_llm_service.set_stream_tokens(["Hi"])

        response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Hi"}],
                "stream": True,
            },
        )

        # Get first content chunk
        for line in response.text.split("\n"):
            if line.startswith("data: ") and line != "data: [DONE]":
                chunk = json.loads(line[6:])
                if chunk["choices"][0]["delta"].get("content"):
                    # Verify format
                    assert "id" in chunk
                    assert chunk["object"] == "chat.completion.chunk"
                    assert "created" in chunk
                    assert chunk["model"] == "mock-model"
                    assert len(chunk["choices"]) == 1
                    assert chunk["choices"][0]["index"] == 0
                    return

        pytest.fail("No content chunk found")
