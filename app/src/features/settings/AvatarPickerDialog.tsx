import { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import { AVATAR_PRESETS, type AvatarId } from "../../shared/avatars";
import { PeerAvatar } from "../../shared/PeerAvatar";

export function AvatarPickerDialog(props: {
  open: boolean;
  name: string;
  avatarId: AvatarId | "";
  busy?: boolean;
  onClose: () => void;
  onApply: (avatarId: AvatarId | "") => void | Promise<void>;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<AvatarId | "">(props.avatarId);

  useEffect(() => {
    if (props.open) setDraft(props.avatarId);
  }, [props.open, props.avatarId]);

  const selectedBorder = theme.palette.primary.main;
  const tileBg = alpha(theme.palette.action.hover, theme.palette.mode === "dark" ? 0.55 : 1);

  function OptionTile(opts: {
    selected: boolean;
    label: string;
    onSelect: () => void;
    children: ReactNode;
  }) {
    return (
      <Box
        component="button"
        type="button"
        disabled={props.busy}
        onClick={opts.onSelect}
        title={opts.label}
        sx={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.75,
          p: 1,
          m: 0,
          border: 2,
          borderColor: opts.selected ? selectedBorder : "transparent",
          borderRadius: 2,
          bgcolor: opts.selected
            ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.16 : 0.08)
            : tileBg,
          cursor: props.busy ? "default" : "pointer",
          color: "text.primary",
          transition: "border-color 0.15s ease, background-color 0.15s ease",
          "&:hover": {
            bgcolor: alpha(
              theme.palette.primary.main,
              theme.palette.mode === "dark" ? 0.12 : 0.06
            ),
            borderColor: opts.selected ? selectedBorder : "divider",
          },
        }}
      >
        {opts.children}
        <Typography
          sx={{
            fontSize: "0.75rem",
            fontWeight: opts.selected ? 700 : 500,
            color: opts.selected ? "text.primary" : "text.secondary",
            lineHeight: 1.2,
            textAlign: "center",
          }}
        >
          {opts.label}
        </Typography>
        {opts.selected && (
          <Box
            sx={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 20,
              height: 20,
              borderRadius: "50%",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              display: "grid",
              placeItems: "center",
              boxShadow: 1,
            }}
          >
            <CheckRoundedIcon sx={{ fontSize: 14 }} />
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Dialog
      open={props.open}
      onClose={() => {
        if (!props.busy) props.onClose();
      }}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          bgcolor: "background.paper",
          backgroundImage: "none",
          border: 1,
          borderColor: "divider",
          borderRadius: 2.5,
          overflow: "hidden",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: 1.25,
          pr: 6,
          pb: 0.5,
        }}
      >
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.2 : 0.12),
            color: "primary.main",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            mt: 0.25,
          }}
        >
          <PersonOutlineRoundedIcon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0, pt: 0.25 }}>
          <Typography sx={{ fontWeight: 700, fontSize: "1.125rem", color: "text.primary", lineHeight: 1.3 }}>
            Choose Your Avatar
          </Typography>
          <Typography sx={{ fontSize: "0.8125rem", color: "text.secondary", mt: 0.35 }}>
            Pick an avatar to represent you to your peers.
          </Typography>
        </Box>
        <IconButton
          aria-label="Close"
          disabled={props.busy}
          onClick={props.onClose}
          sx={{
            position: "absolute",
            right: 10,
            top: 10,
            color: "text.secondary",
            "&:hover": { color: "text.primary", bgcolor: "action.hover" },
          }}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 2.5 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(3, minmax(0, 1fr))",
              sm: "repeat(5, minmax(0, 1fr))",
            },
            gap: 1.25,
          }}
        >
          <OptionTile
            selected={!draft}
            label="Use Initial"
            onSelect={() => setDraft("")}
          >
            <PeerAvatar name={props.name} size={52} />
          </OptionTile>
          {AVATAR_PRESETS.map((preset) => (
            <OptionTile
              key={preset.id}
              selected={draft === preset.id}
              label={preset.label}
              onSelect={() => setDraft(preset.id)}
            >
              <PeerAvatar name={preset.label} avatarId={preset.id} size={52} />
            </OptionTile>
          ))}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button
          onClick={props.onClose}
          disabled={props.busy}
          sx={{
            textTransform: "none",
            fontWeight: 600,
            color: "text.secondary",
            "&:hover": { color: "text.primary", bgcolor: "action.hover" },
          }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={props.busy || draft === props.avatarId}
          onClick={() => void props.onApply(draft)}
          sx={{
            textTransform: "none",
            fontWeight: 700,
            px: 2.5,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            "&:hover": { bgcolor: "primary.dark" },
            "&.Mui-disabled": {
              bgcolor: "action.disabledBackground",
              color: "action.disabled",
            },
          }}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
