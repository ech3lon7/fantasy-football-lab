import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { feedback, type FeedbackKind } from "./settings";

// Sound and haptics are independent channels, both off unless the account turned them on.
export interface FeedbackSettings {
  sound: boolean;
  haptics: boolean;
  // The Player card entrances switch; on unless turned off.
  cardEntrances?: boolean;
}

export type Notify = (kind: FeedbackKind) => void;

// Components rendered outside the shell (tests, story-like previews) stay silent instead of failing.
const Context = createContext<Notify>(() => {});

// What the player card entrances need: whether they are allowed, and the sound and haptics switches.
export interface CardEntrances {
  enabled: boolean;
  sound: boolean;
  haptics: boolean;
}
const EntrancesContext = createContext<CardEntrances>({
  enabled: true,
  sound: false,
  haptics: false,
});
export const useCardEntrances = () => useContext(EntrancesContext);

export function FeedbackProvider({
  settings,
  children,
}: {
  settings: FeedbackSettings;
  children?: ReactNode;
}) {
  const notify = useMemo<Notify>(
    () => (kind) => feedback(kind, settings),
    [settings.sound, settings.haptics],
  );
  const entrances = useMemo<CardEntrances>(
    () => ({
      enabled: settings.cardEntrances !== false,
      sound: settings.sound,
      haptics: settings.haptics,
    }),
    [settings.cardEntrances, settings.sound, settings.haptics],
  );
  return (
    <Context.Provider value={notify}>
      <EntrancesContext.Provider value={entrances}>
        {children}
      </EntrancesContext.Provider>
    </Context.Provider>
  );
}

// One way for any control to say what happened, so the cue matches the Feel settings in force.
export function useFeedback(): Notify {
  return useContext(Context);
}

// Outcomes map to one cue each, so call sites cannot drift apart; the tests pin these three.
export const searchCue = (found: boolean): FeedbackKind =>
  found ? "success" : "caution";
export const importCue = (blockingIssues: number): FeedbackKind =>
  blockingIssues > 0 ? "caution" : "success";
export const actionCue = (ok: boolean): FeedbackKind =>
  ok ? "success" : "caution";
