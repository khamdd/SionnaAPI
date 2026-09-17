import { useCallback, useEffect, useState } from "react";

import { cancelSimulationJob, deleteSimulationJob, listSimulationJobs } from "../api";
import { toggleSetValue } from "../utils/collections";

const JOB_PAGE_LIMIT = 200;

export default function useSimulationQueue({ enabled, route }) {
  const [error, setError] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [progressLabel, setProgressLabel] = useState("");
  const [selectedDeleteIds, setSelectedDeleteIds] = useState(() => new Set());
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [cancellingJobIds, setCancellingJobIds] = useState(() => new Set());
  const [status, setStatus] = useState("No queue loaded.");

  const load = useCallback(async () => {
    setProgressLabel("Loading queue...");
    setStatus("Loading simulation queue...");
    setError(false);

    try {
      const result = await listSimulationJobs(JOB_PAGE_LIMIT);

      if (!result.database_configured) {
        setJobs([]);
        setSelectedJobId(null);
        setSelectedDeleteIds(new Set());
        setStatus(
          "Database is not configured. Set DATABASE_URL to use the simulation queue.",
        );
        setError(true);
        return;
      }

      if (result.error) {
        throw new Error(result.error);
      }

      const items = result.items || [];
      setJobs(items);
      setSelectedJobId((current) =>
        items.some((item) => item.id === current) ? current : null,
      );
      setSelectedDeleteIds(
        (current) =>
          new Set(
            [...current].filter((id) =>
              items.some(
                (item) =>
                  item.id === id &&
                  String(item.status || "").toLowerCase() !== "running",
              ),
            ),
          ),
      );
      setStatus(
        items.length
          ? `${items.length} simulation jobs recorded.`
          : "No simulation jobs recorded.",
      );
    } catch (loadError) {
      setStatus(`Queue failed: ${loadError.message}`);
      setError(true);
    } finally {
      setProgressLabel("");
    }
  }, []);

  useEffect(() => {
    if (!enabled || route !== "/queue") {
      return undefined;
    }

    const hasPendingJob = jobs.some(
      (job) => job.status === "queued" || job.status === "running",
    );

    if (!hasPendingJob) {
      return undefined;
    }

    const timerId = window.setInterval(load, 5000);
    return () => window.clearInterval(timerId);
  }, [enabled, jobs, load, route]);

  const toggleDeleteSelection = useCallback(
    (jobId) => {
      const job = jobs.find((item) => item.id === jobId);
      if (!job || String(job.status || "").toLowerCase() === "running") {
        return;
      }
      setSelectedDeleteIds((current) => toggleSetValue(current, jobId));
    },
    [jobs],
  );

  const toggleAllDeleteSelection = useCallback(() => {
    const deletableIds = jobs
      .filter((job) => String(job.status || "").toLowerCase() !== "running")
      .map((job) => job.id);
    setSelectedDeleteIds((current) =>
      deletableIds.length > 0 && deletableIds.every((id) => current.has(id))
        ? new Set()
        : new Set(deletableIds),
    );
  }, [jobs]);

  const deleteSelected = useCallback(async () => {
    if (progressLabel || selectedDeleteIds.size === 0) {
      return null;
    }

    const selectedIds = [...selectedDeleteIds];
    const confirmed = window.confirm(
      `Delete ${selectedIds.length} selected simulation queue entries? Saved History results will remain.`,
    );

    if (!confirmed) {
      return null;
    }

    setProgressLabel("Deleting selected queue entries...");
    setStatus(`Deleting ${selectedIds.length} selected queue entries...`);
    setError(false);

    try {
      const results = await Promise.allSettled(
        selectedIds.map((jobId) => deleteSimulationJob(jobId)),
      );
      const deletedIds = new Set(
        selectedIds.filter(
          (id, index) =>
            results[index].status === "fulfilled" && results[index].value?.deleted,
        ),
      );
      const failedIds = selectedIds.filter((id) => !deletedIds.has(id));

      setSelectedDeleteIds(new Set(failedIds));
      await load();

      if (failedIds.length > 0) {
        setStatus(
          `Deleted ${deletedIds.size}; ${failedIds.length} failed or started running.`,
        );
        setError(true);
      } else {
        setStatus(`Deleted ${deletedIds.size} selected queue entries.`);
      }

      return { deletedIds, failedIds };
    } finally {
      setProgressLabel("");
    }
  }, [load, progressLabel, selectedDeleteIds]);

  const cancelJob = useCallback(async (jobId) => {
    if (!jobId || cancellingJobIds.has(jobId)) {
      return null;
    }

    setCancellingJobIds((current) => new Set(current).add(jobId));
    setError(false);
    try {
      const result = await cancelSimulationJob(jobId);
      await load();
      setStatus(
        result.cancelled
          ? "Simulation job stopped."
          : "Stop requested. The worker will finish its current step and stop.",
      );
      return result;
    } catch (cancelError) {
      setStatus(`Could not stop simulation: ${cancelError.message}`);
      setError(true);
      return null;
    } finally {
      setCancellingJobIds((current) => {
        const next = new Set(current);
        next.delete(jobId);
        return next;
      });
    }
  }, [cancellingJobIds, load]);

  return {
    deleteSelected,
    cancelJob,
    cancellingJobIds,
    error,
    jobs,
    load,
    progressLabel,
    selectedDeleteIds,
    selectedJobId,
    setError,
    setProgressLabel,
    setSelectedJobId,
    setStatus,
    status,
    toggleAllDeleteSelection,
    toggleDeleteSelection,
  };
}
