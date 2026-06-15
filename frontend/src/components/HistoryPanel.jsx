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
  onOpen,
  onShowComparison,
  onToggleCompare,
  selectedComparisonIds,
  selectedHistoryId,
}) {
  return (
    <div className="history-view">
      <p className={`history-status ${historyError ? "error-text" : ""}`}>{historyStatus}</p>
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
            isSelectedHistory={item.id === selectedHistoryId}
            isLoading={isLoading}
            onDelete={onDelete}
            onOpen={onOpen}
            onToggleCompare={onToggleCompare}
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
  isSelectedHistory,
  isLoading,
  item,
  onDelete,
  onOpen,
  onToggleCompare,
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
