import { invoke } from "@tauri-apps/api/core";

export type Profile = {
  id: string;
  display_name: string;
  x25519_public: string;
  ed25519_public: string;
  listen_port: number;
  created_at?: string;
  /** Team / project label, e.g. HMIS, Shakti */
  team?: string;
};

export type Peer = {
  user_id: string;
  display_name: string;
  x25519_public: string;
  ed25519_public: string;
  last_ip?: string | null;
  last_port?: number | null;
  tls_fingerprint?: string | null;
  pinned?: boolean;
  /** Local-only: drop inbound DMs and refuse outbound DMs. */
  blocked?: boolean;
  online?: boolean;
  last_seen_at?: string | null;
  identity_changed?: boolean;
  pending_tls_fingerprint?: string | null;
  /** Project / team label from discovery beacon */
  team?: string | null;
};

export type Conversation = {
  id: string;
  kind: "dm" | "group";
  title?: string | null;
  peer_id?: string | null;
  peer_name?: string | null;
  created_at: string;
  pinned_at?: string | null;
  muted?: boolean;
  members_can_add?: boolean;
  /** False when you left or were removed from a group (chat may still be listed). */
  i_am_member?: boolean;
  unread_count?: number;
  last_message_kind?: string | null;
  last_message_at?: string | null;
  last_message_sender?: string | null;
  last_message_ciphertext?: string | null;
  last_message_nonce?: string | null;
  last_message_wrapped_keys?: Record<string, string>;
};

export type Member = {
  user_id: string;
  display_name: string;
  role?: string;
  joined_at?: string | null;
};

export type LanHost = {
  ip: string;
  label: string;
  has_app: boolean;
};

export type ReactionGroup = {
  emoji: string;
  users: string[];
  count: number;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: string;
  ciphertext: string;
  nonce: string;
  wrapped_keys: any;
  signature: string;
  file_id?: string | null;
  /** All file ids on this message (album). Prefer over single file_id when present. */
  attachments?: string[] | null;
  created_at: string;
  reply_to?: string | null;
  delivered?: boolean;
  read?: boolean;
  /** Soft undelivered — still retrying locally (peer offline / app closed). */
  queued?: boolean;
  failed?: boolean;
  attempts?: number;
  last_error?: string | null;
  reactions?: ReactionGroup[];
  pinned?: boolean;
  edited_at?: string | null;
  sort_at?: string | null;
};

async function inv<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

export const peerApi = {
  getProfile: () => inv<Profile | null>("get_profile"),
  setupProfile: (body: {
    displayName: string;
    userId: string;
    x25519Public: string;
    ed25519Public: string;
    listenPort?: number;
    team?: string;
  }) =>
    inv<Profile>("setup_profile", {
      displayName: body.displayName,
      userId: body.userId,
      x25519Public: body.x25519Public,
      ed25519Public: body.ed25519Public,
      listenPort: body.listenPort ?? null,
      team: body.team ?? null,
    }),
  updateDisplayName: (displayName: string, team?: string) =>
    inv<Profile>("update_display_name", {
      displayName,
      team: team ?? null,
    }),
  myFingerprint: () => inv<string>("my_fingerprint"),
  discoverPeers: () => inv<Peer[]>("discover_peers"),
  listLanHosts: () => inv<LanHost[]>("list_lan_hosts"),
  listPeers: () => inv<Peer[]>("list_peers"),
  pinPeer: (userId: string, fingerprint: string) =>
    inv<void>("pin_peer", { userId, fingerprint }),
  setPeerBlocked: (userId: string, blocked: boolean) =>
    inv<void>("set_peer_blocked", { userId, blocked }),
  listConversations: () => inv<Conversation[]>("list_conversations"),
  setConversationPinned: (conversationId: string, pinned: boolean) =>
    inv<void>("set_conversation_pinned", { conversationId, pinned }),
  clearConversationMessages: (conversationId: string, includeFiles: boolean) =>
    inv<void>("clear_conversation_messages", { conversationId, includeFiles }),
  setConversationMuted: (conversationId: string, muted: boolean) =>
    inv<void>("set_conversation_muted", { conversationId, muted }),
  listPinnedMessages: (conversationId: string) =>
    inv<{ message_id: string; pinned_by: string; pinned_at: string }[]>(
      "list_pinned_messages",
      { conversationId }
    ),
  getNotificationsEnabled: () => inv<boolean>("get_notifications_enabled"),
  setNotificationsEnabled: (enabled: boolean) =>
    inv<void>("set_notifications_enabled", { enabled }),
  getAutostartEnabled: () => inv<boolean>("get_autostart_enabled"),
  setAutostartEnabled: (enabled: boolean) =>
    inv<void>("set_autostart_enabled", { enabled }),
  conversationIsMuted: (conversationId: string) =>
    inv<boolean>("conversation_is_muted", { conversationId }),
  openDm: (peerId: string) => inv<Conversation>("open_dm", { peerId }),
  createGroup: (title: string, memberIds: string[], wrappedGroupKeys: Record<string, string>) =>
    inv<Conversation>("create_group", { title, memberIds, wrappedGroupKeys }),
  listMessages: (
    conversationId: string,
    opts?: { limit?: number; beforeSortKey?: string | null; beforeId?: string | null }
  ) =>
    inv<{ messages: Message[]; has_more_older: boolean }>("list_messages", {
      conversationId,
      limit: opts?.limit ?? 80,
      beforeSortKey: opts?.beforeSortKey ?? null,
      beforeId: opts?.beforeId ?? null,
    }),
  retryMessage: (messageId: string) => inv<void>("retry_message", { messageId }),
  deleteMessageForMe: (messageId: string) =>
    inv<void>("delete_message_for_me", { messageId }),
  deleteMessageForEveryone: (messageId: string) =>
    inv<Message>("delete_message_for_everyone", { messageId }),
  abortOutgoingFile: (fileId: string) => inv<void>("abort_outgoing_file", { fileId }),
  markConversationRead: (conversationId: string) =>
    inv<void>("mark_conversation_read", { conversationId }),
  sendMessage: (
    conversationId: string,
    message: any,
    recipientIds: string[],
    edit?: boolean
  ) =>
    inv<Message>("send_message", {
      conversationId,
      message,
      recipientIds,
      edit: edit ?? null,
    }),
  sendTyping: (conversationId: string, recipientIds: string[]) =>
    inv<void>("send_typing", { conversationId, recipientIds }),
  getGroupKey: (conversationId: string) =>
    inv<string | null>("get_group_key", { conversationId }),
  setMyGroupKey: (conversationId: string, wrappedGroupKey: string) =>
    inv<void>("set_my_group_key", { conversationId, wrappedGroupKey }),
  requestGroupSync: (conversationId: string) =>
    inv<void>("request_group_sync", { conversationId }),
  /** Re-wrap group key for a member and push a sync event (heal missing wrap). */
  repairGroupMemberKey: (
    conversationId: string,
    userId: string,
    wrappedGroupKey: string
  ) =>
    inv<void>("repair_group_member_key", {
      conversationId,
      userId,
      wrappedGroupKey,
    }),
  memberIds: (conversationId: string) => inv<string[]>("member_ids", { conversationId }),
  listMembers: (conversationId: string) =>
    inv<Member[]>("list_group_members", { conversationId }),
  addGroupMembers: (conversationId: string, wrappedGroupKeys: Record<string, string>) =>
    inv<void>("add_group_members", { conversationId, wrappedGroupKeys }),
  removeGroupMember: (
    conversationId: string,
    userId: string,
    wrappedGroupKeys?: Record<string, string>
  ) =>
    inv<void>("remove_group_member", {
      conversationId,
      userId,
      wrappedGroupKeys: wrappedGroupKeys ?? null,
    }),
  leaveGroup: (conversationId: string, wrappedGroupKeys?: Record<string, string>) =>
    inv<void>("leave_group", {
      conversationId,
      wrappedGroupKeys: wrappedGroupKeys ?? null,
    }),
  renameGroup: (conversationId: string, title: string) =>
    inv<void>("rename_group", { conversationId, title }),
  deleteGroup: (conversationId: string) =>
    inv<void>("delete_group", { conversationId }),
  deleteConversationLocal: (conversationId: string) =>
    inv<void>("delete_conversation_local", { conversationId }),
  openExternalUrl: (url: string) => inv<void>("open_external_url", { url }),
  ensureAnnouncementBoards: () =>
    inv<Conversation[]>("ensure_announcement_boards"),
  syncTeamAnnouncementMembers: (peerIds: string[], wrappedGroupKeys: Record<string, string>) =>
    inv<void>("sync_team_announcement_members", {
      peerIds,
      wrappedGroupKeys,
    }),
  setGroupMembersCanAdd: (conversationId: string, allowed: boolean) =>
    inv<void>("set_group_members_can_add", { conversationId, allowed }),
  setGroupMemberRole: (conversationId: string, userId: string, role: string) =>
    inv<void>("set_group_member_role", { conversationId, userId, role }),
  createOutgoingFile: (body: {
    conversationId: string;
    encFilename: string;
    filenameNonce: string;
    sizeBytes: number;
    chunkCount: number;
    wrappedKeys: any;
    originalPath?: string | null;
    contentSha256?: string | null;
    fileCryptoV?: number | null;
  }) =>
    inv<{ file_id: string; staging_dir: string }>("create_outgoing_file", {
      conversationId: body.conversationId,
      encFilename: body.encFilename,
      filenameNonce: body.filenameNonce,
      sizeBytes: body.sizeBytes,
      chunkCount: body.chunkCount,
      wrappedKeys: body.wrappedKeys,
      originalPath: body.originalPath ?? null,
      contentSha256: body.contentSha256 ?? null,
      fileCryptoV: body.fileCryptoV ?? 2,
    }),
  writeFileChunk: (fileId: string, index: number, dataB64: string, nonce: string) =>
    inv<void>("write_file_chunk", { fileId, index, dataB64, nonce }),
  /** Native disk→AES-GCM→staging (path-based sends). Avoids JS Base64 IPC. */
  stageOutgoingFromPath: (fileId: string, path: string, contentKeyB64: string) =>
    inv<{ content_sha256: string; bytes_written: number; chunk_count: number }>(
      "stage_outgoing_from_path",
      { fileId, path, contentKeyB64 }
    ),
  requestStageCancel: (fileId: string) => inv<void>("request_stage_cancel", { fileId }),
  requestStagePause: (fileId: string) => inv<void>("request_stage_pause", { fileId }),
  clearStagePause: (fileId: string) => inv<void>("clear_stage_pause", { fileId }),
  setFileContentHash: (fileId: string, contentSha256: string) =>
    inv<void>("set_file_content_hash", { fileId, contentSha256 }),
  sendFileNotice: (conversationId: string, fileId: string, recipientIds: string[]) =>
    inv<Message>("send_file_notice", { conversationId, fileId, recipientIds }),
  fetchFileChunk: (fileId: string, index: number, uploaderId: string) =>
    inv<{ nonce: string; data_b64: string; index?: number }>("fetch_file_chunk", {
      fileId,
      index,
      uploaderId,
    }),
  /** Many chunks over one TLS keep-alive session (much faster for large files). */
  fetchFileChunks: (
    fileId: string,
    fromIndex: number,
    count: number,
    uploaderId: string
  ) =>
    inv<Array<{ index: number; nonce: string; data_b64: string }>>("fetch_file_chunks", {
      fileId,
      fromIndex,
      count,
      uploaderId,
    }),
  /** Single TLS binary stream (IPMsg-style). Prefer this; fall back to fetchFileChunks. */
  downloadFileStream: (
    fileId: string,
    uploaderId: string,
    contentKeyB64: string,
    fromIndex: number
  ) =>
    inv<{ next_index: number; total: number }>("download_file_stream", {
      fileId,
      uploaderId,
      contentKeyB64,
      fromIndex,
    }),
  /** Abort an in-flight binary stream download (pause/stop). */
  cancelFileStream: (fileId: string) => inv<void>("cancel_file_stream", { fileId }),
  ackFileDownload: (fileId: string, uploaderId: string) =>
    inv<void>("ack_file_download", { fileId, uploaderId }),
  getFile: (fileId: string) => inv<any>("get_file", { fileId }),
  getFiles: (fileIds: string[]) =>
    inv<
      Array<{
        id: string;
        size_bytes?: number;
        enc_filename?: string;
        filename_nonce?: string;
        local_path?: string | null;
        local_path_present?: boolean;
        wrapped_keys?: any;
        chunk_count?: number;
        file_crypto_v?: number;
        uploader_id?: string;
      }>
    >("get_files", { fileIds }),
  ensureFileThumbnail: (fileId: string) =>
    inv<{ file_id: string; mime: string; data_b64: string }>("ensure_file_thumbnail", {
      fileId,
    }),
  saveDownloadedFile: (filename: string, dataB64: string, fileId?: string) =>
    inv<string>("save_downloaded_file", {
      filename,
      dataB64,
      fileId: fileId ?? null,
    }),
  beginFileReceive: (fileId: string) =>
    inv<{ next_index: number; temp_path: string | null }>("begin_file_receive", { fileId }),
  appendFileReceive: (fileId: string, index: number, dataB64: string) =>
    inv<void>("append_file_receive", { fileId, index, dataB64 }),
  finalizeFileReceive: (fileId: string, filename: string) =>
    inv<string>("finalize_file_receive", { fileId, filename }),
  getReceiveProgress: (fileId: string) =>
    inv<{ next_index: number; temp_path: string | null }>("get_receive_progress", { fileId }),
  /** Cache plaintext for an outgoing file when the picker gave no disk path. */
  cacheOutgoingPlain: (fileId: string, filename: string, dataB64: string) =>
    inv<string>("cache_outgoing_plain", { fileId, filename, dataB64 }),
  /** Copy a disk file (e.g. annotated screenshot under captures/) into durable outgoing cache. */
  persistOutgoingFromPath: (fileId: string, sourcePath: string, filename?: string) =>
    inv<string>("persist_outgoing_from_path", {
      fileId,
      sourcePath,
      filename: filename ?? null,
    }),
  openLocalFile: (fileId: string) => inv<void>("open_local_file", { fileId }),
  readLocalFile: (fileId: string) => inv<string>("read_local_file", { fileId }),
  getAppSetting: (key: string) => inv<string | null>("get_app_setting", { key }),
  setAppSetting: (key: string, value: string) => inv<void>("set_app_setting", { key, value }),
  acceptPendingIdentity: (userId: string) => inv<void>("accept_pending_identity", { userId }),
  upsertTransfer: (row: Record<string, unknown>) => inv<void>("upsert_transfer", { row }),
  listTransfers: () => inv<TransferLog[]>("list_transfers"),
  deleteTransfer: (id: string) => inv<void>("delete_transfer", { id }),
  clearTransferHistory: () => inv<number>("clear_transfer_history"),
  saveItem: (row: Record<string, unknown>) => inv<void>("save_item", { row }),
  deleteSavedItem: (id: string) => inv<void>("delete_saved_item", { id }),
  listSavedItems: () => inv<SavedItem[]>("list_saved_items"),
  listCalendarItems: (fromDay: string, toDay: string) =>
    inv<CalendarItem[]>("list_calendar_items", { fromDay, toDay }),
  getCalendarItem: (id: string) => inv<CalendarItem | null>("get_calendar_item", { id }),
  upsertCalendarItem: (item: Partial<CalendarItem> & { title: string; day: string; kind: CalendarKind }) =>
    inv<CalendarItem>("upsert_calendar_item", { item }),
  deleteCalendarItem: (id: string) => inv<void>("delete_calendar_item", { id }),
  setCalendarTodoDone: (id: string, done: boolean) =>
    inv<CalendarItem>("set_calendar_todo_done", { id, done }),
  toggleCalendarChecklistOption: (id: string, optionId: string, checked: boolean) =>
    inv<CalendarItem>("toggle_calendar_checklist_option", { id, optionId, checked }),
  ackCalendarItem: (id: string) => inv<CalendarItem>("ack_calendar_item", { id }),
  pollCalendarDue: () => inv<number>("poll_calendar_due"),
  peerDeliveryError: (userId: string) =>
    inv<{ last_error?: string | null; attempts?: number; created_at?: string } | null>(
      "peer_delivery_error",
      { userId }
    ),
  verifyDownloadedFile: (fileId: string) =>
    inv<{ verified: boolean; sha256: string; reason?: string }>("verify_downloaded_file", { fileId }),
  discardFileReceive: (fileId: string) => inv<void>("discard_file_receive", { fileId }),
  listDirectoryFiles: (root: string) =>
    inv<{ abs_path: string; rel_path: string; size: number }[]>("list_directory_files", { root }),
  packBundle: (entries: { abs_path: string; rel_path: string }[]) =>
    inv<{ path: string; size: number; count: number; name: string }>("pack_bundle", { entries }),
  readBundleChunk: (path: string, offset: number, len: number) =>
    inv<string>("read_bundle_chunk", { path, offset, len }),
  /** Read any regular disk file (drag-drop / Share); not limited to bundles/. */
  readFileChunk: (path: string, offset: number, len: number) =>
    inv<string>("read_file_chunk", { path, offset, len }),
  deleteBundleFile: (path: string) => inv<void>("delete_bundle_file", { path }),
  scanFile: (path: string) => inv<ScanResult>("scan_file", { path }),
  localPathMeta: (path: string) =>
    inv<{ path: string; name: string; size: number; is_dir: boolean }>("local_path_meta", {
      path,
    }),
  installShellExtension: (exePath: string) => inv<void>("install_shell_extension", { exePath }),
  uninstallShellExtension: () => inv<void>("uninstall_shell_extension"),
  shellExtensionInstalled: () => inv<boolean>("shell_extension_installed"),
  beginScreenshotSession: () => inv<{ sessionId: string }>("begin_screenshot_session"),
  completeRegionCapture: (
    sessionId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    viewWidth: number,
    viewHeight: number
  ) =>
    inv<{ captureId: string }>("complete_region_capture", {
      sessionId,
      x,
      y,
      width,
      height,
      viewWidth,
      viewHeight,
    }),
  completeFullscreenCapture: (sessionId: string) =>
    inv<{ captureId: string }>("complete_fullscreen_capture", { sessionId }),
  cancelScreenshotSession: (sessionId?: string | null) =>
    inv<void>("cancel_screenshot_session", { sessionId: sessionId ?? null }),
  readCapturePreview: (captureId: string) =>
    inv<{ mime: string; data_b64: string; bytes: number }>("read_capture_preview", { captureId }),
  finalizeCapture: (captureId: string, pngB64: string) =>
    inv<{ captureId: string; path: string; bytes: number; name: string }>("finalize_capture", {
      captureId,
      pngB64,
    }),
  discardCapture: (captureId: string) => inv<void>("discard_capture", { captureId }),
  cleanupStaleCaptures: () => inv<void>("cleanup_stale_captures"),
};

export type TransferLog = {
  id: string;
  direction: string;
  file_id?: string | null;
  conversation_id?: string | null;
  peer_label?: string | null;
  filename: string;
  size_bytes: number;
  status: string;
  error?: string | null;
  bytes_done: number;
  verified: boolean;
  started_at: string;
  updated_at: string;
  finished_at?: string | null;
};

export type ScanResult = {
  clean: boolean;
  engine: string;
  detail: string;
  skipped: boolean;
};

export type SavedItem = {
  id: string;
  message_id?: string | null;
  conversation_id: string;
  kind: string;
  preview: string;
  created_at: string;
};

export type CalendarKind = "note" | "reminder" | "meeting" | "todo";

export type CalendarChecklistOption = {
  id: string;
  label: string;
  checked_by: string[];
  check_at?: Record<string, string>;
};

export type CalendarItem = {
  id: string;
  title: string;
  body: string;
  kind: CalendarKind;
  day: string;
  time?: string | null;
  meeting_url?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  done: boolean;
  shared: boolean;
  participant_ids: string[];
  notified_at?: string | null;
  checklist?: CalendarChecklistOption[];
  acks?: Record<string, string>;
};
