import { Box, IconButton, Tooltip } from "@mui/material";
import ChatIcon from "@mui/icons-material/ForumRounded";
import PeopleAltIcon from "@mui/icons-material/PeopleAltRounded";
import CampaignIcon from "@mui/icons-material/CampaignRounded";
import DownloadingIcon from "@mui/icons-material/DownloadingRounded";
import SportsEsportsIcon from "@mui/icons-material/SportsEsportsRounded";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorderRounded";
import SettingsIcon from "@mui/icons-material/SettingsRounded";
import { FEATURE_GAMES } from "../../features";
import type { Conversation } from "../../peer";

export type ShellNav =
  | "people"
  | "chats"
  | "transfers"
  | "games"
  | "saved"
  | "announcements";

export function NavRail(props: {
  nav: ShellNav;
  gamesOn: boolean;
  onSettings: () => void;
  setNav: (nav: ShellNav) => void;
  setTab: (tab: number) => void;
  ensureAnnounceBoards: () => Promise<Conversation[]>;
  selectConversation: (c: Conversation) => void | Promise<void>;
  listConversations: () => Promise<Conversation[]>;
}) {
  const {
    nav,
    gamesOn,
    onSettings,
    setNav,
    setTab,
    ensureAnnounceBoards,
    selectConversation,
    listConversations,
  } = props;

  return (
    <Box
      sx={{
        width: 64,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        py: 1.5,
        gap: 0.5,
        borderRight: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      {(
        [
          ["chats", "Chats", <ChatIcon key="c" />],
          ["people", "People", <PeopleAltIcon key="p" />],
          ["announcements", "Announcements", <CampaignIcon key="a" />],
          ["transfers", "Transfers", <DownloadingIcon key="t" />],
          ...(FEATURE_GAMES && gamesOn
            ? [["games", "Games", <SportsEsportsIcon key="s" />] as const]
            : []),
          ["saved", "Saved", <BookmarkBorderIcon key="b" />],
        ] as const
      ).map(([id, label, icon]) => (
        <Tooltip key={id} title={label} placement="right">
          <IconButton
            color={nav === id ? "primary" : "default"}
            aria-label={label}
            onClick={() => {
              setNav(id as ShellNav);
              if (id === "people") setTab(0);
              if (id === "chats") setTab(1);
              if (id === "announcements") {
                void (async () => {
                  const boards = await ensureAnnounceBoards();
                  if (boards[0]) {
                    const full =
                      (await listConversations()).find((c) => c.id === boards[0].id) ||
                      boards[0];
                    await selectConversation(full);
                  }
                })();
              }
            }}
            sx={{
              bgcolor: nav === id ? "action.selected" : "transparent",
              borderRadius: 2.5,
            }}
          >
            {icon}
          </IconButton>
        </Tooltip>
      ))}
      <Box flex={1} />
      <Tooltip title="Settings" placement="right">
        <IconButton onClick={onSettings} sx={{ borderRadius: 2.5 }}>
          <SettingsIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
