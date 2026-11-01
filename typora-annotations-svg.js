(function (global) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const TYPOGRAPHY = {
    text: '"Avenir Next", "PingFang SC", sans-serif',
    code: '"Source Code Pro", "PingFang SC", monospace',
  };
  const DRAWABLE = "text, rect, circle, ellipse, line, polyline, polygon, path, use, image, g";
  const TAGS = new Set(("svg g rect circle ellipse line polyline polygon path text tspan defs marker " +
    "clipPath mask linearGradient radialGradient stop pattern symbol use title desc style").split(" "));
  const ATTRS = new Set(("id class x y x1 y1 x2 y2 dx dy width height rx ry cx cy r d points " +
    "viewBox preserveAspectRatio transform fill stroke stroke-width stroke-dasharray stroke-linecap " +
    "stroke-linejoin opacity fill-opacity stroke-opacity font-family font-size font-weight font-style " +
    "text-anchor dominant-baseline alignment-baseline letter-spacing textLength lengthAdjust " +
    "marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient " +
    "clip-path clipPathUnits mask maskUnits maskContentUnits gradientUnits gradientTransform " +
    "spreadMethod offset stop-color stop-opacity patternUnits patternContentUnits patternTransform " +
    "vector-effect visibility display color").split(" "));
  const CSS_PROPS = new Set(("fill stroke stroke-width stroke-dasharray stroke-linecap stroke-linejoin " +
    "opacity fill-opacity stroke-opacity font font-family font-size font-weight font-style text-anchor " +
    "dominant-baseline alignment-baseline letter-spacing color stop-color stop-opacity visibility display").split(" "));

  function safeValue(value) {
    return !/[<>@\\]/.test(value) && !/expression\s*\(/i.test(value) &&
      !/url\s*\(/i.test(value.replace(/url\(\s*#[\w:.-]+\s*\)/gi, ""));
  }

  function safeDeclarations(text) {
    return text.split(";").map((part) => {
      const colon = part.indexOf(":");
      const key = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).trim();
      return colon > 0 && CSS_PROPS.has(key) && safeValue(value) ? key + ":" + value : "";
    }).filter(Boolean).join(";");
  }

  function safeStyles(text) {
    return Array.from(text.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((match) => {
      const selector = match[1].trim();
      return /^[\w.#\s,:>*-]+$/.test(selector) ? selector + "{" + safeDeclarations(match[2]) + "}" : "";
    }).join("\n");
  }

  // Build a passive SVG in an isolated shadow tree. Never insert source markup,
  // scripts, event handlers, foreignObject, external URLs or global CSS.
  function passiveSvg(source, doc) {
    const xml = new DOMParser().parseFromString(source, "image/svg+xml");
    if (xml.querySelector("parsererror") || xml.documentElement.localName !== "svg") {
      throw new Error("无法解析 SVG");
    }
    function copy(node) {
      if (node.nodeType === 3) return doc.createTextNode(node.nodeValue);
      if (node.nodeType !== 1 || node.namespaceURI !== NS || !TAGS.has(node.localName)) return null;
      const result = doc.createElementNS(NS, node.localName);
      if (node.localName === "style") {
        result.textContent = safeStyles(node.textContent);
        return result;
      }
      for (const attr of node.attributes) {
        if (attr.localName === "href" && /^#[\w:.-]+$/.test(attr.value)) {
          result.setAttribute("href", attr.value);
        } else if (attr.name === "style") {
          result.setAttribute("style", safeDeclarations(attr.value));
        } else if (ATTRS.has(attr.name) && safeValue(attr.value)) {
          result.setAttribute(attr.name, attr.value);
        }
      }
      for (const child of node.childNodes) {
        const next = copy(child);
        if (next) result.appendChild(next);
      }
      return result;
    }
    return copy(xml.documentElement);
  }

  function normalizedText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function fontRole(family, classes, text) {
    return /monospace|menlo|monaco|consolas|courier|source\s*code|sf[ -]?mono|fira code|jetbrains mono/i.test(family) ||
      /(?:^|\s)(?:m|code|mono|monospace)(?:\s|$)/i.test(classes) ||
      /^(?:svc-[\w.-]+|[\w.+-]+@[\w.-]+|sf org login (?:web|jwt)|git push)$/.test(text.trim()) ? "code" : "text";
  }

  function canTheme(source) {
    const xml = new DOMParser().parseFromString(source, "image/svg+xml");
    // Keep the original image for constructs our passive renderer cannot reproduce.
    return !xml.querySelector("parsererror") && Array.from(xml.querySelectorAll("*")).every((node) =>
      TAGS.has(node.localName) || ["script", "metadata"].includes(node.localName)) &&
      !Array.from(xml.querySelectorAll("style")).some((style) => /@|(?:filter|font-feature-settings)\s*:/i.test(style.textContent));
  }

  function applyTypography(svg) {
    // Measure before applying the display theme; source sizes express the layout.
    const labels = Array.from(svg.querySelectorAll("text"));
    const budgets = labels.map((element) => ({ element, width: element.getBBox().width }));
    const nodes = Array.from(svg.querySelectorAll("text, tspan"));
    const roles = nodes.map((element) => fontRole(getComputedStyle(element).fontFamily,
      element.getAttribute("class") || "", element.textContent));
    nodes.forEach((element, index) => element.style.setProperty("font-family", TYPOGRAPHY[roles[index]], "important"));
    svg.style.setProperty("font-family", TYPOGRAPHY.text, "important");
    const tokenPattern = /(?:svc-(?:[\w.-]+)|[\w.+-]+@[\w.-]+|deploy-bot|sf org login (?:web|jwt)|git push)/g;
    labels.forEach((label) => {
      if (roles[nodes.indexOf(label)] === "code") return;
      for (const node of Array.from(label.childNodes)) {
        if (node.nodeType !== 3) continue;
        const content = node.nodeValue;
        const matches = Array.from(content.matchAll(tokenPattern));
        if (!matches.length) continue;
        const fragment = document.createDocumentFragment();
        let offset = 0;
        for (const match of matches) {
          fragment.appendChild(document.createTextNode(content.slice(offset, match.index)));
          const code = document.createElementNS(NS, "tspan");
          code.textContent = match[0];
          code.style.setProperty("font-family", TYPOGRAPHY.code, "important");
          fragment.appendChild(code);
          offset = match.index + match[0].length;
        }
        fragment.appendChild(document.createTextNode(content.slice(offset)));
        node.replaceWith(fragment);
      }
    });
    for (const { element, width } of budgets) {
      const actual = element.getBBox().width;
      // Fit wider replacement glyphs into the label's original width budget.
      // Existing textLength/lengthAdjust settings remain authoritative.
      if (width > 0 && actual > width * 1.02 && !element.hasAttribute("textLength")) {
        const scale = width / actual;
        const sizes = [element, ...element.querySelectorAll("tspan")].map((node) =>
          ({ node, size: parseFloat(getComputedStyle(node).fontSize) }));
        for (const { node, size } of sizes) node.style.setProperty("font-size", size * scale + "px", "important");
      }
    }
  }

  function describe(element, root) {
    const path = [];
    for (let node = element; node && node !== root; node = node.parentElement) {
      path.unshift(Array.from(node.parentElement.children).indexOf(node));
    }
    return {
      tag: element.localName,
      id: element.id || "",
      text: normalizedText(element.textContent),
      path: path.join("/"),
      geometry: Array.from(element.attributes).filter((attr) =>
        !["id", "class", "style"].includes(attr.name))
        .map((attr) => [attr.name, attr.value]).sort((a, b) => a[0].localeCompare(b[0])),
    };
  }

  function findTarget(candidates, target, sameVersion) {
    if (!target || typeof target.tag !== "string") return -1;
    const tagged = candidates.map((item, index) => ({ item, index })).filter(({ item }) => item.tag === target.tag);
    const unique = (items) => items.length === 1 ? items[0].index : -1;
    if (target.id) {
      const matches = tagged.filter(({ item }) => item.id === target.id);
      if (matches.length) return unique(matches);
    }
    const matches = tagged.filter(({ item }) => target.text
      ? item.text === target.text
      : JSON.stringify(item.geometry) === JSON.stringify(target.geometry));
    if (matches.length === 1) return matches[0].index;
    if (sameVersion) return unique(matches.filter(({ item }) => item.path === target.path));
    return -1;
  }

  function validBounds(bounds) {
    return bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
      bounds.width > 0 && bounds.height > 0;
  }

  function visibleRect(rect) {
    const width = Math.max(6, rect.width), height = Math.max(6, rect.height);
    const left = rect.left - (width - rect.width) / 2;
    const top = rect.top - (height - rect.height) / 2;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
  }

  function transformRect(rect, matrix) {
    const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y],
      [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
      .map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f }));
    const x = Math.min(...points.map((p) => p.x));
    const y = Math.min(...points.map((p) => p.y));
    const width = Math.max(...points.map((p) => p.x)) - x;
    const height = Math.max(...points.map((p) => p.y)) - y;
    return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height };
  }

  function create(options) {
    const entries = new Map();
    let active = null;
    let generation = 0;

    function remove(entry) {
      if (active === entry) active = null;
      entry.host.remove();
      entries.delete(entry.image);
    }

    function stop() {
      if (!active) return;
      active.mode = null;
      active.drag = null;
      active.surface.style.pointerEvents = "none";
      active.outline.hidden = true;
      active.tools.querySelectorAll("button").forEach((button, index) => { button.hidden = index !== 0; });
      active = null;
      options.onStop?.();
    }

    function drawableElements(svg) {
      return Array.from(svg.querySelectorAll(DRAWABLE)).filter((el) =>
        !el.closest("defs, marker, clipPath, mask, pattern, symbol") &&
        !(el.localName === "g" && !el.id));
    }

    function setSvg(entry, data) {
      const svg = passiveSvg(data.svg, document);
      if (!svg.hasAttribute("viewBox")) {
        svg.setAttribute("viewBox", "0 0 " + (parseFloat(svg.getAttribute("width")) || entry.image.naturalWidth || 960) +
          " " + (parseFloat(svg.getAttribute("height")) || entry.image.naturalHeight || 600));
      }
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      if (!svg.hasAttribute("font-family")) svg.setAttribute("font-family", "serif");
      if (!svg.hasAttribute("font-size")) svg.setAttribute("font-size", "16");
      Object.assign(svg.style, { display: "block", width: "100%", height: "100%", opacity: "0", overflow: "hidden", userSelect: "none" });
      entry.shadow.replaceChildren(svg);
      entry.themed = canTheme(data.svg);
      if (entry.themed) {
        applyTypography(svg);
        svg.style.opacity = "1";
      }
      entry.svg = svg;
      entry.data = data;
      entry.elements = drawableElements(svg);
      entry.descriptors = entry.elements.map((el) => describe(el, svg));
      svg.addEventListener("pointerdown", (event) => pointerDown(entry, event));
      svg.addEventListener("pointermove", (event) => pointerMove(entry, event));
      svg.addEventListener("pointerup", (event) => pointerUp(entry, event));
      svg.addEventListener("pointercancel", () => { entry.drag = null; entry.outline.hidden = true; });
      svg.addEventListener("pointerleave", () => { if (!entry.drag) entry.outline.hidden = true; });
    }

    async function load(entry, refresh = false, notify = false) {
      if (entry.loading) return entry.loading;
      if (entry.data && !refresh) return entry.data;
      const currentGeneration = generation;
      entry.lastCheck = Date.now();
      entry.loading = (async () => {
        try {
          const url = "http://127.0.0.1:17373/v1/svg?documentPath=" + encodeURIComponent(entry.documentPath) +
            "&src=" + encodeURIComponent(entry.source);
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) throw new Error("无法读取 SVG，请确认图片已保存且批注服务已更新");
          const data = await response.json();
          if (generation !== currentGeneration || !entries.has(entry.image)) return null;
          const changed = entry.data?.fingerprint !== data.fingerprint;
          const wasUnavailable = entry.unavailable;
          if (changed) {
            if (active === entry) stop();
            setSvg(entry, data);
          }
          entry.unavailable = false;
          entry.surface.hidden = false;
          entry.host.classList.toggle("ta-svg-themed", entry.themed);
          if (changed || wasUnavailable) options.onChange();
          return data;
        } catch (error) {
          entry.error = error.message;
          if (!entry.unavailable && entry.data) options.onChange();
          entry.unavailable = true;
          entry.surface.hidden = true;
          entry.host.classList.remove("ta-svg-themed");
          if (notify) options.toast(error.message);
          return null;
        } finally {
          entry.loading = null;
        }
      })();
      return entry.loading;
    }

    function preview(entry, rect) {
      const hostRect = entry.host.getBoundingClientRect();
      Object.assign(entry.outline.style, { left: rect.left - hostRect.left + "px", top: rect.top - hostRect.top + "px",
        width: Math.max(2, rect.width) + "px", height: Math.max(2, rect.height) + "px" });
      entry.outline.hidden = false;
    }

    function eventElement(entry, event) {
      let element = event.target;
      if (element.localName === "tspan") element = element.closest("text");
      return entry.elements.includes(element) ? element : null;
    }

    function dragRect(entry, event) {
      const image = entry.svg.getBoundingClientRect();
      const x = Math.max(image.left, Math.min(image.right, event.clientX));
      const y = Math.max(image.top, Math.min(image.bottom, event.clientY));
      const left = Math.min(entry.drag.x, x), top = Math.min(entry.drag.y, y);
      return { x: left, y: top, left, top, width: Math.abs(x - entry.drag.x), height: Math.abs(y - entry.drag.y) };
    }

    function pointerDown(entry, event) {
      if (active !== entry || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (entry.mode === "region") {
        entry.drag = { x: event.clientX, y: event.clientY };
        entry.svg.setPointerCapture(event.pointerId);
      }
    }

    function pointerMove(entry, event) {
      if (active !== entry) return;
      if (entry.drag) return preview(entry, dragRect(entry, event));
      const element = eventElement(entry, event);
      if (entry.mode === "element" && element) preview(entry, visibleRect(element.getBoundingClientRect()));
      else entry.outline.hidden = true;
    }

    function pointerUp(entry, event) {
      if (active !== entry || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      let target = null, rect;
      if (entry.mode === "region" && entry.drag) {
        rect = dragRect(entry, event);
        entry.drag = null;
        if (entry.svg.hasPointerCapture(event.pointerId)) entry.svg.releasePointerCapture(event.pointerId);
        if (rect.width < 6 || rect.height < 6) return;
      } else {
        const element = eventElement(entry, event);
        if (!element) return;
        target = describe(element, entry.svg);
        rect = visibleRect(element.getBoundingClientRect());
      }
      const matrix = entry.svg.getScreenCTM();
      if (!matrix) return;
      const bounds = transformRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }, matrix.inverse());
      if (!validBounds(bounds)) return;
      const regionText = entry.elements.filter((el) => {
        if (el.localName !== "text") return false;
        const r = el.getBoundingClientRect();
        return r.right > rect.left && r.left < rect.left + rect.width && r.bottom > rect.top && r.top < rect.top + rect.height;
      }).map((el) => normalizedText(el.textContent)).join(" · ");
      const viewBox = Array.from(entry.svg.viewBox.baseVal ? [entry.svg.viewBox.baseVal.x, entry.svg.viewBox.baseVal.y,
        entry.svg.viewBox.baseVal.width, entry.svg.viewBox.baseVal.height] : []);
      const anchor = { scope: "svg", quote: (target?.text || (target ? "SVG " + target.tag : regionText || "SVG 框选区域")).slice(0, 600),
        prefix: "", suffix: "", imageSource: entry.data.imageSource, imagePath: entry.data.imagePath,
        imageAlt: entry.image.alt || "", imageOccurrence: entry.occurrence, imageCount: entry.imageCount,
        svgFingerprint: entry.data.fingerprint, target, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, viewBox };
      preview(entry, rect);
      options.onSelect(anchor, rect);
    }

    async function start(entry, mode) {
      stop();
      const data = await load(entry, true, true);
      if (!data || !entries.has(entry.image)) return;
      active = entry;
      entry.mode = mode;
      entry.surface.style.pointerEvents = "auto";
      entry.surface.style.cursor = mode === "region" ? "crosshair" : "pointer";
      entry.tools.querySelectorAll("button").forEach((button, index) => {
        button.hidden = index === 0;
        button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
      });
      options.toast(mode === "region" ? "拖动框选图中区域" : "点击图中文字、形状或箭头");
    }

    function makeEntry(image, source, documentPath) {
      const host = document.createElement("div");
      host.className = "ta-svg-host";
      const surface = document.createElement("div");
      surface.className = "ta-svg-surface";
      surface.setAttribute("aria-label", "SVG 批注画布：" + (image.alt || "图片"));
      const shadow = surface.attachShadow({ mode: "open" });
      const outline = document.createElement("div");
      outline.className = "ta-svg-outline";
      outline.hidden = true;
      const tools = document.createElement("div");
      tools.className = "ta-svg-tools";
      const entry = { image, source, documentPath, host, surface, shadow, outline, tools, lastCheck: 0 };
      ["批注此图", "点选", "框选", "完成"].forEach((label, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.hidden = index !== 0;
        button.dataset.mode = index === 2 ? "region" : "element";
        button.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); });
        button.addEventListener("click", () => index === 3 ? stop() : start(entry, index === 2 ? "region" : "element"));
        tools.appendChild(button);
      });
      host.append(surface, outline, tools);
      options.root.appendChild(host);
      return entry;
    }

    function sync() {
      const documentPath = options.documentPath();
      const images = Array.from(document.querySelectorAll("#write img")).filter((image) =>
        /\.svg(?:[?#]|$)/i.test(image.currentSrc || image.getAttribute("src") || ""));
      for (const entry of entries.values()) {
        if (!images.includes(entry.image) || entry.documentPath !== documentPath ||
            entry.source !== (entry.image.currentSrc || entry.image.getAttribute("src"))) remove(entry);
      }
      if (!documentPath) return;
      const viewport = document.querySelector("content")?.getBoundingClientRect() ||
        { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      for (const image of images) {
        const source = image.currentSrc || image.getAttribute("src");
        if (!entries.has(image)) entries.set(image, makeEntry(image, source, documentPath));
        const entry = entries.get(image);
        const identical = images.filter((other) => (other.currentSrc || other.getAttribute("src")) === source);
        entry.occurrence = identical.indexOf(image);
        entry.imageCount = identical.length;
        const rect = image.getBoundingClientRect();
        const layout = [rect.left, rect.top, rect.width, rect.height].join(",");
        if (entry.layout && entry.layout !== layout) options.onChange();
        entry.layout = layout;
        entry.host.hidden = !rect.width || !rect.height || rect.bottom <= viewport.top || rect.top >= viewport.bottom ||
          rect.right <= viewport.left || rect.left >= viewport.right || getComputedStyle(image).visibility === "hidden";
        Object.assign(entry.host.style, { left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px",
          clipPath: `inset(${Math.max(0, viewport.top - rect.top)}px ${Math.max(0, rect.right - viewport.right)}px ${Math.max(0, rect.bottom - viewport.bottom)}px ${Math.max(0, viewport.left - rect.left)}px)` });
        entry.tools.style.top = Math.max(4, viewport.top - rect.top + 4) + "px";
        if (!entry.data && !entry.host.hidden && Date.now() - entry.lastCheck > 10000) load(entry);
        if (entry.data && !entry.host.hidden && Date.now() - entry.lastCheck > 10000 && !entry.drag) load(entry, true);
      }
    }

    function resolve(anchor) {
      const matches = Array.from(entries.values()).filter((entry) => entry.data && !entry.unavailable
        ? entry.data.imagePath === anchor.imagePath
        : false).sort((a, b) => a.occurrence - b.occurrence);
      // Loading is lazy except for images that already have annotations.
      for (const entry of entries.values()) {
        if (!entry.data && Date.now() - entry.lastCheck > 10000) load(entry);
      }
      if (!matches.length) return null;
      if (matches.length !== (anchor.imageCount || 1)) return null;
      const entry = matches[anchor.imageOccurrence || 0];
      if (!entry) return null;
      const sameVersion = entry.data.fingerprint === anchor.svgFingerprint;
      if (!anchor.target) return sameVersion && validBounds(anchor.bounds) ? { kind: "svg", entry, bounds: anchor.bounds } : null;
      const index = findTarget(entry.descriptors, anchor.target, sameVersion);
      return index >= 0 ? { kind: "svg", entry, element: entry.elements[index] } : null;
    }

    function rect(resolved) {
      if (resolved.element) return visibleRect(resolved.element.getBoundingClientRect());
      const matrix = resolved.entry.svg.getScreenCTM();
      return matrix ? transformRect(resolved.bounds, matrix) : null;
    }

    function draw(resolved, type, focused) {
      const box = rect(resolved);
      if (!box || resolved.entry.host.hidden) return;
      const frame = document.createElement("div");
      frame.className = "ta-svg-annotation ta-svg-annotation-" + type + (focused ? " selected" : "");
      Object.assign(frame.style, { left: box.left + "px", top: box.top + "px", width: Math.max(3, box.width) + "px", height: Math.max(3, box.height) + "px" });
      const viewport = document.querySelector("content")?.getBoundingClientRect();
      if (viewport) frame.style.clipPath = `inset(${Math.max(0, viewport.top - box.top)}px ${Math.max(0, box.right - viewport.right)}px ${Math.max(0, box.bottom - viewport.bottom)}px ${Math.max(0, viewport.left - box.left)}px)`;
      options.root.querySelector("#typora-annotation-fallback").appendChild(frame);
    }

    function thumbnail(resolved) {
      const svg = resolved.entry.svg;
      const viewBox = svg.viewBox.baseVal;
      const matrix = svg.getScreenCTM();
      const box = rect(resolved);
      if (!matrix || !box || viewBox.width <= 0 || viewBox.height <= 0) return null;
      const bounds = transformRect({ x: box.left, y: box.top, width: box.width, height: box.height }, matrix.inverse());
      const preview = document.createElement("div");
      preview.className = "ta-svg-thumbnail";
      preview.style.aspectRatio = viewBox.width + " / " + viewBox.height;
      const image = document.createElement(resolved.entry.themed ? "div" : "img");
      if (resolved.entry.themed) {
        image.style.cssText = "width:100%;height:100%";
        image.setAttribute("role", "img");
        image.setAttribute("aria-label", "图中批注位置预览");
        image.attachShadow({ mode: "open" }).appendChild(svg.cloneNode(true));
      } else {
        image.src = resolved.entry.source;
        image.alt = "图中批注位置预览";
      }
      const frame = document.createElement("span");
      Object.assign(frame.style, { left: (bounds.x - viewBox.x) / viewBox.width * 100 + "%",
        top: (bounds.y - viewBox.y) / viewBox.height * 100 + "%", width: bounds.width / viewBox.width * 100 + "%",
        height: bounds.height / viewBox.height * 100 + "%" });
      preview.append(image, frame);
      return preview;
    }

    document.addEventListener("keydown", (event) => { if (event.key === "Escape") stop(); });
    return { sync, resolve, rect, draw, thumbnail, stop,
      reset() { generation += 1; stop(); for (const entry of Array.from(entries.values())) remove(entry); },
    };
  }

  const api = { create, findTarget, validBounds, visibleRect, transformRect, passiveSvg, safeStyles, safeDeclarations,
    fontRole, TYPOGRAPHY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.TyporaSvgAnnotations = api;
})(typeof window === "undefined" ? globalThis : window);
