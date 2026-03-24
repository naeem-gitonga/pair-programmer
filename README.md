# Pair Programmer

A local AI coding assistant powered by llama.cpp, SmolVLM2, or AWS Bedrock. Run it from any directory and it operates within that project. Includes a VS Code extension that automatically sends your active file and selection as context with every message.

**Disclaimer** I didn't write any tests for this. I just wanted to get something up
and running. Normally I would let AI write the test but for the sake of iterating
I decided to forego my usual DevOps duties so I could get this out and work on 
other stuff that took priority. And... yeah.

## Architecture

```
┌─────────────────┐     OpenAI-compatible API      ┌──────────────────────┐
│   CLI (Node.js) │ ──────────────────────────────► │ llama.cpp (Docker)   │
│                 │                                  │ Qwen3-Coder-Next     │
│                 │     AWS Bedrock Converse API     │ Q4_K_M on GPU        │
│                 │ ──────────────────────────────► └──────────────────────┘
└────────▲────────┘
         │ reads ~/.pair-programmer/context.json
┌────────┴────────┐
│  VS Code Ext.   │  (writes active file + selection on every cursor move)
└─────────────────┘
                      ▲
                      │ OpenAI-compatible API
                      │ (SmolVLM2 vision model)
                      │
              ┌───────────────┐
              │ SmolVLM2      │
              │ (Docker)      │
              │ Port 8005     │
              └───────────────┘
```

The CLI and LLM servers can run on **different machines**. A common setup is the CLI on a MacBook and llama.cpp/SmolVLM2 on a GPU server — configure the server URLs via `/settings > Local Server URL`.

## Prerequisites

**Client machine (where you run the CLI):**
- Node.js 20+
- VS Code

**Server machine (where the models run):**
- Docker with NVIDIA GPU support (`nvidia-container-toolkit`)
- ~45GB free disk space for the quantized Qwen3 model
- ~1.8GB VRAM for SmolVLM2 (can run on CPU too)
- ~128GB RAM/VRAM (unified memory) to run Qwen3 model

**For AWS Bedrock (optional, no server needed):**
- AWS credentials configured (`~/.aws/credentials`)
- `AWS_PROFILE` set in `.env`

## Setup

### On the server machine

**1. Clone the repo:**
```bash
git clone https://github.com/naeem-gitonga/pair-programmer.git
cd pair-programmer
```

**2. Get the models:**

Download Qwen3-Coder-Next safetensors from HuggingFace into `models/qwen3-coder-next/`, then quantize:

```bash
./llamacpp/quantize.sh
```

This produces `llamacpp/models/qwen3-coder-next-q4_k_m.gguf` (~45GB). The intermediate F16 file (~149GB) can be deleted afterwards.

For SmolVLM2, download the model files into `vllm/models/smolvlm2/` from HuggingFace.

> If you already have the GGUF, place it at `llamacpp/models/qwen3-coder-next-q4_k_m.gguf` and skip the quantize step.

**3. Install and start the servers:**
```bash
./scripts install-server   # checks models, builds Docker images
./scripts run-server       # starts llama.cpp on port 8004
./scripts run-smolvlm2     # starts SmolVLM2 on port 8005
```

Or use docker-compose:
```bash
docker-compose up -d
```

---

### On the client machine

**1. Clone the repo:**
```bash
git clone https://github.com/naeem-gitonga/pair-programmer.git
cd pair-programmer
```

**2. Configure (optional):**
```bash
cp .env.example .env
```

`.env` fields:
```
AWS_PROFILE=your-aws-profile        # optional, for Bedrock
TAVILY_API_KEY=your-tavily-key      # optional, for web search tool
SMOLVLM_SERVER_URL=http://localhost:8005  # optional, SmolVLM2 server URL
```

**3. Install:**
```bash
./scripts install-client
```

This installs the CLI globally and installs the VS Code extension. Reload VS Code after this step.

**4. Run:**
```bash
pair
```

Run `pair` from any directory — the CLI operates within that directory. If the local server is unreachable, you'll immediately be prompted to switch models (e.g. AWS Bedrock).

**If your LLM server is on a remote machine**, set the URL once via `/settings > Local Server URL`. It's saved to `~/.pair-programmer/config.json` and used on every subsequent run.

---

## Models

Models are configured in `models.json` at the project root. Each model can have a `purpose` field to categorize it:

| Purpose | Description |
|---------|-------------|
| `text` | Text-only models (coding, reasoning, etc.) |
| `imagevid` | Vision models (image/video analysis) |

Example `models.json`:
```json
[
  {
    "name": "Qwen3-Coder-Next (local)",
    "url": "http://localhost:8004",
    "modelId": "Qwen3 Coder (Local)",
    "purpose": "text"
  },
  {
    "name": "SmolVLM2-500M-Video",
    "url": "http://localhost:8005",
    "modelId": "smolvlm2",
    "purpose": "imagevid"
  },
  {
    "name": "AWS Bedrock - Qwen3-Coder-Next",
    "url": "https://bedrock-runtime.us-east-1.amazonaws.com",
    "modelId": "qwen.qwen3-coder-next",
    "purpose": "text"
  }
]
```

Add or remove entries to configure which models are available in the `/model` picker.

## Vision Capabilities

The SmolVLM2 model enables image and video analysis. Use the `analyze_media` tool when the user asks about images, screenshots, diagrams, or video content.

### When to use:
- User mentions an image file (e.g., "look at screenshot.png", "describe the diagram.jpg")
- User wants to understand visual content
- User wants to compare multiple images
- User wants text extracted from an image

### Tool usage:
```json
{
  "tool": "analyze_media",
  "args": {
    "media_path": "screenshot.png",
    "query": "What question or instruction about the media"
  }
}
```

The `media_path` can be:
- A filename (will be searched for in your project)
- An absolute path (e.g., "/home/user/image.png")
- If multiple files match, the tool will return the list and you should ask the user to specify

## CLI Commands

| Command | Description |
|---------|-------------|
| `/model` | Switch between all models defined in `models.json` |
| `/model text` | Switch to text models only |
| `/model image` | Switch to image/video models only |
| `/settings` | Open settings (tool output verbosity, local server URL) |
| `/help` | Show available commands |

## Settings

Settings are persisted to `~/.pair-programmer/config.json`.

| Setting | Description |
|---------|-------------|
| Tool output verbosity | How many lines of tool output to show: limited (2) / some (10) / all |
| Local server URL | URL of the llama.cpp server — change this if your server is on a remote machine |
| SmolVLM2 server URL | URL of the SmolVLM2 vision model server (default: http://localhost:8005) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_SERVER_URL` | `http://localhost:8004` | Default LLM server URL (overridden by saved config) |
| `LLM_MODEL_NAME` | `local` | Model name sent to the server |
| `LLM_TEMPERATURE` | `0.7` | Sampling temperature |
| `SMOLVLM_SERVER_URL` | `http://localhost:8005` | SmolVLM2 server URL |
| `AWS_PROFILE` | — | AWS credentials profile for Bedrock |
| `TAVILY_API_KEY` | — | API key for web search tool |

## Scripts

| Command | Description |
|---------|-------------|
| `./scripts install-client` | Install CLI globally + VS Code extension |
| `./scripts install-server` | Check models and build Docker images |
| `./scripts run-server` | Start the llama.cpp server |
| `./scripts run-smolvlm2` | Start the SmolVLM2 server |
| `./scripts start` | Build and start all Docker services |
| `./scripts down` | Stop all Docker services |
| `./scripts logs [service]` | View Docker logs |

## License

MIT
