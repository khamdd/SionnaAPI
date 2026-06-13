import { CloseIcon } from "./Icons";

export default function HistoryModal({ children, onClose, progressLabel = "" }) {
  return (
    <section className="history-detail" onClick={onClose}>
      <div
        className="history-modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="Simulation history detail"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="history-modal-close"
          type="button"
          aria-label="Close history detail"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        <ModalProgress active={Boolean(progressLabel)} label={progressLabel} />
        <div className="history-modal-body">
          {children}
        </div>
      </div>
    </section>
  );
}

function ModalProgress({ active, label }) {
  return (
    <div
      className={`modal-progress ${active ? "active" : ""}`}
      aria-hidden={!active}
      role="status"
    >
      <span>{label}</span>
      <div>
        <i />
      </div>
    </div>
  );
}

export function HistoryModalBody({ title, children }) {
  return (
    <>
      <strong>{title}</strong>
      {children}
    </>
  );
}
