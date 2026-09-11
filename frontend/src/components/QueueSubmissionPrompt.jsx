import { formatSimulationType, formatText } from "../utils/format";

export default function QueueSubmissionPrompt({ job, onClose, onOpenQueue }) {
  const sceneName = job.scene_name || job.scene?.name || job.scene?.id;

  return (
    <section className="prompt-backdrop" onClick={onClose}>
      <div
        className="queue-prompt"
        role="dialog"
        aria-modal="true"
        aria-label="Simulation queued"
        onClick={(event) => event.stopPropagation()}
      >
        <strong>Simulation recorded</strong>
        <p>The simulation is recorded in the queue. You can open Simulation Queue to track its status and save the result after it finishes.</p>
        <dl className="detail-grid">
          <dt>Scene</dt><dd>{formatText(sceneName)}</dd>
          <dt>Type</dt><dd>{formatSimulationType(job.simulation_type)}</dd>
        </dl>
        <div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Stay here
          </button>
          <button className="primary-button" type="button" onClick={onOpenQueue}>
            Open Simulation Queue
          </button>
        </div>
      </div>
    </section>
  );
}
