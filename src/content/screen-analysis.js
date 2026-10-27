(function (scope) {
  const COLORS = {
    bullish: (r, g, b) => g > 100 && g > r * 1.4 && g > b * 1.05,
    bearish: (r, g, b) => r > 160 && r > g * 1.4 && r > b * 1.2
  };

  function colorAt(data, index) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    if (COLORS.bullish(r, g, b)) return "bullish";
    if (COLORS.bearish(r, g, b)) return "bearish";
    return null;
  }

  function extractVisibleCandles(image, { top = 0, bottom = image.height } = {}) {
    const { width, height, data } = image;
    if (!Number.isInteger(width) || !Number.isInteger(height) ||
        width <= 0 || height <= 0 || data.length < width * height * 4) {
      throw new TypeError("Invalid chart image data");
    }
    const yStart = Math.max(0, Math.floor(top));
    const yEnd = Math.min(height, Math.ceil(bottom));
    const columns = Array.from({ length: width }, () => []);
    const rowOccupancy = new Uint16Array(height);

    for (let y = yStart; y < yEnd; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const kind = colorAt(data, (y * width + x) * 4);
        if (!kind) continue;
        columns[x].push({ y, kind });
        rowOccupancy[y] += 1;
      }
    }

    const lineRows = new Set();
    for (let y = yStart; y < yEnd; y += 1) {
      if (rowOccupancy[y] > width * 0.18) lineRows.add(y);
    }

    const activeColumns = [];
    for (let x = 0; x < width; x += 1) {
      const pixels = columns[x].filter((pixel) => !lineRows.has(pixel.y));
      if (pixels.length >= 3) activeColumns.push({ x, pixels });
    }

    const groups = [];
    for (const column of activeColumns) {
      const previous = groups.at(-1);
      if (previous && column.x - previous.end <= 1) {
        previous.end = column.x;
        previous.columns.push(column);
      } else {
        groups.push({ start: column.x, end: column.x, columns: [column] });
      }
    }

    return groups.flatMap((group) => {
      const barWidth = group.end - group.start + 1;
      const pixels = group.columns.flatMap((column) => column.pixels);
      if (barWidth < 2 || pixels.length < 12) return [];
      const bullishPixels = pixels.filter((pixel) => pixel.kind === "bullish").length;
      const bearishPixels = pixels.length - bullishPixels;
      if (bullishPixels === bearishPixels) return [];

      const yCounts = new Uint8Array(height);
      for (const column of group.columns) {
        for (const pixel of column.pixels) yCounts[pixel.y] += 1;
      }
      const bodyThreshold = Math.max(2, Math.ceil(barWidth * 0.4));
      const bodyRows = [];
      for (let y = yStart; y < yEnd; y += 1) {
        if (!lineRows.has(y) && yCounts[y] >= bodyThreshold) bodyRows.push(y);
      }
      if (!bodyRows.length) return [];

      const highY = Math.min(...pixels.map((pixel) => pixel.y));
      const lowY = Math.max(...pixels.map((pixel) => pixel.y));
      const bodyTopY = Math.min(...bodyRows);
      const bodyBottomY = Math.max(...bodyRows);
      const rangePixels = lowY - highY;
      if (rangePixels <= 0 || bodyTopY < highY || bodyBottomY > lowY) return [];

      const bullish = bullishPixels > bearishPixels;
      const openY = bullish ? bodyBottomY : bodyTopY;
      const closeY = bullish ? bodyTopY : bodyBottomY;
      return [{
        x: (group.start + group.end) / 2,
        direction: bullish ? "bullish" : "bearish",
        highY,
        lowY,
        openY,
        closeY,
        bodyRatio: (bodyBottomY - bodyTopY) / rangePixels,
        upperWickRatio: (bodyTopY - highY) / rangePixels,
        lowerWickRatio: (lowY - bodyBottomY) / rangePixels,
        closeLocation: (lowY - closeY) / rangePixels
      }];
    });
  }

  function visiblePatterns(candles) {
    const current = candles.at(-1);
    const previous = candles.at(-2);
    if (!current) return [];
    const patterns = [];
    if (previous &&
        previous.direction === "bearish" &&
        current.direction === "bullish" &&
        current.openY >= previous.openY &&
        current.closeY <= previous.closeY &&
        current.bodyRatio >= 0.5) {
      patterns.push("bullish engulfing");
    }
    if (previous &&
        previous.direction === "bullish" &&
        current.direction === "bearish" &&
        current.openY <= previous.openY &&
        current.closeY >= previous.closeY &&
        current.bodyRatio >= 0.5) {
      patterns.push("bearish engulfing");
    }
    if (current.lowerWickRatio >= 0.5 &&
        current.bodyRatio <= 0.4 &&
        current.closeLocation >= 0.65) {
      patterns.push("bullish rejection-shaped candle");
    }
    if (current.upperWickRatio >= 0.5 &&
        current.bodyRatio <= 0.4 &&
        current.closeLocation <= 0.35) {
      patterns.push("bearish rejection-shaped candle");
    }
    return patterns;
  }

  function scoreVisibleSignals(candles) {
    return candles.map((current, index) => {
      const previous = candles[index - 1];
      const recent = candles.slice(Math.max(0, index - 5), index);
      const reasons = [];
      let score = 0;
      const bullish = current.direction === "bullish";

      if (previous) {
        const engulfing = bullish
          ? previous.direction === "bearish" &&
            current.openY >= previous.openY &&
            current.closeY <= previous.closeY &&
            current.bodyRatio >= 0.45
          : previous.direction === "bullish" &&
            current.openY <= previous.openY &&
            current.closeY >= previous.closeY &&
            current.bodyRatio >= 0.45;
        if (engulfing) {
          score += 2;
          reasons.push("engulfing shape");
        }
      }

      const rejection = bullish
        ? current.lowerWickRatio >= 0.45 &&
          current.bodyRatio <= 0.5 &&
          current.closeLocation >= 0.65
        : current.upperWickRatio >= 0.45 &&
          current.bodyRatio <= 0.5 &&
          current.closeLocation <= 0.35;
      if (rejection) {
        score += 2;
        reasons.push("wick rejection shape");
      }

      if (current.bodyRatio >= 0.68) {
        score += 1;
        reasons.push("strong body");
      }

      if (recent.length >= 3) {
        const breakout = bullish
          ? current.closeY < Math.min(...recent.map((candle) => candle.highY))
          : current.closeY > Math.max(...recent.map((candle) => candle.lowY));
        if (breakout) {
          score += 2;
          reasons.push("visible range break");
        }
      }

      if (recent.length >= 2) {
        const continuation = recent.slice(-2).every((candle) =>
          candle.direction === current.direction
        ) && (bullish
          ? current.closeY < recent.at(-1).closeY
          : current.closeY > recent.at(-1).closeY);
        if (continuation) {
          score += 1;
          reasons.push("3-bar momentum");
        }
      }

      return {
        x: current.x,
        direction: current.direction,
        highY: current.highY,
        lowY: current.lowY,
        signal: score >= 2 ? (bullish ? "bullish" : "bearish") : null,
        score,
        reasons
      };
    });
  }

  function parseVisibleOhlc(text) {
    const match = String(text).match(
      /(?:^|\n)O\s*([\d,]+(?:\.\d+)?)\s+H\s*([\d,]+(?:\.\d+)?)\s+L\s*([\d,]+(?:\.\d+)?)\s+C\s*([\d,]+(?:\.\d+)?)/m
    );
    if (!match) return null;
    const [open, high, low, close] = match.slice(1).map((value) => Number(value.replaceAll(",", "")));
    if (![open, high, low, close].every(Number.isFinite) ||
        high < Math.max(open, close) || low > Math.min(open, close) || low > high) {
      return null;
    }
    return { open, high, low, close };
  }

  function analyzeVisibleScreen(image) {
    const candles = extractVisibleCandles(image);
    const annotations = scoreVisibleSignals(candles);
    const bullishCount = candles.filter((candle) => candle.direction === "bullish").length;
    const bearishCount = candles.length - bullishCount;
    const recent = candles.slice(-8);
    const trend = recent.length < 2 ? "not enough visible bars"
      : recent.at(-1).closeY < recent[0].closeY ? "up on screen"
      : recent.at(-1).closeY > recent[0].closeY ? "down on screen"
      : "flat on screen";
    return {
      visibleBarCount: candles.length,
      bullishCount,
      bearishCount,
      trend,
      latestPatterns: visiblePatterns(candles),
      annotations,
      signalCount: annotations.filter((item) => item.signal).length,
      note: "Screen-pixel analysis only; historical values are relative pixels, not recovered prices."
    };
  }

  scope.VPAEdgeScreenAnalysis = Object.freeze({
    extractVisibleCandles,
    analyzeVisibleScreen,
    scoreVisibleSignals,
    parseVisibleOhlc
  });
})(globalThis);
