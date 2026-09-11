import HistoryPanel from "./HistoryPanel";

export default function HistoryRoutePage({
  activeScene,
  comparisonSceneId,
  comparisonSceneName,
  comparisonType,
  historyError,
  historyStatus,
  isLoading,
  items,
  onCancelComparison,
  onDelete,
  onDeleteSelected,
  onOpen,
  onRefresh,
  onShowComparison,
  onToggleCompare,
  onToggleDeleteSelection,
  onToggleSelectAll,
  selectedComparisonIds,
  selectedDeleteIds,
  selectedHistoryId,
}) {
  return (
    <main className="route-page">
      <div className="page-title with-action">
        <div>
          <h1>Simulation History</h1>
          <p>Showing saved simulation runs for {activeScene?.name || "the selected scene"} only.</p>
        </div>
        <button className="ghost-button" type="button" disabled={isLoading} onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <section className="history-page-panel">
        <HistoryPanel
          comparisonSceneId={comparisonSceneId}
          comparisonSceneName={comparisonSceneName}
          comparisonType={comparisonType}
          historyError={historyError}
          historyStatus={historyStatus}
          isLoading={isLoading}
          items={items}
          onCancelComparison={onCancelComparison}
          onDelete={onDelete}
          onDeleteSelected={onDeleteSelected}
          onOpen={onOpen}
          onShowComparison={onShowComparison}
          onToggleCompare={onToggleCompare}
          onToggleDeleteSelection={onToggleDeleteSelection}
          onToggleSelectAll={onToggleSelectAll}
          selectedComparisonIds={selectedComparisonIds}
          selectedDeleteIds={selectedDeleteIds}
          selectedHistoryId={selectedHistoryId}
        />
      </section>
    </main>
  );
}
