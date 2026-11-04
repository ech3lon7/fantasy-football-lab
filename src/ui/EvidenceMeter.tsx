import { Check, X, Minus } from "lucide-react";
import type { EvidenceComparison } from "../domain/evidence-comparison";
import { evidenceMeter } from "../domain/evidence-meter";

// Symbols retain explicit accessible names; unavailable or unresolved evidence is never rendered as a failed check.
export function EvidenceStatus({
  status,
  numeric = false,
}: {
  status: string;
  numeric?: boolean;
}) {
  const passed = status === "PASS",
    failed = status === "FAIL";
  const Icon = passed ? Check : failed ? X : Minus;
  return (
    <span
      role="img"
      aria-label={`${numeric ? "Threshold" : "Check"} ${passed ? "met" : failed ? "not met" : status === "UNRESOLVED" ? "unresolved" : "unavailable"}`}
      className={`evidence-status ${passed ? "evidence-status--met" : failed ? "evidence-status--missed" : "muted"}`}
    >
      <Icon size={14} strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

// Context rows can contain several engine statuses; replace only those tokens while preserving names, numbers and weeks.
export function EvidenceText({ text }: { text: string }) {
  return text.split(/\b(PASS|FAIL|UNKNOWN|UNRESOLVED)\b/).map((part, i) =>
    /^(PASS|FAIL|UNKNOWN|UNRESOLVED)$/.test(part) ? (
      <EvidenceStatus key={i} status={part} />
    ) : (
      part
    ),
  );
}

// The two markers use domain-owned numeric metadata. Exact text and margin remain visible even when the marker is clipped at an axis end.
export function EvidenceMeter({
  comparison,
  tag,
  check,
  kind,
  requiredKind,
  status,
  remainingWeeks,
  showStatus = true,
}: {
  comparison: EvidenceComparison;
  tag: string;
  check: string;
  kind: string;
  requiredKind: string;
  status?: string;
  remainingWeeks?: number;
  showStatus?: boolean;
}) {
  const meter = evidenceMeter(comparison, tag, check, remainingWeeks);
  // A compound row's unresolved eligibility must not hide an independently known numeric cutoff.
  const unknown = comparison.condition
    ? comparison.condition === "UNKNOWN" || comparison.condition === "WAIVED"
    : status === "UNKNOWN";
  return (
    <div className="evidence-comparison">
      {comparison.note && (
        <small className="evidence-note">{comparison.note}</small>
      )}
      <div className="evidence-meter-numbers">
        <span>
          {comparison.condition ? "Actual" : "Player"}{" "}
          <strong
            className={comparison.actual === "Unavailable" ? "muted" : kind}
          >
            {comparison.actual}
          </strong>
        </span>
        <span>
          {comparison.condition ? "Required" : "Threshold"}{" "}
          <strong
            className={
              comparison.required === "Unavailable" ? "muted" : requiredKind
            }
          >
            {comparison.required}
          </strong>
        </span>
        {showStatus && comparison.condition !== "WAIVED" && (
          <EvidenceStatus
            numeric={!comparison.condition}
            status={
              !meter || unknown ? "UNKNOWN" : meter.qualifies ? "PASS" : "FAIL"
            }
          />
        )}
      </div>
      {meter && !unknown ? (
        <>
          <div
            className="evidence-meter-track"
            role="meter"
            aria-label={`${check}${comparison.note ? `: ${comparison.note}` : ""}`}
            aria-valuemin={meter.low}
            aria-valuemax={meter.high}
            aria-valuenow={meter.bounded}
            aria-valuetext={
              comparison.condition
                ? `${comparison.actual}; required: ${comparison.required}; ${comparison.margin}. Binary eligibility check, not a performance score.`
                : `Player ${comparison.actual}; threshold ${comparison.required}; ${comparison.margin}. ${meter.favorableIncreases ? "Higher" : "Lower"} is more favorable. ${meter.outside}`
            }
          >
            <span
              className="evidence-meter-threshold"
              aria-hidden="true"
              style={{ left: `${meter.thresholdPosition}%` }}
            />
            <span
              className="evidence-meter-player"
              aria-hidden="true"
              style={{ left: `${meter.playerPosition}%` }}
            />
          </div>
          <div
            className="evidence-meter-axis"
            title={
              comparison.condition
                ? "Binary eligibility: not met to met"
                : `${meter.favorableIncreases ? "Higher" : "Lower"} is more favorable`
            }
          >
            <span>{meter.leftLabel}</span>
            <span>{meter.rightLabel}</span>
          </div>
          {meter.outside && (
            <small className="muted">
              {meter.outside}; the exact player value is shown above.
            </small>
          )}
        </>
      ) : (
        <div className="evidence-meter-unavailable muted">
          {/* Missing or waived requirements retain a neutral track without pretending the player failed. */}
          <div
            className="evidence-meter-track evidence-meter-track--unavailable"
            role="img"
            aria-label={`${check}${comparison.note ? `: ${comparison.note}` : ""}: ${comparison.condition === "WAIVED" ? "waived" : "unavailable"}`}
          />
          <small>
            {comparison.condition === "WAIVED"
              ? "Waived — not required"
              : "Insufficient verified evidence"}
          </small>
        </div>
      )}
      <small
        className={comparison.margin === "Unavailable" ? "muted" : "model"}
      >
        {comparison.condition
          ? comparison.margin
          : `Margin: ${comparison.margin}`}
      </small>
    </div>
  );
}
