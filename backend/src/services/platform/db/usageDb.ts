// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest,
  saveRequestUsage,
  appendRequestLog,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
} from "./index.ts";
