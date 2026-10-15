// @ts-nocheck
import {
  Avatar, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, List, ListItemAvatar, ListItemButton, ListItemText, TextField, Typography,
} from "@mui/material";
import { avatarColor } from "../../shared/format";

import type { ChatScreenVm } from "../chat/chatVm";

export function GroupCreateDialog({ vm }: { vm: ChatScreenVm }) {
  const {
    createGroup,
    groupOpen,
    groupPick,
    groupTitle,
    others,
    setGroupOpen,
    setGroupPick,
    setGroupTitle
  } = vm;
  return (
    <>
      <Dialog open={groupOpen} onClose={() => setGroupOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create group</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Group name"
            sx={{ mt: 1, mb: 2 }}
            value={groupTitle}
            onChange={(e) => setGroupTitle(e.target.value)}
          />
          <List dense>
            {others.map((p) => (
              <ListItemButton
                key={p.user_id}
                selected={groupPick.includes(p.user_id)}
                onClick={() =>
                  setGroupPick((g) =>
                    g.includes(p.user_id) ? g.filter((x) => x !== p.user_id) : [...g, p.user_id]
                  )
                }
              >
                <ListItemText primary={p.display_name} />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!groupTitle.trim() || !groupPick.length} onClick={createGroup}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

    </>
  );
}
