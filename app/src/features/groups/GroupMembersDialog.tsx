// @ts-nocheck
import {
  Avatar, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, IconButton, List, ListItemAvatar, ListItemButton, ListItemText,
  Stack, Switch, TextField, Typography,
} from "@mui/material";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import DeleteForeverIcon from "@mui/icons-material/DeleteForeverRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutlineRounded";
import GroupsIcon from "@mui/icons-material/GroupsRounded";
import LogoutIcon from "@mui/icons-material/LogoutRounded";
import PersonAddAltIcon from "@mui/icons-material/PersonAddAltRounded";
import PersonRemoveIcon from "@mui/icons-material/PersonRemoveRounded";
import { avatarColor } from "../../shared/format";

import type { ChatScreenVm } from "../chat/chatVm";

export function GroupMembersDialog({ vm }: { vm: ChatScreenVm }) {
  const {
    active,
    addPick,
    canAddMembers,
    handleAddMembers,
    handleDeleteGroup,
    handleLeaveGroup,
    handleRemoveLeftGroup,
    handleRemoveMember,
    handleRenameGroup,
    handleSetMemberRole,
    handleToggleMembersCanAdd,
    inGroup,
    isAdmin,
    isAnnounceBoard,
    members,
    membersOpen,
    others,
    profile,
    renameDraft,
    setAddPick,
    setMembersOpen,
    setRenameDraft,
  } = vm;
  return (
    <>
      <Dialog
        open={membersOpen && active?.kind === "group"}
        onClose={() => setMembersOpen(false)}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { borderRadius: 3, overflow: "hidden" } }}
      >
        <DialogTitle sx={{ pr: 6, pb: 1 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Avatar sx={{ bgcolor: "primary.main", color: "#FFFFFF", width: 42, height: 42 }}>
              <GroupsIcon sx={{ fontSize: 24, color: "#FFFFFF" }} />
            </Avatar>
            <Typography fontWeight={800} fontSize={20} noWrap>
              {active?.title || "Group"}
            </Typography>
          </Stack>
          <IconButton
            aria-label="Close"
            onClick={() => setMembersOpen(false)}
            sx={{ position: "absolute", right: 10, top: 10 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.5 }}>
          <Stack spacing={2} divider={<Divider flexItem />}>
            {isAdmin && (
              <Box>
                <Typography fontWeight={800} fontSize={13} sx={{ mb: 1.25 }}>
                  Group details
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={700}
                  letterSpacing={0.6}
                  display="block"
                  mb={0.5}
                >
                  GROUP NAME
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
                  <TextField
                    size="small"
                    fullWidth
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    placeholder="Group name"
                    sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
                  />
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<DriveFileRenameOutlineIcon />}
                    disabled={!renameDraft.trim() || renameDraft.trim() === (active?.title || "")}
                    onClick={handleRenameGroup}
                    sx={{
                      flexShrink: 0,
                      textTransform: "none",
                      borderRadius: 2,
                      bgcolor: "action.selected",
                      color: "primary.main",
                      boxShadow: "none",
                      "&:hover": { bgcolor: "action.hover", boxShadow: "none" },
                    }}
                  >
                    Rename
                  </Button>
                </Stack>
                <FormControlLabel
                  sx={{
                    m: 0,
                    mb: 1.5,
                    width: "100%",
                    justifyContent: "space-between",
                    ml: 0,
                  }}
                  labelPlacement="start"
                  control={
                    <Switch
                      checked={active?.members_can_add !== false}
                      onChange={(_, v) => handleToggleMembersCanAdd(v)}
                    />
                  }
                  label={
                    <Typography fontWeight={600} fontSize={14}>
                      Members can add others
                    </Typography>
                  }
                />
                <Button
                  color="error"
                  variant="outlined"
                  fullWidth
                  startIcon={<DeleteForeverIcon />}
                  onClick={handleDeleteGroup}
                  sx={{ borderRadius: 2, py: 1.1, textTransform: "none", fontWeight: 700 }}
                >
                  Delete group for everyone
                </Button>
              </Box>
            )}

            <Box>
              <Typography fontWeight={800} fontSize={13} sx={{ mb: 1 }}>
                Members
              </Typography>
              <List dense disablePadding>
                {members.map((m) => {
                  const label =
                    m.user_id === profile.id ? `${m.display_name} (you)` : m.display_name;
                  return (
                    <ListItemButton
                      key={m.user_id}
                      disableRipple
                      sx={{ cursor: "default", py: 0.9, px: 0.5, borderRadius: 2 }}
                    >
                      <ListItemAvatar sx={{ minWidth: 44 }}>
                        <Avatar
                          sx={{
                            width: 38,
                            height: 38,
                            bgcolor: avatarColor(m.display_name),
                            color: "#FFFFFF",
                            fontSize: 16,
                            fontWeight: 700,
                          }}
                        >
                          {m.display_name.slice(0, 1).toUpperCase()}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={label}
                        secondary={m.role === "admin" ? "Admin" : "Member"}
                        primaryTypographyProps={{ fontWeight: 700, fontSize: 14 }}
                      />
                      {m.role === "admin" && (
                        <Chip
                          size="small"
                          label="Admin"
                          icon={<AdminPanelSettingsIcon sx={{ fontSize: "16px !important" }} />}
                          sx={{
                            mr: 0.5,
                            height: 24,
                            fontWeight: 700,
                            bgcolor: "action.selected",
                            color: "primary.main",
                          }}
                        />
                      )}
                      {isAdmin && m.user_id !== profile.id && (
                        <>
                          <Button
                            size="small"
                            sx={{ mr: 0.25, textTransform: "none", fontWeight: 600 }}
                            onClick={() =>
                              handleSetMemberRole(
                                m.user_id,
                                m.role === "admin" ? "member" : "admin"
                              )
                            }
                          >
                            {m.role === "admin" ? "Demote" : "Make admin"}
                          </Button>
                          <IconButton
                            aria-label={`Remove ${m.display_name}`}
                            size="small"
                            onClick={() => handleRemoveMember(m.user_id, m.display_name)}
                          >
                            <PersonRemoveIcon fontSize="small" />
                          </IconButton>
                        </>
                      )}
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>

            {canAddMembers && (
              <Box>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                  <Typography fontWeight={800} fontSize={13} sx={{ flex: 1 }}>
                    Add people
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PersonAddAltIcon />}
                    disabled={!addPick.length}
                    onClick={handleAddMembers}
                    sx={{ textTransform: "none", borderRadius: 2, fontWeight: 700 }}
                  >
                    Add{addPick.length ? ` (${addPick.length})` : ""}
                  </Button>
                </Stack>
                <List dense disablePadding>
                  {others
                    .filter((p) => !members.some((m) => m.user_id === p.user_id))
                    .map((p) => (
                      <ListItemButton
                        key={p.user_id}
                        selected={addPick.includes(p.user_id)}
                        onClick={() =>
                          setAddPick((g) =>
                            g.includes(p.user_id)
                              ? g.filter((x) => x !== p.user_id)
                              : [...g, p.user_id]
                          )
                        }
                        sx={{ borderRadius: 2, py: 0.85, px: 0.5 }}
                      >
                        <ListItemAvatar sx={{ minWidth: 44 }}>
                          <Avatar
                            sx={{
                              width: 38,
                              height: 38,
                              bgcolor: avatarColor(p.display_name),
                              color: "#FFFFFF",
                              fontSize: 16,
                              fontWeight: 700,
                            }}
                          >
                            {p.display_name.slice(0, 1).toUpperCase()}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={p.display_name}
                          secondary={p.online ? "Online" : "Offline"}
                          primaryTypographyProps={{ fontWeight: 700, fontSize: 14 }}
                        />
                        <Checkbox
                          edge="end"
                          size="small"
                          checked={addPick.includes(p.user_id)}
                          tabIndex={-1}
                          disableRipple
                        />
                      </ListItemButton>
                    ))}
                </List>
                {!others.filter((p) => !members.some((m) => m.user_id === p.user_id)).length && (
                  <Typography color="text.secondary" variant="body2" sx={{ py: 1 }}>
                    No other people on the LAN to add.
                  </Typography>
                )}
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2, pt: 1 }}>
          {!isAnnounceBoard && inGroup && (
            <Button
              color="error"
              startIcon={<LogoutIcon />}
              onClick={handleLeaveGroup}
              sx={{ textTransform: "none", fontWeight: 700, mr: "auto" }}
            >
              Leave group
            </Button>
          )}
          {!isAnnounceBoard && !inGroup && (
            <Button
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => handleRemoveLeftGroup(active)}
              sx={{ textTransform: "none", fontWeight: 700, mr: "auto" }}
            >
              Remove from chat list
            </Button>
          )}
          <Button
            color="primary"
            onClick={() => setMembersOpen(false)}
            sx={{ textTransform: "none", fontWeight: 700 }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

    </>
  );
}
