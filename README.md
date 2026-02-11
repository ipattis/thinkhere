# LocalMind

**Privacy-first AI chat that runs entirely in your browser.**

No servers. No API keys. No data leaves your device. Powered by [WebLLM](https://github.com/mlc-ai/web-llm) and WebGPU.

## How it works

LocalMind downloads and runs open-source language models directly in your browser using WebGPU for GPU-accelerated inference. Models are cached after the first download, so subsequent loads take only seconds.

### Available models

| Model | Size | Description |
|-------|------|-------------|
| SmolLM2 360M | ~250 MB | Tiny and fast — good for quick experiments |
| SmolLM2 1.7B | ~1 GB | Great balance of size and capability |
| Llama 3.2 1B | ~700 MB | Meta's compact model with strong reasoning |
| Phi-3.5 Mini | ~2.2 GB | Microsoft's capable small model |

## Browser requirements

WebGPU is required. Supported browsers:

- **Chrome** 113+
- **Edge** 113+

Other Chromium-based browsers with WebGPU support may also work. Safari and Firefox do not yet fully support WebGPU.

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
