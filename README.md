# Pair Programmer

A local AI coding assistant powered by llama.cpp or AWS Bedrock. Run it from any directory and it operates within that project. Includes a VS Code extension that automatically sends your active file and selection as context with every message.

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
```

The CLI and the LLM server can run on **different machines**. A common setup is the CLI on a MacBook and llama.cpp on a GPU server — configure the server URL via `/settings > Local Server URL`.

## Prerequisites

**Client machine (where you run the CLI):**
- Node.js 20+
- VS Code

**Server machine (where the model runs):**
- Docker with NVIDIA GPU support (`nvidia-container-toolkit`)
- ~45GB free disk space for the quantized model
- ~128GB RAM/VRAM (unified memory) to run the model

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

**2. Get the model:**

Download Qwen3-Coder-Next safetensors from HuggingFace into `models/qwen3-coder-next/`, then quantize:

```bash
./llamacpp/quantize.sh
```

This produces `llamacpp/models/qwen3-coder-next-q4_k_m.gguf` (~45GB). The intermediate F16 file (~149GB) can be deleted afterwards.

> If you already have the GGUF, place it at `llamacpp/models/qwen3-coder-next-q4_k_m.gguf` and skip the quantize step.

**3. Install and start the server:**
```bash
./scripts install-server   # checks model, builds Docker image
./scripts run-server       # starts llama.cpp on port 8004
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

Models are configured in `models.json` at the project root:

```json
[
  {
    "name": "Qwen3-Coder-Next (local)",
    "url": "http://localhost:8004",
    "modelId": "Qwen3 Coder (Local)"
  },
  {
    "name": "AWS Bedrock - Qwen3-Coder-Next",
    "url": "https://bedrock-runtime.us-east-1.amazonaws.com",
    "modelId": "qwen.qwen3-coder-next"
  }
]
```

Add or remove entries to configure which models are available in the `/model` picker.

## CLI Commands

| Command | Description |
|---------|-------------|
| `/model` | Switch between models defined in `models.json` |
| `/settings` | Open settings (tool output verbosity, local server URL) |
| `/help` | Show available commands |

## Settings

Settings are persisted to `~/.pair-programmer/config.json`.

| Setting | Description |
|---------|-------------|
| Tool output verbosity | How many lines of tool output to show: limited (2) / some (10) / all |
| Local server URL | URL of the llama.cpp server — change this if your server is on a remote machine |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_SERVER_URL` | `http://localhost:8004` | Default LLM server URL (overridden by saved config) |
| `LLM_MODEL_NAME` | `local` | Model name sent to the server |
| `LLM_TEMPERATURE` | `0.7` | Sampling temperature |
| `AWS_PROFILE` | — | AWS credentials profile for Bedrock |
| `TAVILY_API_KEY` | — | API key for web search tool |

## Scripts

| Command | Description |
|---------|-------------|
| `./scripts install-client` | Install CLI globally + VS Code extension |
| `./scripts install-server` | Check model and build Docker image |
| `./scripts run-server` | Start the LLM server |
| `./scripts start` | Build and start all Docker services |
| `./scripts down` | Stop all Docker services |
| `./scripts logs [service]` | View Docker logs |

## License

MIT
