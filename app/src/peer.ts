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
};

export type Conversation = {
  id: string;
  kind: "dm" | "group";
  title?: string | null;
  peer_id?: string | null;
  peer_name?: string | null;
  created_at: string;
};

export type Member = {
  user_id: string;
  display_name: string;
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
  delivered?: boolean;
  read?: boolean;
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
  myFingerprint: () => inv<string>("my_fingerprint"),
  discoverPeers: () => inv<Peer[]>("discover_peers"),
  listPeers: () => inv<Peer[]>("list_peers"),
  pinPeer: (userId: string, fingerprint: string) =>
    inv<void>("pin_peer", { userId, fingerprint }),
  listConversations: () => inv<Conversation[]>("list_conversations"),
  openDm: (peerId: string) => inv<Conversation>("open_dm", { peerId }),
  createGroup: (title: string, memberIds: string[], wrappedGroupKeys: Record<string, string>) =>
    inv<Conversation>("create_group", { title, memberIds, wrappedGroupKeys }),
  listMessages: (conversationId: string) =>
    inv<Message[]>("list_messages", { conversationId }),
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
  removeGroupMember: (conversationId: string, userId: string) =>
    inv<void>("remove_group_member", { conversationId, userId }),
  leaveGroup: (conversationId: string) => inv<void>("leave_group", { conversationId }),
  createOutgoingFile: (body: {
    conversationId: string;
    encFilename: string;
    filenameNonce: string;
    sizeBytes: number;
    chunkCount: number;
    wrappedKeys: any;
    originalPath?: string | null;
  }) =>
    inv<{ file_id: string; staging_dir: string }>("create_outgoing_file", {
      conversationId: body.conversationId,
      encFilename: body.encFilename,
      filenameNonce: body.filenameNonce,
      sizeBytes: body.sizeBytes,
      chunkCount: body.chunkCount,
      wrappedKeys: body.wrappedKeys,
      originalPath: body.originalPath ?? null,
    }),
  writeFileChunk: (stagingDir: string, index: number, data: number[], nonce: string) =>
    inv<void>("write_file_chunk", { stagingDir, index, data, nonce }),
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
  saveDownloadedFile: (filename: string, data: number[], fileId?: string) =>
    inv<string>("save_downloaded_file", { filename, data, fileId: fileId ?? null }),
  openLocalFile: (fileId: string) => inv<void>("open_local_file", { fileId }),
  readLocalFile: (fileId: string) => inv<string>("read_local_file", { fileId }),
};
