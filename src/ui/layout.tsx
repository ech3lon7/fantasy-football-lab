import type { ReactNode } from "react";
import { type Dataset, str } from "../domain/contracts";
export function Select({
  label,
  value,
  change,
  children,
}: {
  label: string;
  value: string;
  change: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="control">
      <span>{label}</span>
      <select value={value} onChange={(e) => change(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
export function TeamsOptions({ d }: { d: Dataset }) {
  return (
    <>
      {d.tables.ModelTeams.map((t) => (
        <option key={str(t.TeamID)} value={str(t.TeamID)}>
          {str(t.TeamName)}
        </option>
      ))}
    </>
  );
}
export function Panel({
  title,
  note,
  children,
  action,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
