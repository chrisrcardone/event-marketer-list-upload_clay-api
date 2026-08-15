/** Shared run/monitor payload types (API ⇄ screens). */

export type RunStatus =
  | "draft"
  | "queued"
  | "uploading"
  | "validating"
  | "running"
  | "finalizing"
  | "complete"
  | "completed_with_failures"
  | "validation_failed"
  | "failed"
  | "expired";

export interface ChunkView {
  index: number;
  rowCount: number;
  finished: number;
  status: "queued" | "starting" | "running" | "complete" | "failed";
}

export interface RunView {
  id: string;
  runName: string;
  fileName: string;
  status: RunStatus;
  mode: "inline" | "batch" | null;
  campaignId: string;
  campaignName: string;
  campaignUrl: string;
  campaignMemberStatus: string;
  totalRows: number;
  effectiveRows: number;
  droppedBeforeUpload: number;
  finishedRows: number;
  writtenRows: number;
  failedRows: number;
  skippedRows: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  lastProgressAt: string | null;
  rateLimitedUntil: string | null;
  stalled: boolean;
  chunks: ChunkView[];
  failureGroups: Array<{ label: string; count: number }>;
  validationErrors: Array<{ line: number; field: string; message: string }> | null;
  validationTotalInvalid: number | null;
  error: string | null;
  retryOfRunId: string | null;
}

export interface ResultRowView {
  id: number;
  originalRowNumber: number;
  chunkIndex: number | null;
  name: string;
  email: string;
  phone: string;
  status: "pending" | "written" | "failed" | "skipped";
  reason: string;
  salesforceUrl: string;
}
