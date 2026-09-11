import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildSimulationProfileRequest,
  createSimulationProfile,
  deleteSimulationProfile,
  listNetworkConfigurations,
  listSimulationProfiles,
  setSimulationProfileEnabled,
  updateSimulationProfile,
} from "../api";
import {
  DEFAULT_RSRP_RANDOM_SEED,
  DEFAULT_RSRP_USER_COUNT,
  DEFAULT_USER_HEIGHT_M,
  TRANSMITTER_PATTERN,
} from "../constants";
import { isAntennaEnabled } from "../utils/antennas";
import { formatDateTime, formatSimulationType } from "../utils/format";
import { solverForScene } from "../utils/scene";


const PROFILE_TYPES = [
  ["network_coverage", "Network Coverage", "Area coverage and overlap across all enabled antennas."],
  ["coverage_map", "Coverage Map", "Single-transmitter ray-traced coverage map."],
  ["rsrp_simulation", "RSRP", "Sampled user signal strength across the scene."],
  ["sinr", "SINR", "Serving and interfering link quality at a receiver."],
  ["throughput_comparison", "Throughput", "Before-and-after throughput for two transmitter tilts."],
];

const PROPAGATION_MODELS = [
  ["sionna", "Sionna 3D ray tracing"],
  ["uma", "UMa"],
  ["ericsson", "Ericsson"],
  ["friis", "Friis"],
];

const ROLE_TYPES = {
  coverage_map: [["transmitter", "Transmitter"]],
  sinr: [
    ["transmitter", "Transmitter"],
    ["receiver", "Receiver"],
    ["interferer", "Interferer"],
  ],
  throughput_comparison: [
    ["transmitter", "Transmitter"],
    ["receiver", "Receiver"],
    ["interferer", "Interferer"],
  ],
};


export default function SimulationProfilesPage({ activeScene, currentUser }) {
  const [profiles, setProfiles] = useState([]);
  const [configurations, setConfigurations] = useState([]);
  const [validationConfigurationId, setValidationConfigurationId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState(null);
  const [validation, setValidation] = useState({ state: "idle" });

  const published = useMemo(
    () => configurations.find((item) => item.status === "published") || null,
    [configurations],
  );
  const selected = useMemo(
    () => profiles.find((item) => item.id === selectedId) || null,
    [profiles, selectedId],
  );
  const validationConfiguration = useMemo(
    () => configurations.find(
      (item) => item.id === validationConfigurationId,
    ) || null,
    [configurations, validationConfigurationId],
  );
  const enabledProfiles = useMemo(
    () => profiles.filter((item) => item.enabled),
    [profiles],
  );
  const validationAntennas = useMemo(
    () => (validationConfiguration?.antennas || []).filter(isAntennaEnabled),
    [validationConfiguration],
  );

  const loadWorkspace = useCallback(async (preferredId = null) => {
    setIsLoading(true);
    try {
      const [profileResult, configurationResult] = await Promise.all([
        listSimulationProfiles(activeScene.id),
        listNetworkConfigurations(activeScene.id),
      ]);
      const nextProfiles = profileResult.profiles || [];
      setProfiles(nextProfiles);
      setConfigurations(configurationResult.configurations || []);
      setSelectedId((current) => chooseSelectedProfile(
        nextProfiles,
        preferredId || current,
      ));
      setNotice((current) => (current?.kind === "error" ? null : current));
    } catch (error) {
      setProfiles([]);
      setConfigurations([]);
      setSelectedId(null);
      setNotice({
        kind: "error",
        message: `Simulation profiles could not be loaded: ${error.message}`,
      });
    } finally {
      setIsLoading(false);
    }
  }, [activeScene.id]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    setValidationConfigurationId((current) => {
      if (configurations.some((item) => item.id === current)) {
        return current;
      }
      return published?.id || configurations[0]?.id || null;
    });
  }, [configurations, published]);

  useEffect(() => {
    if (editor || !selected || !validationConfiguration) {
      setValidation({ state: "idle" });
      return undefined;
    }

    let active = true;
    setValidation({ state: "loading" });
    buildSimulationProfileRequest(selected.id, validationConfiguration.id)
      .then((result) => {
        if (active) {
          setValidation({ state: "valid", result });
        }
      })
      .catch((error) => {
        if (active) {
          setValidation({ state: "invalid", message: error.message });
        }
      });

    return () => {
      active = false;
    };
  }, [editor, selected, validationConfiguration]);

  function startCreate() {
    setEditor({
      mode: "create",
      profileId: null,
      draft: createProfileDraft("network_coverage", activeScene),
    });
    setNotice({
      kind: "info",
      message: "New profile started. It will remain disabled until validation succeeds.",
    });
  }

  function startEdit(profile) {
    if (profile.enabled) {
      setNotice({
        kind: "error",
        message: "Disable this profile before editing its simulation settings.",
      });
      return;
    }
    setEditor({
      mode: "edit",
      profileId: profile.id,
      draft: {
        name: profile.name,
        simulation_type: profile.simulation_type,
        request_template: structuredClone(profile.request_template || {}),
      },
    });
    setNotice({ kind: "info", message: `Editing ${profile.name}.` });
  }

  function discardEditor() {
    if (!window.confirm("Discard the unsaved simulation profile changes?")) {
      return;
    }
    setEditor(null);
    setNotice(null);
  }

  function updateDraft(nextDraft) {
    setEditor((current) => ({ ...current, draft: nextDraft }));
  }

  function changeProfileType(simulationType) {
    setEditor((current) => ({
      ...current,
      draft: {
        ...createProfileDraft(simulationType, activeScene),
        name: current.draft.name,
      },
    }));
  }

  async function saveProfile(event) {
    event.preventDefault();
    const name = String(editor?.draft?.name || "").trim();
    if (!name) {
      setNotice({ kind: "error", message: "Enter a profile name before saving." });
      return;
    }

    setAction("saving");
    setNotice({ kind: "info", message: "Saving simulation profile..." });
    const payload = {
      name,
      simulation_type: editor.draft.simulation_type,
      request_template: normalizeTemplate(editor.draft.request_template),
    };
    try {
      const result = editor.mode === "create"
        ? await createSimulationProfile({
          scene_id: activeScene.id,
          enabled: false,
          ...payload,
        })
        : await updateSimulationProfile(editor.profileId, payload);
      setEditor(null);
      setNotice({
        kind: "success",
        message: `${result.profile.name} saved as disabled.`,
      });
      await loadWorkspace(result.profile.id);
    } catch (error) {
      setNotice({ kind: "error", message: `Profile could not be saved: ${error.message}` });
    } finally {
      setAction("");
    }
  }

  async function toggleSelected() {
    if (!selected || !isOwner(selected, currentUser)) {
      return;
    }
    const nextEnabled = !selected.enabled;
    setAction(nextEnabled ? "enabling" : "disabling");
    setNotice({
      kind: "info",
      message: nextEnabled
        ? `Validating profile against ${configurationLabel(validationConfiguration)}...`
        : "Removing profile eligibility...",
    });
    try {
      if (nextEnabled && !validationConfiguration) {
        throw new Error("Choose a validation configuration first.");
      }
      const result = await setSimulationProfileEnabled(
        selected.id,
        nextEnabled,
        validationConfiguration?.id,
      );
      setNotice({
        kind: "success",
        message: nextEnabled
          ? `${result.profile.name} is eligible after validation against ${configurationLabel(validationConfiguration)}.`
          : `${result.profile.name} disabled.`,
      });
      await loadWorkspace(result.profile.id);
    } catch (error) {
      setNotice({
        kind: "error",
        message: nextEnabled
          ? `Profile could not be made eligible: ${error.message}`
          : `Profile could not be disabled: ${error.message}`,
      });
    } finally {
      setAction("");
    }
  }

  async function removeSelected() {
    if (!selected || !isOwner(selected, currentUser)) {
      return;
    }
    if (!window.confirm(
      `Delete simulation profile "${selected.name}"? This cannot be undone.`,
    )) {
      return;
    }

    setAction("deleting");
    setNotice({ kind: "info", message: "Deleting simulation profile..." });
    try {
      await deleteSimulationProfile(selected.id);
      setNotice({ kind: "success", message: `${selected.name} deleted.` });
      await loadWorkspace();
    } catch (error) {
      setNotice({ kind: "error", message: `Profile could not be deleted: ${error.message}` });
    } finally {
      setAction("");
    }
  }

  const busy = isLoading || Boolean(action);
  const activeDraft = editor?.draft || null;
  const draftChecks = activeDraft
    ? evaluateProfileDraft(
      activeDraft,
      validationConfiguration,
      validationAntennas,
    )
    : [];

  return (
    <main className="route-page profiles-page">
      <header className="page-title with-action profiles-title">
        <div>
          <h1>Simulation profiles</h1>
          <p>
            Define how {activeScene.name} should be tested. Eligible profiles can be
            selected independently for either side of a scenario comparison.
          </p>
        </div>
        <div className="page-title-actions">
          <button className="ghost-button" type="button" disabled={busy} onClick={() => loadWorkspace()}>
            Refresh
          </button>
          <button className="primary-button" type="button" disabled={busy || Boolean(editor)} onClick={startCreate}>
            Create profile
          </button>
        </div>
      </header>

      {notice && (
        <p className={`profiles-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.message}
        </p>
      )}

      <div className="profiles-workspace">
        <ProfileRail
          currentUser={currentUser}
          disabled={busy || Boolean(editor)}
          isLoading={isLoading}
          onSelect={setSelectedId}
          profiles={profiles}
          selectedId={selectedId}
        />
        <ProfileWorkbench
          action={action}
          antennas={validationAntennas}
          currentUser={currentUser}
          editor={editor}
          onChange={updateDraft}
          onDelete={removeSelected}
          onDiscard={discardEditor}
          onEdit={startEdit}
          onSave={saveProfile}
          onToggle={toggleSelected}
          onTypeChange={changeProfileType}
          validationConfiguration={validationConfiguration}
          selected={selected}
        />
        <ProfileValidation
          checks={draftChecks}
          configurations={configurations}
          editor={editor}
          enabledCount={enabledProfiles.length}
          onConfigurationChange={setValidationConfigurationId}
          selected={selected}
          validation={validation}
          validationConfiguration={validationConfiguration}
          validationConfigurationId={validationConfigurationId}
        />
      </div>
    </main>
  );
}


function ProfileRail({ currentUser, disabled, isLoading, onSelect, profiles, selectedId }) {
  const groups = [
    ["Eligible profiles", profiles.filter((profile) => profile.enabled)],
    ["Disabled drafts", profiles.filter((profile) => !profile.enabled)],
  ];
  return (
    <aside className="profiles-rail" aria-label="Simulation profiles">
      <div className="profiles-panel-heading">
        <div><h2>Profile ledger</h2><span>{profiles.length} saved</span></div>
      </div>
      {isLoading && <p className="profiles-empty">Loading profiles...</p>}
      {!isLoading && profiles.length === 0 && (
        <p className="profiles-empty">No profiles yet. Create one to define the first repeatable test.</p>
      )}
      {!isLoading && groups.map(([label, items]) => items.length > 0 && (
        <section className="profiles-group" key={label}>
          <h3>{label}</h3>
          {items.map((profile, index) => (
            <button
              className={`profile-ledger-item ${profile.id === selectedId ? "active" : ""} ${profile.enabled ? "enabled" : ""}`}
              disabled={disabled}
              key={profile.id}
              type="button"
              onClick={() => onSelect(profile.id)}
            >
              <span className="profile-stack-index">{profile.enabled ? index + 1 : "–"}</span>
              <span>
                <strong>{profile.name}</strong>
                <small>{formatSimulationType(profile.simulation_type)}</small>
              </span>
              <span className={`profile-state ${profile.enabled ? "enabled" : "disabled"}`}>
                {isOwner(profile, currentUser) ? (profile.enabled ? "Eligible" : "Draft") : "Shared"}
              </span>
            </button>
          ))}
        </section>
      ))}
    </aside>
  );
}


function ProfileWorkbench({
  action,
  antennas,
  currentUser,
  editor,
  onChange,
  onDelete,
  onDiscard,
  onEdit,
  onSave,
  onToggle,
  onTypeChange,
  selected,
  validationConfiguration,
}) {
  if (editor) {
    return (
      <form className="profiles-workbench profile-editor" onSubmit={onSave} noValidate>
        <div className="profiles-panel-heading editor-heading">
          <div>
            <h2>{editor.mode === "create" ? "New profile" : `Edit ${editor.draft.name}`}</h2>
            <span>Saved independently from antenna configuration versions</span>
          </div>
          <span className="profile-state disabled">Unsaved</span>
        </div>
        <fieldset disabled={Boolean(action)}>
          <ProfileEditorFields
            antennas={antennas}
            draft={editor.draft}
            onChange={onChange}
            onTypeChange={onTypeChange}
            validationConfiguration={validationConfiguration}
          />
        </fieldset>
        <div className="profiles-action-bar">
          <span>Save first, then validate against a configuration to make this profile eligible.</span>
          <div>
            <button className="ghost-button" type="button" disabled={Boolean(action)} onClick={onDiscard}>Discard changes</button>
            <button className="primary-button" type="submit" disabled={Boolean(action)}>
              {action === "saving" ? "Saving..." : "Save profile"}
            </button>
          </div>
        </div>
      </form>
    );
  }

  if (!selected) {
    return (
      <section className="profiles-workbench profiles-blank">
        <div>
          <h2>Define the first repeatable test</h2>
          <p>Create a profile, assign its solver and radio settings, then validate it against a configuration.</p>
        </div>
      </section>
    );
  }

  const owner = isOwner(selected, currentUser);
  const template = selected.request_template || {};
  return (
    <section className="profiles-workbench">
      <div className="profiles-panel-heading workbench-heading">
        <div><h2>{selected.name}</h2><span>{formatSimulationType(selected.simulation_type)}</span></div>
        <span className={`profile-state ${selected.enabled ? "enabled" : "disabled"}`}>
          {selected.enabled ? "Eligible" : "Disabled"}
        </span>
      </div>
      <dl className="profile-meta">
        <div><dt>Updated</dt><dd>{formatDateTime(selected.updated_at)}</dd></div>
        <div><dt>Access</dt><dd>{owner ? "Owned by you" : "Shared read-only"}</dd></div>
        <div><dt>Validation target</dt><dd>{configurationLabel(validationConfiguration)}</dd></div>
      </dl>
      <ProfileSummary profile={selected} template={template} />
      <div className="profile-template-block">
        <details>
          <summary>Saved request template</summary>
          <pre>{JSON.stringify(template, null, 2)}</pre>
        </details>
      </div>
      <div className="profiles-action-bar">
        <span>{owner ? (selected.enabled ? "Disable this profile before editing its simulation settings." : "Validate against the configuration that supplies its antenna roles.") : "Only the creator can change this project-shared profile."}</span>
        <div>
          {owner && (
            <button className="ghost-button danger-button" type="button" disabled={Boolean(action)} onClick={onDelete}>
              {action === "deleting" ? "Deleting..." : "Delete"}
            </button>
          )}
          {owner && <button className="ghost-button" type="button" disabled={Boolean(action) || selected.enabled} title={selected.enabled ? "Disable this profile before editing" : undefined} onClick={() => onEdit(selected)}>Edit</button>}
          {owner && (
            <button className="primary-button" type="button" disabled={Boolean(action) || (!selected.enabled && !validationConfiguration)} onClick={onToggle}>
              {action === "enabling" ? "Validating..." : action === "disabling" ? "Disabling..." : selected.enabled ? "Disable profile" : "Validate and make eligible"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}


function ProfileEditorFields({
  antennas,
  draft,
  onChange,
  onTypeChange,
  validationConfiguration,
}) {
  const template = draft.request_template;
  const type = draft.simulation_type;
  return (
    <div className="profile-editor-fields">
      <section className="profile-form-section profile-identity-section">
        <div className="profile-section-heading"><h3>Identity</h3><p>Name the test and choose the simulation it builds.</p></div>
        <div className="profile-form-grid two-column">
          <TextField label="Profile name" value={draft.name} maxLength={120} onChange={(name) => onChange({ ...draft, name })} />
          <label className="profile-field">
            <span>Simulation type</span>
            <select value={type} onChange={(event) => onTypeChange(event.target.value)}>
              {PROFILE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <p className="profile-type-note">{profileTypeInfo(type)[2]}</p>
      </section>

      {ROLE_TYPES[type] && (
        <RoleFields
          antennas={antennas}
          validationConfiguration={validationConfiguration}
          roles={template.roles || {}}
          roleTypes={ROLE_TYPES[type]}
          onChange={(roles) => onTemplateChange(draft, onChange, "roles", roles)}
        />
      )}

      {(type === "sinr" || type === "throughput_comparison") && (
        <RadioFields draft={draft} onChange={onChange} includeBandwidth={type === "sinr"} />
      )}

      {type === "rsrp_simulation" && <RsrpFields draft={draft} onChange={onChange} />}

      {type === "network_coverage" && (
        <NetworkFields draft={draft} onChange={onChange} />
      )}

      {type === "throughput_comparison" && (
        <ThroughputFields draft={draft} onChange={onChange} />
      )}

      <SolverFields draft={draft} onChange={onChange} />

      <section className="profile-form-section">
        <div className="profile-section-heading"><h3>Antenna pattern</h3><p>Pattern ID passed to the simulation request.</p></div>
        <div className="profile-form-grid">
          <TextField label="Pattern" value={template.transmitter_pattern ?? ""} onChange={(value) => onTemplateChange(draft, onChange, "transmitter_pattern", value)} />
        </div>
      </section>

    </div>
  );
}


function RoleFields({
  antennas,
  onChange,
  roles,
  roleTypes,
  validationConfiguration,
}) {
  return (
    <section className="profile-form-section role-section">
      <div className="profile-section-heading">
        <div><h3>Antenna roles</h3><p>Roles resolve from the selected validation configuration.</p></div>
        <span>{antennas.length} enabled antennas available</span>
      </div>
      {!validationConfiguration && (
        <p className="profile-inline-warning">
          Choose a configuration before assigning antenna roles.
        </p>
      )}
      <div className="profile-role-grid">
        {roleTypes.map(([role, label]) => (
          <label className="profile-field" key={role}>
            <span>{label}</span>
            <select value={roles[role] || ""} onChange={(event) => onChange({ ...roles, [role]: event.target.value })}>
              <option value="">Choose antenna</option>
              {antennas.map((antenna) => <option value={antenna.id} key={antenna.id}>{antenna.id}</option>)}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}


function RadioFields({ draft, includeBandwidth, onChange }) {
  const template = draft.request_template;
  return (
    <section className="profile-form-section">
      <div className="profile-section-heading"><h3>Propagation and radio</h3><p>Keep radio assumptions explicit so repeated studies remain comparable.</p></div>
      <div className="profile-form-grid">
        <label className="profile-field">
          <span>Propagation model</span>
          <select value={template.propagation_model} onChange={(event) => onTemplateChange(draft, onChange, "propagation_model", event.target.value)}>
            {PROPAGATION_MODELS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <NumberField label="Carrier frequency" unit="GHz" min={0.01} max={100} value={template.carrier_frequency_ghz} onChange={(value) => onTemplateChange(draft, onChange, "carrier_frequency_ghz", value)} />
        {includeBandwidth && <NumberField label="Bandwidth" unit="MHz" min={0.01} value={template.bandwidth_mhz} onChange={(value) => onTemplateChange(draft, onChange, "bandwidth_mhz", value)} />}
        <NumberField label="Noise figure" unit="dB" min={0} max={30} value={template.noise_figure_db} onChange={(value) => onTemplateChange(draft, onChange, "noise_figure_db", value)} />
      </div>
    </section>
  );
}


function NetworkFields({ draft, onChange }) {
  const template = draft.request_template;
  return (
    <section className="profile-form-section">
      <div className="profile-section-heading"><h3>Radio capacity</h3><p>These settings belong to this profile and may differ between scenarios.</p></div>
      <div className="profile-form-grid">
        <NumberField label="Bandwidth" unit="MHz" min={0.01} value={template.bandwidth_mhz} onChange={(value) => onTemplateChange(draft, onChange, "bandwidth_mhz", value)} />
        <NumberField label="MIMO layers" min={1} step={1} value={template.mimo_layers} onChange={(value) => onTemplateChange(draft, onChange, "mimo_layers", value)} />
      </div>
    </section>
  );
}


function RsrpFields({ draft, onChange }) {
  const template = draft.request_template;
  return (
    <section className="profile-form-section">
      <div className="profile-section-heading"><h3>User sampling</h3><p>Control the repeatable receiver population used for RSRP.</p></div>
      <div className="profile-form-grid">
        <NumberField label="User count" min={1} max={5000} step={1} value={template.user_count} onChange={(value) => onTemplateChange(draft, onChange, "user_count", value)} />
        <NumberField label="User height" unit="m" min={0.5} max={10} value={template.user_height_m} onChange={(value) => onTemplateChange(draft, onChange, "user_height_m", value)} />
        <NumberField label="Random seed" min={0} step={1} value={template.random_seed} onChange={(value) => onTemplateChange(draft, onChange, "random_seed", value)} />
      </div>
    </section>
  );
}


function ThroughputFields({ draft, onChange }) {
  const template = draft.request_template;
  return (
    <section className="profile-form-section">
      <div className="profile-section-heading"><h3>Throughput comparison</h3><p>Compare the same transmitter at two tilt settings.</p></div>
      <div className="profile-form-grid">
        <NumberField label="Base tilt" unit="deg" value={template.base_tilt} onChange={(value) => onTemplateChange(draft, onChange, "base_tilt", value)} />
        <NumberField label="Target tilt" unit="deg" value={template.target_tilt} onChange={(value) => onTemplateChange(draft, onChange, "target_tilt", value)} />
        <NumberField label="Bandwidth" unit="MHz" min={0.01} value={template.bandwidth_mhz} onChange={(value) => onTemplateChange(draft, onChange, "bandwidth_mhz", value)} />
        <NumberField label="MIMO layers" min={1} step={1} value={template.mimo_layers} onChange={(value) => onTemplateChange(draft, onChange, "mimo_layers", value)} />
      </div>
    </section>
  );
}


function SolverFields({ draft, onChange }) {
  const solver = draft.request_template.solver || {};
  const updateSolver = (field, value) => onTemplateChange(draft, onChange, "solver", { ...solver, [field]: value });
  return (
    <section className="profile-form-section">
      <div className="profile-section-heading"><h3>Solver</h3><p>The study reuses these exact resolution and ray-depth settings.</p></div>
      <div className="profile-form-grid">
        <NumberField label="Max depth" min={0} max={10} step={1} value={solver.max_depth} onChange={(value) => updateSolver("max_depth", value)} />
        <NumberField label="Samples per TX" min={1} max={10000000} step={1} value={solver.samples_per_tx} onChange={(value) => updateSolver("samples_per_tx", value)} />
        <NumberField label="Cell size" unit="m" min={0.1} max={50} value={solver.cell_size} onChange={(value) => updateSolver("cell_size", value)} />
        <VectorField labels={["x", "y", "z"]} label="Grid center" value={solver.center || [0, 0, 0]} onChange={(value) => updateSolver("center", value)} />
        <VectorField labels={["width", "height"]} label="Grid size" unit="m" value={solver.size || [400, 400]} onChange={(value) => updateSolver("size", value)} />
      </div>
    </section>
  );
}


function TextField({ label, maxLength, onChange, value }) {
  return <label className="profile-field"><span>{label}</span><input type="text" maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}


function NumberField({ label, max, min, onChange, step = "any", unit = "", value }) {
  return (
    <label className="profile-field">
      <span>{label}</span>
      <span className="profile-unit-input">
        <input type="number" min={min} max={max} step={step} value={value ?? ""} onChange={(event) => onChange(parseNumber(event.target.value))} />
        {unit && <i>{unit}</i>}
      </span>
    </label>
  );
}


function VectorField({ label, labels, onChange, unit = "", value }) {
  return (
    <label className="profile-field profile-vector-field">
      <span>{label}</span>
      <span className="profile-vector-input">
        {labels.map((axis, index) => (
          <span key={axis}><input aria-label={`${label} ${axis}`} type="number" step="any" value={value[index] ?? ""} onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? parseNumber(event.target.value) : item))} /><small>{axis}{unit ? ` ${unit}` : ""}</small></span>
        ))}
      </span>
    </label>
  );
}


function ProfileSummary({ profile, template }) {
  const typeInfo = profileTypeInfo(profile.simulation_type);
  const roles = template.roles || {};
  const roleText = Object.entries(roles).map(([role, antenna]) => `${role}: ${antenna || "unassigned"}`).join(", ");
  return (
    <div className="profile-summary">
      <section><h3>Purpose</h3><p>{typeInfo[2]}</p></section>
      <section><h3>Execution</h3><p>{template.propagation_model ? propagationLabel(template.propagation_model) : "Sionna scene simulation"}; {template.solver?.cell_size ?? "–"} m cells; {Number(template.solver?.samples_per_tx || 0).toLocaleString()} samples per transmitter.</p></section>
      {roleText && <section><h3>Roles</h3><p>{roleText}</p></section>}
    </div>
  );
}


function ProfileValidation({
  checks,
  configurations,
  editor,
  enabledCount,
  onConfigurationChange,
  selected,
  validation,
  validationConfiguration,
  validationConfigurationId,
}) {
  let validationBody;
  if (editor) {
    validationBody = (
      <>
        <ul className="profile-check-list">
          {checks.map((check) => <li className={check.ok ? "pass" : "fail"} key={check.label}><i aria-hidden="true">{check.ok ? "✓" : "!"}</i><span><strong>{check.label}</strong><small>{check.detail}</small></span></li>)}
        </ul>
        <details className="profile-json-preview">
          <summary>Unsaved request template</summary>
          <pre>{JSON.stringify(normalizeTemplate(editor.draft.request_template), null, 2)}</pre>
        </details>
      </>
    );
  } else if (!validationConfiguration) {
    validationBody = <p className="profiles-empty error-text">No readable network configuration is available. Create a configuration before making profiles eligible.</p>;
  } else if (!selected) {
    validationBody = <p className="profiles-empty">Select a profile to validate it against this configuration.</p>;
  } else if (validation.state === "loading") {
    validationBody = <p className="profiles-empty">Building the exact request...</p>;
  } else if (validation.state === "invalid") {
    validationBody = <div className="profile-validation-result invalid"><strong>Not ready for eligibility</strong><p>{validation.message}</p></div>;
  } else if (validation.state === "valid") {
    validationBody = (
      <div className="profile-validation-result valid">
        <strong>Valid against {configurationLabel(validationConfiguration)}</strong>
        <p>The server built an exact {formatSimulationType(selected.simulation_type)} request.</p>
        <details><summary>Resolved request</summary><pre>{JSON.stringify(validation.result.request, null, 2)}</pre></details>
      </div>
    );
  } else {
    validationBody = <p className="profiles-empty">Validation is waiting for a saved profile and configuration.</p>;
  }

  return (
    <aside className="profiles-validation" aria-label="Profile eligibility">
      <div className="profiles-panel-heading"><div><h2>Eligibility</h2><span>{enabledCount} available for selection</span></div></div>
      <div className="run-stack-strip"><span>{enabledCount}</span><p><strong>eligible profiles</strong><small>Each can be selected for either scenario side</small></p></div>
      <label className="profile-validation-target">
        <span>Validate against</span>
        <select
          disabled={configurations.length === 0}
          value={validationConfigurationId || ""}
          onChange={(event) => onConfigurationChange(event.target.value || null)}
        >
          {configurations.length === 0 && <option value="">No configurations</option>}
          {configurations.map((configuration) => (
            <option key={configuration.id} value={configuration.id}>
              {configurationOptionLabel(configuration)}
            </option>
          ))}
        </select>
        <small>Published is the default; readable drafts and superseded versions are also valid targets.</small>
      </label>
      {validationBody}
    </aside>
  );
}


function createProfileDraft(simulationType, activeScene) {
  const solver = solverForScene(activeScene);
  const templates = {
    network_coverage: {
      transmitter_pattern: TRANSMITTER_PATTERN,
      solver,
      bandwidth_mhz: 100,
      mimo_layers: 4,
    },
    coverage_map: {
      roles: { transmitter: "" },
      transmitter_pattern: TRANSMITTER_PATTERN,
      solver,
    },
    rsrp_simulation: {
      transmitter_pattern: TRANSMITTER_PATTERN,
      solver,
      user_count: DEFAULT_RSRP_USER_COUNT,
      user_height_m: DEFAULT_USER_HEIGHT_M,
      random_seed: DEFAULT_RSRP_RANDOM_SEED,
    },
    sinr: {
      roles: { transmitter: "", receiver: "", interferer: "" },
      propagation_model: "sionna",
      carrier_frequency_ghz: 3.5,
      bandwidth_mhz: 100,
      noise_figure_db: 7,
      transmitter_pattern: TRANSMITTER_PATTERN,
      solver,
    },
    throughput_comparison: {
      roles: { transmitter: "", receiver: "", interferer: "" },
      propagation_model: "sionna",
      carrier_frequency_ghz: 3.5,
      noise_figure_db: 7,
      base_tilt: 8,
      target_tilt: 12,
      transmitter_pattern: TRANSMITTER_PATTERN,
      bandwidth_mhz: 100,
      mimo_layers: 4,
      solver,
    },
  };
  return {
    name: "",
    simulation_type: simulationType,
    request_template: structuredClone(templates[simulationType]),
  };
}


function evaluateProfileDraft(draft, validationConfiguration, antennas) {
  const template = draft.request_template || {};
  const roles = ROLE_TYPES[draft.simulation_type] || [];
  const roleIds = roles.map(([role]) => template.roles?.[role]).filter(Boolean);
  const assignedRoles = roles.length === 0 || (
    roleIds.length === roles.length
    && new Set(roleIds).size === roleIds.length
    && roleIds.every((id) => antennas.some((antenna) => antenna.id === id))
  );
  const numericValues = requiredNumericValues(draft.simulation_type, template);
  const numericComplete = numericValues.every((value) => Number.isFinite(Number(value)));
  return [
    { ok: Boolean(String(draft.name || "").trim()), label: "Profile identity", detail: "A unique scene-level name is required." },
    { ok: Boolean(validationConfiguration), label: "Validation configuration", detail: validationConfiguration ? `${configurationLabel(validationConfiguration)} will resolve antennas.` : "Choose a readable configuration before validation." },
    { ok: numericComplete, label: "Explicit settings", detail: numericComplete ? "Required solver and radio values are present." : "One or more numeric settings are incomplete." },
    { ok: assignedRoles, label: "Antenna roles", detail: roles.length === 0 ? "This simulation uses every enabled configuration antenna." : assignedRoles ? "Distinct enabled antennas are assigned." : "Assign a different enabled antenna to every role." },
  ];
}


function requiredNumericValues(type, template) {
  const solver = template.solver || {};
  const values = [solver.max_depth, solver.samples_per_tx, solver.cell_size, ...(solver.center || []), ...(solver.size || [])];
  if (type === "network_coverage") values.push(template.bandwidth_mhz, template.mimo_layers);
  if (type === "rsrp_simulation") values.push(template.user_count, template.user_height_m, template.random_seed);
  if (type === "sinr") values.push(template.carrier_frequency_ghz, template.bandwidth_mhz, template.noise_figure_db);
  if (type === "throughput_comparison") values.push(template.carrier_frequency_ghz, template.noise_figure_db, template.base_tilt, template.target_tilt, template.bandwidth_mhz, template.mimo_layers);
  return values;
}


function normalizeTemplate(template) {
  const normalized = structuredClone(template || {});
  delete normalized.objectives;
  return normalized;
}


function onTemplateChange(draft, onChange, field, value) {
  onChange({ ...draft, request_template: { ...draft.request_template, [field]: value } });
}


function parseNumber(value) {
  return value === "" ? "" : Number(value);
}


function profileTypeInfo(type) {
  return PROFILE_TYPES.find(([value]) => value === type) || PROFILE_TYPES[0];
}


function propagationLabel(value) {
  return PROPAGATION_MODELS.find(([model]) => model === value)?.[1] || value;
}


function configurationLabel(configuration) {
  if (!configuration) return "Unavailable";
  return `${configurationStatusLabel(configuration.status)} v${configuration.version}`;
}


function configurationOptionLabel(configuration) {
  const source = configuration.source === "optimization"
    ? " (suggested)"
    : "";
  return `${configurationLabel(configuration)}${source}`;
}


function configurationStatusLabel(status) {
  if (status === "published") return "Published";
  if (status === "superseded") return "Superseded";
  if (status === "draft") return "Draft";
  return status || "Configuration";
}


function chooseSelectedProfile(profiles, preferredId) {
  if (profiles.some((profile) => profile.id === preferredId)) return preferredId;
  return profiles.find((profile) => profile.enabled)?.id || profiles[0]?.id || null;
}


function isOwner(profile, currentUser) {
  return Boolean(profile && currentUser?.id && String(profile.created_by) === String(currentUser.id));
}
