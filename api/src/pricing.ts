/** Credit prices. Pure constants/functions so the frontend text and the charging code cannot drift apart. */
export const PRICING = {
  initialCredits: 100,
  downloadCost: 5, // downloading a new file; using existing files is free
  accessCost: 1, // one-time access to a file someone else already downloaded (use + view as often as you like)
  runBase: 10, // every sandbox run
  runPerSecond: 5, // per started second of execution
  runMax: 25, // a run never costs more than this
  minToRun: 15, // a sandbox cannot be started with less than this
} as const;

// Prices in US dollar cents.
export const PACKS = [
  { id: 'small', credits: 50, priceCents: 500 },
  { id: 'medium', credits: 110, priceCents: 1000 },
  { id: 'large', credits: 1250, priceCents: 10000 },
] as const;

/** 10 credits per run + 5 per second, rounded up to whole seconds, at most 25. */
export function runCost(durationMs: number): number {
  const seconds = Math.max(0, Math.ceil(durationMs / 1000));
  return Math.min(PRICING.runMax, PRICING.runBase + PRICING.runPerSecond * seconds);
}
