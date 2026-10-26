import { Avatar, Box, IconButton, Tooltip, Typography } from "@mui/material";
import ChatIcon from "@mui/icons-material/ForumRounded";
import PeopleAltIcon from "@mui/icons-material/PeopleAltRounded";
import CampaignIcon from "@mui/icons-material/CampaignRounded";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonthRounded";
import SportsEsportsIcon from "@mui/icons-material/SportsEsportsRounded";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorderRounded";
import SettingsIcon from "@mui/icons-material/SettingsRounded";
import { FEATURE_GAMES } from "../../features";
import type { Conversation, Profile } from "../../peer";

export type ShellNav =
  | "people"
  | "chats"
  | "calendar"
  | "games"
  | "saved"
  | "announcements"
  | "settings";

export function NavRail(props: {
  nav: ShellNav;
  gamesOn: boolean;
  onSettings: () => void;
  setNav: (nav: ShellNav) => void;
  setTab: (tab: number) => void;
  ensureAnnounceBoards: () => Promise<Conversation[]>;
  selectConversation: (c: Conversation) => void | Promise<void>;
  listConversations: () => Promise<Conversation[]>;
  profile?: Profile;
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
    profile,
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
          ["calendar", "Calendar", <CalendarMonthIcon key="cal" />],
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
              borderRadius: 1.5,
            }}
          >
            {icon}
          </IconButton>
        </Tooltip>
      ))}
      <Box flex={1} />
      {profile && (
        <Tooltip
          title={`${profile.display_name}${profile.team?.trim() ? ` (${profile.team.trim()})` : ""}`}
          placement="right"
        >
          <Box
            onClick={onSettings}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              cursor: "pointer",
              mb: 0.5,
              p: 0.5,
              borderRadius: 2,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Avatar
              sx={{
                width: 34,
                height: 34,
                fontSize: 15,
                fontWeight: 700,
                bgcolor: "primary.main",
                color: "#FFFFFF",
              }}
            >
              {profile.display_name.slice(0, 1).toUpperCase()}
            </Avatar>
            {profile.team?.trim() && (
              <Typography
                variant="caption"
                sx={{
                  fontSize: "9px",
                  fontWeight: 700,
                  color: "text.secondary",
                  maxWidth: 56,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textAlign: "center",
                  mt: 0.25,
                }}
              >
                {profile.team.trim()}
              </Typography>
            )}
          </Box>
        </Tooltip>
      )}
      <Tooltip title="Settings" placement="right">
        <IconButton
          color={nav === "settings" ? "primary" : "default"}
          aria-label="Settings"
          onClick={() => {
            setNav("settings");
            onSettings();
          }}
          sx={{
            bgcolor: nav === "settings" ? "action.selected" : "transparent",
            borderRadius: 1.5,
          }}
        >
          <SettingsIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
