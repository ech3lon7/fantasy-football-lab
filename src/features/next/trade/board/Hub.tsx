import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { HUB_FONT_MAX, fitFontSize } from "./fit-text";
import { motion, useBoardMotion } from "./board-motion";

// The width, in design pixels, the hub's value may use inside the inner circle without touching a segment label.
const HUB_BOX = 140;

// The width of a text in Permanent Marker at the largest hub size, measured once per text.
const widths = new Map<string, number>();
function measure(text: string): number {
  const cached = widths.get(text);
  if (cached !== undefined) return cached;
  const probe = document.createElement("span");
  probe.textContent = text;
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;font-size:${HUB_FONT_MAX}px;font-family:var(--gw-marker)`;
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  widths.set(text, width);
  return width;
}

// The hub, display-only: "pick a category" while nothing is pointed at; otherwise the category name, its current value (Permanent
// Marker, auto-fitting from 48px down to 28px) and one hides line. With a category open, clicking the hub goes back one level.
export function Hub({
  idle,
  name,
  line,
  value,
  hides,
  onBack,
}: {
  idle: boolean;
  name: string;
  // An explanation under the name, such as what MPPG means.
  line?: string;
  value: string;
  hides: ReactNode;
  onBack?: () => void;
}) {
  const [size, setSize] = useState(HUB_FONT_MAX);
  const bm = useBoardMotion();
  const valueRef = useRef<HTMLDivElement>(null);
  const last = useRef(value);
  useLayoutEffect(() => {
    if (idle) return;
    setSize(fitFontSize(measure(value), HUB_BOX));
  }, [value, idle]);
  // The value rolls in when it changes (M7).
  useLayoutEffect(() => {
    if (last.current === value) return;
    last.current = value;
    bm.play("hub-roll", valueRef.current, motion.roll, { silent: true });
  }, [value]);
  const style = { ["--zb-fs" as string]: size } as CSSProperties;
  if (idle)
    return (
      <div className="gd-zb-hub" data-idle="">
        <span className="gd-zh-idle">pick a category</span>
      </div>
    );
  const body = (
    <>
      <span className="gd-zh-name">{name}</span>
      {line && <span className="gd-zh-line">{line}</span>}
      <span className="gd-zh-value" ref={valueRef} data-motion="M7" style={style}>{value}</span>
      <span className="gd-zh-hides">{hides}</span>
    </>
  );
  return onBack ? (
    <button type="button" className="gd-zb-hub" aria-label={`Back from ${name.toLowerCase()}`} onClick={onBack} style={style}>
      {body}
    </button>
  ) : (
    <div className="gd-zb-hub" style={style}>
      {body}
    </div>
  );
}
