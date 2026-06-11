import { activateScene, deleteScene } from "../api";
import { formatDateTime, formatMaybeNumber } from "../utils/format";
import { TrashIcon } from "./Icons";
import SceneMapPreview from "./SceneMapPreview";

const CARD_PREVIEW_PADDING = [6, 6];

export default function ScenesPage({
  activeSceneId,
  isLoading,
  notice,
  onRefresh,
  onSceneActivated,
  onSetNotice,
  scenes,
}) {
  async function loadScene(scene) {
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
          <h1>Scenes</h1>
          <p>Manage imported scenes. Munich is always available as the default scene.</p>
        </div>
        <button className="ghost-button" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {notice?.message && (
        <p className={`scene-notice ${notice.error ? "error-text" : ""}`}>{notice.message}</p>
      )}

      <section className="scene-list">
        {scenes.map((scene) => {
          const isActive = scene.id === activeSceneId;
          const canDelete = !scene.is_default && !isActive;
          const metrics = scene.metrics || {};

          return (
            <article className={`scene-card ${isActive ? "active" : ""}`} key={scene.id}>
              <div className="scene-card-preview">
                {scene.bounds ? (
                  <SceneMapPreview
                    bounds={scene.bounds}
                    className="scene-card-map-preview"
                    maxZoom={17}
                    padding={CARD_PREVIEW_PADDING}
                  />
                ) : (
                  <div className="munich-preview">Munich</div>
                )}
              </div>
              <div className="scene-card-body">
                <div>
                  <h2>{scene.name}</h2>
                  <p>{isActive ? "Active scene" : scene.is_default ? "Default scene" : "Imported scene"}</p>
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
                    Load
                  </button>
                  <button
                    className="history-delete"
                    type="button"
                    disabled={!canDelete || isLoading}
                    title={canDelete ? "Delete scene" : "Active/default scene cannot be deleted"}
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
