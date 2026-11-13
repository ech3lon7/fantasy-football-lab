// A grade letter on the shared six-step scale; the letter is always shown, never colour alone.
export function GradeBadge({
  grade,
  tone,
}: {
  grade: string;
  tone: number | null;
}) {
  return (
    <span
      className="gd-grade"
      data-tone={tone ?? "na"}
      title={tone === null ? "Grade unavailable" : `Grade ${grade}`}
    >
      {grade === "n.a." ? "N/A" : grade}
    </span>
  );
}
