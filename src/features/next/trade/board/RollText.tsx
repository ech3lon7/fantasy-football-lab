import { useLayoutEffect, useRef, type HTMLAttributes } from "react";
import { motion, useBoardMotion } from "./board-motion";

// Text that rolls in (120 ms) whenever it changes (M21), and a number that counts to its new value (250 ms) as it is written
// straight into the element. Neither one puts a frame of the animation through React.
export function RollText({
  text,
  motionId = "M21",
  ...rest
}: { text: string; motionId?: string } & Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(text);
  const bm = useBoardMotion();
  useLayoutEffect(() => {
    if (last.current === text) return;
    last.current = text;
    bm.play(`roll-${motionId}`, ref.current, motionId === "M17" ? motion.counterRoll : motion.countRoll, { silent: true });
  }, [text]);
  return (
    <span ref={ref} data-motion={motionId} {...rest}>
      {text}
    </span>
  );
}

export function CountText({
  value,
  format = (n: number) => n.toLocaleString(),
  motionId = "M5",
  ...rest
}: { value: number; format?: (n: number) => string; motionId?: string } & Omit<HTMLAttributes<HTMLSpanElement>, "children">) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const bm = useBoardMotion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    shown.current = value;
    if (from === value) {
      el.textContent = format(value);
      return;
    }
    return bm.tweenText(el, from, value, format, `tween-${motionId}`);
  }, [value]);
  // The text is written by the effect, never by React, so a counting number is not overwritten halfway.
  return <span ref={ref} data-motion={motionId} {...rest} />;
}
