(function () {
  "use strict";

  if (window.__typoraAnnotationsLoaded) return;
  window.__typoraAnnotationsLoaded = true;

  const STORAGE_PREFIX = "typora-annotations:v1:";
  const ROOT_ID = "typora-annotations-root";
  const HIGHLIGHT_NAME = "typora-user-highlight";
  const COMMENT_NAME = "typora-user-comment";
  const CONTEXT_LENGTH = 48;
  const HELPER_URL = "http://127.0.0.1:17373/v1/document";
  const SIDEBAR_WIDTH_KEY = "typora-annotations:sidebar-width";

  const state = {
    documentId: null,
    items: [],
    pendingAnchor: null,
    resolved: new Map(),
    renderTimer: 0,
    observer: null,
    jsonDocumentId: null,
    annotationFile: null,
    storageMode: "local",
    loadGeneration: 0,
    saveTimer: 0,
    sidebarWidth: 340,
    activeCodeMirror: null,
  };

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "annotation-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function currentDocumentId() {
    const filePath = currentDocumentPath();
    if (filePath) return "file:" + filePath;
    const title = document.querySelector("#title-text")?.textContent?.trim();
    return "draft:" + (title || "untitled");
  }

  function currentDocumentPath() {
    const filePath = window.File && window.File.bundle && window.File.bundle.filePath;
    return typeof filePath === "string" && filePath.startsWith("/") ? filePath : null;
  }

  function storageKey() {
    return STORAGE_PREFIX + encodeURIComponent(state.documentId || currentDocumentId());
  }

  function readLocalItems() {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey()) || "{}");
      return Array.isArray(data.items) ? data.items.filter(validItem) : [];
    } catch (error) {
      console.warn("[Typora Annotations] Could not read annotations", error);
      toast("批注读取失败");
      return [];
    }
  }

  function validItem(item) {
    return item && typeof item.id === "string" &&
      (item.type === "highlight" || item.type === "comment") &&
      item.anchor && typeof item.anchor.quote === "string";
  }

  function saveItems() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ version: 1, items: state.items }));
    } catch (error) {
      console.warn("[Typora Annotations] Could not save annotations", error);
      toast("批注保存失败");
    }
    scheduleJsonSave();
  }

  async function helperRequest(method, documentPath, body) {
    const url = HELPER_URL + (method === "GET" ? "?path=" + encodeURIComponent(documentPath) : "");
    const response = await fetch(url, {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error("helper returned " + response.status);
    return response.json();
  }

  async function loadItemsForCurrentDocument() {
    const generation = ++state.loadGeneration;
    const documentPath = currentDocumentPath();
    const localItems = readLocalItems();
    state.items = localItems;
    state.jsonDocumentId = null;
    state.annotationFile = null;
    state.storageMode = documentPath ? "connecting" : "local";
    render();
    renderStorageStatus();
    if (!documentPath) return;

    try {
      let data = await helperRequest("GET", documentPath);
      if (generation !== state.loadGeneration || documentPath !== currentDocumentPath()) return;
      if (!data.storageExists && localItems.length) {
        data = await helperRequest("PUT", documentPath, {
          documentPath,
          annotations: localItems,
        });
      }
      if (generation !== state.loadGeneration || documentPath !== currentDocumentPath()) return;
      state.items = Array.isArray(data.annotations) ? data.annotations.filter(validItem) : [];
      state.jsonDocumentId = data.documentId || null;
      state.annotationFile = data.annotationFile || null;
      state.storageMode = "json";
      localStorage.setItem(storageKey(), JSON.stringify({ version: 1, items: state.items }));
      render();
      renderStorageStatus();
    } catch (error) {
      console.warn("[Typora Annotations] JSON helper unavailable; using local fallback", error);
      state.storageMode = "local";
      renderStorageStatus();
    }
  }

  function scheduleJsonSave() {
    window.clearTimeout(state.saveTimer);
    const documentPath = currentDocumentPath();
    if (!documentPath) return;
    state.saveTimer = window.setTimeout(async () => {
      try {
        const data = await helperRequest("PUT", documentPath, {
          documentId: state.jsonDocumentId,
          documentPath,
          annotations: state.items,
        });
        if (documentPath !== currentDocumentPath()) return;
        state.jsonDocumentId = data.documentId || state.jsonDocumentId;
        state.annotationFile = data.annotationFile || state.annotationFile;
        state.storageMode = "json";
        renderStorageStatus();
      } catch (error) {
        console.warn("[Typora Annotations] JSON save failed; local fallback retained", error);
        state.storageMode = "local";
        renderStorageStatus();
        toast("JSON 保存失败，已暂存本地");
      }
    }, 120);
  }

  function commonPrefixLength(a, b) {
    const limit = Math.min(a.length, b.length);
    let i = 0;
    while (i < limit && a[i] === b[i]) i += 1;
    return i;
  }

  function commonSuffixLength(a, b) {
    const limit = Math.min(a.length, b.length);
    let i = 0;
    while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
    return i;
  }

  function findAnchor(text, anchor) {
    if (!anchor || !anchor.quote) return null;
    const candidates = [];
    let offset = text.indexOf(anchor.quote);
    while (offset !== -1) {
      const before = text.slice(Math.max(0, offset - anchor.prefix.length), offset);
      const afterStart = offset + anchor.quote.length;
      const after = text.slice(afterStart, afterStart + anchor.suffix.length);
      const score = commonSuffixLength(before, anchor.prefix) +
        commonPrefixLength(after, anchor.suffix);
      candidates.push({ start: offset, end: afterStart, score });
      offset = text.indexOf(anchor.quote, offset + 1);
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score || a.start - b.start);
    return candidates[0];
  }

  function findCodeAnchor(blocks, anchor) {
    if (!anchor || anchor.scope !== "code") return null;
    const candidates = [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const value = String(blocks[blockIndex] || "");
      const match = findAnchor(value, anchor);
      if (!match) continue;
      const blockPrefix = String(anchor.blockPrefix || "");
      const blockSuffix = String(anchor.blockSuffix || "");
      const blockScore = commonPrefixLength(value.slice(0, blockPrefix.length), blockPrefix) +
        commonSuffixLength(value.slice(-blockSuffix.length), blockSuffix);
      candidates.push({ ...match, blockIndex, score: match.score + blockScore });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score || a.blockIndex - b.blockIndex || a.start - b.start);
    return candidates[0];
  }

  function isVisibleTextNode(node, root) {
    if (!node.nodeValue || !node.nodeValue.length) return false;
    let element = node.parentElement;
    while (element && element !== root) {
      if (element.closest("#" + ROOT_ID)) return false;
      if (element.matches("script, style, template, .md-meta, .md-hidden, .md-rawblock-control, .md-rawblock-tooltip, [aria-hidden='true']")) {
        return false;
      }
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      element = element.parentElement;
    }
    return true;
  }

  function buildTextMap() {
    const root = document.querySelector("#write");
    if (!root) return { root: null, text: "", segments: [] };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const segments = [];
    let text = "";
    let node;
    while ((node = walker.nextNode())) {
      if (!isVisibleTextNode(node, root)) continue;
      const start = text.length;
      text += node.nodeValue;
      segments.push({ node, start, end: text.length });
    }
    return { root, text, segments };
  }

  function pointToIndex(container, offset, map) {
    if (container.nodeType === Node.TEXT_NODE) {
      const segment = map.segments.find((entry) => entry.node === container);
      if (segment) return segment.start + Math.min(offset, container.nodeValue.length);
    }

    const point = document.createRange();
    try {
      point.setStart(container, offset);
      point.collapse(true);
      for (const segment of map.segments) {
        const segmentRange = document.createRange();
        segmentRange.selectNodeContents(segment.node);
        const versusStart = point.compareBoundaryPoints(Range.START_TO_START, segmentRange);
        if (versusStart <= 0) return segment.start;
      }
    } catch (error) {
      console.debug("[Typora Annotations] Could not map selection point", error);
    }
    return map.text.length;
  }

  function textPointForOffset(segments, offset, boundary) {
    for (const segment of segments) {
      const containsOffset = boundary === "start"
        ? offset >= segment.start && offset < segment.end
        : offset > segment.start && offset <= segment.end;
      if (containsOffset) {
        return { node: segment.node, offset: offset - segment.start };
      }
    }
    return null;
  }

  function rangeForOffsets(map, start, end) {
    // Adjacent text nodes share the same numeric boundary in the flattened map.
    // A range start belongs to the following node; a range end belongs to the
    // preceding node. Keeping those affinities distinct avoids highlighting the
    // previous block when an annotation starts at the beginning of a paragraph.
    const startPoint = textPointForOffset(map.segments, start, "start");
    const endPoint = textPointForOffset(map.segments, end, "end");
    if (!startPoint || !endPoint) return null;
    const range = document.createRange();
    range.setStart(startPoint.node, Math.min(startPoint.offset, startPoint.node.nodeValue.length));
    range.setEnd(endPoint.node, Math.min(endPoint.offset, endPoint.node.nodeValue.length));
    return range.collapsed ? null : range;
  }

  function anchorFromRange(range) {
    const map = buildTextMap();
    if (!map.root || !map.root.contains(range.commonAncestorContainer)) return null;
    let start = pointToIndex(range.startContainer, range.startOffset, map);
    let end = pointToIndex(range.endContainer, range.endOffset, map);
    if (end < start) [start, end] = [end, start];
    const quote = map.text.slice(start, end);
    if (!quote.trim()) return null;
    return {
      quote,
      prefix: map.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
      suffix: map.text.slice(end, end + CONTEXT_LENGTH),
    };
  }

  function createAnnotation(type, anchor, comment) {
    const now = new Date().toISOString();
    state.items.push({
      id: uuid(),
      type,
      anchor,
      comment: type === "comment" ? String(comment || "").trim() : "",
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    saveItems();
    render();
    toast(type === "comment" ? "评论已添加" : "高亮已添加");
  }

  function deleteAnnotation(id) {
    state.items = state.items.filter((item) => item.id !== id);
    saveItems();
    render();
  }

  function updateComment(id, comment) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item || item.type !== "comment") return;
    item.comment = String(comment || "").trim();
    item.updatedAt = new Date().toISOString();
    saveItems();
    renderSidebar();
  }

  function clearNativeHighlights() {
    if (window.CSS && CSS.highlights) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      CSS.highlights.delete(COMMENT_NAME);
    }
  }

  function render() {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(renderNow, 40);
  }

  function renderNow() {
    const map = buildTextMap();
    if (!map.root) return;
    clearNativeHighlights();
    document.querySelector("#typora-annotation-markers")?.replaceChildren();
    document.querySelector("#typora-annotation-fallback")?.replaceChildren();
    state.resolved.clear();
    const highlights = [];
    const comments = [];
    const codeMirrors = Array.from(map.root.querySelectorAll(".CodeMirror"))
      .map((wrapper) => wrapper.CodeMirror)
      .filter((cm) => cm && typeof cm.getValue === "function");
    const codeValues = codeMirrors.map((cm) => cm.getValue());

    for (const item of state.items) {
      if (item.anchor.scope === "code") {
        const match = findCodeAnchor(codeValues, item.anchor);
        if (!match) continue;
        const cm = codeMirrors[match.blockIndex];
        const resolved = {
          kind: "code",
          cm,
          from: cm.posFromIndex(match.start),
          to: cm.posFromIndex(match.end),
        };
        state.resolved.set(item.id, resolved);
        renderCodeOverlay(resolved, item.type);
        if (item.type === "comment") addCommentMarker(item, resolved);
        continue;
      }
      const match = findAnchor(map.text, item.anchor);
      if (!match) continue;
      const range = rangeForOffsets(map, match.start, match.end);
      if (!range) continue;
      const resolved = { kind: "dom", range };
      state.resolved.set(item.id, resolved);
      (item.type === "comment" ? comments : highlights).push(range);
      if (item.type === "comment") addCommentMarker(item, resolved);
    }

    if (window.CSS && CSS.highlights && window.Highlight) {
      if (highlights.length) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...highlights));
      if (comments.length) CSS.highlights.set(COMMENT_NAME, new Highlight(...comments));
    } else {
      renderFallbackRanges(highlights, "highlight");
      renderFallbackRanges(comments, "comment");
    }
    renderSidebar();
  }

  function codeSelectionRects(resolved) {
    const { cm, from, to } = resolved;
    const rects = [];
    const lineHeight = Math.max(1, cm.defaultTextHeight ? cm.defaultTextHeight() : 16);
    for (let line = from.line; line <= to.line; line += 1) {
      const lineText = cm.getLine(line) || "";
      const startCh = line === from.line ? from.ch : 0;
      const endCh = line === to.line ? to.ch : lineText.length;
      if (endCh <= startCh) continue;
      const start = cm.charCoords({ line, ch: startCh }, "window");
      const end = cm.charCoords({ line, ch: endCh }, "window");
      rects.push({
        left: Math.min(start.left, end.left),
        right: Math.max(start.left, end.left),
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom || start.top + lineHeight, end.bottom || end.top + lineHeight),
      });
    }
    return rects;
  }

  function renderCodeOverlay(resolved, type) {
    const layer = document.querySelector("#typora-annotation-fallback");
    if (!layer) return;
    for (const rect of codeSelectionRects(resolved)) {
      const mark = document.createElement("span");
      mark.className = "ta-fallback ta-code-overlay ta-fallback-" + type;
      mark.style.left = rect.left + window.scrollX + "px";
      mark.style.top = rect.top + window.scrollY + "px";
      mark.style.width = Math.max(1, rect.right - rect.left) + "px";
      mark.style.height = Math.max(1, rect.bottom - rect.top) + "px";
      layer.appendChild(mark);
    }
  }

  function renderFallbackRanges(ranges, type) {
    const layer = document.querySelector("#typora-annotation-fallback");
    if (!layer) return;
    for (const range of ranges) {
      for (const rect of range.getClientRects()) {
        const mark = document.createElement("span");
        mark.className = "ta-fallback ta-fallback-" + type;
        mark.style.left = rect.left + window.scrollX + "px";
        mark.style.top = rect.top + window.scrollY + "px";
        mark.style.width = rect.width + "px";
        mark.style.height = rect.height + "px";
        layer.appendChild(mark);
      }
    }
  }

  function commentMarkerPosition(rects, scrollX, scrollY) {
    if (!rects.length) return null;
    const topmostRect = rects.reduce((topmost, rect) =>
      rect.top < topmost.top ? rect : topmost);
    const topmostBottom = Number.isFinite(topmostRect.bottom)
      ? topmostRect.bottom
      : topmostRect.top + 1;
    const topLineRects = rects.filter((rect) => {
      const bottom = Number.isFinite(rect.bottom) ? rect.bottom : rect.top + 1;
      return rect.top < topmostBottom && bottom > topmostRect.top;
    });
    const right = Math.max(...topLineRects.map((rect) => rect.right));
    return {
      left: right + scrollX - 3,
      top: topmostRect.top + scrollY - 7,
    };
  }

  function addCommentMarker(item, resolved) {
    const rects = resolved.kind === "code"
      ? codeSelectionRects(resolved)
      : Array.from(resolved.range.getClientRects());
    const position = commentMarkerPosition(rects, window.scrollX, window.scrollY);
    const layer = document.querySelector("#typora-annotation-markers");
    if (!position || !layer) return;
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "ta-comment-marker";
    marker.textContent = "●";
    marker.title = item.comment || "评论";
    marker.setAttribute("aria-label", "查看评论：" + (item.comment || item.anchor.quote));
    marker.style.left = position.left + "px";
    marker.style.top = position.top + "px";
    marker.addEventListener("click", () => {
      openSidebar(item.id);
      focusAnnotation(item.id);
    });
    layer.appendChild(marker);
  }

  function codeMirrorFromTarget(target) {
    const element = target && target.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    const wrapper = element?.closest?.(".CodeMirror");
    return wrapper?.CodeMirror || null;
  }

  function orderedCodeSelection(cm) {
    if (!cm || typeof cm.listSelections !== "function") return null;
    const selections = cm.listSelections();
    if (selections.length !== 1) return null;
    const selection = selections[0];
    const before = selection.anchor.line < selection.head.line ||
      (selection.anchor.line === selection.head.line && selection.anchor.ch <= selection.head.ch);
    const from = before ? selection.anchor : selection.head;
    const to = before ? selection.head : selection.anchor;
    if (from.line === to.line && from.ch === to.ch) return null;
    return { from, to };
  }

  function captureCodeMirrorSelection(target) {
    const cm = codeMirrorFromTarget(target) || (!target ? state.activeCodeMirror : null);
    const selection = orderedCodeSelection(cm);
    if (!selection) return null;
    const value = cm.getValue();
    const start = cm.indexFromPos(selection.from);
    const end = cm.indexFromPos(selection.to);
    const quote = value.slice(start, end);
    if (!quote.trim()) return null;
    const coords = cm.charCoords(selection.to, "window");
    return {
      anchor: {
        quote,
        prefix: value.slice(Math.max(0, start - CONTEXT_LENGTH), start),
        suffix: value.slice(end, end + CONTEXT_LENGTH),
        scope: "code",
        blockPrefix: value.slice(0, 96),
        blockSuffix: value.slice(-96),
      },
      rect: {
        left: coords.left,
        top: coords.top,
        width: Math.max(1, coords.right - coords.left),
        height: Math.max(1, coords.bottom - coords.top),
      },
    };
  }

  function captureSelection(target) {
    const codeSelection = captureCodeMirrorSelection(target);
    if (codeSelection) return codeSelection;
    const selection = window.getSelection();
    const write = document.querySelector("#write");
    if (!selection || selection.isCollapsed || !selection.rangeCount || !write) return null;
    const range = selection.getRangeAt(0);
    if (!write.contains(range.commonAncestorContainer)) return null;
    const anchor = anchorFromRange(range);
    if (!anchor) return null;
    return { anchor, range: range.cloneRange(), rect: range.getBoundingClientRect() };
  }

  function showSelectionToolbar(target) {
    const captured = captureSelection(target);
    if (!captured) return hideSelectionToolbar();
    state.pendingAnchor = captured.anchor;
    const toolbar = document.querySelector("#typora-annotation-toolbar");
    const rect = captured.rect;
    if (!toolbar || (!rect.width && !rect.height)) return;
    toolbar.hidden = false;
    toolbar.style.left = Math.max(8, Math.min(window.innerWidth - toolbar.offsetWidth - 8, rect.left + rect.width / 2 - toolbar.offsetWidth / 2)) + "px";
    toolbar.style.top = Math.max(8, rect.top - toolbar.offsetHeight - 8) + "px";
  }

  function hideSelectionToolbar() {
    const toolbar = document.querySelector("#typora-annotation-toolbar");
    if (toolbar) toolbar.hidden = true;
  }

  function showCommentComposer(anchor) {
    if (!anchor) return;
    const composer = document.querySelector("#typora-annotation-composer");
    const textarea = composer?.querySelector("textarea");
    if (!composer || !textarea) return;
    composer.hidden = false;
    composer.dataset.mode = "create";
    composer.querySelector(".ta-composer-quote").textContent = anchor.quote;
    textarea.value = "";
    composer.__anchor = anchor;
    textarea.focus();
  }

  function closeComposer() {
    const composer = document.querySelector("#typora-annotation-composer");
    if (composer) composer.hidden = true;
  }

  function openSidebar(selectedId) {
    const sidebar = document.querySelector("#typora-annotation-sidebar");
    if (!sidebar) return;
    sidebar.classList.add("open");
    document.body.classList.add("ta-sidebar-open");
    renderSidebar();
    window.setTimeout(render, 180);
    if (selectedId) {
      requestAnimationFrame(() => {
        const card = sidebar.querySelector(`[data-id="${CSS.escape(selectedId)}"]`);
        card?.scrollIntoView({ block: "nearest" });
        card?.classList.add("selected");
        setTimeout(() => card?.classList.remove("selected"), 1000);
      });
    }
  }

  function closeSidebar() {
    document.querySelector("#typora-annotation-sidebar")?.classList.remove("open");
    document.body.classList.remove("ta-sidebar-open");
    window.setTimeout(render, 180);
  }

  function clampSidebarWidth(width) {
    const maximum = Math.max(240, Math.min(620, window.innerWidth - 320));
    return Math.max(240, Math.min(maximum, Number(width) || 340));
  }

  function applySidebarWidth(width, persist) {
    state.sidebarWidth = clampSidebarWidth(width);
    document.documentElement.style.setProperty("--ta-sidebar-width", state.sidebarWidth + "px");
    if (persist) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(state.sidebarWidth)));
    render();
  }

  function initSidebarResize() {
    const handle = document.querySelector("#typora-annotation-resize-handle");
    if (!handle) return;
    applySidebarWidth(localStorage.getItem(SIDEBAR_WIDTH_KEY) || 340, false);
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      document.body.classList.add("ta-resizing");
      const onMove = (moveEvent) => applySidebarWidth(window.innerWidth - moveEvent.clientX, false);
      const onUp = () => {
        document.body.classList.remove("ta-resizing");
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(state.sidebarWidth)));
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    });
  }

  function syncTypography() {
    const root = document.getElementById(ROOT_ID);
    const write = document.querySelector("#write");
    if (!root || !write) return;
    const style = getComputedStyle(write);
    root.style.setProperty("--ta-font-family", style.fontFamily);
    root.style.setProperty("--ta-font-size", style.fontSize);
    root.style.setProperty("--ta-line-height", style.lineHeight);
  }

  function displayPath(path) {
    if (!path) return "";
    const match = path.match(/^\/Users\/[^/]+\/(.*)$/);
    return match ? "~/" + match[1] : path;
  }

  function renderStorageStatus() {
    const status = document.querySelector("#typora-annotation-storage-status");
    const agentButton = document.querySelector("[data-action='agent']");
    if (!status) return;
    if (!currentDocumentPath()) {
      status.textContent = "保存文档后写入 JSON";
      status.title = "未保存草稿暂存于 Typora 本地存储";
      if (agentButton) agentButton.disabled = true;
    } else if (state.storageMode === "json") {
      status.textContent = displayPath(state.annotationFile || "~/Documents/typora");
      status.title = state.annotationFile || "批注已保存到 JSON";
      if (agentButton) agentButton.disabled = false;
    } else if (state.storageMode === "connecting") {
      status.textContent = "正在连接 JSON 存储…";
      status.title = "";
      if (agentButton) agentButton.disabled = true;
    } else {
      status.textContent = "JSON helper 未连接 · 已本地暂存";
      status.title = "运行 install-support.sh 以启用 ~/Documents/typora 存储";
      if (agentButton) agentButton.disabled = true;
    }
  }

  async function copyAgentPrompt() {
    const documentPath = currentDocumentPath();
    if (!documentPath) return toast("请先保存文档");
    const prompt = `请使用 typora-annotations skill 读取并处理这个文档的批注：${documentPath}`;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch (error) {
      const input = document.createElement("textarea");
      input.value = prompt;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    toast("已复制给 Agent 的提示词");
  }

  function focusAnnotation(id) {
    const resolved = state.resolved.get(id);
    if (!resolved) return toast("这条批注暂时无法定位");
    if (resolved.kind === "code") {
      resolved.cm.scrollIntoView({ from: resolved.from, to: resolved.to }, 100);
      resolved.cm.focus();
      resolved.cm.setSelection(resolved.from, resolved.to);
      window.setTimeout(() => resolved.cm.setCursor(resolved.to), 900);
      return;
    }
    const range = resolved.range;
    const target = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    } else {
      const rect = range.getBoundingClientRect();
      window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: "smooth" });
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range.cloneRange());
    setTimeout(() => selection.removeAllRanges(), 900);
  }

  function renderSidebar() {
    const list = document.querySelector("#typora-annotation-list");
    const count = document.querySelector("#typora-annotation-count");
    const badge = document.querySelector("#typora-annotation-toggle .ta-badge");
    if (!list) return;
    if (count) count.textContent = String(state.items.length);
    if (badge) {
      badge.textContent = String(state.items.length);
      badge.hidden = !state.items.length;
    }
    renderStorageStatus();
    list.replaceChildren();
    if (!state.items.length) {
      const empty = document.createElement("div");
      empty.className = "ta-empty";
      empty.textContent = "选中一段文字，添加高亮或评论。";
      list.appendChild(empty);
      return;
    }

    for (const item of [...state.items].reverse()) {
      const isResolved = state.resolved.has(item.id);
      const card = document.createElement("article");
      card.className = "ta-card ta-card-" + item.type + (isResolved ? "" : " unresolved");
      card.dataset.id = item.id;
      card.addEventListener("click", (event) => {
        if (event.target.closest("button, textarea, .ta-card-actions")) return;
        focusAnnotation(item.id);
      });

      const quote = document.createElement("button");
      quote.type = "button";
      quote.className = "ta-card-quote";
      quote.textContent = item.anchor.quote;
      quote.title = "定位到原文";
      quote.setAttribute("aria-label",
        (item.type === "comment" ? "评论：" : "高亮：") + item.anchor.quote + "，定位到原文");
      quote.addEventListener("click", () => focusAnnotation(item.id));
      card.appendChild(quote);

      if (item.type === "comment") {
        const comment = document.createElement("textarea");
        comment.className = "ta-card-comment";
        comment.value = item.comment || "";
        comment.placeholder = "输入评论";
        comment.addEventListener("change", () => updateComment(item.id, comment.value));
        card.appendChild(comment);
      }

      const actions = document.createElement("div");
      actions.className = "ta-card-actions";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "删除";
      remove.addEventListener("click", () => deleteAnnotation(item.id));
      if (!isResolved) {
        const status = document.createElement("span");
        status.textContent = "原文已变化";
        actions.appendChild(status);
      }
      actions.appendChild(remove);
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function toast(message) {
    let element = document.querySelector("#typora-annotation-toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(element.__timer);
    element.__timer = setTimeout(() => element.classList.remove("show"), 1400);
  }

  function buildUi() {
    if (document.getElementById(ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("aria-label", "Typora 批注");
    root.innerHTML = `
      <div id="typora-annotation-fallback" aria-hidden="true"></div>
      <div id="typora-annotation-markers"></div>
      <div id="typora-annotation-toolbar" role="toolbar" aria-label="添加批注" hidden>
        <button type="button" data-action="highlight" title="添加高亮">高亮</button>
        <button type="button" data-action="comment" title="添加评论">评论</button>
      </div>
      <button id="typora-annotation-toggle" type="button" title="批注列表" aria-label="打开批注列表">批注<span class="ta-badge" hidden>0</span></button>
      <aside id="typora-annotation-sidebar" aria-label="批注列表">
        <div id="typora-annotation-resize-handle" role="separator" aria-orientation="vertical" aria-label="调整批注栏宽度"></div>
        <header><strong>批注 <span id="typora-annotation-count">0</span></strong><div class="ta-header-actions"><button type="button" data-action="agent">给 Agent</button><button type="button" class="ta-close" aria-label="关闭">×</button></div></header>
        <div id="typora-annotation-list"></div>
        <footer id="typora-annotation-storage-status" title=""></footer>
      </aside>
      <div id="typora-annotation-composer" role="dialog" aria-modal="true" aria-label="添加评论" hidden>
        <div class="ta-composer-card">
          <strong>添加评论</strong>
          <blockquote class="ta-composer-quote"></blockquote>
          <textarea rows="4" placeholder="输入评论…"></textarea>
          <div class="ta-composer-actions"><button type="button" data-action="cancel">取消</button><button type="button" data-action="save">添加</button></div>
        </div>
      </div>
      <div id="typora-annotation-toast" role="status" aria-live="polite"></div>`;
    document.body.appendChild(root);

    root.querySelector("[data-action='highlight']").addEventListener("mousedown", (event) => event.preventDefault());
    root.querySelector("[data-action='comment']").addEventListener("mousedown", (event) => event.preventDefault());
    root.querySelector("[data-action='highlight']").addEventListener("click", () => {
      if (state.pendingAnchor) createAnnotation("highlight", state.pendingAnchor);
      hideSelectionToolbar();
    });
    root.querySelector("[data-action='comment']").addEventListener("click", () => {
      showCommentComposer(state.pendingAnchor);
      hideSelectionToolbar();
    });
    root.querySelector("#typora-annotation-toggle").addEventListener("click", () => openSidebar());
    root.querySelector("[data-action='agent']").addEventListener("click", copyAgentPrompt);
    root.querySelector(".ta-close").addEventListener("click", closeSidebar);
    root.querySelector("[data-action='cancel']").addEventListener("click", closeComposer);
    root.querySelector("[data-action='save']").addEventListener("click", () => {
      const composer = root.querySelector("#typora-annotation-composer");
      const value = composer.querySelector("textarea").value.trim();
      if (!value) return toast("请输入评论内容");
      createAnnotation("comment", composer.__anchor, value);
      closeComposer();
      openSidebar();
    });
  }

  function switchDocumentIfNeeded() {
    const nextId = currentDocumentId();
    if (nextId === state.documentId) return;
    state.documentId = nextId;
    state.items = readLocalItems();
    closeComposer();
    hideSelectionToolbar();
    render();
    loadItemsForCurrentDocument();
  }

  function observeEditor() {
    const write = document.querySelector("#write");
    if (!write) return;
    state.observer?.disconnect();
    state.observer = new MutationObserver(render);
    state.observer.observe(write, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
  }

  function bindEvents() {
    document.addEventListener("mouseup", (event) => {
      if (event.target.closest("#" + ROOT_ID)) return;
      state.activeCodeMirror = codeMirrorFromTarget(event.target);
      setTimeout(() => showSelectionToolbar(event.target), 0);
    }, true);
    document.addEventListener("keyup", (event) => {
      if (event.key === "Shift" || event.key.startsWith("Arrow")) {
        state.activeCodeMirror = codeMirrorFromTarget(event.target);
        showSelectionToolbar(event.target);
      }
    }, true);
    document.addEventListener("scroll", render, true);
    window.addEventListener("resize", render, { passive: true });
    window.addEventListener("resize", () => applySidebarWidth(state.sidebarWidth, false), { passive: true });
    window.addEventListener("scroll", render, { passive: true });
    window.addEventListener("storage", (event) => {
      if (event.key === storageKey()) {
        state.items = readLocalItems();
        render();
      }
    });
  }

  function init() {
    buildUi();
    state.documentId = currentDocumentId();
    state.items = readLocalItems();
    initSidebarResize();
    syncTypography();
    observeEditor();
    bindEvents();
    render();
    loadItemsForCurrentDocument();
    setInterval(() => {
      switchDocumentIfNeeded();
      syncTypography();
      if (!state.observer || !document.querySelector("#write")) observeEditor();
    }, 750);
    window.__typoraAnnotations = {
      get items() { return state.items.map((item) => ({ ...item })); },
      render,
      findAnchor,
      get annotationFile() { return state.annotationFile; },
      get storageMode() { return state.storageMode; },
      version: "2.1.1",
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0), { once: true });
  } else {
    setTimeout(init, 0);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      findAnchor,
      findCodeAnchor,
      commonPrefixLength,
      commonSuffixLength,
      textPointForOffset,
      commentMarkerPosition,
    };
  }
})();
