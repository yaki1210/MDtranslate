(function () {
  const SETTINGS_KEY = "mdt-settings";
  const DEFAULT_SETTINGS = {
    fontFamily: 'Georgia, "Noto Serif SC", "Times New Roman", serif',
    uiFontFamily: '"Segoe UI", "PingFang SC", sans-serif',
    fontSize: 16,
    lineHeight: 1.72,
    windowWidth: 680,
    windowHeight: 480,
    accentColor: "#2563eb"
  };

  const state = {
    enabled: true,
    minimized: false,
    sourceElement: null,
    targetContainer: null,
    panelElement: null,
    panelBodyElement: null,
    panelMetaElement: null,
    previewToggleButton: null,
    lastRenderedText: "",
    isMarkdown: false,
    interaction: null,
    settings: { ...DEFAULT_SETTINGS },
    restoreRect: null
  };

  const observer = new MutationObserver(() => scheduleRefresh());
  let refreshTimer = null;

  init();

  async function init() {
    clearLegacyWindowState();
    await sanitizeStoredSettings();
    await loadSettings();
    observeStorageChanges();

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.addEventListener("load", scheduleRefresh, { once: true });
    window.addEventListener("popstate", scheduleRefresh);
    document.addEventListener("input", scheduleRefresh, true);
    document.addEventListener("click", scheduleRefresh, true);

    scheduleRefresh();
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 80);
  }

  function refresh() {
    state.sourceElement = findSourceElement();
    const sourceText = getSourceText(state.sourceElement);
    state.isMarkdown = looksLikeMarkdown(sourceText);

    ensurePanel();
    applyPanelTheme();

    const targetContainer = findTargetContainer(sourceText);
    if (!targetContainer) {
      showPanel("No translation");
      syncPreviewButton();
      if (state.panelBodyElement) {
        state.panelBodyElement.innerHTML = "";
      }
      return;
    }

    state.targetContainer = targetContainer;

    if (!state.enabled) {
      showPanel("Off");
      syncPreviewButton();
      if (state.panelBodyElement) {
        state.panelBodyElement.innerHTML = "";
      }
      return;
    }

    if (!state.isMarkdown) {
      showPanel("Text");
      syncPreviewButton();
      if (state.panelBodyElement) {
        state.panelBodyElement.innerHTML = "";
      }
      return;
    }

    const translatedText = extractTranslatedText(targetContainer);
    if (!translatedText.trim()) {
      showPanel("Wait");
      syncPreviewButton();
      if (state.panelBodyElement) {
        state.panelBodyElement.innerHTML = "";
      }
      return;
    }

    renderPreview(translatedText);
    showPanel("Live");
    syncPreviewButton();
  }

  async function loadSettings() {
    if (!chrome?.storage?.sync) {
      return;
    }
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    state.settings = mergeSettings(stored[SETTINGS_KEY] || {});
  }

  function observeStorageChanges() {
    if (!chrome?.storage?.onChanged) {
      return;
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes[SETTINGS_KEY]) {
        return;
      }
      state.settings = mergeSettings(changes[SETTINGS_KEY].newValue || {});
      applyPanelTheme();
      applyDefaultWindowState();
      scheduleRefresh();
    });
  }

  function ensurePanel() {
    if (state.panelElement && state.panelElement.isConnected) {
      return;
    }

    const panel = document.createElement("section");
    panel.className = "mdt-window is-hidden";
    panel.innerHTML = [
      '<div class="mdt-window-header">',
      '  <div class="mdt-window-brand">',
      '    <button type="button" class="mdt-window-toggle is-active" data-action="toggle-preview" aria-pressed="true">Preview</button>',
      '    <span class="mdt-window-meta">Wait</span>',
      "  </div>",
      '  <div class="mdt-window-actions">',
      '    <button type="button" class="mdt-window-button" data-action="minimize" aria-label="Minimize">_</button>',
      "  </div>",
      "</div>",
      '<div class="mdt-window-body"></div>',
      '<div class="mdt-resize-handle is-n" data-resize="n"></div>',
      '<div class="mdt-resize-handle is-e" data-resize="e"></div>',
      '<div class="mdt-resize-handle is-s" data-resize="s"></div>',
      '<div class="mdt-resize-handle is-w" data-resize="w"></div>',
      '<div class="mdt-resize-handle is-ne" data-resize="ne"></div>',
      '<div class="mdt-resize-handle is-se" data-resize="se"></div>',
      '<div class="mdt-resize-handle is-sw" data-resize="sw"></div>',
      '<div class="mdt-resize-handle is-nw" data-resize="nw"></div>'
    ].join("");

    document.body.appendChild(panel);

    state.panelElement = panel;
    state.panelBodyElement = panel.querySelector(".mdt-window-body");
    state.panelMetaElement = panel.querySelector(".mdt-window-meta");
    state.previewToggleButton = panel.querySelector("[data-action='toggle-preview']");

    applyDefaultWindowState();
    bindPanelEvents(panel);
    updateMinimizedState();
    syncPreviewButton();
  }

  function bindPanelEvents(panel) {
    const header = panel.querySelector(".mdt-window-header");
    const minimizeButton = panel.querySelector("[data-action='minimize']");
    const previewButton = panel.querySelector("[data-action='toggle-preview']");

    header.addEventListener("mousedown", startDrag);
    previewButton.addEventListener("click", () => {
      state.enabled = !state.enabled;
      syncPreviewButton();
      scheduleRefresh();
    });
    minimizeButton.addEventListener("click", () => {
      if (state.minimized) {
        state.minimized = false;
        updateMinimizedState();
        applyDefaultWindowState();
      } else {
        state.minimized = true;
        updateMinimizedState();
      }
    });

    panel.querySelectorAll("[data-resize]").forEach((handle) => {
      handle.addEventListener("mousedown", startResize);
    });

    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", stopInteraction);
    window.addEventListener("resize", clampPanelToViewport);
  }

  function startDrag(event) {
    if (!state.panelElement || event.target.closest(".mdt-window-button")) {
      return;
    }

    const rect = state.panelElement.getBoundingClientRect();
    state.interaction = {
      type: "drag",
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    state.panelElement.classList.add("is-dragging");
    event.preventDefault();
  }

  function startResize(event) {
    if (!state.panelElement) {
      return;
    }

    const rect = state.panelElement.getBoundingClientRect();
    state.interaction = {
      type: "resize",
      direction: event.currentTarget.dataset.resize,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      startWidth: rect.width,
      startHeight: rect.height
    };
    state.panelElement.classList.add("is-resizing");
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerMove(event) {
    if (!state.interaction || !state.panelElement) {
      return;
    }

    if (state.interaction.type === "drag") {
      const left = clamp(event.clientX - state.interaction.offsetX, 12, window.innerWidth - state.panelElement.offsetWidth - 12);
      const top = clamp(event.clientY - state.interaction.offsetY, 12, window.innerHeight - 64);
      setPanelRect({ left, top });
      return;
    }

    resizePanel(event);
  }

  function resizePanel(event) {
    const interaction = state.interaction;
    const minWidth = 320;
    const minHeight = 180;
    let left = interaction.startLeft;
    let top = interaction.startTop;
    let width = interaction.startWidth;
    let height = interaction.startHeight;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;

    if (interaction.direction.includes("e")) {
      width = interaction.startWidth + dx;
    }
    if (interaction.direction.includes("s")) {
      height = interaction.startHeight + dy;
    }
    if (interaction.direction.includes("w")) {
      width = interaction.startWidth - dx;
      left = interaction.startLeft + dx;
    }
    if (interaction.direction.includes("n")) {
      height = interaction.startHeight - dy;
      top = interaction.startTop + dy;
    }

    if (width < minWidth) {
      if (interaction.direction.includes("w")) {
        left -= minWidth - width;
      }
      width = minWidth;
    }

    if (height < minHeight) {
      if (interaction.direction.includes("n")) {
        top -= minHeight - height;
      }
      height = minHeight;
    }

    width = Math.min(width, window.innerWidth - 24);
    height = Math.min(height, window.innerHeight - 24);
    left = clamp(left, 12, window.innerWidth - width - 12);
    top = clamp(top, 12, window.innerHeight - 64);

    setPanelRect({ left, top, width, height });
  }

  function stopInteraction() {
    if (!state.interaction || !state.panelElement) {
      return;
    }
    state.interaction = null;
    state.panelElement.classList.remove("is-dragging", "is-resizing");
  }

  function updateMinimizedState() {
    if (!state.panelElement) {
      return;
    }
    state.panelElement.classList.toggle("is-minimized", state.minimized);
    const button = state.panelElement.querySelector("[data-action='minimize']");
    if (button) {
      button.textContent = state.minimized ? "+" : "_";
      button.setAttribute("aria-label", state.minimized ? "Restore" : "Minimize");
    }
  }

  function showPanel(statusText) {
    if (!state.panelElement) {
      return;
    }
    state.panelElement.classList.remove("is-hidden");
    setPanelStatus(statusText);
  }

  function hidePanel(statusText) {
    if (!state.panelElement) {
      return;
    }
    state.panelElement.classList.add("is-hidden");
    setPanelStatus(statusText);
  }

  function setPanelStatus(message) {
    if (state.panelMetaElement) {
      state.panelMetaElement.textContent = message;
    }
  }

  function renderPreview(text) {
    if (!state.panelBodyElement) {
      return;
    }

    if (state.lastRenderedText !== text) {
      state.panelBodyElement.innerHTML = renderMarkdown(text);
      state.lastRenderedText = text;
    }
  }

  function syncPreviewButton() {
    if (!state.previewToggleButton) {
      return;
    }
    state.previewToggleButton.classList.toggle("is-active", state.enabled);
    state.previewToggleButton.setAttribute("aria-pressed", state.enabled ? "true" : "false");
  }

  function applyDefaultWindowState() {
    if (!state.panelElement) {
      return;
    }

    const width = clamp(state.settings.windowWidth, 320, window.innerWidth - 24);
    const height = clamp(state.settings.windowHeight, 180, window.innerHeight - 24);
    const anchored = getDefaultPanelPosition(width, height);

    state.minimized = false;
    setPanelRect({ left: anchored.left, top: anchored.top, width, height });
  }

  function setPanelRect(nextRect) {
    if (!state.panelElement) {
      return;
    }
    if (nextRect.left != null) {
      state.panelElement.style.left = `${nextRect.left}px`;
      state.panelElement.style.right = "auto";
    }
    if (nextRect.top != null) {
      state.panelElement.style.top = `${nextRect.top}px`;
      state.panelElement.style.bottom = "auto";
    }
    if (nextRect.width != null) {
      state.panelElement.style.width = `${nextRect.width}px`;
    }
    if (nextRect.height != null) {
      state.panelElement.style.height = `${nextRect.height}px`;
    }
  }

  function clampPanelToViewport() {
    if (!state.panelElement) {
      return;
    }

    const rect = state.panelElement.getBoundingClientRect();
    const width = clamp(rect.width, 320, window.innerWidth - 24);
    const height = clamp(rect.height, state.minimized ? 56 : 180, window.innerHeight - 24);
    const left = clamp(rect.left, 12, Math.max(12, window.innerWidth - width - 12));
    const top = clamp(rect.top, 12, Math.max(12, window.innerHeight - 64));

    setPanelRect({ left, top, width, height });
  }

  function applyPanelTheme() {
    if (!state.panelElement) {
      return;
    }

    state.panelElement.style.setProperty("--mdt-font-family", state.settings.fontFamily);
    state.panelElement.style.setProperty("--mdt-ui-font-family", state.settings.uiFontFamily);
    state.panelElement.style.setProperty("--mdt-font-size", `${state.settings.fontSize}px`);
    state.panelElement.style.setProperty("--mdt-line-height", String(state.settings.lineHeight));
    state.panelElement.style.setProperty("--mdt-accent", state.settings.accentColor);
  }

  function findSourceElement() {
    const explicit = document.querySelector("textarea[aria-label], textarea");
    if (explicit) {
      return explicit;
    }

    const editors = Array.from(document.querySelectorAll("[contenteditable='true']"))
      .filter(isVisible)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return editors[0] || null;
  }

  function getSourceText(element) {
    if (!element) {
      return "";
    }
    if ("value" in element) {
      return element.value || "";
    }
    return element.innerText || element.textContent || "";
  }

  function findTargetContainer(sourceText) {
    const sourceRect = state.sourceElement ? state.sourceElement.getBoundingClientRect() : null;
    const langNodes = Array.from(document.querySelectorAll("[lang]"))
      .filter(isVisible)
      .filter((node) => {
        if (!node.textContent || node.textContent.trim().length < 3) {
          return false;
        }
        if (state.sourceElement && state.sourceElement.contains(node)) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          return false;
        }
        if (sourceRect && rect.left <= sourceRect.left + sourceRect.width * 0.6) {
          return false;
        }
        if (sourceText && normalizeText(node.textContent) === normalizeText(sourceText)) {
          return false;
        }
        return true;
      });

    const candidateMap = new Map();
    for (const node of langNodes) {
      const container = closestMeaningfulContainer(node);
      if (!container || candidateMap.has(container)) {
        continue;
      }
      candidateMap.set(container, scoreTargetContainer(container));
    }

    const ranked = Array.from(candidateMap.entries())
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1]);

    return ranked[0]?.[0] || null;
  }

  function closestMeaningfulContainer(node) {
    let current = node;
    while (current && current !== document.body) {
      const rect = current.getBoundingClientRect();
      if (rect.width > 240 && rect.height > 60) {
        return current;
      }
      current = current.parentElement;
    }
    return node.parentElement;
  }

  function scoreTargetContainer(element) {
    const rect = element.getBoundingClientRect();
    const text = extractTranslatedText(element);
    if (!text.trim()) {
      return 0;
    }

    let score = 0;
    score += Math.min(text.length, 600);
    score += rect.width * 0.2;
    score += rect.height * 0.1;
    score += rect.left;
    score += element.querySelectorAll("[lang]").length * 20;
    score -= element.querySelectorAll("button, textarea, input").length * 30;
    return score;
  }

  function extractTranslatedText(container) {
    const blockCandidates = Array.from(container.querySelectorAll("[lang], span, div, p"))
      .filter(isVisible)
      .filter((node) => (node.textContent || "").trim().length > 0)
      .filter((node) => !node.closest(".mdt-window"));

    if (!blockCandidates.length) {
      return container.innerText || container.textContent || "";
    }

    const uniqueLines = [];
    const seen = new Set();

    for (const node of blockCandidates) {
      const text = normalizeWhitespace(node.innerText || node.textContent || "");
      if (!text || seen.has(text) || text.length < 2) {
        continue;
      }
      seen.add(text);
      uniqueLines.push(text);
    }

    return dedupeLineBursts(uniqueLines.join("\n"));
  }

  function dedupeLineBursts(text) {
    const lines = text.split(/\n+/);
    const result = [];
    let last = "";
    for (const line of lines) {
      if (line === last) {
        continue;
      }
      result.push(line);
      last = line;
    }
    return result.join("\n");
  }

  function renderMarkdown(markdown) {
    const normalized = markdown.replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    const html = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        index += 1;
        continue;
      }

      if (/^```/.test(line.trim())) {
        const language = line.trim().slice(3).trim();
        const buffer = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index].trim())) {
          buffer.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) {
          index += 1;
        }
        const codeClass = language ? ` class="language-${escapeHtml(language)}"` : "";
        html.push(`<pre><code${codeClass}>${escapeHtml(buffer.join("\n"))}</code></pre>`);
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
        html.push("<hr />");
        index += 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const buffer = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          buffer.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        html.push(`<blockquote>${buffer.map((item) => `<p>${renderInlineMarkdown(item)}</p>`).join("")}</blockquote>`);
        continue;
      }

      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
      if (listMatch) {
        const ordered = /\d+\./.test(listMatch[2]);
        const tag = ordered ? "ol" : "ul";
        const buffer = [];
        while (index < lines.length) {
          const matched = lines[index].match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
          if (!matched) {
            break;
          }
          buffer.push(`<li>${renderInlineMarkdown(matched[3])}</li>`);
          index += 1;
        }
        html.push(`<${tag}>${buffer.join("")}</${tag}>`);
        continue;
      }

      const paragraph = [];
      while (index < lines.length && lines[index].trim()) {
        if (/^(#{1,6})\s+/.test(lines[index]) ||
          /^```/.test(lines[index].trim()) ||
          /^>\s?/.test(lines[index]) ||
          /^(\s*)([-*+]|\d+\.)\s+/.test(lines[index]) ||
          /^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index].trim())) {
          break;
        }
        paragraph.push(lines[index]);
        index += 1;
      }
      html.push(`<p>${renderInlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br />")}</p>`);
    }

    return html.join("");
  }

  function renderInlineMarkdown(text) {
    let output = escapeHtml(text);
    output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
    output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
    output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    output = output.replace(/(^|[^\*])\*([^*]+)\*/g, "$1<em>$2</em>");
    output = output.replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
    output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    return output;
  }

  function looksLikeMarkdown(text) {
    if (!text || text.trim().length < 3) {
      return false;
    }

    const signals = [
      /^#{1,6}\s/m,
      /```[\s\S]*```/,
      /(^|\n)\s*[-*+]\s+/,
      /(^|\n)\s*\d+\.\s+/,
      /\[[^\]]+\]\((https?:\/\/|\/)[^)]+\)/,
      /\*\*[^*]+\*\*/,
      /(^|\n)>\s+/,
      /`[^`]+`/,
      /(^|\n)\|.+\|/,
      /(^|\n)(---|\*\*\*|___)\s*($|\n)/
    ];

    let hits = 0;
    for (const signal of signals) {
      if (signal.test(text)) {
        hits += 1;
      }
    }

    return hits >= 2;
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeWhitespace(value) {
    return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function normalizeText(value) {
    return normalizeWhitespace(value).replace(/\s+/g, " ");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function areaScore(element) {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function clearLegacyWindowState() {
    try {
      window.localStorage.removeItem("mdt-floating-window");
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  async function sanitizeStoredSettings() {
    if (!chrome?.storage?.sync) {
      return;
    }
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    if (!stored[SETTINGS_KEY]) {
      return;
    }

    const merged = mergeSettings(stored[SETTINGS_KEY]);
    const needsRewrite =
      stored[SETTINGS_KEY].windowWidth !== merged.windowWidth ||
      stored[SETTINGS_KEY].windowHeight !== merged.windowHeight;

    if (needsRewrite) {
      await chrome.storage.sync.set({ [SETTINGS_KEY]: merged });
    }
  }

  function mergeSettings(storedSettings) {
    return {
      ...DEFAULT_SETTINGS,
      ...(storedSettings || {})
    };
  }

  function getDefaultPanelPosition(width, height) {
    return {
      left: Math.max(24, window.innerWidth - width - 24),
      top: clamp(
        Math.round(window.innerHeight / 3 - 40),
        24,
        Math.max(24, window.innerHeight - height - 24)
      )
    };
  }
})();
