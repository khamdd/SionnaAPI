import { formatDateTime, formatSimulationType, formatText } from "../utils/format";
import { formatJobStatus } from "../utils/jobAdapters";
import { TrashIcon } from "./Icons";
import { BulkDeletePanel } from "./HistoryPanel";

function QueueRow({
  isLoading,
  isSelected,
  isSelectedForDelete,
  job,
  onDiscard,
  onOpen,
  onOpenHistory,
  onSave,
  onToggleDeleteSelection,
}) {
  const status = String(job.status || "").toLowerCase();
  const isSucceeded = status === "succeeded";
  const isRunning = status === "running";
  const isQueued = status === "queued";
  const isSaved = Boolean(job.result_run_id);
  const canOpen = isSucceeded || status === "failed";
  const canDiscard = !isRunning;

  return (
    <div className="queue-row">
      <label
        className="history-select"
        title={isRunning ? "Running jobs cannot be deleted" : "Select queue entry for bulk deletion"}
      >
        <input
          type="checkbox"
          checked={isSelectedForDelete}
          disabled={isLoading || isRunning}
          aria-label={`Select ${formatSimulationType(job.simulation_type)} queue entry`}
          onChange={() => onToggleDeleteSelection(job.id)}
        />
      </label>
      <button
        className={`history-item ${isSelected ? "active" : ""}`}
        type="button"
        disabled={isLoading || !canOpen}
        onClick={() => onOpen(job.id)}
      >
        <strong>{formatSimulationType(job.simulation_type)} - {formatJobStatus(job)}</strong>
        <span>{formatDateTime(job.queued_at)}</span>
        <span>{formatText(job.scene?.name || job.scene?.id)}{isQueued || isRunning ? " | Waiting for worker" : ""}</span>
      </button>
      <button
        className="history-compare"
        type="button"
        disabled={isLoading || !isSucceeded || isSaved}
        onClick={() => onSave(job)}
      >
        {isSaved ? "Saved" : "Save"}
      </button>
      <button
        className="ghost-button queue-open-history"
        type="button"
        disabled={isLoading || !isSaved}
        onClick={() => onOpenHistory(job.result_run_id)}
      >
        History
      </button>
      <button
        className="history-delete queue-discard"
        type="button"
        title={isSaved ? "Remove queue entry" : "Discard simulation result"}
        aria-label={isSaved ? "Remove queue entry" : "Discard simulation result"}
        disabled={isLoading || !canDiscard}
        onClick={() => onDiscard(job)}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

export default function QueueRoutePage({
  isLoading,
  jobError,
  jobs,
  jobStatus,
  onDiscard,
  onDeleteSelected,
  onOpen,
  onOpenHistory,
  onRefresh,
  onSave,
  onToggleDeleteSelection,
  onToggleSelectAll,
  selectedDeleteIds,
  selectedJobId,
}) {
  const deletableJobs = jobs.filter((job) => (
    String(job.status || "").toLowerCase() !== "running"
  ));
  const allSelected = deletableJobs.length > 0 && deletableJobs.every((job) => (
    selectedDeleteIds.has(job.id)
  ));
  const someSelected = selectedDeleteIds.size > 0 && !allSelected;

  return (
    <main className="route-page">
      <div className="page-title with-action">
        <div>
          <h1>Simulation Queue</h1>
          <p>Track submitted simulations, inspect completed results, then save only the results you want in history.</p>
        </div>
        <button className="ghost-button" type="button" disabled={isLoading} onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <section className="history-page-panel queue-page-panel">
        <div className="history-view">
          <p className={`history-status ${jobError ? "error-text" : ""}`}>{jobStatus}</p>
          <BulkDeletePanel
            allSelected={allSelected}
            isLoading={isLoading}
            itemCount={deletableJobs.length}
            onDeleteSelected={onDeleteSelected}
            onToggleSelectAll={onToggleSelectAll}
            selectedCount={selectedDeleteIds.size}
            someSelected={someSelected}
          />
          <div className="history-list">
            {jobs.map((job) => (
              <QueueRow
                key={job.id}
                isLoading={isLoading}
                isSelected={job.id === selectedJobId}
                isSelectedForDelete={selectedDeleteIds.has(job.id)}
                job={job}
                onDiscard={onDiscard}
                onOpen={onOpen}
                onOpenHistory={onOpenHistory}
                onSave={onSave}
                onToggleDeleteSelection={onToggleDeleteSelection}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
