// Standard normal CDF using the Abramowitz and Stegun erf approximation (error below 1.5e-7).
export function normalCdf(x: number): number {
  // The approximation is off by about 5e-10 at zero; the centre is exact.
  if (x === 0) return 0.5;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
    t;
  const erf = 1 - poly * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

// Combine independent spreads: the root of the sum of their squares.
export function combineSpreads(spreads: number[]): number {
  return Math.sqrt(spreads.reduce((total, s) => total + s * s, 0));
}

export interface Estimate {
  mean: number | null;
  spread: number | null;
}

// The chance that A outscores B, treating each score as independent and normal around its mean with its spread.
// Any missing value, or no variability at all, gives null: no figure is shown rather than a made-up one.
export function outscoreProbability(a: Estimate, b: Estimate): number | null {
  if (a.mean === null || b.mean === null) return null;
  if (a.spread === null || b.spread === null) return null;
  const combined = combineSpreads([a.spread, b.spread]);
  if (!(combined > 0)) return null;
  return normalCdf((a.mean - b.mean) / combined);
}

// A plain reading of a probability; the same wording is used for players and for lineups.
export function oddsReading(p: number): string {
  const edge = Math.abs(p - 0.5);
  return edge < 0.05
    ? "close to a coin flip"
    : edge < 0.15
      ? "a modest edge"
      : "a clear edge";
}

export const oddsCaveat =
  "An estimate from past variability, treating each score as independent. It is not a prediction.";
