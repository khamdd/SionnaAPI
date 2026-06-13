import { useState } from "react";
import {
  runCoverageMap,
  runSinr,
  runThroughputComparison,
} from "../api";
import {
  DEFAULT_SOLVER,
  TRANSMITTER_PATTERN,
} from "../constants";
import {
  formatMaybeNumber,
  formatPositionValue,
  formatText,
} from "../utils/format";

const DEFAULT_CAMERA = {
  position: [-1.5, -137, 115],
  look_at: [0, 0, 10],
};

export function CoverageApiPage() {
  const [form, setForm] = useState(() => ({
    tilt: 8,
    transmitter_position: [-45, -40, 30],
    tx_power: 30,
    solver: DEFAULT_SOLVER,
    camera: DEFAULT_CAMERA,
  }));
  const [resultState, setResultState] = useApiResult();

  async function submit(event) {
    event.preventDefault();
    await setResultState(() => runCoverageMap({
      ...form,
      transmitter_pattern: TRANSMITTER_PATTERN,
    }));
  }

  return (
    <ApiPageShell
      title="Coverage API"
      description="Render a single-transmitter coverage map for a selected transmitter position, tilt, and power."
      resultState={resultState}
      renderResult={(result) => <CoverageResult result={result} />}
    >
      <form className="api-form" onSubmit={submit}>
        <FormSection title="Transmitter">
          <NumberField label="Tilt" unit="deg" value={form.tilt} onChange={(value) => updateForm(setForm, "tilt", value)} />
          <NumberField label="Power" unit="dBm" value={form.tx_power} onChange={(value) => updateForm(setForm, "tx_power", value)} />
          <PositionField label="Position" value={form.transmitter_position} onChange={(value) => updateForm(setForm, "transmitter_position", value)} />
        </FormSection>
        <SolverFields solver={form.solver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
        <button className="primary-button" type="submit" disabled={resultState.loading}>
          {resultState.loading ? "Running..." : "Run coverage"}
        </button>
      </form>
    </ApiPageShell>
  );
}

export function SinrApiPage() {
  const [form, setForm] = useState(() => ({
    tilt: 8,
    transmitter_position: [0, 0, 30],
    receiver_position: [40, 20, 1.5],
    interferer_position: [120, 100, 25],
    interferer_tilt: 12,
    tx_power: 30,
    solver: DEFAULT_SOLVER,
  }));
  const [resultState, setResultState] = useApiResult();

  async function submit(event) {
    event.preventDefault();
    await setResultState(() => runSinr({
      ...form,
      transmitter_pattern: TRANSMITTER_PATTERN,
    }));
  }

  return (
    <ApiPageShell
      title="SINR API"
      description="Evaluate signal quality at one receiver point with one serving transmitter and one interferer."
      resultState={resultState}
      renderResult={(result) => <SinrResult result={result} />}
    >
      <form className="api-form" onSubmit={submit}>
        <FormSection title="Serving transmitter">
          <NumberField label="Tilt" unit="deg" value={form.tilt} onChange={(value) => updateForm(setForm, "tilt", value)} />
          <NumberField label="Power" unit="dBm" value={form.tx_power} onChange={(value) => updateForm(setForm, "tx_power", value)} />
          <PositionField label="Position" value={form.transmitter_position} onChange={(value) => updateForm(setForm, "transmitter_position", value)} />
        </FormSection>
        <FormSection title="Receiver and interferer">
          <PositionField label="Receiver" value={form.receiver_position} onChange={(value) => updateForm(setForm, "receiver_position", value)} />
          <PositionField label="Interferer" value={form.interferer_position} onChange={(value) => updateForm(setForm, "interferer_position", value)} />
          <NumberField label="Interferer tilt" unit="deg" value={form.interferer_tilt} onChange={(value) => updateForm(setForm, "interferer_tilt", value)} />
        </FormSection>
        <SolverFields solver={form.solver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
        <button className="primary-button" type="submit" disabled={resultState.loading}>
          {resultState.loading ? "Running..." : "Calculate SINR"}
        </button>
      </form>
    </ApiPageShell>
  );
}

export function ThroughputApiPage() {
  const [form, setForm] = useState(() => ({
    base_tilt: 6,
    target_tilt: 12,
    transmitter_position: [0, 0, 30],
    receiver_position: [40, 20, 1.5],
    interferer_position: [120, 100, 25],
    interferer_tilt: 12,
    tx_power: 30,
    bandwidth_mhz: 100,
    mimo_layers: 4,
    solver: DEFAULT_SOLVER,
  }));
  const [resultState, setResultState] = useApiResult();

  async function submit(event) {
    event.preventDefault();
    await setResultState(() => runThroughputComparison({
      ...form,
      transmitter_pattern: TRANSMITTER_PATTERN,
    }));
  }

  return (
    <ApiPageShell
      title="Throughput API"
      description="Compare estimated receiver throughput between two transmitter tilt settings."
      resultState={resultState}
      renderResult={(result) => <ThroughputResult result={result} />}
    >
      <form className="api-form" onSubmit={submit}>
        <FormSection title="Tilt comparison">
          <NumberField label="Base tilt" unit="deg" value={form.base_tilt} onChange={(value) => updateForm(setForm, "base_tilt", value)} />
          <NumberField label="Target tilt" unit="deg" value={form.target_tilt} onChange={(value) => updateForm(setForm, "target_tilt", value)} />
          <NumberField label="Power" unit="dBm" value={form.tx_power} onChange={(value) => updateForm(setForm, "tx_power", value)} />
        </FormSection>
        <FormSection title="Radio link">
          <PositionField label="Transmitter" value={form.transmitter_position} onChange={(value) => updateForm(setForm, "transmitter_position", value)} />
          <PositionField label="Receiver" value={form.receiver_position} onChange={(value) => updateForm(setForm, "receiver_position", value)} />
          <PositionField label="Interferer" value={form.interferer_position} onChange={(value) => updateForm(setForm, "interferer_position", value)} />
          <NumberField label="Interferer tilt" unit="deg" value={form.interferer_tilt} onChange={(value) => updateForm(setForm, "interferer_tilt", value)} />
        </FormSection>
        <FormSection title="Throughput assumptions">
          <NumberField label="Bandwidth" unit="MHz" value={form.bandwidth_mhz} min={1} onChange={(value) => updateForm(setForm, "bandwidth_mhz", value)} />
          <NumberField label="MIMO layers" value={form.mimo_layers} min={1} step={1} onChange={(value) => updateForm(setForm, "mimo_layers", value)} />
        </FormSection>
        <SolverFields solver={form.solver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
        <button className="primary-button" type="submit" disabled={resultState.loading}>
          {resultState.loading ? "Running..." : "Compare throughput"}
        </button>
      </form>
    </ApiPageShell>
  );
}

function ApiPageShell({ children, description, renderResult, resultState, title }) {
  return (
    <section className="api-page">
      <div className="page-title">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="api-layout">
        <div className="api-panel">
          {children}
        </div>
        <div className="api-result-panel">
          <h2>Result</h2>
          {resultState.error && <p className="history-status error-text">{resultState.error}</p>}
          {!resultState.error && resultState.loading && <p className="history-status">Waiting for backend...</p>}
          {!resultState.error && !resultState.loading && !resultState.result && (
            <p className="history-status">Run the API to see the response summary here.</p>
          )}
          {!resultState.error && resultState.result && renderResult(resultState.result)}
        </div>
      </div>
    </section>
  );
}

function FormSection({ children, title }) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function SolverFields({ solver, onChange }) {
  return (
    <FormSection title="Solver">
      <NumberField label="Max depth" value={solver.max_depth} min={0} max={10} step={1} onChange={(value) => updateObject(onChange, solver, "max_depth", value)} />
      <NumberField label="Samples per TX" value={solver.samples_per_tx} min={1} max={10000000} step={1} onChange={(value) => updateObject(onChange, solver, "samples_per_tx", value)} />
      <NumberField label="Cell size" unit="m" value={solver.cell_size} min={0.1} max={50} step="any" onChange={(value) => updateObject(onChange, solver, "cell_size", value)} />
      <PositionField label="Center" value={solver.center} onChange={(value) => updateObject(onChange, solver, "center", value)} />
      <SizeField label="Size" value={solver.size} onChange={(value) => updateObject(onChange, solver, "size", value)} />
    </FormSection>
  );
}

function NumberField({ label, max, min, onChange, step = "any", unit = "", value }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <div className="input-with-unit">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          required
          onChange={(event) => onChange(parseNumericInput(event.target.value))}
        />
        {unit && <small>{unit}</small>}
      </div>
    </label>
  );
}

function PositionField({ label, onChange, value }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <div className="vector-inputs">
        {["x", "y", "z"].map((axis, index) => (
          <input
            key={axis}
            type="number"
            aria-label={`${label} ${axis}`}
            value={value[index]}
            step="any"
            required
            onChange={(event) => onChange(replaceArrayValue(value, index, parseNumericInput(event.target.value)))}
          />
        ))}
      </div>
    </label>
  );
}

function SizeField({ label, onChange, value }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <div className="vector-inputs two">
        {["x", "y"].map((axis, index) => (
          <input
            key={axis}
            type="number"
            aria-label={`${label} ${axis}`}
            value={value[index]}
            min="1"
            step="any"
            required
            onChange={(event) => onChange(replaceArrayValue(value, index, parseNumericInput(event.target.value)))}
          />
        ))}
      </div>
    </label>
  );
}

function CoverageResult({ result }) {
  return (
    <div className="result-summary">
      <dl className="detail-grid">
        <dt>Status</dt><dd>{formatText(result.status)}</dd>
      </dl>
      {result.coverage_map_image_url && (
        <img src={result.coverage_map_image_url} alt="Coverage API result" />
      )}
    </div>
  );
}

function SinrResult({ result }) {
  return (
    <dl className="detail-grid">
      <dt>Status</dt><dd>{formatText(result.status)}</dd>
      <dt>SINR</dt><dd>{formatMaybeNumber(result.sinr_db)} dB</dd>
      <dt>Signal power</dt><dd>{formatMaybeNumber(result.signal_power)} dBm</dd>
      <dt>Noise power</dt><dd>{formatMaybeNumber(result.noise_power)} dBm</dd>
      <dt>Receiver</dt><dd>{formatPositionValue(result.receiver_position)}</dd>
    </dl>
  );
}

function ThroughputResult({ result }) {
  const comparison = result.comparison || {};

  return (
    <dl className="detail-grid">
      <dt>Status</dt><dd>{formatText(result.status)}</dd>
      <dt>Base tilt</dt><dd>{formatMaybeNumber(comparison.base_tilt_deg)} deg</dd>
      <dt>Target tilt</dt><dd>{formatMaybeNumber(comparison.target_tilt_deg)} deg</dd>
      <dt>Base throughput</dt><dd>{formatMaybeNumber(comparison.base_throughput_mbps)} Mbps</dd>
      <dt>Target throughput</dt><dd>{formatMaybeNumber(comparison.target_throughput_mbps)} Mbps</dd>
      <dt>Delta</dt><dd>{formatMaybeNumber(comparison.delta_mbps)} Mbps</dd>
      <dt>Change</dt><dd>{formatMaybeNumber(comparison.percentage_change)}%</dd>
      <dt>Direction</dt><dd>{formatText(comparison.direction)}</dd>
    </dl>
  );
}

function useApiResult() {
  const [state, setState] = useState({
    error: "",
    loading: false,
    result: null,
  });

  async function run(requestFactory) {
    setState({
      error: "",
      loading: true,
      result: null,
    });

    try {
      const result = await requestFactory();

      if (result.status && result.status !== "success") {
        throw new Error(result.error || "API returned failure.");
      }

      setState({
        error: "",
        loading: false,
        result,
      });
    } catch (error) {
      setState({
        error: error.message,
        loading: false,
        result: null,
      });
    }
  }

  return [state, run];
}

function updateForm(setForm, field, value) {
  setForm((current) => ({
    ...current,
    [field]: value,
  }));
}

function updateObject(onChange, current, field, value) {
  onChange({
    ...current,
    [field]: value,
  });
}

function replaceArrayValue(values, index, value) {
  return values.map((item, itemIndex) => (
    itemIndex === index ? value : item
  ));
}

function parseNumericInput(value) {
  return value === "" ? "" : Number(value);
}
