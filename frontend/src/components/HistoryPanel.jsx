import { useEffect, useRef } from "react";
import {
  formatDateTime,
  formatSimulationType,
} from "../utils/format";
import {
  compareButtonTitle,
  historyListSubtitle,
  isSuccessfulHistoryItem,
} from "../utils/history";
import { TrashIcon } from "./Icons";

export default function HistoryPanel({
  comparisonSceneId,
  comparisonSceneName,
  comparisonType,
  historyError,
  historyStatus,
  isLoading = false,
  items,
  onCancelComparison,
  onDelete,
  onDeleteSelected,
  onOpen,
  onShowComparison,
  onToggleCompare,
  onToggleDeleteSelection,
  onToggleSelectAll,
  selectedComparisonIds,
  selectedDeleteIds,
  selectedHistoryId,
}) {
  const allSelected = items.length > 0 && selectedDeleteIds.size === items.length;
  const someSelected = selectedDeleteIds.size > 0 && !allSelected;

  return (
    <div className="history-view">
      <p className={`history-status ${historyError ? "error-text" : ""}`}>{historyStatus}</p>
      <BulkDeletePanel
        allSelected={allSelected}
        isLoading={isLoading}
        itemCount={items.length}
        onDeleteSelected={onDeleteSelected}
        onToggleSelectAll={onToggleSelectAll}
        selectedCount={selectedDeleteIds.size}
        someSelected={someSelected}
      />
      <ComparisonPanel
        comparisonType={comparisonType}
        isLoading={isLoading}
        selectedCount={selectedComparisonIds.size}
        onCancel={onCancelComparison}
        onShow={onShowComparison}
      />
      <div className="history-list">
        {items.map((item) => (
          <HistoryRow
            key={item.id}
            comparisonSceneId={comparisonSceneId}
            comparisonSceneName={comparisonSceneName}
            item={item}
            comparisonType={comparisonType}
            isSelectedForComparison={selectedComparisonIds.has(item.id)}
            isSelectedForDelete={selectedDeleteIds.has(item.id)}
            isSelectedHistory={item.id === selectedHistoryId}
            isLoading={isLoading}
            onDelete={onDelete}
            onOpen={onOpen}
            onToggleCompare={onToggleCompare}
            onToggleDeleteSelection={onToggleDeleteSelection}
          />
        ))}
      </div>
    </div>
  );
}

function HistoryRow({
  comparisonSceneId,
  comparisonSceneName,
  comparisonType,
  isSelectedForComparison,
  isSelectedForDelete,
  isSelectedHistory,
  isLoading,
  item,
  onDelete,
  onOpen,
  onToggleCompare,
  onToggleDeleteSelection,
}) {
  const isComparing = Boolean(comparisonType);
  const canCompareItem = isSuccessfulHistoryItem(item);
  const isCompatible = !isComparing || (
    item.simulation_type === comparisonType && canCompareItem
    && item.scene_id === comparisonSceneId
  );

  return (
    <div
      className={[
        "history-row",
        isComparing && !isCompatible ? "comparison-disabled" : "",
        isSelectedForComparison ? "comparison-selected" : "",
      ].filter(Boolean).join(" ")}
    >
      <label className="history-select" title="Select history for bulk deletion">
        <input
          type="checkbox"
          checked={isSelectedForDelete}
          disabled={isLoading}
          aria-label={`Select ${formatSimulationType(item.simulation_type)} history`}
          onChange={() => onToggleDeleteSelection(item.id)}
        />
      </label>
      <button
        className={`history-item ${isSelectedHistory ? "active" : ""}`}
        type="button"
        disabled={isLoading}
        onClick={() => onOpen(item.id)}
      >
        <strong>{formatSimulationType(item.simulation_type)} - {item.status}</strong>
        <span>{formatDateTime(item.created_at)}</span>
        <span>{historyListSubtitle(item)}</span>
      </button>
      <button
        className="history-compare"
        type="button"
        disabled={isLoading || !canCompareItem || !isCompatible}
        title={compareButtonTitle(
          item,
          isComparing,
          isCompatible,
          comparisonType,
          comparisonSceneName,
        )}
        onClick={() => onToggleCompare(item)}
      >
        {isSelectedForComparison ? "Selected" : "Compare"}
      </button>
      <button
        className="history-delete"
        type="button"
        title="Delete simulation history"
        aria-label={`Delete ${formatSimulationType(item.simulation_type)} history`}
        disabled={isLoading}
        onClick={() => onDelete(item)}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function BulkDeletePanel({
  allSelected,
  isLoading,
  itemCount,
  onDeleteSelected,
  onToggleSelectAll,
  selectedCount,
  someSelected,
}) {
  const checkboxRef = useRef(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  return (
    <div className="history-bulk-panel">
      <label>
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={allSelected}
          disabled={isLoading || itemCount === 0}
          onChange={onToggleSelectAll}
        />
        <span>{allSelected ? "Clear all" : "Select all"}</span>
      </label>
      <span>{selectedCount} selected</span>
      <button
        className="history-bulk-delete"
        type="button"
        disabled={isLoading || selectedCount === 0}
        onClick={onDeleteSelected}
      >
        <TrashIcon />
        Delete selected
      </button>
    </div>
  );
}

function ComparisonPanel({ comparisonType, isLoading, selectedCount, onCancel, onShow }) {
  if (!comparisonType) {
    return null;
  }

  return (
    <div className="history-compare-panel">
      <div>
        <strong>Comparing {formatSimulationType(comparisonType)}</strong>
        <span>{selectedCount} selected. Choose 2 or more saved results.</span>
      </div>
      <div className="comparison-actions">
        <button className="ghost-button" type="button" disabled={isLoading} onClick={onCancel}>Cancel</button>
        <button
          className="primary-button"
          type="button"
          disabled={isLoading || selectedCount < 2}
          onClick={onShow}
        >
          Show comparison
        </button>
      </div>
    </div>
  );
}
