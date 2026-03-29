// ── ThinkHere Service Worker — Model Download Manager ──

const CACHE_NAME = "thinkhere-mediapipe-models";

function cacheKey(modelFile) {
    return `https://thinkhere.local/mediapipe/${modelFile}`;
}

// Activate immediately
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Handle download requests from main thread
self.addEventListener("message", (e) => {
    if (!e.data) return;
    if (e.data.type === "download-model") {
        const { url, modelFile } = e.data;
        const clientId = e.source?.id;
        handleDownload(url, modelFile, clientId);
    } else if (e.data.type === "clear-storage") {
        handleClearStorage(e.source?.id);
    }
});

// Intercept fetch requests for cached model files (avoids blob URL double-memory)
self.addEventListener("fetch", (e) => {
    const url = e.request.url;
    if (url.startsWith("https://thinkhere.local/mediapipe/")) {
        e.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(url);
                if (cached) return cached;
                return new Response("Model not found in cache", { status: 404 });
            })
        );
    }
});

// Clear all cached model data
async function handleClearStorage(clientId) {
    try {
        await caches.delete(CACHE_NAME);
        await postToClient(clientId, { type: "storage-cleared", success: true });
    } catch (err) {
        await postToClient(clientId, { type: "storage-cleared", success: false, error: err.message });
    }
}

async function postToClient(clientId, msg) {
    try {
        const client = await self.clients.get(clientId);
        if (client) client.postMessage(msg);
    } catch { /* client may have navigated away */ }
}

async function handleDownload(url, modelFile, clientId) {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 2000;

    // Check cache first
    try {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(cacheKey(modelFile));
        if (cached) {
            const blob = await cached.blob();
            await postToClient(clientId, {
                type: "download-complete",
                size: blob.size,
            });
            return;
        }
    } catch (err) {
        console.warn("SW cache check failed:", err);
    }

    // Download with in-memory retry
    let offset = 0;
    let chunks = [];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const headers = {};
            if (offset > 0) {
                headers["Range"] = `bytes=${offset}-`;
            }

            const resp = await fetch(url, { headers });

            // Non-retryable client errors
            if (!resp.ok && resp.status !== 206 && resp.status >= 400 && resp.status < 500) {
                await postToClient(clientId, {
                    type: "download-error",
                    error: `${resp.status} ${resp.statusText}`,
                    httpStatus: resp.status,
                });
                return;
            }
            if (!resp.ok && resp.status !== 206) {
                throw new Error(`${resp.status} ${resp.statusText}`);
            }

            // Determine total size
            let totalSize = 0;
            if (resp.status === 206) {
                const range = resp.headers.get("content-range") || "";
                const match = range.match(/\/\s*(\d+)/);
                if (match) totalSize = parseInt(match[1], 10);
            } else {
                totalSize = parseInt(resp.headers.get("content-length") || "0", 10);
                if (offset > 0) {
                    // Server didn't support Range — restart
                    chunks = [];
                    offset = 0;
                }
            }

            // Stream response
            const reader = resp.body.getReader();
            let loaded = offset;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                loaded += value.length;

                if (totalSize > 0) {
                    await postToClient(clientId, {
                        type: "download-progress",
                        loaded,
                        total: totalSize,
                    });
                }
            }

            // Download complete — assemble and cache
            const blob = new Blob(chunks);
            chunks = []; // free memory

            try {
                const cache = await caches.open(CACHE_NAME);
                await cache.put(cacheKey(modelFile), new Response(blob.slice(0)));
            } catch (err) {
                console.warn("SW cache store failed:", err);
            }

            await postToClient(clientId, {
                type: "download-complete",
                size: blob.size,
            });
            return;

        } catch (err) {
            if (attempt === MAX_RETRIES) {
                await postToClient(clientId, {
                    type: "download-error",
                    error: err.message,
                });
                return;
            }

            // Retry — offset stays at current position, chunks are preserved
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            console.warn(`SW download attempt ${attempt} failed, retrying in ${delay}ms...`, err.message);
            await postToClient(clientId, { type: "download-retry", attempt });
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}
