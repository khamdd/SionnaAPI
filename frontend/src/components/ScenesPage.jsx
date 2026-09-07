import { activateScene, deleteScene } from "../api";
import { SCENE_CARD_PREVIEW_PADDING } from "../constants";
import { formatDateTime, formatMaybeNumber } from "../utils/format";
import { TrashIcon } from "./Icons";
import SceneMapPreview from "./SceneMapPreview";

export default function ScenesPage({
  activeSceneId,
  isLoading,
  notice,
  onCreateScene,
  onRefresh,
  onSceneActivated,
  onSetNotice,
  scenes,
}) {
  async function loadScene(scene) {
    if (isLoading) {
      return;
    }

    onSetNotice("Loading scene...");

    try {
      const result = await activateScene(scene.id);
      onSceneActivated(result.scene);
      onSetNotice(`${result.scene.name} is now active.`);
    } catch (error) {
      onSetNotice(`Load failed: ${error.message}`, true);
    }
  }

  async function removeScene(scene) {
    if (isLoading) {
      return;
    }

    const confirmed = window.confirm(`Delete scene "${scene.name}"?`);

    if (!confirmed) {
      return;
    }

    onSetNotice("Deleting scene...");

    try {
      await deleteScene(scene.id);
      await onRefresh();
      onSetNotice(`Deleted ${scene.name}.`);
    } catch (error) {
      onSetNotice(`Delete failed: ${error.message}`, true);
    }
  }

  return (
    <main className="route-page">
      <div className="page-title with-action">
        <div>
          <h1>Choose a work scene</h1>
          <p>Select the geographic model used by every simulation and saved result in this workspace.</p>
        </div>
        <div className="page-title-actions">
          <button className="primary-button" type="button" disabled={isLoading} onClick={onCreateScene}>
            Create new scene
          </button>
          <button className="ghost-button" type="button" disabled={isLoading} onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>

      {notice?.message && (
        <p className={`scene-notice ${notice.error ? "error-text" : ""}`}>{notice.message}</p>
      )}

      <section className="scene-list">
        {scenes.length === 0 && (
          <div className="scene-empty-state">
            No scene found
          </div>
        )}
        {scenes.map((scene) => {
          const isActive = scene.id === activeSceneId;
          const metrics = scene.metrics || {};

          return (
            <article className={`scene-card ${isActive ? "active" : ""}`} key={scene.id}>
              <div className="scene-card-preview">
                {scene.bounds ? (
                  <SceneMapPreview
                    bounds={scene.bounds}
                    className="scene-card-map-preview"
                    maxZoom={17}
                    padding={SCENE_CARD_PREVIEW_PADDING}
                  />
                ) : (
                  <div className="scene-preview-placeholder">No preview</div>
                )}
              </div>
              <div className="scene-card-body">
                <div>
                  <h2>{scene.name}</h2>
                  <p>{isActive ? "Current work scene" : "Imported scene"}</p>
                </div>
                <dl>
                  <dt>Status</dt><dd>{scene.status}</dd>
                  <dt>Created</dt><dd>{formatDateTime(scene.created_at)}</dd>
                  <dt>Area</dt><dd>{metrics.area_km2 ? `${formatMaybeNumber(metrics.area_km2)} km²` : "--"}</dd>
                  <dt>Size</dt><dd>{metrics.width_m ? `${formatMaybeNumber(metrics.width_m)} x ${formatMaybeNumber(metrics.height_m)} m` : "--"}</dd>
                </dl>
                <div className="scene-card-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={isActive || isLoading}
                    onClick={() => loadScene(scene)}
                  >
                    Use scene
                  </button>
                  <button
                    className="history-delete"
                    type="button"
                    disabled={isLoading}
                    title="Delete scene"
                    onClick={() => removeScene(scene)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
