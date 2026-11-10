import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { focusableSelector, trapIndex } from "./keys";

interface Entry {
  key: number;
  title: string;
  width: number;
  flush: boolean;
  onClose?: () => void;
  // The element that had focus when the popover opened; focus returns there on close.
  opener: HTMLElement | null;
  render: (close: () => void) => ReactNode;
}

interface Api {
  open: (options: {
    title: string;
    width?: number;
    flush?: boolean;
    // Runs once after the popover has been removed, however it was closed.
    onClose?: () => void;
    render: (close: () => void) => ReactNode;
  }) => number;
  close: (key?: number) => void;
}

const PopoverContext = createContext<Api | null>(null);

// Give any component the stack's open and close functions.
export function usePopovers(): Api {
  const api = useContext(PopoverContext);
  if (!api) throw new Error("usePopovers needs a PopoverProvider");
  return api;
}

// One dialog in the stack: moves focus in on open and keeps Tab inside it.
function Dialog({
  entry,
  top,
  close,
}: {
  entry: Entry;
  top: boolean;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Focus the first control (or the dialog itself) once, when this dialog first appears.
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(focusableSelector);
    (first ?? ref.current)?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="gd-popover-layer" inert={!top}>
      <div className="gd-backdrop" onClick={top ? close : undefined} />
      <div
        ref={ref}
        className={`gd-popover${entry.flush ? " flush" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={entry.title}
        tabIndex={-1}
        style={{ maxWidth: entry.width }}
        onKeyDown={(e) => {
          if (e.key !== "Tab" || !ref.current) return;
          const items = [
            ...ref.current.querySelectorAll<HTMLElement>(focusableSelector),
          ];
          if (items.length === 0) {
            e.preventDefault();
            return;
          }
          const at = items.indexOf(document.activeElement as HTMLElement);
          const next = trapIndex(at, items.length, e.shiftKey);
          // Only intercept at the ends; browsers handle the middle of the cycle normally.
          const atEnd = e.shiftKey ? at <= 0 : at === items.length - 1;
          if (atEnd || at < 0) {
            e.preventDefault();
            items[next].focus();
          }
        }}
      >
        <button
          type="button"
          className="gd-popover-close"
          aria-label="Close"
          onClick={close}
        >
          ×
        </button>
        {entry.render(close)}
      </div>
    </div>
  );
}

// Render popovers above the page: Escape closes only the top one, and focus returns to each opener.
export function PopoverProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([]),
    // Keep the list in a ref too, so closing can run side effects outside a state updater.
    list = useRef<Entry[]>([]),
    next = useRef(1);
  const commit = (entries: Entry[]) => {
    list.current = entries;
    setStack(entries);
  };
  const close = useCallback((key?: number) => {
    const target = key ?? list.current[list.current.length - 1]?.key;
    const entry = list.current.find((e) => e.key === target);
    if (!entry) return;
    commit(list.current.filter((e) => e.key !== target));
    // Return focus after the dialog unmounts so it lands on the opener, not on the closing dialog.
    requestAnimationFrame(() => {
      if (entry.opener?.isConnected)
        entry.opener.focus({ preventScroll: true });
    });
    entry.onClose?.();
  }, []);
  const open = useCallback<Api["open"]>(
    ({ title, width, flush, onClose, render }) => {
      const key = next.current++;
      const opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      commit([
        ...list.current,
        {
          key,
          title,
          width: width ?? 1040,
          flush: !!flush,
          onClose,
          opener,
          render,
        },
      ]);
      return key;
    },
    [],
  );
  const api = useMemo(() => ({ open, close }), [open, close]);
  // Escape closes only the top popover, then the one beneath on the next press.
  useEffect(() => {
    if (stack.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [stack.length, close]);
  return (
    <PopoverContext.Provider value={api}>
      {children}
      {stack.map((entry, i) => (
        <Dialog
          key={entry.key}
          entry={entry}
          top={i === stack.length - 1}
          close={() => close(entry.key)}
        />
      ))}
    </PopoverContext.Provider>
  );
}
