export type FilePreview = {
  fileId: string;
  uploaderId: string;
  name: string;
  url: string;
  mime: string;
  data: Uint8Array;
  localPath?: string | null;
  /** Gallery navigation when opening from an album. */
  gallery?: { fileIds: string[]; index: number };
};

export type StagedFile = {
  id: string;
  /** Browser File from picker, or a disk path from Tauri drag-drop / Share. */
  source: File | { path: string; name: string; size: number };
  name: string;
  size: number;
  /** True only for disk folders (ZIP on send). Never infer from display name. */
  isDir: boolean;
  previewUrl: string | null;
  /** Opaque id for Screenshot & Annotate temps under app captures/. */
  captureId?: string;
};

export const BUNDLE_MAX_FILES = 5000;
export const BUNDLE_MAX_BYTES = 5 * 1024 * 1024 * 1024;

export type OutgoingFileState = {
  conversationId: string;
  fileId?: string;
  stagingDir?: string;
  name: string;
  done: number;
  total: number;
  /** True while encrypt/upload is cooperatively paused. */
  paused?: boolean;
  /** True after user Stop — bubble stays; progress controls hide. */
  cancelled?: boolean;
  /** Disk path for Retry after cancel (dialog / drag-drop sends). */
  sourcePath?: string;
  sizeBytes?: number;
  /** 1-based index when sending a multi-file batch. */
  batchIndex?: number;
  batchTotal?: number;
};

export type IncomingFileState = {
  fileId: string;
  conversationId?: string;
  name: string;
  done: number;
  total: number;
  /** Progress chip label — "Downloading…" for saves, "Opening…" only for in-app preview. */
  label?: string;
  paused?: boolean;
  /** True after user Stop — bubble stays with Retry. */
  cancelled?: boolean;
  /** Needed to resume/retry a cancelled download. */
  uploaderId?: string;
};

/** Chunks per keep-alive TLS session — one handshake, many pulls. */
export const FILE_FETCH_BATCH = 32;
