import { useCallback, useEffect, useMemo, useState } from "react";
import { getSimulationStatistics } from "../api";
import { formatSimulationType } from "../utils/format";

const KNOWN_SIMULATION_TYPES = [
  "coverage_map",
  "network_coverage",
  "network_coverage_optimization",
  "rsrp_simulation",
  "sinr",
  "throughput_comparison",
];

const EMPTY_BREAKDOWN = {};
const EMPTY_COUNTS = { queue: 0, history: 0, successful: 0, failure: 0 };

function simulationLabel(type) {
  if (type === "network_coverage_optimization") return "Network coverage optimization";
  return formatSimulationType(type);
}

export default function StatisticsPage({ activeScene }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getSimulationStatistics(100, activeScene?.id)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [activeScene?.id]);

  useEffect(() => load(), [load]);

  const summary = data?.summary || {};
  const breakdown = summary.breakdown || EMPTY_BREAKDOWN;
  const simulationTypes = useMemo(() => [
    ...KNOWN_SIMULATION_TYPES,
    ...Object.keys(breakdown).filter((type) => !KNOWN_SIMULATION_TYPES.includes(type)),
  ], [breakdown]);
  const rows = simulationTypes.map((type) => ({
    type,
    ...(breakdown[type] || EMPTY_COUNTS),
  }));
  const totals = rows.reduce((total, row) => ({
    queue: total.queue + row.queue,
    history: total.history + row.history,
    successful: total.successful + row.successful,
    failure: total.failure + row.failure,
  }), { ...EMPTY_COUNTS });
  const hasActivity = totals.queue + totals.history > 0;

  return <main className="route-page statistics-page">
    <div className="page-title with-action dashboard-title">
      <div><span className="dashboard-eyebrow">Workspace overview</span><h1>Dashboard</h1><p>Simulation status for {activeScene?.name || "the selected scene"}.</p></div>
      <button className="ghost-button" type="button" onClick={load} disabled={loading}>{loading ? "Refreshing..." : "Refresh dashboard"}</button>
    </div>
    <section className="dashboard-hero" aria-label="Dashboard context">
      <div className="dashboard-hero-copy"><span>Scene intelligence</span><h2>{activeScene?.name || "Selected scene"}</h2><p>See what is running now and how each simulation type has performed.</p></div>
      <div className="dashboard-radar" aria-hidden="true"><i className="dashboard-radar-ring ring-one" /><i className="dashboard-radar-ring ring-two" /><i className="dashboard-radar-ring ring-three" /><i className="dashboard-radar-sweep" /><b /></div>
      <div className="dashboard-hero-footer"><span><small>Scope</small><strong>Queue + history</strong></span><span className={`dashboard-sync ${loading ? "is-loading" : ""}`}><i />{loading ? "Updating data" : data ? "Data up to date" : "Waiting for data"}</span></div>
    </section>
    {error && <p className="history-status error-text">Statistics failed: {error}</p>}
    <section className="statistics-summary-grid" aria-label="Simulation totals">
      <article><span>In simulation queue</span><strong>{summary.queue_total ?? summary.queued_total ?? totals.queue}</strong><small>Jobs still listed in the queue</small></article>
      <article><span>In history</span><strong>{summary.history_total ?? totals.history}</strong><small>Saved results for this scene</small></article>
      <article><span>Successful</span><strong>{summary.successful_runs ?? totals.successful}</strong><small>Completed without error</small></article>
      <article><span>Failure</span><strong className="dashboard-failure-value">{summary.failed_runs ?? totals.failure}</strong><small>Failed saved results</small></article>
    </section>
    {loading && !data && <p className="statistics-empty dashboard-loading">Loading scene statistics...</p>}
    {data && !error && <section className="dashboard-status-panel" aria-labelledby="simulation-status-title">
      <div className="dashboard-status-heading">
        <div><h3 id="simulation-status-title">Simulation status by type</h3><p>Queue counts include every job still listed in Simulation Queue. History counts saved results; active jobs are queued or running.</p></div>
        <span className="dashboard-status-key">All counts are scene-scoped</span>
      </div>
      <div className="dashboard-status-table-wrap"><table className="dashboard-status-table">
        <thead><tr><th scope="col">Simulation</th><th scope="col">In queue</th><th scope="col">In history</th><th scope="col">Successful</th><th scope="col">Failure</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.type}>
          <td>{simulationLabel(row.type)}</td>
          <td data-label="In queue"><strong className="status-queue">{row.queue}</strong></td>
          <td data-label="In history"><strong>{row.history}</strong></td>
          <td data-label="Successful"><strong className="status-success">{row.successful}</strong></td>
          <td data-label="Failure"><strong className="status-failure">{row.failure}</strong></td>
        </tr>)}</tbody>
        <tfoot><tr><td>Total</td><td>{totals.queue}</td><td>{totals.history}</td><td>{totals.successful}</td><td>{totals.failure}</td></tr></tfoot>
      </table></div>
      {!hasActivity && <p className="dashboard-status-empty">No queued or saved simulations yet. Start a simulation to populate these counts.</p>}
    </section>}
  </main>;
}
