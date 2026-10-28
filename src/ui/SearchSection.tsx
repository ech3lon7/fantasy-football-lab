import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// Keep each search mounted while collapsed, preserving its own controls, worker and results; inert removes hidden controls from keyboard navigation.
export function SearchSection({
  title,
  note,
  open,
  toggle,
  children,
}: {
  title: string;
  note?: string;
  open: boolean;
  toggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="panel search-section">
      <div className="panel-head">
        <div>
          <h2>
            <button
              className="search-section-toggle"
              aria-expanded={open}
              aria-controls={id}
              onClick={toggle}
            >
              {title}
              <ChevronDown size={20} aria-hidden="true" />
            </button>
          </h2>
          {note && <p>{note}</p>}
        </div>
      </div>
      <div
        id={id}
        className={`search-section-content${open ? " is-open" : ""}`}
        inert={!open}
      >
        <div>
          <div className="search-section-body">{children}</div>
        </div>
      </div>
    </section>
  );
}
