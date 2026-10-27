(function () {
  const panelId = "vpa-edge-screen-panel";
  const chartHostname = "charts.deriv.com";

  if (window.top === window || new URL(location.origin).hostname !== chartHostname) return;
  if (document.getElementById(panelId)) return;

  const analysis = globalThis.VPAEdgeScreenAnalysis;
  const root = document.createElement("aside");
  root.id = panelId;
  root.setAttribute("aria-label", "VPA Edge screen-only analysis");
  root.innerHTML = `
    <header><strong>VPA EDGE · SCREEN ONLY</strong>
      <span id="vpa-screen-status">Reading screen</span>
      <button type="button" aria-label="Collapse VPA Edge panel">−</button>
    </header>
    <section>
      <div id="vpa-screen-market" class="vpa-screen-market">Detecting visible chart…</div>
      <div class="vpa-screen-grid">
        <div><small>VISIBLE BARS</small><b id="vpa-screen-bars">—</b></div>
        <div><small>SCREEN TREND</small><b id="vpa-screen-trend">—</b></div>
        <div><small>GREEN / RED</small><b id="vpa-screen-colors">—</b></div>
        <div><small>SETUP MARKS</small><b id="vpa-screen-signals">—</b></div>
      </div>
      <div id="vpa-screen-pattern" class="vpa-screen-pattern">Waiting for visible candle shapes</div>
      <div id="vpa-screen-alert" class="vpa-screen-alert" role="status" aria-live="polite">
        No new setup detected
      </div>
      <div class="vpa-screen-ohlc">
        <small>CHART-HEADER OHLC</small>
        <div id="vpa-screen-ohlc">Unavailable in visible text</div>
      </div>
      <p id="vpa-screen-note">Analyzing rendered chart pixels. No market feed or history request.</p>
      <footer id="vpa-screen-footer">Values derived from the visible screen only</footer>
    </section>
  `;
  document.documentElement.append(root);

  const drawing = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  drawing.id = "vpa-edge-screen-markings";
  drawing.setAttribute("aria-hidden", "true");
  drawing.style.cssText =
    "position:fixed;z-index:2147483645;pointer-events:none;overflow:visible";
  document.documentElement.append(drawing);

  const field = (name) => root.querySelector(`#vpa-screen-${name}`);
  const section = root.querySelector("section");
  const collapseButton = root.querySelector("header button");
  collapseButton.addEventListener("click", () => {
    section.hidden = !section.hidden;
    collapseButton.textContent = section.hidden ? "+" : "−";
    collapseButton.setAttribute(
      "aria-label",
      section.hidden ? "Expand VPA Edge panel" : "Collapse VPA Edge panel"
    );
  });

  function setEnabled(enabled) {
    root.hidden = !enabled;
    drawing.hidden = !enabled;
  }

  chrome.storage.local.get({ enabled: true }, (state) => {
    if (chrome.runtime.lastError) {
      field("status").textContent =
        `Overlay setting unavailable: ${chrome.runtime.lastError.message}`;
      return;
    }
    setEnabled(state.enabled);
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.enabled) {
      setEnabled(changes.enabled.newValue);
    }
  });

  let lastCanvasFingerprint = null;
  let lastCanvasChange = Date.now();
  let chartCanvas = null;
  let canvasReadError = null;
  let activeAlertKey = null;
  const notifiedSetupKeys = new Set();

  function visibleButtons(label) {
    return [...document.querySelectorAll(`button[aria-label="${label}"]`)]
      .filter((button) => button.getBoundingClientRect().width > 0);
  }

  function readChartLabels() {
    const symbolButton = visibleButtons("Symbol Search")
      .find((button) => button.textContent.trim());
    const intervalButton = [...document.querySelectorAll("button")]
      .filter((button) => button.getBoundingClientRect().width > 0)
      .find((button) =>
        /\b\d+\s*(?:minutes?|mins?|m|hours?|hrs?|h|days?|d)\b|\b\d+[mhd]\b/i
          .test(`${button.getAttribute("aria-label") ?? ""} ${button.textContent}`)
      );
    const symbol = symbolButton?.textContent.trim().replace(/\s+/g, "") ?? "Unknown symbol";
    const intervalText = intervalButton?.getAttribute("aria-label") ??
      intervalButton?.textContent ?? "";
    return {
      symbol: /^[A-Za-z0-9_]{2,30}$/.test(symbol) ? symbol : "Unknown symbol",
      intervalText: intervalText.trim()
    };
  }

  function getChartCanvas() {
    if (chartCanvas?.isConnected) return chartCanvas;
    const canvases = [...document.querySelectorAll("canvas")]
      .filter((canvas) => canvas.width >= 100 && canvas.height >= 150)
      .sort((a, b) => b.width * b.height - a.width * a.height);
    let mostBars = 0;
    for (const candidate of canvases) {
      try {
        const context = candidate.getContext("2d", { willReadFrequently: true });
        if (!context) continue;
        const image = context.getImageData(0, 0, candidate.width, candidate.height);
        const barCount = analysis.extractVisibleCandles(image).length;
        if (barCount > mostBars) {
          mostBars = barCount;
          chartCanvas = candidate;
        }
      } catch (error) {
        canvasReadError = `TradingView canvas pixel access failed: ${error.message}`;
      }
    }
    return chartCanvas;
  }

  function svgElement(name, attributes, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    if (text) element.textContent = text;
    return element;
  }

  function drawMarkings(canvas, result) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    drawing.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
    drawing.setAttribute("width", String(rect.width));
    drawing.setAttribute("height", String(rect.height));
    drawing.style.left = `${rect.left}px`;
    drawing.style.top = `${rect.top}px`;
    drawing.replaceChildren();

    const annotations = result.annotations.slice(-24);
    for (const mark of annotations) {
      const bullish = mark.direction === "bullish";
      const color = bullish ? "#00c896" : "#ff5263";
      const x = Math.min(Math.max(2, mark.x), canvas.width - 2);
      const rawY = bullish ? mark.lowY + 8 : mark.highY - 8;
      const y = Math.min(Math.max(8, rawY), canvas.height - 12);
      drawing.append(svgElement("circle", {
        cx: x, cy: y, r: mark.signal ? 5 : 2.5,
        fill: color, stroke: "#101820", "stroke-width": 1
      }));

      if (!mark.signal) continue;
      const rawLabelY = bullish ? y + 14 : y - 7;
      const labelY = Math.min(Math.max(13, rawLabelY), canvas.height - 4);
      const label = `${bullish ? "BULLISH" : "BEARISH"} ${mark.score}`;
      const badgeWidth = 65;
      const badgeX = Math.min(
        Math.max(2, x - badgeWidth / 2),
        Math.max(2, canvas.width - badgeWidth - 2)
      );
      drawing.append(svgElement("rect", {
        x: badgeX, y: labelY - 11, width: badgeWidth, height: 13, rx: 3,
        fill: "#101820", stroke: color, "stroke-width": 0.8
      }));
      drawing.append(svgElement("text", {
        x: badgeX + badgeWidth / 2, y: labelY - 2,
        fill: color, "font-size": 7, "font-weight": 700,
        "font-family": "system-ui, sans-serif", "text-anchor": "middle"
      }, label));
      const title = svgElement(
        "title",
        {},
        `Approximate screen-only ${bullish ? "bullish" : "bearish"} setup, score ${mark.score}: ${mark.reasons.join(", ")}`
      );
      drawing.lastElementChild.append(title);
    }
  }

  function fingerprint(image) {
    let hash = 2166136261;
    const step = Math.max(4, Math.floor(image.data.length / 2048 / 4) * 4);
    for (let i = 0; i < image.data.length; i += step) {
      hash ^= image.data[i];
      hash = Math.imul(hash, 16777619);
    }
    return `${image.width}x${image.height}:${hash >>> 0}`;
  }

  function formatPrice(value) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
  }

  function updateScreen() {
    const chart = readChartLabels();
    field("market").textContent = `${chart.symbol} · ${chart.intervalText || "interval unavailable"}`;

    const canvas = getChartCanvas();
    if (!canvas) {
      field("status").textContent = "Chart pixels unavailable";
      field("note").textContent = canvasReadError ??
        "No readable candle canvas is present in this frame.";
      return;
    }

    try {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Chart canvas has no readable 2D context.");
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const nextFingerprint = fingerprint(image);
      if (nextFingerprint !== lastCanvasFingerprint) {
        lastCanvasFingerprint = nextFingerprint;
        lastCanvasChange = Date.now();
      }

      const result = analysis.analyzeVisibleScreen(image);
      field("bars").textContent = result.visibleBarCount
        ? `~${result.visibleBarCount} visible`
        : "No candles detected";
      field("trend").textContent = result.trend;
      field("colors").textContent = `${result.bullishCount} green / ${result.bearishCount} red`;
      field("signals").textContent = `${result.signalCount} approximate`;
      field("pattern").textContent = result.latestPatterns.join(", ") ||
        "Dots show candle direction; outlined labels mark pattern setups.";
      drawMarkings(canvas, result);

      const latestSetup = result.annotations.at(-1);
      if (latestSetup?.signal) {
        const setupKey = `${Math.round(latestSetup.x / 5)}:${latestSetup.signal}:${latestSetup.reasons.join("|")}`;
        const direction = latestSetup.signal;
        if (setupKey !== activeAlertKey) {
          const isNew = !notifiedSetupKeys.has(setupKey);
          field("alert").textContent =
            `${isNew ? "NEW " : ""}POSSIBLE ${direction.toUpperCase()} SETUP · score ${latestSetup.score}. Check the live chart; not an entry instruction.`;
          activeAlertKey = setupKey;
        }
        field("alert").dataset.direction = direction;
        if (!notifiedSetupKeys.has(setupKey)) {
          notifiedSetupKeys.add(setupKey);
          if (notifiedSetupKeys.size > 200) {
            const oldestKey = notifiedSetupKeys.values().next().value;
            notifiedSetupKeys.delete(oldestKey);
          }
        }
      } else {
        if (activeAlertKey !== null) {
          field("alert").textContent = "No possible setup on the latest visible candle.";
          activeAlertKey = null;
        }
        field("alert").dataset.direction = "";
      }

      const ohlc = analysis.parseVisibleOhlc(document.body.innerText);
      field("ohlc").textContent = ohlc
        ? `O ${formatPrice(ohlc.open)} · H ${formatPrice(ohlc.high)} · L ${formatPrice(ohlc.low)} · C ${formatPrice(ohlc.close)}`
        : "Unavailable in visible chart text";

      const elapsed = Math.floor((Date.now() - lastCanvasChange) / 1000);
      field("status").textContent = elapsed < 5 ? "Screen changing" : "Screen static";
      field("note").textContent = result.note;
      field("footer").textContent =
        `Pixel scan · last screen change ${elapsed}s ago · alert only, no trades`;
    } catch (error) {
      field("status").textContent = "Screen pixels unreadable";
      drawing.replaceChildren();
      field("note").textContent =
        `The browser would not expose the chart pixels: ${error.message}`;
    }
  }

  updateScreen();
  const interval = setInterval(updateScreen, 1200);
  window.addEventListener("pagehide", () => clearInterval(interval), { once: true });
})();
