import { useEffect, useState, type ReactNode } from "react";
import { labTabs, type LabTab } from "../../domain/view/shell";
import { FeelSettings, type FeelValues } from "./Shell";
import { KeyboardList } from "./KeyboardReference";
import { defaultFilterShortcut, filterShortcut, filterShortcutProblem } from "./trade/filter-shortcut";

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
              {shortcutError && <span role="alert">{shortcutError}</span>}
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
