import { useCallback, useEffect, useState } from "react";

import {
  deleteSimulationRun,
  getSimulationRun,
  listSimulationRuns,
} from "../api";
import ComparisonResult from "../components/ComparisonResult";
import HistoryDetail from "../components/HistoryDetail";
import { HistoryModalBody } from "../components/HistoryModal";
import {
  removeMapValue,
  removeSetValue,
  toggleSetValue,
} from "../utils/collections";
import { formatDateTime, formatSimulationType } from "../utils/format";
import {
  isSuccessfulHistoryItem,
  pruneComparisonDetails,
  pruneComparisonSelection,
} from "../utils/history";

const HISTORY_PAGE_LIMIT = 200;

export default function useSimulationHistory({ activeScene, modal }) {
  const {
    close: closeModal,
    handlePreviewLoadingChange,
    previewLoadCount,
    setContent: setModalContent,
  } = modal;
  const [comparisonDetails, setComparisonDetails] = useState(() => new Map());
  const [comparisonSceneId, setComparisonSceneId] = useState(null);
  const [comparisonSceneName, setComparisonSceneName] = useState(null);
  const [comparisonType, setComparisonType] = useState(null);
  const [error, setError] = useState(false);
  const [items, setItems] = useState([]);
  const [progressLabel, setProgressLabel] = useState("");
  const [selectedComparisonIds, setSelectedComparisonIds] = useState(
    () => new Set(),
  );
  const [selectedDeleteIds, setSelectedDeleteIds] = useState(() => new Set());
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [status, setStatus] = useState("No history loaded.");

  const cancelComparison = useCallback(() => {
    setComparisonType(null);
    setComparisonSceneId(null);
    setComparisonSceneName(null);
    setSelectedComparisonIds(new Set());
    setComparisonDetails(new Map());
  }, []);

  const load = useCallback(async () => {
    const sceneId = activeScene?.id;
    const sceneName = activeScene?.name || "selected scene";

    if (!sceneId) {
      setItems([]);
      setSelectedHistoryId(null);
      setSelectedDeleteIds(new Set());
      setSelectedComparisonIds(new Set());
      setComparisonDetails(new Map());
      setComparisonType(null);
      setComparisonSceneId(null);
      setComparisonSceneName(null);
      closeModal();
      setStatus("Select a work scene to view history.");
      setError(true);
      return;
    }

    setProgressLabel("Loading history...");
    setStatus(`Loading history for ${sceneName}...`);
    setError(false);

    try {
      const result = await listSimulationRuns(HISTORY_PAGE_LIMIT, sceneId);

      if (!result.database_configured) {
        setItems([]);
        setSelectedDeleteIds(new Set());
        setSelectedComparisonIds(new Set());
        setComparisonDetails(new Map());
        setComparisonType(null);
        closeModal();
        setStatus("PostgreSQL is unavailable. Contact the operator before using history.");
        return;
      }

      if (result.error) {
        throw new Error(result.error);
      }

      const nextItems = (result.items || []).filter(
        (item) => item.scene_id === sceneId,
      );
      setItems(nextItems);
      setSelectedDeleteIds(
        (current) =>
          new Set(
            [...current].filter((id) =>
              nextItems.some((item) => item.id === id),
            ),
          ),
      );
      setStatus(
        nextItems.length
          ? `${nextItems.length} saved simulations for ${sceneName}`
          : `No saved simulations for ${sceneName}.`,
      );
      setSelectedComparisonIds((current) =>
        pruneComparisonSelection(
          current,
          nextItems,
          comparisonType,
          comparisonSceneId,
        ),
      );
      setComparisonDetails((current) =>
        pruneComparisonDetails(current, nextItems),
      );
    } catch (loadError) {
      setStatus(`History failed: ${loadError.message}`);
      setError(true);
    } finally {
      setProgressLabel("");
    }
  }, [
    activeScene?.id,
    activeScene?.name,
    comparisonSceneId,
    comparisonType,
    closeModal,
  ]);

  useEffect(() => {
    setItems([]);
    setSelectedHistoryId(null);
    setSelectedDeleteIds(new Set());
    setSelectedComparisonIds(new Set());
    setComparisonDetails(new Map());
    setComparisonType(null);
    setComparisonSceneId(null);
    setComparisonSceneName(null);
    closeModal();
    setStatus(
      activeScene
        ? `History is scoped to ${activeScene.name}.`
        : "Select a work scene to view history.",
    );
    setError(!activeScene);
  }, [activeScene?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (comparisonType && selectedComparisonIds.size === 0) {
      setComparisonType(null);
      setComparisonSceneId(null);
      setComparisonSceneName(null);
    }
  }, [comparisonType, selectedComparisonIds]);

  const toggleComparison = useCallback(
    (item) => {
      if (!isSuccessfulHistoryItem(item)) {
        return;
      }

      if (
        comparisonType &&
        (item.simulation_type !== comparisonType ||
          item.scene_id !== comparisonSceneId)
      ) {
        return;
      }

      setComparisonType((current) => current || item.simulation_type);
      setComparisonSceneId((current) => current || item.scene_id);
      setComparisonSceneName((current) => current || item.scene_name);
      setSelectedComparisonIds((current) => toggleSetValue(current, item.id));
      setComparisonDetails((current) => removeMapValue(current, item.id));
    },
    [comparisonSceneId, comparisonType],
  );

  const showComparison = useCallback(async () => {
    if (progressLabel || previewLoadCount > 0) {
      return;
    }
    if (!comparisonType || selectedComparisonIds.size < 2) {
      return;
    }

    setProgressLabel("Loading comparison...");
    setStatus("Loading comparison...");
    setError(false);

    try {
      const { details, resolvedItems } = await loadComparisonDetails(
        selectedComparisonIds,
        comparisonDetails,
      );
      setComparisonDetails(details);
      setModalContent(
        <HistoryModalBody
          title={`Comparison: ${formatSimulationType(comparisonType)}`}
        >
          <ComparisonResult
            items={resolvedItems}
            onPreviewLoadingChange={handlePreviewLoadingChange}
            type={comparisonType}
            wardBoundary={activeScene?.ward_boundary}
          />
        </HistoryModalBody>,
      );
      cancelComparison();
      setSelectedHistoryId(null);
      setStatus(`Compared ${resolvedItems.length} simulations.`);
    } catch (comparisonError) {
      setStatus(`Comparison failed: ${comparisonError.message}`);
      setError(true);
    } finally {
      setProgressLabel("");
    }
  }, [
    activeScene?.ward_boundary,
    cancelComparison,
    comparisonDetails,
    comparisonType,
    handlePreviewLoadingChange,
    previewLoadCount,
    progressLabel,
    selectedComparisonIds,
    setModalContent,
  ]);

  const open = useCallback(
    async (runId) => {
      if (progressLabel || previewLoadCount > 0) {
        return;
      }

      setSelectedHistoryId(runId);
      setProgressLabel("Loading history detail...");
      setModalContent(<p className="history-status">Loading detail...</p>);

      try {
        const result = await getSimulationRun(runId);
        if (!result.database_configured) {
          setModalContent(
            <p className="history-status">PostgreSQL is unavailable.</p>,
          );
          return;
        }
        if (result.error) {
          throw new Error(result.error);
        }
        if (!result.item) {
          setModalContent(
            <p className="history-status">Simulation not found.</p>,
          );
          return;
        }

        setModalContent(
          <HistoryDetail
            item={result.item}
            onPreviewLoadingChange={handlePreviewLoadingChange}
            wardBoundary={
              result.item.scene_id === activeScene?.id
                ? activeScene?.ward_boundary
                : null
            }
          />,
        );
      } catch (detailError) {
        setModalContent(
          <p className="history-status error-text">
            Detail failed: {detailError.message}
          </p>,
        );
      } finally {
        setProgressLabel("");
      }
    },
    [
      activeScene,
      handlePreviewLoadingChange,
      previewLoadCount,
      progressLabel,
      setModalContent,
    ],
  );

  const remove = useCallback(
    async (item) => {
      if (progressLabel || previewLoadCount > 0) {
        return;
      }
      const confirmed = window.confirm(
        `Delete ${formatSimulationType(item.simulation_type)} history from ${formatDateTime(item.created_at)}?`,
      );
      if (!confirmed) {
        return;
      }

      setProgressLabel("Deleting history...");
      setStatus("Deleting history...");
      setError(false);
      try {
        await deleteSimulationRun(item.id);
        if (selectedHistoryId === item.id) {
          closeModal();
          setSelectedHistoryId(null);
        }
        setSelectedComparisonIds((current) => removeSetValue(current, item.id));
        setComparisonDetails((current) => removeMapValue(current, item.id));
        setSelectedDeleteIds((current) => removeSetValue(current, item.id));
        await load();
      } catch (deleteError) {
        setStatus(`Delete failed: ${deleteError.message}`);
        setError(true);
      } finally {
        setProgressLabel("");
      }
    },
    [closeModal, load, previewLoadCount, progressLabel, selectedHistoryId],
  );

  const toggleDeleteSelection = useCallback((runId) => {
    setSelectedDeleteIds((current) => toggleSetValue(current, runId));
  }, []);

  const toggleAllDeleteSelection = useCallback(() => {
    setSelectedDeleteIds((current) =>
      current.size === items.length
        ? new Set()
        : new Set(items.map((item) => item.id)),
    );
  }, [items]);

  const deleteSelected = useCallback(async () => {
    if (
      progressLabel ||
      previewLoadCount > 0 ||
      selectedDeleteIds.size === 0
    ) {
      return;
    }

    const selectedIds = [...selectedDeleteIds];
    const confirmed = window.confirm(
      `Delete ${selectedIds.length} selected simulation histories?`,
    );
    if (!confirmed) {
      return;
    }

    setProgressLabel("Deleting selected history...");
    setStatus(`Deleting ${selectedIds.length} selected histories...`);
    setError(false);

    try {
      const results = await Promise.allSettled(
        selectedIds.map((runId) => deleteSimulationRun(runId)),
      );
      const deletedIds = new Set(
        selectedIds.filter((id, index) => results[index].status === "fulfilled"),
      );
      const failedIds = selectedIds.filter((id) => !deletedIds.has(id));

      if (selectedHistoryId && deletedIds.has(selectedHistoryId)) {
        closeModal();
        setSelectedHistoryId(null);
      }
      setSelectedComparisonIds(
        (current) => new Set([...current].filter((id) => !deletedIds.has(id))),
      );
      setComparisonDetails(
        (current) =>
          new Map([...current].filter(([id]) => !deletedIds.has(id))),
      );
      setSelectedDeleteIds(new Set(failedIds));
      await load();

      if (failedIds.length > 0) {
        setStatus(`Deleted ${deletedIds.size}; ${failedIds.length} failed.`);
        setError(true);
      } else {
        setStatus(`Deleted ${deletedIds.size} selected histories.`);
      }
    } finally {
      setProgressLabel("");
    }
  }, [
    closeModal,
    load,
    previewLoadCount,
    progressLabel,
    selectedDeleteIds,
    selectedHistoryId,
  ]);

  const closeSelection = useCallback(() => {
    setSelectedHistoryId(null);
  }, []);

  return {
    cancelComparison,
    closeSelection,
    comparisonSceneId,
    comparisonSceneName,
    comparisonType,
    deleteSelected,
    error,
    items,
    load,
    open,
    progressLabel,
    remove,
    selectedComparisonIds,
    selectedDeleteIds,
    selectedHistoryId,
    setError,
    setProgressLabel,
    setStatus,
    showComparison,
    status,
    toggleAllDeleteSelection,
    toggleComparison,
    toggleDeleteSelection,
  };
}

async function loadComparisonDetails(selectedIds, cachedDetails) {
  const resolvedItems = [];
  const details = new Map(cachedDetails);

  for (const runId of selectedIds) {
    let item = details.get(runId);
    if (!item) {
      const result = await getSimulationRun(runId);
      if (!result.database_configured) {
        throw new Error("PostgreSQL is unavailable.");
      }
      if (result.error) {
        throw new Error(result.error);
      }
      if (!result.item) {
        throw new Error("Simulation not found.");
      }
      item = result.item;
      details.set(runId, item);
    }
    resolvedItems.push(item);
  }

  return { details, resolvedItems };
}
