export type CommandContext = {
  hasConversation: boolean;
  isGroup: boolean;
  hasMessageSelection: boolean;
};

export type SlashCommand = {
  name: string;
  hint: string;
  available: (ctx: CommandContext) => boolean;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/send", hint: "Attach files to this conversation", available: (c) => c.hasConversation },
  { name: "/bundle", hint: "Package files or a folder and send them", available: (c) => c.hasConversation },
  { name: "/transfers", hint: "Open the transfer manager", available: () => true },
  { name: "/peers", hint: "Show discovered peers and connection status", available: () => true },
  { name: "/announce", hint: "Post a formatted announcement in this group", available: (c) => c.isGroup },
  { name: "/poll", hint: "Create a poll in this group", available: (c) => c.isGroup },
  { name: "/snippet", hint: "Send a formatted code or text snippet", available: (c) => c.hasConversation },
  { name: "/search", hint: "Search messages, chats, and files on this computer", available: () => true },
  { name: "/pin", hint: "Pin or unpin the selected message", available: (c) => c.hasMessageSelection },
  { name: "/help", hint: "List available commands", available: () => true },
];

export function matchingCommands(draft: string, ctx: CommandContext) {
  const q = draft.trim().toLowerCase();
  if (!q.startsWith("/")) return [];
  return SLASH_COMMANDS.filter(
    (c) => c.available(ctx) && (c.name.startsWith(q) || q === "/")
  );
}
