// ── ThinkHere — Free Tier: WebLLM Chat ──

import * as webllm from "https://esm.run/@mlc-ai/web-llm";
import { marked } from "https://esm.run/marked";

// ── The single model for the free tier ──
const MODEL = {
  id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
  name: "SmolLM2 1.7B",
  desc: "Fast, lightweight chat model.",
  tech: "WebLLM · MLC · WebGPU",
  size: "~1 GB",
  sizeMB: 1000,
  time: "~1 – 3 min",
  minRAM_GB: 4,
};

let webllmEngine = null;
let pendingFiles = [];
let isGenerating = false;
let shouldStop = false;
let stopResolve = null;
let chatHistory = [];
let hasWebGPU = false;
let deviceProfile = null;

// ── IndexedDB Conversation Persistence ──
const DB_NAME = "thinkhere";
const DB_VERSION = 3;
const STORE_NAME = "conversations";
let currentConvId = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveConversation() {
  if (chatHistory.length === 0) return;
  const id = currentConvId || Date.now().toString();
  currentConvId = id;
  const firstUserMsg = chatHistory.find(m => m.role === "user");
  const conv = {
    id,
    title: firstUserMsg ? firstUserMsg.content.slice(0, 60) : "New conversation",
    messages: [...chatHistory],
    updatedAt: new Date().toISOString(),
  };
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(conv);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.error("Failed to save conversation:", e); }
}

async function loadConversationList() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const results = req.result || [];
        resolve(results.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")));
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    console.error("Failed to load conversations:", e);
    return [];
  }
}

async function loadConversation(id) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.error("Failed to load conversation:", e);
    return null;
  }
}

async function deleteConversation(id) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.error("Failed to delete conversation:", e); }
}

async function updateConversationTitle(id, title) {
  const conv = await loadConversation(id);
  if (!conv) return;
  conv.title = title;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(conv);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.error("Failed to update title:", e); }
}

async function renderConversationList() {
  const list = document.getElementById("conversationList");
  if (!list) return;
  const convs = await loadConversationList();

  while (list.firstChild) list.removeChild(list.firstChild);

  for (const c of convs) {
    const div = document.createElement("div");
    div.className = "convo-item" + (c.id === currentConvId ? " active" : "");
    div.title = c.title;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);

    const span = document.createElement("span");
    span.className = "convo-label";
    span.textContent = c.title;

    div.appendChild(svg);
    div.appendChild(span);

    const convoId = c.id;
    div.addEventListener("click", () => window.switchConversation(convoId));
    list.appendChild(div);
  }
}

window.switchConversation = async function (id) {
  if (isGenerating) return;
  const conv = await loadConversation(id);
  if (!conv) return;

  currentConvId = id;
  chatHistory = conv.messages;

  const container = document.getElementById("messages");
  container.innerHTML = "";
  for (const msg of chatHistory) {
    const bubble = appendMessage(msg.role, msg.content);
    if (msg.role === "assistant" && msg.content) {
      bubble.innerHTML = marked.parse(msg.content);
      bubble.classList.add("rendered");
    }
  }
  if (chatHistory.length === 0) {
    container.innerHTML = '<div class="message system">New conversation · all processing happens here</div>';
  }

  await renderConversationList();
  updateTokenCount();
};

async function generateConversationLabel(convId) {
  if (!webllmEngine) return;
  const conv = await loadConversation(convId);
  if (!conv) return;
  const firstUserMsg = conv.messages.find(m => m.role === "user");
  const firstAssistantMsg = conv.messages.find(m => m.role === "assistant");
  if (!firstUserMsg) return;

  try {
    const result = await webllmEngine.chat.completions.create({
      messages: [{ role: "user", content: `Summarize this conversation in 4-6 words as a short label. Only output the label, nothing else.\n\nUser: ${firstUserMsg.content}\n${firstAssistantMsg ? `Assistant: ${firstAssistantMsg.content.slice(0, 200)}` : ""}` }],
      temperature: 0.3,
      max_tokens: 60,
      stream: false,
    });
    let label = result.choices[0].message.content.trim();
    label = label.replace(/[*_#"`]/g, "").trim();
    if (label.length > 0 && label.length < 60) {
      await updateConversationTitle(convId, label);
      await renderConversationList();
    }
  } catch (e) {
    console.warn("Could not generate conversation label:", e);
  }
}

// Configure marked
marked.setOptions({ breaks: true, gfm: true });

// ── Detect Browser Profile ──
function detectBrowserProfile() {
  const ua = navigator.userAgent;
  let name = "Unknown";
  let version = 0;

  if (/CriOS\//.test(ua)) {
    name = "Chrome";
    version = parseInt(ua.match(/CriOS\/(\d+)/)?.[1] || "0");
  } else if (/FxiOS\//.test(ua)) {
    name = "Firefox";
    version = parseInt(ua.match(/FxiOS\/(\d+)/)?.[1] || "0");
  } else if (/EdgiOS\//.test(ua)) {
    name = "Edge";
    version = parseInt(ua.match(/EdgiOS\/(\d+)/)?.[1] || "0");
  } else if (/Edg\//.test(ua)) {
    name = "Edge";
    version = parseInt(ua.match(/Edg\/(\d+)/)?.[1] || "0");
  } else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    name = "Chrome";
    version = parseInt(ua.match(/Chrome\/(\d+)/)?.[1] || "0");
  } else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) {
    name = "Safari";
    version = parseInt(ua.match(/Version\/(\d+)/)?.[1] || "0");
  } else if (/Firefox\//.test(ua)) {
    name = "Firefox";
    version = parseInt(ua.match(/Firefox\/(\d+)/)?.[1] || "0");
  }

  return { name, version };
}

// ── Detect Device Profile ──
function detectDevice() {
  const ua = navigator.userAgent;
  const bp = detectBrowserProfile();

  const isMobileUA = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  const isTabletUA = /iPad|Android(?!.*Mobile)|tablet/i.test(ua);
  const screenWidth = window.screen?.width || window.innerWidth;
  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

  let deviceType = "desktop";
  if (isMobileUA || (isTouchDevice && screenWidth < 768)) {
    deviceType = "mobile";
  } else if (isTabletUA || (isTouchDevice && screenWidth >= 768 && screenWidth < 1200)) {
    deviceType = "tablet";
  }

  const rawDeviceMemory = navigator.deviceMemory || null;
  let ramCapped = false;
  let deviceRAM_GB;

  if (rawDeviceMemory) {
    deviceRAM_GB = rawDeviceMemory;
    if (deviceType === "desktop" && rawDeviceMemory >= 8) {
      ramCapped = true;
    }
  } else {
    if (deviceType === "mobile") deviceRAM_GB = 4;
    else if (deviceType === "tablet") deviceRAM_GB = 6;
    else { deviceRAM_GB = 8; ramCapped = true; }
  }

  const isLowEnd = deviceRAM_GB <= 4 && !ramCapped;
  const isIPhone = /iPhone|iPod/.test(ua);

  return {
    deviceType,
    isMobile: deviceType === "mobile",
    isTablet: deviceType === "tablet",
    isDesktop: deviceType === "desktop",
    isIPhone,
    browserName: bp.name,
    browserVersion: bp.version,
    deviceRAM_GB,
    ramCapped,
    isLowEnd,
  };
}

// ── Check WebGPU Support ──
async function checkWebGPU() {
  const container = document.getElementById("webgpuCheck");
  const bp = detectBrowserProfile();

  const isIPhone = /iPhone|iPod/.test(navigator.userAgent);
  if (isIPhone) {
    return !!(navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null));
  }

  if (bp.name === "Firefox") {
    container.innerHTML = `<div class="browser-version-warning">
      <strong>Firefox detected</strong> (v${bp.version})<br>
      WebGPU is not yet enabled by default in Firefox. On-device AI models require WebGPU.<br>
      For GPU-accelerated AI, use <code>Chrome 113+</code> or <code>Edge 113+</code>.
    </div>`;
  } else if (bp.name === "Safari" && bp.version < 18) {
    container.innerHTML = `<div class="browser-version-warning">
      <strong>Safari ${bp.version} detected</strong><br>
      WebGPU requires Safari 18+. On-device AI models require WebGPU.<br>
      For best results, update Safari or use <code>Chrome 113+</code>.
    </div>`;
  } else if ((bp.name === "Chrome" || bp.name === "Edge") && bp.version < 113) {
    container.innerHTML = `<div class="browser-version-warning">
      <strong>${bp.name} ${bp.version} detected</strong><br>
      WebGPU requires ${bp.name} 113+. Please update your browser.
    </div>`;
  }

  if (!navigator.gpu) {
    if (!container.innerHTML) {
      container.innerHTML = `<div class="webgpu-warning">
        <strong>WebGPU not available.</strong><br>
        ThinkHere requires WebGPU to run AI models. Please use Chrome 113+, Edge 113+, or Safari 18+.
      </div>`;
    }
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No adapter");
    return true;
  } catch {
    if (!container.innerHTML) {
      container.innerHTML = `<div class="webgpu-warning">
        WebGPU adapter not found. Please try a different browser.
      </div>`;
    }
    return false;
  }
}

// ── Update Device Info Bar ──
function updateDeviceInfoBar() {
  const bar = document.getElementById("deviceInfoBar");
  if (!deviceProfile || !bar) return;

  const dp = deviceProfile;
  const typeLabel = dp.deviceType.charAt(0).toUpperCase() + dp.deviceType.slice(1);

  bar.innerHTML = `<div class="device-info-bar">
    <span>${typeLabel}</span>
    <span class="info-sep">&middot;</span>
    <span>${dp.browserName} ${dp.browserVersion}</span>
    <span id="deviceStorageInfo"></span>
  </div>`;

  checkStorageAvailability().then(storage => {
    const storageEl = document.getElementById("deviceStorageInfo");
    if (storageEl && storage) {
      const availMB = Math.round(storage.availableMB);
      const availLabel = availMB >= 1000 ? `${(availMB / 1000).toFixed(1)} GB` : `${availMB} MB`;
      const storageClass = availMB < 500 ? "info-warn" : "info-ok";
      storageEl.innerHTML = `<span class="info-sep">&middot;</span> <span class="${storageClass}">${availLabel} free storage</span>`;
    }
  });
}

async function checkStorageAvailability() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const quotaMB = Math.round((est.quota || 0) / 1e6);
      const usageMB = Math.round((est.usage || 0) / 1e6);
      return { quotaMB, usageMB, availableMB: quotaMB - usageMB };
    }
  } catch (e) {
    console.warn("Storage estimation not available:", e);
  }
  return null;
}

// ── iPhone Banner ──
function showIPhoneBanner() {
  const container = document.getElementById("deviceBanners");
  if (!container) return;
  const banner = document.createElement("div");
  banner.className = "iphone-unsupported-banner";
  banner.innerHTML = `
    <strong>iPhone not supported</strong><br>
    iOS Safari enforces strict per-tab memory limits (~3-4 GB) that prevent AI models
    from loading. For the best experience, use a <strong>laptop or desktop</strong> with Chrome or Edge.
    iPads with M-series chips may also work.
  `;
  container.appendChild(banner);
}

// ── Token Count ──
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function updateTokenCount() {
  let total = 0;
  for (const msg of chatHistory) {
    total += estimateTokens(msg.content) + 4;
  }
  const maxCtx = 4096;
  const pct = Math.min((total / maxCtx) * 100, 100);

  document.getElementById("tokenContext").textContent = `~${total} tokens`;
  const fill = document.getElementById("tokenBarFill");
  fill.style.width = `${pct}%`;
  fill.classList.remove("warn", "danger");
  if (pct > 85) fill.classList.add("danger");
  else if (pct > 65) fill.classList.add("warn");
}

// ── Load Model ──
window.loadModel = async function () {
  const introSection = document.getElementById("introSection");
  const loadScreen = document.getElementById("loadingScreen");

  // Pre-load safety checks
  if (deviceProfile && deviceProfile.isIPhone) {
    alert("iPhone is not supported. Please use a desktop or tablet.");
    return;
  }

  if (!hasWebGPU) {
    alert("WebGPU is required to run ThinkHere. Please use Chrome 113+, Edge 113+, or Safari 18+.");
    return;
  }

  // RAM check
  if (deviceProfile && !deviceProfile.ramCapped && deviceProfile.deviceRAM_GB < MODEL.minRAM_GB) {
    if (!confirm(`${MODEL.name} needs ~${MODEL.minRAM_GB} GB RAM, but your device has ~${deviceProfile.deviceRAM_GB} GB.\n\nTry loading anyway?`)) return;
  }

  // Hide intro, show loading screen
  if (introSection) introSection.style.display = "none";
  loadScreen.classList.add("active");

  const label = document.getElementById("loadingLabel");
  const bar = document.getElementById("progressBar");
  const statProgress = document.getElementById("statProgress");
  const statSize = document.getElementById("statSize");
  const statElapsed = document.getElementById("statElapsed");
  const tip = document.getElementById("loadingTip");

  document.getElementById("loadingModelName").textContent = MODEL.name;

  // Phase management
  const phases = {
    download: document.getElementById("phaseDownload"),
    compile: document.getElementById("phaseCompile"),
    ready: document.getElementById("phaseReady"),
  };

  function setPhase(name) {
    Object.entries(phases).forEach(([key, el]) => {
      el.classList.remove("active", "done");
      if (key === name) el.classList.add("active");
    });
    const order = ["download", "compile", "ready"];
    const idx = order.indexOf(name);
    for (let i = 0; i < idx; i++) {
      phases[order[i]].classList.remove("active");
      phases[order[i]].classList.add("done");
    }
  }

  // Tips
  const tips = [
    "Downloading model weights — this only happens once, then it's cached locally.",
    "SmolLM2 is a fast, lightweight chat model optimized for on-device use.",
    "All data stays on your device. Nothing is sent to any server.",
    "After caching, this model will load in just a few seconds next time.",
    "WebLLM uses WebGPU for fast on-device inference.",
  ];
  let tipIdx = 0;
  const tipInterval = setInterval(() => {
    tipIdx = (tipIdx + 1) % tips.length;
    tip.style.opacity = 0;
    setTimeout(() => {
      tip.textContent = tips[tipIdx];
      tip.style.opacity = 1;
    }, 300);
  }, 5000);

  // Elapsed timer
  const startTime = performance.now();
  const timerInterval = setInterval(() => {
    const secs = Math.floor((performance.now() - startTime) / 1000);
    const min = Math.floor(secs / 60);
    const sec = secs % 60;
    statElapsed.textContent = min > 0 ? `${min}m ${sec}s elapsed` : `${sec}s elapsed`;
  }, 1000);

  setPhase("download");

  try {
    webllmEngine = new webllm.MLCEngine();

    webllmEngine.setInitProgressCallback((report) => {
      const pct = Math.round(report.progress * 100);
      bar.style.width = `${pct}%`;
      statProgress.textContent = `${pct}%`;
      label.textContent = report.text;

      // Phase transitions based on progress text
      if (report.text.includes("Loading model")) setPhase("download");
      if (report.text.includes("Compiling")) setPhase("compile");
    });

    await webllmEngine.reload(MODEL.id);

    // Done
    clearInterval(timerInterval);
    clearInterval(tipInterval);
    setPhase("ready");
    label.textContent = "Ready!";
    bar.style.width = "100%";
    statProgress.textContent = "100%";

    await new Promise(r => setTimeout(r, 600));

    // Transition to chat
    loadScreen.classList.remove("active");
    loadScreen.style.display = "none";
    document.getElementById("chatContainer").classList.add("active");
    document.getElementById("modelLabel").textContent = MODEL.name;
    document.getElementById("headerStatus").textContent = MODEL.name;
    document.getElementById("sendBtn").disabled = false;
    document.getElementById("userInput").focus();
    updateTokenCount();

  } catch (err) {
    clearInterval(timerInterval);
    clearInterval(tipInterval);
    bar.style.background = "#e05050";
    console.error(err);

    const msg = (err.message || "").toLowerCase();

    const isBlocked = msg.includes("403") || msg.includes("cors");
    const isNetworkError = msg.includes("failed to fetch") || msg.includes("network") || msg.includes("blocked") || msg.includes("timeout") || msg.includes("abort");

    tip.textContent = "";
    const errorDiv = document.createElement("div");
    errorDiv.className = "network-error";

    // Remove any previous error divs
    loadScreen.querySelectorAll(".network-error").forEach(el => el.remove());

    if (isBlocked) {
      label.textContent = "Network error \u2014 unable to download model";
      errorDiv.innerHTML = `
        <strong>Blocked by network policy</strong>
        Model weights could not be reached. If you're on a managed network, ask your IT team to allow access to:
        <ul>
          <li><code>huggingface.co</code> \u2014 model weights</li>
          <li><code>cdn.jsdelivr.net</code> \u2014 runtime libraries</li>
          <li><code>esm.run</code> \u2014 ES module CDN</li>
        </ul>
        <a href="javascript:void(0)" onclick="loadModel()" style="color: var(--accent); text-decoration: underline;">Retry</a>
        &nbsp;\u00b7&nbsp;
        <a href="/" style="color: var(--accent); text-decoration: underline;">Reload page</a>
      `;
    } else if (isNetworkError) {
      label.textContent = "Download interrupted";
      errorDiv.innerHTML = `
        <strong>Download didn't complete</strong>
        The model is ~1 GB and the download was interrupted. This can happen on slower or unstable connections.
        <br><br>
        <strong>Things to try:</strong>
        <ul>
          <li>Check your internet connection</li>
          <li>Try again \u2014 downloads resume from cache when possible</li>
          <li>Use a wired connection if on Wi-Fi</li>
        </ul>
        <a href="javascript:void(0)" onclick="loadModel()" style="color: var(--accent); text-decoration: underline; font-weight: 600;">Retry download</a>
        &nbsp;\u00b7&nbsp;
        <a href="/" style="color: var(--accent); text-decoration: underline;">Reload page</a>
      `;
    } else {
      label.textContent = "Model failed to initialize";
      const modelGB = (MODEL.sizeMB / 1000).toFixed(1);
      const neededGB = (MODEL.sizeMB * 2 / 1000).toFixed(1);
      const ramGB = deviceProfile ? deviceProfile.deviceRAM_GB : null;
      const ramNote = ramGB ? ` Your device reports ~${ramGB} GB RAM.` : "";
      errorDiv.innerHTML = `
        <strong>Couldn't start the model</strong>
        <br>The model downloaded successfully but failed during initialization.
        <br><br><code style="font-size: 0.8em; opacity: 0.7;">${escapeHtml(err.message)}</code><br><br>
        <div class="mem-requirement">
          <strong>Memory required:</strong> ~${neededGB} GB (${modelGB} GB model + inference engine).${ramNote}
        </div>
        <strong>Things to try:</strong>
        <ul>
          <li>Close other tabs to free up memory</li>
          <li>Click <strong>Free memory &amp; retry</strong> below to clear cached data and try again</li>
          <li>Make sure your browser supports WebGPU (Chrome 113+, Edge 113+, Safari 18+)</li>
        </ul>
        <a href="javascript:void(0)" onclick="freeMemoryAndRetry()" style="color: var(--accent); text-decoration: underline; font-weight: 600;">Free memory &amp; retry</a>
        &nbsp;·&nbsp;
        <a href="javascript:void(0)" onclick="loadModel()" style="color: var(--accent); text-decoration: underline;">Retry</a>
        &nbsp;·&nbsp;
        <a href="/" style="color: var(--accent); text-decoration: underline;">Reload page</a>
      `;
    }

    loadScreen.appendChild(errorDiv);
  }
};

// ── Free Memory & Retry ──
window.freeMemoryAndRetry = async function () {
  const loadScreen = document.getElementById("loadingScreen");
  const label = document.getElementById("loadingLabel");
  const bar = document.getElementById("progressBar");
  const tip = document.getElementById("loadingTip");
  const memInfo = document.getElementById("memoryInfo");

  // Reset UI
  if (label) label.textContent = "Freeing memory...";
  if (bar) { bar.style.width = "0%"; bar.style.background = ""; }
  if (tip) tip.textContent = "Clearing cached model data and freeing browser memory.";
  if (memInfo) memInfo.style.display = "none";
  if (loadScreen) loadScreen.querySelectorAll(".network-error").forEach(el => el.remove());

  // Release inference engine
  if (webllmEngine) {
    try { await webllmEngine.unload(); } catch (e) { /* ignore */ }
    webllmEngine = null;
  }

  // Clear WebLLM / MLC caches
  try {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      if (name.includes("webllm") || name.includes("mlc")) {
        await caches.delete(name);
      }
    }
    console.log("Model cache cleared.");
  } catch (e) {
    console.warn("Failed to clear cache:", e);
  }

  // Brief pause to let GC reclaim
  if (label) label.textContent = "Memory freed — reloading model...";
  await new Promise(r => setTimeout(r, 1500));

  // Retry
  loadModel();
};

// ── Send Message ──
window.sendMessage = async function () {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text || isGenerating || !webllmEngine) return;

  // Start a new conversation if none active
  if (!currentConvId) {
    currentConvId = Date.now().toString();
  }

  const userBubble = appendMessage("user", text);

  // Show attached files summary
  if (pendingFiles.length > 0) {
    const fileInfo = document.createElement("div");
    fileInfo.className = "message-files";
    fileInfo.textContent = `[${pendingFiles.length} file(s) attached as context]`;
    userBubble.appendChild(fileInfo);
  }

  // Build final user content with file context
  let userContent = text;
  if (pendingFiles.length > 0) {
    const fileContext = pendingFiles.map(f => `--- File: ${f.name} ---\n${f.content}`).join("\n\n");
    userContent = `${text}\n\n[Attached file context]\n${fileContext}`;
  }

  chatHistory.push({ role: "user", content: userContent });
  await saveConversation();
  await renderConversationList();
  input.value = "";
  autoResize(input);
  isGenerating = true;
  shouldStop = false;
  showStopButton();
  document.getElementById("tokenInfo").textContent = "Generating...";

  const messages = [...chatHistory];

  // Create assistant bubble for streaming
  const bubble = appendMessage("assistant", "");
  let fullResponse = "";
  const startTime = performance.now();
  let tokenCount = 0;

  try {
    const completion = await webllmEngine.chat.completions.create({
      messages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: true,
    });

    for await (const chunk of completion) {
      if (shouldStop) break;
      const delta = chunk.choices[0]?.delta?.content || "";
      fullResponse += delta;
      tokenCount++;
      renderStreamingMarkdown(bubble, fullResponse);
      scrollToBottom();
    }

    chatHistory.push({ role: "assistant", content: fullResponse });
    pendingFiles = [];

    // Save to IndexedDB and generate label after first exchange
    const isFirstExchange = chatHistory.filter(m => m.role === "assistant").length === 1;
    await saveConversation();
    await renderConversationList();
    if (isFirstExchange && currentConvId) {
      generateConversationLabel(currentConvId);
    }

    if (!shouldStop) {
      const elapsed = (performance.now() - startTime) / 1000;
      const tps = (tokenCount / elapsed).toFixed(1);
      document.getElementById("tokenInfo").textContent = `${tokenCount} tokens · ${tps} tok/s`;
    }

    // Final markdown render
    if (fullResponse) {
      bubble.innerHTML = marked.parse(fullResponse);
      bubble.classList.add("rendered");
    }

  } catch (err) {
    if (!shouldStop && err.name !== "AbortError") {
      bubble.textContent = `[Error: ${err.message}]`;
      console.error(err);
      document.getElementById("tokenInfo").textContent = "Error";
    }
  }

  isGenerating = false;
  shouldStop = false;
  pendingFiles = [];
  updateFilePreview();
  hideStopButton();
  document.getElementById("sendBtn").disabled = false;
  document.getElementById("userInput").focus();
  updateTokenCount();
};

// ── Stop Generation ──
window.stopGeneration = function () {
  shouldStop = true;
  if (stopResolve) { stopResolve(); stopResolve = null; }
};

function showStopButton() {
  document.getElementById("sendBtn").style.display = "none";
  document.getElementById("stopBtn").classList.add("active");
}

function hideStopButton() {
  document.getElementById("stopBtn").classList.remove("active");
  document.getElementById("sendBtn").style.display = "";
}

// ── New Chat ──
window.newChat = async function () {
  chatHistory = [];
  currentConvId = null;
  const container = document.getElementById("messages");
  container.innerHTML = '<div class="message system">New conversation · all processing happens here</div>';
  await renderConversationList();
  updateTokenCount();
};

// ── File Upload as Context ──
window.handleFileUpload = function (input) {
  const files = Array.from(input.files || []);
  if (files.length === 0) return;
  input.value = "";

  for (const file of files) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      pendingFiles.push({ name: file.name, content, size: file.size });
      updateFilePreview();
    };
    reader.readAsText(file);
  }
};

function updateFilePreview() {
  const container = document.getElementById("filePreview");
  if (!container) return;
  if (pendingFiles.length === 0) {
    container.classList.remove("active");
    container.innerHTML = "";
    return;
  }
  container.classList.add("active");
  container.innerHTML = pendingFiles.map((f, i) => {
    const sizeLabel = f.size >= 1000 ? `${(f.size / 1000).toFixed(1)} KB` : `${f.size} B`;
    return `<div class="file-thumb">
      <span class="file-icon">📄</span>
      <span>${escapeHtml(f.name)} (${sizeLabel})</span>
      <button class="remove-attach" onclick="removeFile(${i})">×</button>
    </div>`;
  }).join("");
}

window.removeFile = function (idx) {
  pendingFiles.splice(idx, 1);
  updateFilePreview();
};

// ── Drag & drop file handler ──
document.addEventListener("dragover", (e) => { e.preventDefault(); });
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!webllmEngine) return;
  const files = Array.from(e.dataTransfer?.files || []);
  for (const file of files) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingFiles.push({ name: file.name, content: ev.target.result, size: file.size });
      updateFilePreview();
    };
    reader.readAsText(file);
  }
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Helpers ──
function renderStreamingMarkdown(el, text) {
  const fenceCount = (text.match(/```/g) || []).length;
  const sanitized = fenceCount % 2 !== 0 ? text + "\n```" : text;
  el.innerHTML = marked.parse(sanitized);
  el.classList.add("rendered");
}

function appendMessage(role, text) {
  const container = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = text;
  container.appendChild(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() {
  const m = document.getElementById("messages");
  m.scrollTop = m.scrollHeight;
}

window.handleKey = function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
};

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 150) + "px";
}
window.autoResize = autoResize;

// ── Scroll forwarding ──
document.addEventListener("wheel", (e) => {
  const messages = document.getElementById("messages");
  if (messages && messages.offsetHeight > 0 && !messages.contains(e.target)) {
    messages.scrollTop += e.deltaY;
  }
}, { passive: true });

// ── GitHub stats ──
fetch("https://api.github.com/repos/ipattis/thinkhere")
  .then(r => r.json())
  .then(data => {
    const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
    if (data.stargazers_count != null) {
      const el = document.getElementById("ghStarsSidebar");
      if (el) el.textContent = fmt(data.stargazers_count);
    }
    if (data.forks_count != null) {
      const el = document.getElementById("ghForksSidebar");
      if (el) el.textContent = fmt(data.forks_count);
    }
  })
  .catch(() => { });

// ── Init ──
(async () => {
  await renderConversationList();

  deviceProfile = detectDevice();
  hasWebGPU = await checkWebGPU();
  updateDeviceInfoBar();

  // Show iPhone banner if needed
  if (deviceProfile.isIPhone) {
    showIPhoneBanner();
    const cta = document.getElementById("introChatCta");
    if (cta) { cta.style.pointerEvents = "none"; cta.style.opacity = "0.4"; }
    return;
  }

  // Disable start CTA if no WebGPU
  if (!hasWebGPU) {
    const cta = document.getElementById("introChatCta");
    if (cta) { cta.style.pointerEvents = "none"; cta.style.opacity = "0.4"; }
  }
})();
