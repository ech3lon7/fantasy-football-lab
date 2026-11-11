import type { ReactNode } from "react";
import { barPositions, isEdited, type Range } from "../domain/view/primitives";

// Surface container that uses the theme's card background.
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`gd-card ${className}`.trim()}>{children}</section>
  );
}

// Small rounded button for secondary actions.
export function Pill({
  children,
  onClick,
  pressed,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="gd-pill"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// Segmented choice whose selected option uses the shared yellow selected state.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  format,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  // Optional display text per option; defaults to the capitalised option.
  format?: (option: T) => string;
}) {
  return (
    <div className="gd-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {format ? format(option) : option[0].toUpperCase() + option.slice(1)}
        </button>
      ))}
    </div>
  );
}

export type ChipTone = "neutral" | "positive" | "negative" | "warning";

// Status chip; the text always carries the meaning, colour only reinforces it.
export function Chip({
  tone = "neutral",
  children,
  title,
}: {
  tone?: ChipTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`gd-chip-tag gd-chip-${tone}`} title={title}>
      {children}
    </span>
  );
}

// Group of settings that folds to one line summarising its current values; the edited marker stays visible when folded.
export function FoldingGroup({
  title,
  summary,
  open,
  onToggle,
  edited = false,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  edited?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="gd-fold">
      <h3>
        <button
          type="button"
          className="gd-fold-head"
          aria-expanded={open}
          onClick={() => onToggle(!open)}
        >
          <span className="gd-fold-title">{title}</span>
          {edited && (
            <span className="gd-edited" title="Changed from the default">
              ■ edited
            </span>
          )}
          {!open && <span className="gd-fold-summary">{summary}</span>}
        </button>
      </h3>
      {open && <div className="gd-fold-body">{children}</div>}
    </section>
  );
}

// Range slider with an "edited" marker when the value differs from its default; the native control follows the theme.
export function RangeSlider({
  label,
  value,
  fallback,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  fallback: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  // Optional display text for the current value, such as "Off" at zero.
  format?: (value: number) => string;
}) {
  return (
    <label className="gd-slider">
      <span>
        {label}
        {isEdited(value, fallback) && (
          <span className="gd-edited"> ■ edited</span>
        )}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{format ? format(value) : value}</output>
    </label>
  );
}

// Floor-to-ceiling bar with the expected value marked; unavailable values show a quiet dash with the reason, never a zero bar.
export function FloorCeilingBar({
  range,
  scale,
  unavailableReason = "Range unavailable",
}: {
  range: Range;
  scale: { min: number; max: number };
  unavailableReason?: string;
}) {
  const at = barPositions(range, scale);
  if (!at)
    return (
      <span className="gd-range-na" title={unavailableReason} tabIndex={0}>
        —
      </span>
    );
  return (
    <span
      className="gd-range"
      role="img"
      aria-label={`Floor ${range.floor?.toFixed(1)}, expected ${range.expected?.toFixed(1)}, ceiling ${range.ceiling?.toFixed(1)}`}
    >
      <span
        className="gd-range-span"
        style={{ left: `${at.floor}%`, width: `${at.width}%` }}
      />
      <span className="gd-range-mark" style={{ left: `${at.expected}%` }} />
    </span>
  );
}

// Placeholder block shown while a calculation finishes; motion stops under Reduced and Off.
export function Skeleton({
  width = "100%",
  height = 16,
}: {
  width?: string | number;
  height?: number;
}) {
  return (
    <span
      className="gd-skeleton"
      aria-hidden="true"
      style={{ width, height }}
    />
  );
}
