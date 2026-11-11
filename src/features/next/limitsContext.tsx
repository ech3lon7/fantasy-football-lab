import { createContext, useContext } from "react";
import type { SearchLimits } from "../../domain/search-limits";

// The shared search limits, provided only by the Gameday Plus Trade room; null leaves the current controls in charge.
export const SearchLimitsContext = createContext<SearchLimits | null>(null);

// Read the shared limits in Find trades and the Chain planner.
export const useSearchLimits = () => useContext(SearchLimitsContext);
