import { formatMaybeNumber, formatPosition } from "../utils/format";

export default function AntennaPanel({ antennas, disabled = false, onChange }) {
  return (
    <div className="antenna-list">
      {antennas.map((item, index) => (
        <article className="antenna-card" key={item.id}>
          <h3>
            <span>{item.id}</span>
            <small>{formatAntennaLocation(item)}</small>
          </h3>
          <div className="antenna-meta">
            <span>Azimuth {item.azimuth} deg</span>
            <span>Height {formatMaybeNumber(item.height_m ?? item.position?.[2])} m</span>
          </div>
          <div className="control-row">
            <label htmlFor={`tilt-${index}`}>Tilt</label>
            <input
              id={`tilt-${index}`}
              type="range"
              min={item.tilt.min}
              max={item.tilt.max}
              step="0.5"
              value={item.tilt.current}
              disabled={disabled}
              onChange={(event) => onChange(index, "tilt", Number(event.target.value))}
            />
            <span className="control-value">{item.tilt.current.toFixed(1)}</span>
          </div>
          <div className="control-row">
            <label htmlFor={`power-${index}`}>Power</label>
            <input
              id={`power-${index}`}
              type="range"
              min={item.tx_power.min}
              max={item.tx_power.max}
              step="0.5"
              value={item.tx_power.current}
              disabled={disabled}
              onChange={(event) => onChange(index, "tx_power", Number(event.target.value))}
            />
            <span className="control-value">{item.tx_power.current.toFixed(1)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function formatAntennaLocation(antenna) {
  if (
    Number.isFinite(Number(antenna.longitude)) &&
    Number.isFinite(Number(antenna.latitude))
  ) {
    return `${formatMaybeNumber(antenna.longitude)}, ${formatMaybeNumber(antenna.latitude)}`;
  }

  return Array.isArray(antenna.position) ? formatPosition(antenna.position) : "--";
}
