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
  comparisonType,
  historyError,
  historyStatus,
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
        selectedCount={selectedComparisonIds.size}
        onCancel={onCancelComparison}
        onShow={onShowComparison}
      />
      <div className="history-list">
        {items.map((item) => (
          <HistoryRow
            key={item.id}
            item={item}
            comparisonType={comparisonType}
            isSelectedForComparison={selectedComparisonIds.has(item.id)}
            isSelectedHistory={item.id === selectedHistoryId}
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
  comparisonType,
  isSelectedForComparison,
  isSelectedHistory,
  item,
  onDelete,
  onOpen,
  onToggleCompare,
}) {
  const isComparing = Boolean(comparisonType);
  const canCompareItem = isSuccessfulHistoryItem(item);
  const isCompatible = !isComparing || (
    item.simulation_type === comparisonType && canCompareItem
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
        onClick={() => onOpen(item.id)}
      >
        <strong>{formatSimulationType(item.simulation_type)} - {item.status}</strong>
        <span>{formatDateTime(item.created_at)}</span>
        <span>{historyListSubtitle(item)}</span>
      </button>
      <button
        className="history-compare"
        type="button"
        disabled={!canCompareItem || !isCompatible}
        title={compareButtonTitle(item, isComparing, isCompatible, comparisonType)}
        onClick={() => onToggleCompare(item)}
      >
        {isSelectedForComparison ? "Selected" : "Compare"}
      </button>
      <button
        className="history-delete"
        type="button"
        title="Delete simulation history"
        aria-label={`Delete ${formatSimulationType(item.simulation_type)} history`}
        onClick={() => onDelete(item)}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function ComparisonPanel({ comparisonType, selectedCount, onCancel, onShow }) {
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
        <button className="ghost-button" type="button" onClick={onCancel}>Cancel</button>
        <button
          className="primary-button"
          type="button"
          disabled={selectedCount < 2}
          onClick={onShow}
        >
          Show comparison
        </button>
      </div>
    </div>
  );
}
