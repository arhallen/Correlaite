/** Credit prices. Pure constants/functions so the frontend text and the charging code cannot drift apart. */
export const PRICING = {
  initialCredits: 100,
  downloadCost: 5, // downloading a new file; using existing files is free
  runBase: 10, // every sandbox run
  runPerSecond: 5, // per started second of execution
  minToRun: 15, // a sandbox cannot be started with less than this
} as const;

export const PACKS = [
  { id: 'small', credits: 100, priceCents: 500 },
  { id: 'medium', credits: 500, priceCents: 2000 },
  { id: 'large', credits: 1000, priceCents: 3500 },
] as const;

/** 10 credits per run + 5 per second, rounded up to whole seconds. */
export function runCost(durationMs: number): number {
  const seconds = Math.max(0, Math.ceil(durationMs / 1000));
  return PRICING.runBase + PRICING.runPerSecond * seconds;
}
