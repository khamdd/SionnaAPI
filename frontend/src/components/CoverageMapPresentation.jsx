export function CoverageMapControls({ mode, onModeChange }) {
  return (
    <div className="coverage-map-controls" aria-label="Coverage map display mode">
      <span>Map layer</span>
      <div>
        <button
          className={mode === "quality" ? "active" : ""}
          type="button"
          onClick={() => onModeChange("quality")}
        >
          Quality
        </button>
        <button
          className={mode === "overlap" ? "active" : ""}
          type="button"
          onClick={() => onModeChange("overlap")}
        >
          Overlap
        </button>
      </div>
    </div>
  );
}

export function CoverageColorLegend({ mode }) {
  const qualityRows = [
    {
      color: "#b91c1c",
      label: "Poor",
      range: "SINR < 0 dB",
      meaning: "Weak or noisy connection",
    },
    {
      color: "#eab308",
      label: "Fair",
      range: "0 to 8 dB",
      meaning: "Usable but unstable",
    },
    {
      color: "#22c55e",
      label: "Good",
      range: "8 to 18 dB",
      meaning: "Stable connection",
    },
    {
      color: "#0ea5e9",
      label: "Excellent",
      range: ">= 18 dB",
      meaning: "Strong connection",
    },
    {
      color: "#6b7280",
      label: "No coverage",
      range: "No valid value",
      meaning: "No usable serving signal",
    },
  ];
  const overlapRows = [
    {
      color: "#6b7280",
      label: "No coverage",
      range: "0 antennas",
      meaning: "No usable serving signal",
    },
    {
      color: "#2563eb",
      label: "Single coverage",
      range: "1 antenna",
      meaning: "Only one antenna is strong enough",
    },
    {
      color: "#22c55e",
      label: "Normal overlap",
      range: "2 antennas",
      meaning: "Good handover candidate area",
    },
    {
      color: "#eab308",
      label: "High overlap",
      range: "3 antennas",
      meaning: "Watch for extra interference",
    },
    {
      color: "#dc2626",
      label: "Excessive overlap",
      range: "4+ antennas",
      meaning: "Likely too many antennas affect this cell",
    },
  ];
  const rows = mode === "overlap" ? overlapRows : qualityRows;

  return (
    <div className="coverage-legend" aria-label="Coverage color legend">
      <div>
        <strong>{mode === "overlap" ? "Overlap colors" : "Coverage colors"}</strong>
        <span>
          {mode === "overlap"
            ? "Counts serving antenna plus neighbor antennas close enough to affect the same cell."
            : "Uses SINR when available. If SINR is missing, the map falls back to throughput or signal power."}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Color</th>
            <th>Quality</th>
            <th>Range</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td><span className="coverage-swatch" style={{ background: row.color }} /></td>
              <td>{row.label}</td>
              <td>{row.range}</td>
              <td>{row.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
