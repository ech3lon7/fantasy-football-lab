import { createContext, useContext } from "react";
import type { SearchLimits } from "../../domain/search-limits";
import type { PositionalGradeImpactRule } from "../../domain/chain-position-impact";

// The shared search limits, provided only by the Gameday Plus Trade room; null leaves the current controls in charge.
export const SearchLimitsContext = createContext<SearchLimits | null>(null);

// Read the shared limits in Find trades and the Chain planner.
export const useSearchLimits = () => useContext(SearchLimitsContext);

// A plain-language reading of a grade goal; null outside the Trade room so current controls show nothing extra.
export const GradeGoalContext = createContext<
  ((rule: PositionalGradeImpactRule) => string) | null
>(null);
export const useGradeGoalSentence = () => useContext(GradeGoalContext);

// Remembers which filter groups were left open, in the existing filter record; null outside the Trade room.
export interface FoldMemory {
  isOpen: (title: string) => boolean;
  set: (title: string, open: boolean) => void;
}
export const FoldMemoryContext = createContext<FoldMemory | null>(null);
export const useFoldMemory = () => useContext(FoldMemoryContext);
