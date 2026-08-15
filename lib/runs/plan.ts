/** Mode selection and chunking math (spec §4.1). Env-tunable; lowering
 *  MAX_INLINE_TOTAL_ROWS toward 0 degrades to pure batch mode by config. */

export interface RunPlanConfig {
  chunkSize: number;
  maxInlineTotalRows: number;
  maxBatchRows: number;
}

export function planConfigFromEnv(): RunPlanConfig {
  return {
    chunkSize: Math.min(100, Number(process.env.CHUNK_SIZE ?? 100) || 100),
    maxInlineTotalRows: Number(process.env.MAX_INLINE_TOTAL_ROWS ?? 5000) || 5000,
    maxBatchRows: Number(process.env.MAX_BATCH_ROWS ?? 50000) || 50000,
  };
}

export type RunMode = "inline" | "batch";

export interface RunPlan {
  mode: RunMode;
  chunks: Array<{ index: number; rowStart: number; rowCount: number }>;
}

export function planRun(effectiveRows: number, cfg: RunPlanConfig): RunPlan | { rejected: string } {
  if (effectiveRows <= 0) return { rejected: "no rows to run" };
  if (effectiveRows > cfg.maxBatchRows)
    return { rejected: `over the ${cfg.maxBatchRows.toLocaleString("en-US")}-row limit` };

  if (effectiveRows > cfg.maxInlineTotalRows) {
    return { mode: "batch", chunks: [] };
  }
  const chunks = [];
  for (let start = 0, i = 0; start < effectiveRows; start += cfg.chunkSize, i++) {
    chunks.push({ index: i, rowStart: start, rowCount: Math.min(cfg.chunkSize, effectiveRows - start) });
  }
  return { mode: "inline", chunks };
}

/** New-run estimates per the design: ≈2 credits/row, ≈1 min per chunk. */
export function estimate(effectiveRows: number, chunkSize = 100) {
  return {
    credits: effectiveRows * 2,
    minutes: Math.max(1, Math.ceil(effectiveRows / chunkSize)),
  };
}
