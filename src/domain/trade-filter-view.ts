import { filterTradeRows, sortTradeRows, type FilterableTrade, type TradeFilters } from "./trade-filters";

// Reuse a captured result set for each filter or sort change; no player evaluation runs here.
export function tradeFilterView<T extends FilterableTrade>(
  rows: T[],
  filters: TradeFilters,
  sort: Parameters<typeof sortTradeRows>[1],
  showHidden: boolean,
  protectedIds: string[] = [],
) {
  const result = filterTradeRows(rows, filters, protectedIds);
  return {
    visible: sortTradeRows(result.visible, sort),
    hidden: showHidden ? result.hidden : [],
    counts: result.counts,
    only: result.only,
    total: rows.length,
  };
}
