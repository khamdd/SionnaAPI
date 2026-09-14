import { useCallback, useEffect, useMemo, useState } from "react";
import {
  compareNetworkConfigurations,
  createNetworkConfiguration,
  listNetworkConfigurations,
  publishNetworkConfiguration,
} from "../api";
import {
  formatAntennaCoordinate,
} from "../utils/antennas";
import { formatDateTime, formatMaybeNumber } from "../utils/format";


export default function NetworkConfigurationsPage({
  activeScene,
  fixedAntennas = [],
}) {
  const [configurations, setConfigurations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [comparisonState, setComparisonState] = useState("idle");
  const [isLoading, setIsLoading] = useState(true);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState(null);

  const published = useMemo(
    () => configurations.find((item) => item.status === "published") || null,
    [configurations],
  );
  const selected = useMemo(
    () => configurations.find((item) => item.id === selectedId) || null,
    [configurations, selectedId],
  );

  const loadConfigurations = useCallback(async (preferredId = null) => {
    setIsLoading(true);
    try {
      const result = await listNetworkConfigurations(activeScene.id);
      const items = result.configurations || [];
      setConfigurations(items);
      setSelectedId((current) => chooseSelectedConfiguration(
        items,
        preferredId || current,
      ));
      setNotice((current) => (
        current?.kind === "error" ? null : current
      ));
    } catch (error) {
      setConfigurations([]);
      setSelectedId(null);
      setNotice({
        kind: "error",
        message: `Configurations could not be loaded: ${error.message}`,
      });
    } finally {
      setIsLoading(false);
    }
  }, [activeScene.id]);

  useEffect(() => {
    loadConfigurations();
  }, [loadConfigurations]);

  useEffect(() => {
    if (editor || !published || !selected || published.id === selected.id) {
      setComparison(null);
      setComparisonState("idle");
      return undefined;
    }

    let active = true;
    setComparison(null);
    setComparisonState("loading");
    compareNetworkConfigurations(published.id, selected.id)
      .then((result) => {
        if (!active) {
          return;
        }
        setComparison(result);
        setComparisonState("ready");
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setComparison({ error: error.message });
        setComparisonState("error");
      });

    return () => {
      active = false;
    };
  }, [editor, published, selected]);

  function startProposal(source = published) {
    const sourceAntennas = source?.antennas?.length
      ? source.antennas
      : [];
    setEditor({
      parent: source || null,
      antennas: sourceAntennas.map(toEditorAntenna),
    });
    setNotice({
      kind: "info",
      message: source
        ? `Working proposal started from version ${source.version}.`
        : "Working proposal started from the scene antenna inventory.",
    });
  }

  function addProposedAntenna(antennaIds) {
    const selectedIds = new Set(editor.antennas.map((item) => item.database_id));
    const additions = fixedAntennas.filter((item) => (
      antennaIds.includes(item.database_id) && !selectedIds.has(item.database_id)
    ));
    setEditor((current) => ({
      ...current,
      antennas: [...current.antennas, ...additions],
    }));
    return { ok: true };
  }

  function removeProposedAntenna(antennaId) {
    if (!window.confirm(`Remove antenna "${antennaId}" from this working proposal?`)) {
      return;
    }
    setEditor((current) => ({
      ...current,
      antennas: current.antennas.filter((antenna) => antenna.id !== antennaId),
    }));
  }

  function discardProposal() {
    if (!window.confirm("Discard the current unsaved proposal changes?")) {
      return;
    }
    setEditor(null);
    setNotice(null);
  }

  async function saveProposal() {
    if (!editor?.antennas.length) {
      setNotice({
        kind: "error",
        message: "Add at least one antenna before saving a configuration draft.",
      });
      return;
    }

    const antennaIds = editor.antennas.map((antenna) => antenna.database_id).filter(Boolean);
    if (antennaIds.length !== editor.antennas.length) {
      setNotice({ kind: "error", message: "Every configuration antenna must come from the inventory." });
      return;
    }

    setAction("saving");
    setNotice({ kind: "info", message: "Saving configuration draft..." });
    try {
      const result = await createNetworkConfiguration({
        scene_id: activeScene.id,
        parent_configuration_id: editor.parent?.id || null,
        source: "manual",
        source_reference: editor.parent
          ? `Configuration workspace proposal from version ${editor.parent.version}`
          : "Configuration workspace proposal from scene inventory",
        antenna_ids: antennaIds,
      });
      setEditor(null);
      setNotice({
        kind: "success",
        message: `Version ${result.configuration.version} saved as a draft.`,
      });
      await loadConfigurations(result.configuration.id);
    } catch (error) {
      setNotice({
        kind: "error",
        message: `Draft could not be saved: ${error.message}`,
      });
    } finally {
      setAction("");
    }
  }

  async function publishSelected() {
    if (!selected || selected.status !== "draft") {
      return;
    }
    const currentLabel = published
      ? ` and supersede published version ${published.version}`
      : " as the first published configuration";
    if (!window.confirm(
      `Publish configuration version ${selected.version}${currentLabel}? Its antenna membership cannot be edited after publishing.`,
    )) {
      return;
    }

    setAction("publishing");
    setNotice({ kind: "info", message: "Publishing configuration..." });
    try {
      const result = await publishNetworkConfiguration(selected.id);
      setNotice({
        kind: "success",
        message: `Version ${result.configuration.version} published.`,
      });
      await loadConfigurations(result.configuration.id);
    } catch (error) {
      setNotice({
        kind: "error",
        message: `Configuration could not be published: ${error.message}`,
      });
    } finally {
      setAction("");
    }
  }

  const busy = isLoading || Boolean(action);

  return (
    <main className="route-page configuration-page">
      <header className="page-title with-action configuration-title">
        <div>
          <h1>Network configurations</h1>
          <p>
            Build versioned antenna lists for {activeScene.name}. Antenna values always
            resolve from the live inventory.
          </p>
        </div>
        <div className="page-title-actions">
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={() => loadConfigurations()}
          >
            Refresh
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={busy || Boolean(editor)}
            onClick={() => startProposal(published)}
          >
            Create proposal
          </button>
        </div>
      </header>

      {notice && (
        <p
          className={`configuration-notice ${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      )}

      <div className="configuration-workspace">
        <VersionRail
          configurations={configurations}
          disabled={busy || Boolean(editor)}
          isLoading={isLoading}
          onSelect={setSelectedId}
          selectedId={selectedId}
        />
        <ConfigurationWorkbench
          action={action}
          editor={editor}
          onAddAntenna={addProposedAntenna}
          onDiscard={discardProposal}
          onPublish={publishSelected}
          onRemoveAntenna={removeProposedAntenna}
          onSave={saveProposal}
          onStartProposal={startProposal}
          antennaPool={fixedAntennas}
          published={published}
          selected={selected}
        />
        <ConfigurationDiff
          comparison={comparison}
          editor={editor}
          published={published}
          selected={selected}
          state={comparisonState}
        />
      </div>
    </main>
  );
}


function VersionRail({ configurations, disabled, isLoading, onSelect, selectedId }) {
  const groups = [
    ["Published baseline", configurations.filter((item) => item.status === "published")],
    ["Your drafts", configurations.filter((item) => item.status === "draft")],
    ["Previous versions", configurations.filter((item) => item.status === "superseded")],
  ];

  return (
    <aside className="configuration-rail" aria-label="Configuration versions">
      <div className="configuration-panel-heading">
        <div>
          <h2>Version ledger</h2>
          <span>{configurations.length} recorded</span>
        </div>
      </div>
      {isLoading && <p className="configuration-empty">Loading versions...</p>}
      {!isLoading && configurations.length === 0 && (
        <p className="configuration-empty">
          No saved configuration exists. Create a proposal from the scene inventory.
        </p>
      )}
      {!isLoading && groups.map(([label, items]) => (
        items.length > 0 && (
          <section className="configuration-version-group" key={label}>
            <h3>{label}</h3>
            {items.map((configuration) => (
              <button
                className={`configuration-version ${selectedId === configuration.id ? "active" : ""}`}
                disabled={disabled}
                key={configuration.id}
                type="button"
                onClick={() => onSelect(configuration.id)}
              >
                <span className="configuration-version-number">v{configuration.version}</span>
                <span>
                  <strong>{configuration.antennas.length} antennas</strong>
                  <small>{formatDateTime(configuration.created_at)}</small>
                </span>
                <StatusMark status={configuration.status} />
              </button>
            ))}
          </section>
        )
      ))}
    </aside>
  );
}


function ConfigurationWorkbench({
  action,
  antennaPool,
  editor,
  onAddAntenna,
  onDiscard,
  onPublish,
  onRemoveAntenna,
  onSave,
  onStartProposal,
  published,
  selected,
}) {
  if (editor) {
    return (
      <section className="configuration-workbench">
        <div className="configuration-panel-heading workbench-heading">
          <div>
            <h2>Working proposal</h2>
            <span>
              {editor.parent
                ? `Based on version ${editor.parent.version}`
                : "Based on the scene antenna inventory"}
            </span>
          </div>
          <span className="working-mark">Unsaved</span>
        </div>
        <div className="configuration-editor-note">
          This version stores antenna membership. Antenna values always come from the live inventory.
        </div>
        <ConfigurationAntennaMembership
          antennaPool={antennaPool}
          antennas={editor.antennas}
          disabled={Boolean(action)}
          onAdd={onAddAntenna}
          onRemove={onRemoveAntenna}
        />
        <div className="configuration-action-bar">
          <span>Saving creates a new version; it does not alter its parent.</span>
          <div>
            <button
              className="ghost-button"
              type="button"
              disabled={Boolean(action)}
              onClick={onDiscard}
            >
              Discard changes
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(action)}
              onClick={onSave}
            >
              {action === "saving" ? "Saving..." : "Save draft"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="configuration-workbench configuration-blank">
        <div>
          <h2>Establish the first version</h2>
          <p>
            Select antennas from this scene and save the first draft before publishing
            a baseline.
          </p>
          <button className="primary-button" type="button" onClick={() => onStartProposal(null)}>
            Create first proposal
          </button>
        </div>
      </section>
    );
  }

  const baselineIds = new Set((published?.antennas || []).map((item) => String(item.id)));
  return (
    <section className="configuration-workbench">
      <div className="configuration-panel-heading workbench-heading">
        <div>
          <h2>Version {selected.version}</h2>
          <span>{selected.antennas.length} antenna records</span>
        </div>
        <StatusMark status={selected.status} />
      </div>
      <dl className="configuration-meta">
        <div><dt>Created</dt><dd>{formatDateTime(selected.created_at)}</dd></div>
        <div><dt>Source</dt><dd>{selected.source_reference || selected.source}</dd></div>
        <div><dt>Parent</dt><dd>{shortId(selected.parent_configuration_id)}</dd></div>
        <div><dt>Content hash</dt><dd title={selected.content_hash}>{shortHash(selected.content_hash)}</dd></div>
      </dl>
      {selected.is_available === false && (
        <p className="configuration-notice error">
          This configuration is unavailable because an antenna is archived or outside this scene.
        </p>
      )}
      <AntennaSnapshotList antennas={selected.antennas} baselineIds={baselineIds} />
      <div className="configuration-action-bar">
        <span>Membership is versioned; displayed antenna values remain live.</span>
        <div>
          <button
            className="ghost-button"
            type="button"
            disabled={Boolean(action)}
            onClick={() => onStartProposal(selected)}
          >
            Use as starting point
          </button>
          {selected.status === "draft" && (
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(action) || selected.is_available === false}
              onClick={onPublish}
            >
              {action === "publishing" ? "Publishing..." : "Publish version"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}


function ConfigurationAntennaMembership({ antennaPool, antennas, disabled, onAdd, onRemove }) {
  const [selected, setSelected] = useState([]);
  const used = new Set(antennas.map((antenna) => antenna.database_id));
  const available = antennaPool.filter((antenna) => !used.has(antenna.database_id));
  return (
    <div className="configuration-membership">
      <div className="configuration-membership-add">
        <select multiple value={selected} disabled={disabled || available.length === 0} onChange={(event) => setSelected([...event.target.selectedOptions].map((option) => option.value))}>
          {available.map((antenna) => <option key={antenna.database_id} value={antenna.database_id}>{antenna.id}</option>)}
        </select>
        <button className="primary-button" type="button" disabled={disabled || selected.length === 0} onClick={() => { onAdd(selected); setSelected([]); }}>Add selected ({selected.length})</button>
      </div>
      <div className="configuration-antenna-table"><table><thead><tr><th>Antenna</th><th>Position</th><th>Height</th><th>Action</th></tr></thead><tbody>{antennas.map((antenna) => <tr key={antenna.database_id || antenna.id}><td><strong>{antenna.id}</strong></td><td>{formatAntennaCoordinate(antenna.longitude)}, {formatAntennaCoordinate(antenna.latitude)}</td><td>{formatMaybeNumber(antenna.height_m)} m</td><td><button className="ghost-button danger-button" type="button" disabled={disabled} onClick={() => onRemove(antenna.id)}>Remove</button></td></tr>)}</tbody></table></div>
    </div>
  );
}


function AntennaSnapshotList({ antennas, baselineIds }) {
  if (!antennas.length) {
    return <p className="configuration-empty">This configuration contains no antennas.</p>;
  }

  return (
    <div className="configuration-antenna-table" role="region" aria-label="Configuration antennas" tabIndex="0">
      <table>
        <thead>
          <tr>
            <th>Antenna</th>
            <th>State</th>
            <th>Position</th>
            <th>Tilt</th>
            <th>Power</th>
            <th>Azimuth</th>
          </tr>
        </thead>
        <tbody>
          {antennas.map((antenna) => (
            <tr key={antenna.id}>
              <td>
                <strong>{antenna.id}</strong>
                <small>{baselineIds.has(String(antenna.id)) ? "Existing" : "Proposed"}</small>
              </td>
              <td>{antenna.enabled === false ? "Disabled" : "Enabled"}</td>
              <td>
                {formatAntennaCoordinate(antenna.longitude, "—")},{" "}
                {formatAntennaCoordinate(antenna.latitude, "—")}
                <small>{formatMaybeNumber(antenna.height_m)} m high</small>
              </td>
              <td>
                {formatMaybeNumber(antenna.tilt.current)}°
                <small>{formatRange(antenna.tilt, "°")}</small>
              </td>
              <td>
                {formatMaybeNumber(antenna.tx_power.current)} dBm
                <small>{formatRange(antenna.tx_power, " dBm")}</small>
              </td>
              <td>{formatMaybeNumber(antenna.azimuth)}°</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function ConfigurationDiff({ comparison, editor, published, selected, state }) {
  let body;
  if (editor) {
    body = (
      <p className="configuration-empty">
        Save this working proposal to calculate its authoritative server diff.
      </p>
    );
  } else if (!published) {
    body = (
      <p className="configuration-empty">
        Publish the first version to establish a baseline for future comparisons.
      </p>
    );
  } else if (!selected || selected.id === published.id) {
    body = (
      <p className="configuration-empty">
        Select a draft or previous version to compare it with published version {published.version}.
      </p>
    );
  } else if (state === "loading") {
    body = <p className="configuration-empty">Calculating exact changes...</p>;
  } else if (state === "error") {
    body = <p className="configuration-empty error-text">Diff failed: {comparison?.error}</p>;
  } else if (comparison) {
    body = <DiffResult comparison={comparison} />;
  } else {
    body = <p className="configuration-empty">No comparison selected.</p>;
  }

  return (
    <aside className="configuration-diff" aria-label="Exact configuration difference">
      <div className="configuration-panel-heading">
        <div>
          <h2>Exact diff</h2>
          <span>{published ? `Against published v${published.version}` : "Awaiting baseline"}</span>
        </div>
      </div>
      {body}
    </aside>
  );
}


function DiffResult({ comparison }) {
  const summary = comparison.summary || {};
  return (
    <>
      <dl className="configuration-diff-summary">
        <div><dt>Added</dt><dd>{summary.antennas_added || 0}</dd></div>
        <div><dt>Removed</dt><dd>{summary.antennas_removed || 0}</dd></div>
        <div><dt>Changed</dt><dd>{summary.antennas_changed || 0}</dd></div>
        <div><dt>Fields</dt><dd>{summary.fields_changed || 0}</dd></div>
      </dl>
      {!comparison.changed ? (
        <p className="configuration-empty">The configurations contain no material changes.</p>
      ) : (
        <div className="configuration-change-list">
          {comparison.changes.map((change, index) => (
            <article key={`${change.antenna_id}-${change.field}-${index}`}>
              <div>
                <strong>{change.antenna_id}</strong>
                <span>{changeLabel(change)}</span>
              </div>
              <dl>
                <div><dt>Before</dt><dd>{formatChangeValue(change.before)}</dd></div>
                <div><dt>After</dt><dd>{formatChangeValue(change.after)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </>
  );
}


function StatusMark({ status }) {
  return <span className={`configuration-status ${status}`}>{statusLabel(status)}</span>;
}


function chooseSelectedConfiguration(items, preferredId) {
  if (items.some((item) => item.id === preferredId)) {
    return preferredId;
  }
  return items.find((item) => item.status === "draft")?.id
    || items.find((item) => item.status === "published")?.id
    || items[0]?.id
    || null;
}


function toEditorAntenna(antenna) {
  return structuredClone(antenna);
}


function formatRange(range, unit) {
  return `${formatMaybeNumber(range.min)}–${formatMaybeNumber(range.max)}${unit}`;
}


function statusLabel(status) {
  if (status === "published") {
    return "Published";
  }
  if (status === "superseded") {
    return "Previous";
  }
  return "Draft";
}


function shortHash(value) {
  return value ? `${value.slice(0, 10)}…` : "—";
}


function shortId(value) {
  return value ? `${value.slice(0, 8)}…` : "None";
}


function changeLabel(change) {
  if (change.change_type === "antenna_added") {
    return "Antenna added";
  }
  if (change.change_type === "antenna_removed") {
    return "Antenna removed";
  }
  return change.field.replaceAll(".", " / ");
}


function formatChangeValue(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Enabled" : "Disabled";
  }
  if (typeof value === "object") {
    if (value.id) {
      const longitude = formatAntennaCoordinate(value.longitude, "—");
      const latitude = formatAntennaCoordinate(value.latitude, "—");
      return `${value.id} at ${longitude}, ${latitude}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}
