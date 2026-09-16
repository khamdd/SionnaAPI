import { EMPTY_ARRAY } from "../../constants";
import { parseAntennaNumericInput } from "../../utils/antennas";

const SINR_ROLES = [
  { key: "transmitter", label: "Transmitter" },
  { key: "interferer", label: "Interferer" },
];

function SinrRoleFields({
  antennas,
  error,
  onChange,
  onReceiverCoordinateModeChange,
  onReceiverPositionChange,
  receiverCoordinateMode = "meters",
  receiverPosition,
  roles,
  simulationLabel = "SINR",
}) {
  const availableAntennas = Array.isArray(antennas) ? antennas : EMPTY_ARRAY;

  function updateRole(role, antennaId) {
    onChange?.({
      ...roles,
      [role]: antennaId,
    });
  }

  return (
    <>
      {availableAntennas.length < 1 && (
        <p className="form-help">
          Add at least one antenna before running {simulationLabel}.
        </p>
      )}
      {SINR_ROLES.map((role) => (
        <label className="form-field" key={role.key}>
          <span>{role.label}</span>
          <select
            value={roles[role.key] || ""}
            required={role.key === "transmitter"}
            onChange={(event) => updateRole(role.key, event.target.value)}
          >
            <option value="">Select {role.label.toLowerCase()}</option>
            {availableAntennas.map((antenna) => (
              <option key={antenna.id} value={antenna.id}>
                {antenna.id} ({antenna._type === "type2" ? "Added antenna" : "Fixed antenna"})
              </option>
            ))}
          </select>
        </label>
      ))}
      <fieldset className="form-subsection">
        <legend className="receiver-point-heading">
          <span>Receiver point</span>
          <button
            className="ghost-button"
            type="button"
            aria-label={`Switch receiver coordinates to ${receiverCoordinateMode === "meters" ? "GPS" : "scene meters"}`}
            title={receiverCoordinateMode === "meters" ? "Switch to latitude/longitude" : "Switch to scene meters"}
            onClick={() => onReceiverCoordinateModeChange?.(
              receiverCoordinateMode === "meters" ? "latlon" : "meters",
            )}
          >
            {receiverCoordinateMode === "meters" ? "m" : "GPS"}
          </button>
        </legend>
        <p className="form-help">
          The receiver is a measurement point, not an antenna.
        </p>
        {[
          ...(receiverCoordinateMode === "latlon"
            ? [["longitude", "Receiver longitude"], ["latitude", "Receiver latitude"], ["height_m", "Receiver height"]]
            : [["x", "Receiver X"], ["y", "Receiver Y"], ["z", "Receiver height"]]),
        ].map(([key, label]) => (
          <NumberField
            key={key}
            label={label}
            unit="m"
            value={receiverPosition?.[key] ?? ""}
            min={key === "z" ? 0 : undefined}
            onChange={(value) => onReceiverPositionChange?.({
              ...(receiverPosition || {}),
              [key]: value,
            })}
          />
        ))}
      </fieldset>
      {error && <small className="field-error">{error}</small>}
      <p className="form-help">
        {simulationLabel} requires one transmitter and one receiver point. An interferer antenna is optional.
      </p>
    </>
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

function PropagationFields({ form, includeBandwidth = false, onChange }) {
  const isAnalytical = form.propagation_model !== "sionna";

  return (
    <FormSection title="Propagation">
      <label className="form-field">
        <span>Model</span>
        <div>
          <select
            value={form.propagation_model}
            onChange={(event) => updateForm(onChange, "propagation_model", event.target.value)}
          >
            <option value="sionna">Sionna 3D ray tracing</option>
            <option value="uma">UMa</option>
            <option value="ericsson">Ericsson</option>
            <option value="friis">Friis</option>
          </select>
          <small className="input-hint">
            {isAnalytical
              ? `Uses only the ${formatPropagationModel(form.propagation_model)} formula without 3D ray tracing.`
              : "Uses the selected 3D scene, antenna pattern, and tilt."}
          </small>
        </div>
      </label>
      {isAnalytical && (
        <>
          <NumberField
            hint={`Carrier frequency used by the ${formatPropagationModel(form.propagation_model)} formula.`}
            label="Frequency"
            min={0.01}
            max={100}
            unit="GHz"
            value={form.carrier_frequency_ghz}
            onChange={(value) => updateForm(onChange, "carrier_frequency_ghz", value)}
          />
          {includeBandwidth && (
            <NumberField
              hint="Used to calculate thermal noise."
              label="Bandwidth"
              min={0.01}
              unit="MHz"
              value={form.bandwidth_mhz}
              onChange={(value) => updateForm(onChange, "bandwidth_mhz", value)}
            />
          )}
          <NumberField
            hint="Receiver noise figure from 0 to 30 dB."
            label="Noise figure"
            min={0}
            max={30}
            unit="dB"
            value={form.noise_figure_db}
            onChange={(value) => updateForm(onChange, "noise_figure_db", value)}
          />
        </>
      )}
    </FormSection>
  );
}

export function SolverFields({ solver, onChange }) {
  return (
    <FormSection title="Solver">
      <NumberField hint="0 to 10." label="Max depth" value={solver.max_depth} min={0} max={10} step={1} onChange={(value) => updateObject(onChange, solver, "max_depth", value)} />
      <NumberField hint="1 to 10,000,000." label="Samples per TX" value={solver.samples_per_tx} min={1} max={10000000} step={1} onChange={(value) => updateObject(onChange, solver, "samples_per_tx", value)} />
      <NumberField hint="0.1 to 50 m." label="Cell size" unit="m" value={solver.cell_size} min={0.1} max={50} step="any" onChange={(value) => updateObject(onChange, solver, "cell_size", value)} />
    </FormSection>
  );
}

function NumberField({ hint = "", label, max, min, onChange, step = "any", unit = "", value }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <div>
        <div className="input-with-unit">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            required
            onChange={(event) => onChange(parseAntennaNumericInput(event.target.value))}
          />
          {unit && <small>{unit}</small>}
        </div>
        {hint && <small className="input-hint">{hint}</small>}
      </div>
    </label>
  );
}

function formatPropagationModel(value) {
  const labels = {
    sionna: "Sionna 3D",
    uma: "UMa",
    ericsson: "Ericsson",
    friis: "Friis",
  };

  return labels[value] || "Sionna 3D";
}

function updateObject(onChange, current, field, value) {
  onChange({
    ...current,
    [field]: value,
  });
}

function updateForm(setForm, field, value) {
  setForm((current) => ({
    ...current,
    [field]: value,
  }));
}


export {
  FormSection,
  NumberField,
  PropagationFields,
  SINR_ROLES,
  SinrRoleFields,
  formatPropagationModel,
};
