# LocalMind

**Privacy-first AI chat that runs entirely in your browser.**

No servers. No API keys. No data leaves your device. Powered by [WebLLM](https://github.com/mlc-ai/web-llm), [Transformers.js](https://huggingface.co/docs/transformers.js), and WebGPU.

## How it works

LocalMind downloads and runs open-source language models directly in your browser using WebGPU for GPU-accelerated inference. Models are cached after the first download, so subsequent loads take only seconds.

Two runtime architectures are supported:

- **WebLLM + MLC** — Models are ahead-of-time compiled via Apache TVM into optimized WebGPU compute shaders. Fast inference, smaller download sizes.
- **Transformers.js + ONNX Runtime Web** — Standard ONNX-format models interpreted at load time. Supports a wider range of architectures and falls back to WASM on devices without WebGPU.

### Available models

| Model | Size | Runtime | Description |
|-------|------|---------|-------------|
| SmolLM2 360M | ~250 MB | WebLLM | Tiny and fast — good for testing |
| SmolLM2 1.7B | ~1 GB | WebLLM | Great balance of size and capability |
| Llama 3.2 1B | ~700 MB | WebLLM | Meta's compact model with strong reasoning |
| Phi-3.5 Mini | ~2.2 GB | WebLLM | Microsoft's capable small model |
| Qwen3 4B Instruct | ~2.9 GB | Transformers.js | Alibaba's instruction-tuned model, strong multilingual chat |
| GPT-OSS 20B | ~12.6 GB | Transformers.js | OpenAI's open-source 20B model, best quality responses |

## Features

### System prompts
Choose from built-in presets (Coding Assistant, Writing Editor, Translator, Concise Mode) or write a custom system prompt. Collapsed by default in the settings panel above the chat.

### Generation controls
Adjust temperature, top-p, and max tokens via sliders in the settings panel. Defaults are sensible but tunable per conversation.

### Markdown rendering
Assistant responses are rendered as formatted markdown — headings, lists, code blocks with syntax highlighting, tables, and inline formatting all display properly.

### Conversation export
Export the current conversation as a `.md` file with a single click. Messages are formatted with role headers and timestamps.

### Conversation persistence
Conversations are automatically saved to IndexedDB. Reopen the browser and pick up where you left off. Manage saved conversations from the history panel.

### Document context
Drag and drop a file onto the chat (or use the attach button) to inject its contents as context. Supports text, markdown, code, CSV, and JSON files (up to 50 KB).

### Token count
A live estimate of the current context window usage is displayed below the chat input, with a visual progress bar and warning thresholds.

### Stop generation
Interrupt a response mid-stream with the stop button. Works with both WebLLM and Transformers.js backends.

## Browser requirements

WebGPU is required for GPU-accelerated inference. Supported browsers:

- **Chrome** 113+
- **Edge** 113+

Other Chromium-based browsers with WebGPU support may also work. Safari and Firefox do not yet fully support WebGPU.

Transformers.js models can fall back to WASM on browsers without WebGPU, but performance will be significantly slower.

## Running locally

No build step is needed. Open `index.html` directly, or serve it with any static file server:

```bash
# Python
python3 -m http.server 8000

# Node.js (npx)
npx serve .
```

Then open `http://localhost:8000` in a WebGPU-capable browser.

## Deployment

This site is designed for static hosting. To deploy on GitHub Pages:

1. Push the repo to GitHub
2. Go to **Settings > Pages**
3. Set the source to the branch you want to deploy (e.g. `main`)
4. The site will be live at `https://<username>.github.io/LocalMind/`

The `.nojekyll` file is included to ensure GitHub Pages serves files as-is without Jekyll processing.

## Project structure

```
LocalMind/
├── index.html      # The entire application (HTML + CSS + JS)
├── favicon.svg     # Browser tab icon
├── 404.html        # Custom 404 page for GitHub Pages
├── .nojekyll       # Bypasses Jekyll on GitHub Pages
├── .gitignore
├── LICENSE          # MIT
└── README.md
```

## License

[MIT](LICENSE)
