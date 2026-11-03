// Badge rendering and positive-only screening share one classification so red labels cannot slip through the filter.
export const signalAppearance = (text: string) =>
  text === "Gem" || text === "Gem candidate"
    ? "candidate"
    : text === "Pre-gem"
      ? "pre-gem"
      : /watch$/i.test(text)
        ? "watch"
        : text === "BUY LOW"
          ? "buy-low"
          : /caution|SELL HIGH|issue|FAIL|UNAVAILABLE|Reduced workload|No breakout signal|No gem signal|Insufficient data|Limited history|Projection only/i.test(
                text,
              )
            ? "caution"
            : /Emerging|Conditional|CONDITIONAL/.test(text)
              ? "conditional"
              : "";
