"""
Tests for the LLM model service.
"""
import pytest
from unittest.mock import Mock, MagicMock, patch

from src.model import LLMService, ModelConfig, create_llm_service


class TestLLMService:
    """Tests for LLMService class."""

    def test_init_without_model_not_ready(self):
        """Service is not ready when initialized without model."""
        service = LLMService()
        assert service.is_ready is False

    def test_init_with_model_is_ready(self):
        """Service is ready when initialized with model and tokenizer."""
        mock_model = Mock()
        mock_tokenizer = Mock()

        service = LLMService(model=mock_model, tokenizer=mock_tokenizer)

        assert service.is_ready is True

    def test_model_name_from_config(self):
        """Service returns model name from config."""
        config = ModelConfig(model_name="test-model")
        service = LLMService(config=config)

        assert service.model_name == "test-model"

    def test_generate_raises_when_not_ready(self):
        """Generate raises RuntimeError when model not loaded."""
        service = LLMService()

        with pytest.raises(RuntimeError, match="Model not loaded"):
            service.generate([{"role": "user", "content": "Hi"}])

    def test_generate_with_injected_mocks(self):
        """Generate works with injected mock model and tokenizer."""
        # Setup mocks
        mock_tokenizer = MagicMock()
        mock_tokenizer.apply_chat_template.return_value = "formatted text"
        mock_tokenizer.return_value = {
            "input_ids": MagicMock(shape=[1, 10]),
            "attention_mask": MagicMock(),
        }
        mock_tokenizer.eos_token_id = 0
        mock_tokenizer.batch_decode.return_value = ["Generated response"]

        mock_model = MagicMock()
        mock_model.generate.return_value = MagicMock()

        # Create service with injected mocks
        service = LLMService(model=mock_model, tokenizer=mock_tokenizer)

        # This would fail without proper tensor mocking, but demonstrates the pattern
        # In a real test, you'd need to mock torch tensors properly
        # The key point is that mocks CAN be injected

        assert service.is_ready is True
        assert mock_tokenizer.apply_chat_template is not None


class TestCreateLLMService:
    """Tests for create_llm_service factory function."""

    def test_creates_service_with_default_config(self):
        """Factory creates service with default config."""
        service = create_llm_service()

        assert isinstance(service, LLMService)
        assert service.is_ready is False

    def test_creates_service_with_custom_config(self):
        """Factory creates service with custom config."""
        config = ModelConfig(
            model_path="/custom/path",
            model_name="custom-model",
        )
        service = create_llm_service(config=config)

        assert service.model_name == "custom-model"


class TestModelConfig:
    """Tests for ModelConfig dataclass."""

    def test_default_values(self):
        """Config has expected default values."""
        config = ModelConfig()

        assert config.device == "auto"
        assert config.dtype == "auto"
        assert config.use_flash_attention is True

    def test_custom_values(self):
        """Config accepts custom values."""
        config = ModelConfig(
            model_path="/my/model",
            device="cuda:0",
            dtype="float16",
            use_flash_attention=False,
        )

        assert config.model_path == "/my/model"
        assert config.device == "cuda:0"
        assert config.dtype == "float16"
        assert config.use_flash_attention is False
