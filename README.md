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
- ripgrep (`rg`) — used by the file search tool. Install via your package manager (e.g. `brew install ripgrep` or `apt install ripgrep`)

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

For SmolVLM2 (vision), download [SmolVLM2-500M-Video-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct) into `vllm/models/smolvlm2/`.

> If you already have the GGUF, place it at `llamacpp/models/qwen3-coder-next-q4_k_m.gguf` and skip the quantize step.

**3. Install and start the servers:**
```bash
./scripts install-server   # checks models, builds Docker images
./scripts run-server       # starts llama.cpp on port 8004
./scripts run-smolvlm2     # starts SmolVLM2 on port 8005 (optional)
```

Or start everything with docker-compose:
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
AWS_PROFILE=your-aws-profile             # optional, for Bedrock
TAVILY_API_KEY=your-tavily-key           # optional, for web search tool
SMOLVLM_SERVER_URL=http://localhost:8005 # optional, SmolVLM2 server URL
```

**3. Install:**
```bash
./scripts install-client
```

This installs the CLI globally (`pair` command), installs npm dependencies, and installs the VS Code extension. **Reload VS Code after this step** (`Ctrl+Shift+P` → Developer: Reload Window).

**4. Run:**
```bash
pair
```

Run `pair` from any directory — the CLI operates within that directory. If the local server is unreachable, you'll be prompted to switch models (e.g. AWS Bedrock).

**If your LLM server is on a remote machine**, set the URL once via `/settings > Local Server URL`. It's saved to `~/.pair-programmer/config.json` and used on every subsequent run.

---

## Models

Models are configured in `models.json` at the project root. Each entry has a `purpose` field:

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
    "modelId": "/models/smolvlm2",
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

The SmolVLM2 model enables image and video analysis. Just describe an image file naturally and the assistant will use the `analyze_media` tool automatically:

```
"read the text in screenshot.png"
"describe what's in diagram.jpg"
"what does this image show: photo.png"
```

The tool searches for the file by name across your project — you don't need to provide the full path.

## Input

The CLI uses a custom terminal input with the following behavior:

- **Multiline input**: `Shift+Enter` inserts a newline. `Enter` submits.
- **Paste**: text pasted from the clipboard is shown inline if under 150 characters. Larger pastes collapse to a `[Pasted +N lines, X chars]` indicator. Arrow keys navigate through indicators. Backspace removes the entire pasted block.
- **History**: `Up`/`Down` arrows navigate previous messages when the cursor is on the first/last line.
- **Shortcuts**: `Ctrl+U` clears the input. `Ctrl+C` exits.

## VS Code Integration

The VS Code extension (`pair-programmer-context`) automatically writes your active file, language, cursor line, and any selected text to `~/.pair-programmer/context.json` on every cursor move. The CLI reads this on every message so the assistant always knows what you're looking at.

When the assistant proposes a file change, it opens a diff in VS Code for review. After you accept or reject, the diff tab closes automatically.

## CLI Commands

| Command | Description |
|---------|-------------|
| `/model` | Switch between all models defined in `models.json` |
| `/model text` | Switch to text models only |
| `/model image` | Switch to image/video models only |
| `/settings` | Open settings (tool output verbosity, server URLs) |
| `/help` | Show available commands |

## Settings

Settings are persisted to `~/.pair-programmer/config.json`.

| Setting | Description |
|---------|-------------|
| Tool output verbosity | How many lines of tool output to show: limited (2) / some (10) / all |
| Local server URL | URL of the llama.cpp server |
| SmolVLM2 server URL | URL of the SmolVLM2 vision model server (default: `http://localhost:8005`) |

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
| `./scripts run-server` | Start the llama.cpp server (port 8004) |
| `./scripts run-smolvlm2` | Start the SmolVLM2 server (port 8005) |
| `./scripts start` | Build and start all Docker services |
| `./scripts down` | Stop all Docker services |
| `./scripts logs [service]` | View Docker logs |
| `./scripts restart <service>` | Restart a specific service |
| `./scripts rebuild <service>` | Rebuild a specific service |

## License

MIT
