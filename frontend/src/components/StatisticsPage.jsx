import { useCallback, useEffect, useMemo, useState } from "react";
import { getSimulationStatistics } from "../api";
import { BarChart, ChartCard, LineChart } from "./charts/ChartPrimitives";
import { formatDateTime, formatMaybeNumber, formatSimulationType } from "../utils/format";

const METRICS = {
  coverage_percent: { label: "Coverage", unit: "%" },
  average_rsrp_dbm: { label: "Average RSRP", unit: " dBm" },
  sinr_db: { label: "SINR", unit: " dB" },
  target_throughput_mbps: { label: "Target throughput", unit: " Mbps" },
};
const EMPTY_SERIES = [];

function preferredMetric(series) {
  return ["coverage_percent", "average_rsrp_dbm", "sinr_db", "target_throughput_mbps"].find((key) => series.some((item) => item.metrics?.[key] != null)) || "coverage_percent";
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
      .then((result) => { if (!cancelled) { setData(result); setLoading(false); } })
      .catch((requestError) => { if (!cancelled) { setError(requestError.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [activeScene?.id]);

  useEffect(() => load(), [load]);

  const series = data?.series || EMPTY_SERIES;
  const metricKey = preferredMetric(series);
  const metric = METRICS[metricKey];
  const trend = useMemo(() => series.filter((item) => item.metrics?.[metricKey] != null).map((item) => ({ label: formatDateTime(item.created_at).split(",")[0], value: item.metrics[metricKey] })), [metricKey, series]);
  const typeBars = Object.entries(data?.summary?.type_counts || {}).map(([type, value]) => ({ label: formatSimulationType(type), value }));
  const latest = data?.summary?.latest_run;

  return <main className="route-page statistics-page">
    <div className="page-title with-action dashboard-title">
      <div><span className="dashboard-eyebrow">Workspace overview</span><h1>Dashboard</h1><p>Simulation and optimization performance for {activeScene?.name || "the selected scene"}.</p></div>
      <button className="ghost-button" type="button" onClick={load} disabled={loading}>{loading ? "Refreshing..." : "Refresh dashboard"}</button>
    </div>
    <section className="dashboard-context" aria-label="Dashboard context">
      <div><span className="dashboard-context-mark" aria-hidden="true" /><div><strong>{activeScene?.name || "Selected scene"}</strong><p>All figures below are scoped to this work scene.</p></div></div>
      <span className={`dashboard-sync ${loading ? "is-loading" : ""}`}>{loading ? "Updating data" : data ? "Data up to date" : "Waiting for data"}</span>
    </section>
    {error && <p className="history-status error-text">Statistics failed: {error}</p>}
    <section className="statistics-summary-grid" aria-label="Simulation summary">
      <article><span>Total runs</span><strong>{data?.summary?.total_runs ?? "—"}</strong></article>
      <article><span>Successful</span><strong>{data?.summary?.successful_runs ?? "—"}</strong></article>
      <article><span>Failure rate</span><strong>{formatMaybeNumber(data?.summary?.failure_rate)}%</strong></article>
      <article><span>Latest result</span><strong>{latest ? formatSimulationType(latest.simulation_type) : "—"}</strong><small>{latest ? formatDateTime(latest.created_at) : "Run a simulation to begin"}</small></article>
    </section>
    {loading && !data && <p className="statistics-empty dashboard-loading">Loading scene statistics...</p>}
    {!loading && !data?.summary?.total_runs && !error && <p className="statistics-empty">No saved simulations yet. Save a completed result from Simulation Queue to populate this dashboard.</p>}
    {!!data?.summary?.total_runs && <section className="statistics-chart-grid">
      <ChartCard title={`${metric.label} trend`} subtitle="Read left to right: older saved results to newer saved results." legend={[{ label: metric.label, color: "#0f766e", description: `measured in ${metric.unit.trim()}` }]}><LineChart points={trend} unit={metric.unit} /></ChartCard>
      <ChartCard title="Runs by simulation type" subtitle="Each bar is the number of saved results of that type." legend={[{ label: "Saved runs", color: "#0f766e", description: "higher bars mean more saved results" }]}><BarChart bars={typeBars} /></ChartCard>
    </section>}
  </main>;
}
