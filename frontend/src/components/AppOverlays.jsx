import { useEffect } from "react";

import HistoryModal from "./HistoryModal";
import QueueSubmissionPrompt from "./QueueSubmissionPrompt";

export default function AppOverlays({
  modal,
  onCloseModal,
  onCloseQueuedPrompt,
  onOpenQueue,
  queuedPrompt,
}) {
  useEffect(() => {
    if (!modal.content && !queuedPrompt) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (modal.content) {
          onCloseModal();
        } else {
          onCloseQueuedPrompt();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modal.content, onCloseModal, onCloseQueuedPrompt, queuedPrompt]);

  return (
    <>
      {modal.content && (
        <HistoryModal
          onClose={onCloseModal}
          progressLabel={modal.progressLabel}
        >
          {modal.content}
        </HistoryModal>
      )}
      {queuedPrompt && (
        <QueueSubmissionPrompt
          job={queuedPrompt}
          onClose={onCloseQueuedPrompt}
          onOpenQueue={onOpenQueue}
        />
      )}
    </>
  );
}
