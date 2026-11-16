// Click-outside for the open category: a pointer-down that lands inside the wheel's ring, the right zone or the left rail is not
// "outside"; anything else (empty chalk on the board, or anywhere off the board) is, and goes back one level.
export interface Zone {
  contains: (node: Node) => boolean;
}

export function isOutside(target: EventTarget | null, zones: (Zone | null | undefined)[]): boolean {
  if (!(target instanceof Node)) return false;
  return !zones.some((zone) => zone?.contains(target));
}
