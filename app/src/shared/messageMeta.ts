import type { Message } from "../peer";

export function messageAttachmentIds(m: Message): string[] {
  const fromArr = (m.attachments || []).filter((id): id is string => !!id);
  if (fromArr.length) return fromArr;
  return m.file_id ? [m.file_id] : [];
}
