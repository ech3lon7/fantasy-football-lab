import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { labTabs, type LabTab } from "../../domain/view/shell";
import { FeelSettings, type FeelValues } from "./Shell";
import { KeyboardList } from "./KeyboardReference";
import { defaultFilterShortcut, filterShortcut, filterShortcutProblem } from "./trade/filter-shortcut";
import { motion, useBoardMotion } from "./trade/board/board-motion";

// The Lab: model settings, evidence sources, audits, data and account, the keyboard reference and Feel, each a short page.
export function Lab({
  tab,
  settings,
  evidence,
  audits,
  account,
  feel,
  changeFeel,
  shortcut,
  changeShortcut,
}: {
  tab: LabTab;
  // Pages that need an imported dataset are null until one exists.
  settings: ReactNode | null;
  evidence: ReactNode | null;
  audits: ReactNode | null;
  account: ReactNode;
  feel: FeelValues;
  shortcut?: string;
  changeShortcut: (value: string) => void;
  changeFeel: (
    key: "theme" | "animation" | "sound" | "haptics" | "cardEntrances",
    value: string,
  ) => void;
}) {
  const [editingShortcut, setEditingShortcut] = useState(false);
  const [shortcutError, setShortcutError] = useState("");
  const bm = useBoardMotion();
  const errorRef = useRef<HTMLSpanElement>(null);
  // M26: a shortcut that is taken shakes its message and a chalk line is drawn under it.
  useLayoutEffect(() => {
    if (!shortcutError) return;
    bm.play("shortcut-shake", errorRef.current, motion.shake);
    bm.play("shortcut-line", errorRef.current?.querySelector(".gd-error-line path"), motion.errorLine, { silent: true });
  }, [shortcutError]);
  // Capture a new shortcut only while Change is active; Escape cancels it.
  useEffect(() => {
    if (!editingShortcut) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") { setEditingShortcut(false); setShortcutError(""); return; }
      const value = filterShortcut(event);
      if (!value) { setShortcutError("Press a key together with Ctrl, Alt, Shift or Meta."); return; }
      const problem = filterShortcutProblem(event);
      if (problem) { setShortcutError(problem); return; }
      changeShortcut(value); setShortcutError(""); setEditingShortcut(false);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [editingShortcut, changeShortcut]);
  const needsData = (
    <p className="gd-muted">Import a workbook to use this page.</p>
  );
  return (
    <div className="gd-lab">
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }} className="slide">
        <span className="kick" style={{ color: "var(--gd-muted)", fontSize: "14px", fontWeight: 700, textTransform: "uppercase" }}>
          Settings · audits · data
        </span>
        <h1 className="h-hero" style={{ fontSize: "54px", margin: 0 }}>
          The lab
        </h1>
      </div>
      <header className="gd-lab-head">
        <nav aria-label="Lab pages" className="gd-tabs">
          {labTabs.map((t) => (
            <a
              key={t.id}
              href={`#/lab/${t.id}`}
              role="tab"
              aria-selected={tab === t.id}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </header>
      <section
        className="gd-lab-page"
        aria-label={labTabs.find((t) => t.id === tab)?.label}
      >
        {tab === "settings" && (settings ?? needsData)}
        {tab === "evidence" && (evidence ?? needsData)}
        {tab === "audits" && (audits ?? needsData)}
        {tab === "data" && account}
        {tab === "keys" && (
          <div className="gd-card">
            <h3>Keyboard reference</h3>
            <KeyboardList shortcut={shortcut} />
            <div><span>Filter wheel shortcut</span> <kbd>{shortcut || defaultFilterShortcut}</kbd>{" "}
              <button type="button" onClick={() => setEditingShortcut(true)}>Change</button>{" "}
              <button type="button" onClick={() => changeShortcut(defaultFilterShortcut)}>Reset to Shift+Space</button>
              {editingShortcut && <span>Press a key combination; Escape cancels.</span>}
              {shortcutError && (
                <span role="alert" ref={errorRef} data-motion="M26" style={{ position: "relative", display: "inline-block", paddingBottom: 6 }}>
                  {shortcutError}
                  <svg className="gd-error-line" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"
                    style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: 6, overflow: "visible", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round" }}>
                    <path d="M2 3 C25 0 40 6 60 3 S90 2 98 3" pathLength={1} strokeDasharray={1} />
                  </svg>
                </span>
              )}
            </div>
          </div>
        )}
        {tab === "feel" && (
          <div
            className="gd-card gd-feel-page"
            role="group"
            aria-label="Feel settings"
          >
            <p className="gd-muted">
              Each setting is independent and syncs with your account.
            </p>
            <FeelSettings feel={feel} change={changeFeel} />
          </div>
        )}
      </section>
    </div>
  );
}
