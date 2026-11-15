import { useEffect, useRef, useState } from "react";
import { motionLevel, tween } from "./chalk-motion";

// A number that counts to its new value at Full motion (A11, A14) and simply changes at Reduced and Off.
export function TweenCount({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  current.current = shown;
  useEffect(
    () => tween(current.current, value, motionLevel(), setShown),
    [value],
  );
  return <>{shown.toLocaleString()}</>;
}
