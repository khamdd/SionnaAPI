function finite(value) {
  return Number.isFinite(Number(value));
}

function formatValue(value) {
  return finite(value) ? Number(value).toFixed(Number(value) % 1 ? 1 : 0) : "—";
}

export function ChartCard({ title, subtitle, legend = [], children, className = "" }) {
  return (
    <article className={`chart-card ${className}`}>
      <header className="chart-card-heading">
        <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
      </header>
      {legend.length > 0 && <ChartLegend items={legend} />}
      {children}
    </article>
  );
}

export function ChartLegend({ items = [] }) {
  return <div className="chart-legend" aria-label="Chart legend">
    {items.map((item) => <span className="chart-legend-item" key={item.label}>
      <i className={`chart-legend-swatch${item.dashed ? " dashed" : ""}`} style={item.dashed ? undefined : { background: item.color }} />
      <span><strong>{item.label}</strong>{item.description ? ` — ${item.description}` : ""}</span>
    </span>)}
  </div>;
}

export function LineChart({ points = [], unit = "", target = null, color = "#0f766e" }) {
  const values = points.map((point) => Number(point.value)).filter(Number.isFinite);
  if (!values.length) return <p className="chart-empty">Not enough data for this trend yet.</p>;
  const width = 640;
  const height = 220;
  const padding = { top: 18, right: 18, bottom: 32, left: 42 };
  const min = Math.min(...values, finite(target) ? Number(target) : Infinity);
  const max = Math.max(...values, finite(target) ? Number(target) : -Infinity);
  const range = max - min || 1;
  const x = (index) => padding.left + (index / Math.max(points.length - 1, 1)) * (width - padding.left - padding.right);
  const y = (value) => padding.top + ((max - Number(value)) / range) * (height - padding.top - padding.bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"} ${x(index)} ${y(point.value)}`).join(" ");
  return (
    <div className="chart-frame">
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line chart">
        <line className="chart-axis" x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} />
        <line className="chart-axis" x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} />
        <text className="chart-label" x="4" y={padding.top + 4}>{formatValue(max)}{unit}</text>
        <text className="chart-label" x="4" y={height - padding.bottom}>{formatValue(min)}{unit}</text>
        {finite(target) && <><line className="chart-target" x1={padding.left} y1={y(target)} x2={width - padding.right} y2={y(target)} /><text className="chart-target-label" x={width - 78} y={y(target) - 5}>target</text></>}
        <path className="chart-line" d={path} style={{ stroke: color }} />
        {points.map((point, index) => <circle className="chart-dot" key={`${point.label}-${index}`} cx={x(index)} cy={y(point.value)} r="4" style={{ fill: color }}><title>{point.label}: {formatValue(point.value)}{unit}</title></circle>)}
        <text className="chart-label" x={padding.left} y={height - 8}>{points[0]?.label || ""}</text>
        <text className="chart-label chart-label-end" x={width - padding.right} y={height - 8}>{points[points.length - 1]?.label || ""}</text>
      </svg>
    </div>
  );
}

export function BarChart({ bars = [], unit = "", colors = ["#0f766e", "#f59e0b", "#64748b"] }) {
  const values = bars.map((bar) => Number(bar.value)).filter(Number.isFinite);
  if (!values.length) return <p className="chart-empty">No comparable KPI values are available.</p>;
  const hasNegative = values.some((value) => value < 0);
  const max = hasNegative ? Math.max(...values.map((value) => Math.abs(value)), 1) : Math.max(...values, 0) || 1;
  return (
    <div className={`bar-chart${hasNegative ? " has-negative" : ""}`} role="img" aria-label="Bar chart">
      {bars.map((bar, index) => {
        const value = Number(bar.value);
        const magnitude = Math.max(5, (Math.abs(value) / max) * (hasNegative ? 50 : 100));
        const style = hasNegative
          ? { height: `${magnitude}%`, bottom: value >= 0 ? "50%" : undefined, top: value < 0 ? "50%" : undefined, background: colors[index % colors.length] }
          : { height: `${magnitude}%`, background: colors[index % colors.length] };
        return <div className="bar-item" key={`${bar.label}-${index}`}><div className="bar-value">{formatValue(value)}{unit}</div><div className="bar-track"><span style={style} /></div><div className="bar-label" title={bar.label}>{bar.label}</div></div>;
      })}
    </div>
  );
}
