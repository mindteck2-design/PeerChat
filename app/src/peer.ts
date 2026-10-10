import { invoke } from "@tauri-apps/api/core";

export type Profile = {
  id: string;
  display_name: string;
  x25519_public: string;
  ed25519_public: string;
  listen_port: number;
  created_at?: string;
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
  online?: boolean;
  last_seen_at?: string | null;
  identity_changed?: boolean;
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
  created_at: string;
  reply_to?: string | null;
  delivered?: boolean;
  read?: boolean;
  failed?: boolean;
  attempts?: number;
  last_error?: string | null;
  reactions?: ReactionGroup[];
  pinned?: boolean;
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
  }) =>
    inv<Profile>("setup_profile", {
      displayName: body.displayName,
      userId: body.userId,
      x25519Public: body.x25519Public,
      ed25519Public: body.ed25519Public,
      listenPort: body.listenPort ?? null,
    }),
  updateDisplayName: (displayName: string) =>
    inv<Profile>("update_display_name", { displayName }),
  myFingerprint: () => inv<string>("my_fingerprint"),
  discoverPeers: () => inv<Peer[]>("discover_peers"),
  listLanHosts: () => inv<LanHost[]>("list_lan_hosts"),
  listPeers: () => inv<Peer[]>("list_peers"),
  pinPeer: (userId: string, fingerprint: string) =>
    inv<void>("pin_peer", { userId, fingerprint }),
  listConversations: () => inv<Conversation[]>("list_conversations"),
  setConversationPinned: (conversationId: string, pinned: boolean) =>
    inv<void>("set_conversation_pinned", { conversationId, pinned }),
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
  conversationIsMuted: (conversationId: string) =>
    inv<boolean>("conversation_is_muted", { conversationId }),
  openDm: (peerId: string) => inv<Conversation>("open_dm", { peerId }),
  createGroup: (title: string, memberIds: string[], wrappedGroupKeys: Record<string, string>) =>
    inv<Conversation>("create_group", { title, memberIds, wrappedGroupKeys }),
  listMessages: (conversationId: string) =>
    inv<Message[]>("list_messages", { conversationId }),
  retryMessage: (messageId: string) => inv<void>("retry_message", { messageId }),
  deleteMessageForMe: (messageId: string) =>
    inv<void>("delete_message_for_me", { messageId }),
  deleteMessageForEveryone: (messageId: string) =>
    inv<Message>("delete_message_for_everyone", { messageId }),
  abortOutgoingFile: (fileId: string) => inv<void>("abort_outgoing_file", { fileId }),
  markConversationRead: (conversationId: string) =>
    inv<void>("mark_conversation_read", { conversationId }),
  sendMessage: (conversationId: string, message: any, recipientIds: string[]) =>
    inv<Message>("send_message", { conversationId, message, recipientIds }),
  getGroupKey: (conversationId: string) =>
    inv<string | null>("get_group_key", { conversationId }),
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
  setFileContentHash: (fileId: string, contentSha256: string) =>
    inv<void>("set_file_content_hash", { fileId, contentSha256 }),
  sendFileNotice: (conversationId: string, fileId: string, recipientIds: string[]) =>
    inv<Message>("send_file_notice", { conversationId, fileId, recipientIds }),
  fetchFileChunk: (fileId: string, index: number, uploaderId: string) =>
    inv<{ nonce: string; data_b64: string }>("fetch_file_chunk", {
      fileId,
      index,
      uploaderId,
    }),
  ackFileDownload: (fileId: string, uploaderId: string) =>
    inv<void>("ack_file_download", { fileId, uploaderId }),
  getFile: (fileId: string) => inv<any>("get_file", { fileId }),
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
  openLocalFile: (fileId: string) => inv<void>("open_local_file", { fileId }),
  readLocalFile: (fileId: string) => inv<string>("read_local_file", { fileId }),
};
