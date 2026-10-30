import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// Keep each search mounted while collapsed, preserving its own controls, worker and results; inert removes hidden controls from keyboard navigation.
export function SearchSection({
  title,
  note,
  open,
  toggle,
  children,
  compact = false,
  action,
}: {
  title: string;
  note?: string;
  open: boolean;
  toggle: () => void;
  children: ReactNode;
  compact?: boolean;
  action?: ReactNode;
}) {
  const id = useId();
  return (
    <section
      className={`panel search-section${compact ? " trade-finder-section" : ""}`}
      hidden={compact && !open}
    >
      <div className="panel-head">
        <div>
          <h2>
            {compact ? (
              title
            ) : (
              <button
                className="search-section-toggle"
                aria-expanded={open}
                aria-controls={id}
                onClick={toggle}
              >
                {title}
                <ChevronDown size={20} aria-hidden="true" />
              </button>
            )}
          </h2>
          {note && <p>{note}</p>}
        </div>
        {action}
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
