import HistoryDetail from "./HistoryDetail";
import { formatDateTime, formatSimulationType } from "../utils/format";
import { formatJobStatus, simulationJobToHistoryItem } from "../utils/jobAdapters";

export default function JobResultDetail({
  job,
  onDiscard,
  onOpenHistory,
  onPreviewLoadingChange,
  onSave,
  result,
}) {
  const status = String(job.status || "").toLowerCase();
  const isSucceeded = status === "succeeded";
  const isSaved = Boolean(job.result_run_id);
  const detailItem = simulationJobToHistoryItem(job, result);

  return (
    <div className="queue-result-detail">
      <div className="queue-result-actions">
        <dl className="detail-grid">
          <dt>Queue status</dt><dd>{formatJobStatus(job)}</dd>
          <dt>Queued</dt><dd>{formatDateTime(job.queued_at)}</dd>
          <dt>Finished</dt><dd>{formatDateTime(job.finished_at)}</dd>
        </dl>
        <div>
          <button
            className="primary-button"
            type="button"
            disabled={!isSucceeded || isSaved}
            onClick={onSave}
          >
            {isSaved ? "Saved to history" : "Save to history"}
          </button>
          {isSaved && onOpenHistory && (
            <button className="ghost-button" type="button" onClick={onOpenHistory}>
              Open history
            </button>
          )}
          <button
            className="ghost-button danger-button"
            type="button"
            disabled={status === "running"}
            onClick={onDiscard}
          >
            {isSaved ? "Remove queue entry" : "Discard result"}
          </button>
        </div>
      </div>
      {isSucceeded && result ? (
        <HistoryDetail
          item={detailItem}
          onPreviewLoadingChange={onPreviewLoadingChange}
        />
      ) : (
        <>
          <strong>{formatSimulationType(job.simulation_type)}</strong>
          <p className="history-status error-text">
            {job.error_message || result?.error || "This simulation has not produced a result yet."}
          </p>
        </>
      )}
    </div>
  );
}
