import { formatMaybeNumber } from "../../utils/format";

export default function SceneChooserView({
  mapNodeRef,
  isPreviewing,
  isControlPanelVisible,
  setIsControlPanelVisible,
  error,
  status,
  onCancel,
  isBusy,
  selectedProvinceCode,
  isMapReady,
  provinces,
  selectProvince,
  selectedProvince,
       wardQuery,
       setWardQuery,
       isWardOptionsOpen,
       setIsWardOptionsOpen,
  isSearchingWards,
  wardOptions,
  selectWard,
  sceneName,
  sceneNameError,
  setSceneName,
  autoSceneNameRef,
  setSceneNameError,
  setError,
  isSelectingArea,
  startSelection,
  previewSelectedArea,
  metrics,
  selectNewArea,
  cancelSelection,
  keepScene,
}) {
  return (
    <main className="scene-page">
      <div
        ref={mapNodeRef}
        className={`scene-map scene-page-map ${isPreviewing ? "scene-map-previewing" : ""}`}
        role="application"
        aria-label="Selectable offline map area"
      />

      {isControlPanelVisible ? (
        <section
          className="scene-control-panel"
          aria-label="Scene selection controls"
        >
          <button
            className="scene-controls-toggle scene-panel-toggle"
            type="button"
            aria-label="Hide controls"
            title="Hide controls"
            onClick={() => setIsControlPanelVisible(false)}
          >
            &lt;
          </button>
          <div className="scene-page-header">
            <div>
              <h1>Create Scene Area</h1>
              <p className={error ? "error-text" : ""}>{status}</p>
            </div>
            <div className="scene-header-actions">
              <button
                className="ghost-button"
                type="button"
                disabled={isBusy}
                onClick={onCancel}
              >
                Back
              </button>
            </div>
          </div>
          {!isPreviewing && (
            <div className="scene-page-form">
              <label className="scene-city-field">
                <span>Province</span>
                <select
                  value={selectedProvinceCode}
                  disabled={isBusy || !isMapReady || provinces.length === 0}
                  onChange={selectProvince}
                >
                  <option value="">
                    {provinces.length === 0
                      ? "Provinces unavailable"
                      : "Select a province"}
                  </option>
                  {provinces.map((province) => (
                    <option key={province.code} value={province.code}>
                      {province.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="scene-ward-field">
                <label htmlFor="scene-ward-search">
                  Ward search
                  {selectedProvince ? ` (${selectedProvince.name})` : ""}
                </label>
                <input
                  id="scene-ward-search"
                  type="text"
                  value={wardQuery}
                  placeholder={
                    selectedProvince
                      ? `Search a ward in ${selectedProvince.name}`
                      : "Select a province first"
                  }
                  autoComplete="off"
                  disabled={isBusy || !isMapReady || !selectedProvinceCode}
                  title={
                    selectedProvinceCode
                      ? undefined
                      : "Select a province to search its wards"
                  }
                  onChange={(event) => {
                    setWardQuery(event.target.value);
                    setIsWardOptionsOpen(true);
                  }}
                  onFocus={() => setIsWardOptionsOpen(true)}
                  onBlur={() => setIsWardOptionsOpen(false)}
                />
                {isWardOptionsOpen && wardQuery.trim() && (
                  <ul className="scene-ward-options">
                    {isSearchingWards && (
                      <li className="scene-ward-hint" aria-live="polite">
                        Searching wards...
                      </li>
                    )}
                    {!isSearchingWards && wardOptions.length === 0 && (
                      <li className="scene-ward-hint">
                        No ward matches this search.
                      </li>
                    )}
                    {wardOptions.map((ward) => (
                      <li key={ward.ward_code}>
                        <button
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            selectWard(ward);
                          }}
                        >
                          <span>{ward.ward_name}</span>
                          <small>
                            {ward.ward_type} · {ward.province_name}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label className="scene-name-field">
                <span>Scene name</span>
                <input
                  type="text"
                  value={sceneName}
                  placeholder="Required, e.g. Hanoi test area"
                  maxLength={80}
                  required
                  disabled={isBusy}
                  onChange={(event) => {
                    setSceneName(event.target.value);
                    autoSceneNameRef.current = null;
                    if (event.target.value.trim()) {
                      setSceneNameError("");
                    }
                    if (error) {
                      setError(false);
                    }
                  }}
                />
                {sceneNameError && (
                  <small className="field-error">{sceneNameError}</small>
                )}
              </label>
              <div className="scene-action-stack">
                <button
                  className={
                    isSelectingArea ? "primary-button" : "ghost-button"
                  }
                  type="button"
                  disabled={isBusy || !isMapReady}
                  onClick={startSelection}
                >
                  Select area
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={isBusy || !isMapReady}
                  onClick={previewSelectedArea}
                >
                  Preview scene
                </button>
              </div>
            </div>
          )}
          {isPreviewing && (
            <div className="scene-preview scene-preview-panel">
              <dl className="scene-preview-meta">
                <dt>Scene</dt>
                <dd>{sceneName.trim()}</dd>
                <dt>Area</dt>
                <dd>
                  {metrics?.areaKm2 ? formatMaybeNumber(metrics.areaKm2) : "--"}{" "}
                  km2
                </dd>
                <dt>Size</dt>
                <dd>
                  {metrics
                    ? `${formatMaybeNumber(metrics.widthM)} x ${formatMaybeNumber(metrics.heightM)} m`
                    : "--"}
                </dd>
              </dl>
              <div className="scene-preview-actions">
                <button
                  className="ghost-button"
                  type="button"
                  disabled={isBusy}
                  onClick={selectNewArea}
                >
                  Select new area
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={isBusy}
                  onClick={cancelSelection}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={isBusy}
                  onClick={keepScene}
                >
                  Keep and load scene
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <button
          className="scene-controls-toggle scene-panel-toggle"
          type="button"
          aria-label="Show controls"
          title="Show controls"
          onClick={() => setIsControlPanelVisible(true)}
        >
          &gt;
        </button>
      )}

      {!isPreviewing && (
        <div className="scene-selection-footer">
          <div>
            <strong>
              {metrics
                ? `${formatMaybeNumber(metrics.widthM)} m x ${formatMaybeNumber(metrics.heightM)} m`
                : "No area selected"}
            </strong>
            <span>
              {metrics
                ? `${formatMaybeNumber(metrics.areaKm2)} km2 selected`
                : "Draw an area to see its size"}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
