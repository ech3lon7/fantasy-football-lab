// Compare the same weekly starters used by EPPG; missing MPPG stays unavailable rather than becoming zero.
export function lineupFilterEvidence(
  weekly: { week: number; beforeIds: (string | null)[]; ids: (string | null)[] }[],
  currentWeek: number, incoming: string[], mppg: ReadonlyMap<string, number | null>,
  cachedBeforeMppg?: number | null,
) {
  const startsEveryWeek = weekly.length > 0 && weekly.every((week) => incoming.every((id) => week.ids.includes(id)));
  const current = weekly.find((week) => week.week === currentWeek);
  const total = (ids: (string | null)[]) => {
    let sum = 0;
    for (const id of ids) if (id !== null) {
      const value = mppg.get(id);
      if (value == null || !Number.isFinite(value)) return null;
      sum += value;
    }
    return sum;
  };
  const before = cachedBeforeMppg !== undefined ? cachedBeforeMppg : (current ? total(current.beforeIds) : null);
  const after = current ? total(current.ids) : null;
  return { startsEveryWeek, weekGain: before === null || after === null ? null : after - before };
}
