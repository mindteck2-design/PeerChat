import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { peerApi } from "../../peer";
import type { FilePreview, IncomingFileState, OutgoingFileState } from "../../shared/transferTypes";

/** Abort/pause control plane for outbound and inbound file transfers. */
export function useFileTransfer(opts: {
  outgoingFile: OutgoingFileState | null;
  incomingFile: IncomingFileState | null;
  setOutgoingFile: Dispatch<SetStateAction<OutgoingFileState | null>>;
  setIncomingFile: Dispatch<SetStateAction<IncomingFileState | null>>;
  setFilePreview: Dispatch<SetStateAction<FilePreview | null>>;
  setPreviewBusy: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
  abortSendRef: MutableRefObject<boolean>;
  queueAbortRef: MutableRefObject<boolean>;
  pauseRef: MutableRefObject<boolean>;
  cancelReceiveRef: MutableRefObject<boolean>;
  pauseOpenRef: MutableRefObject<boolean>;
  abortOpenRef: MutableRefObject<boolean>;
}) {
  const {
    outgoingFile,
    incomingFile,
    setOutgoingFile,
    setIncomingFile,
    setFilePreview,
    setPreviewBusy,
    setStatus,
    abortSendRef,
    queueAbortRef,
    pauseRef,
    cancelReceiveRef,
    pauseOpenRef,
    abortOpenRef,
  } = opts;

  const abortOutgoingTransfer = useCallback(async () => {
    abortSendRef.current = true;
    queueAbortRef.current = true;
    pauseRef.current = false;
    const current = outgoingFile;
    if (current?.fileId) {
      try {
        await peerApi.requestStageCancel(current.fileId);
      } catch {
        /* best effort */
      }
      try {
        // Release staging disk; keep transfer_log via sendFile catch / explicit record.
        await peerApi.abortOutgoingFile(current.fileId);
      } catch {
        /* best effort */
      }
    }
    // Keep the bubble — mark Cancelled (do not clear outgoingFile).
    setOutgoingFile((o) =>
      o
        ? {
            ...o,
            paused: false,
            cancelled: true,
          }
        : o
    );
    setStatus("Send cancelled");
  }, [abortSendRef, outgoingFile, pauseRef, queueAbortRef, setOutgoingFile, setStatus]);

  const abortIncomingTransfer = useCallback(() => {
    cancelReceiveRef.current = true;
    pauseOpenRef.current = false;
    abortOpenRef.current = true;
    const fid = incomingFile?.fileId;
    if (fid) {
      void peerApi.cancelFileStream(fid).catch(() => {});
      void peerApi.discardFileReceive(fid).catch(() => {});
    }
    setIncomingFile((f) =>
      f
        ? {
            ...f,
            paused: false,
            cancelled: true,
            label: "Cancelled",
          }
        : f
    );
    setPreviewBusy(false);
    setStatus("Download cancelled");
  }, [
    abortOpenRef,
    cancelReceiveRef,
    incomingFile?.fileId,
    pauseOpenRef,
    setIncomingFile,
    setPreviewBusy,
    setStatus,
  ]);

  const pauseOutgoingTransfer = useCallback(() => {
    pauseRef.current = true;
    const fid = outgoingFile?.fileId;
    if (fid) {
      void peerApi.requestStagePause(fid).catch(() => {});
    }
    setOutgoingFile((o) => (o && !o.cancelled ? { ...o, paused: true } : o));
  }, [outgoingFile?.fileId, pauseRef, setOutgoingFile]);

  const resumeOutgoingTransfer = useCallback(() => {
    pauseRef.current = false;
    const fid = outgoingFile?.fileId;
    if (fid) {
      void peerApi.clearStagePause(fid).catch(() => {});
    }
    setOutgoingFile((o) => (o && !o.cancelled ? { ...o, paused: false } : o));
  }, [outgoingFile?.fileId, pauseRef, setOutgoingFile]);

  const pauseIncomingTransfer = useCallback(() => {
    pauseOpenRef.current = true;
    cancelReceiveRef.current = false;
    abortOpenRef.current = true;
    const fid = incomingFile?.fileId;
    if (fid) {
      void peerApi.cancelFileStream(fid).catch(() => {});
    }
    setIncomingFile((f) =>
      f && !f.cancelled ? { ...f, paused: true, label: "Paused" } : f
    );
  }, [abortOpenRef, cancelReceiveRef, incomingFile?.fileId, pauseOpenRef, setIncomingFile]);

  const resumeIncomingTransfer = useCallback(() => {
    pauseOpenRef.current = false;
    abortOpenRef.current = false;
    setIncomingFile((f) =>
      f && !f.cancelled ? { ...f, paused: false, label: "Downloading…" } : f
    );
  }, [abortOpenRef, pauseOpenRef, setIncomingFile]);

  const dismissOutgoingTransfer = useCallback(() => {
    setOutgoingFile(null);
  }, [setOutgoingFile]);

  const dismissIncomingTransfer = useCallback(() => {
    setIncomingFile(null);
  }, [setIncomingFile]);

  const closeFilePreview = useCallback(() => {
    setFilePreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, [setFilePreview]);

  return {
    abortOutgoingTransfer,
    abortIncomingTransfer,
    pauseOutgoingTransfer,
    resumeOutgoingTransfer,
    pauseIncomingTransfer,
    resumeIncomingTransfer,
    dismissOutgoingTransfer,
    dismissIncomingTransfer,
    closeFilePreview,
  };
}

export {
  BUNDLE_MAX_BYTES,
  BUNDLE_MAX_FILES,
  FILE_FETCH_BATCH,
  type FilePreview,
  type IncomingFileState,
  type OutgoingFileState,
  type StagedFile,
} from "../../shared/transferTypes";
