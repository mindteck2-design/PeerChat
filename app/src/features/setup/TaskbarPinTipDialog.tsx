import { useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Typography,
  useTheme,
  keyframes,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import VolumeUpRoundedIcon from "@mui/icons-material/VolumeUpRounded";
import WifiRoundedIcon from "@mui/icons-material/WifiRounded";
import KeyboardArrowUpRoundedIcon from "@mui/icons-material/KeyboardArrowUpRounded";
import { saveLocal } from "../../storage";

const PEERCHAT_ICON_B64 =
  "data:image/png;base64,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";

const PEERCHAT_UNREAD_B64 =
  "data:image/png;base64,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";

// Animation keyframes
const cursorMove = keyframes`
  0% { transform: translate(110px, 140px); opacity: 0; }
  8% { transform: translate(110px, 140px); opacity: 1; }
  22% { transform: translate(250px, 172px); opacity: 1; } /* moves to chevron */
  28% { transform: translate(250px, 172px) scale(0.88); } /* clicks chevron */
  34% { transform: translate(250px, 86px) scale(1); } /* moves up to PeerChat in menu */
  40% { transform: translate(250px, 86px) scale(0.9); } /* grabs PeerChat icon */
  58% { transform: translate(196px, 172px) scale(0.9); } /* drags down to taskbar */
  64% { transform: translate(196px, 172px) scale(1.1); } /* drops */
  70% { transform: translate(196px, 172px); opacity: 1; }
  88% { transform: translate(140px, 150px); opacity: 0.6; }
  100% { transform: translate(110px, 140px); opacity: 0; }
`;

const menuPop = keyframes`
  0%, 25% { opacity: 0; transform: translateY(8px) scale(0.95); pointer-events: none; }
  30%, 55% { opacity: 1; transform: translateY(0) scale(1); }
  60%, 100% { opacity: 0; transform: translateY(8px) scale(0.95); pointer-events: none; }
`;

const draggedIcon = keyframes`
  0%, 39% { opacity: 0; transform: translate(242px, 78px); }
  40% { opacity: 1; transform: translate(242px, 78px); }
  58%, 62% { opacity: 1; transform: translate(188px, 164px) scale(1.05); }
  63%, 100% { opacity: 0; transform: translate(188px, 164px); }
`;

const droppedSlotGlow = keyframes`
  0%, 58% { opacity: 0; transform: scale(0.8); }
  62% { opacity: 1; transform: scale(1.2); }
  68%, 95% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.8); }
`;

const flashBadge = keyframes`
  0%, 65% { opacity: 0; }
  72%, 84% { opacity: 1; }
  85%, 92% { opacity: 0; }
  93%, 100% { opacity: 1; }
`;

export function TaskbarPinTipDialog(props: {
  open: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [dontShowAgain, setDontShowAgain] = useState(true);

  const handleDismiss = async () => {
    if (dontShowAgain) {
      await saveLocal("peerchat.tray_pin_tip_dismissed", true);
    }
    props.onClose();
  };

  return (
    <Dialog
      open={props.open}
      onClose={handleDismiss}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          p: 1,
          bgcolor: theme.palette.mode === "dark" ? "#161B22" : "#FFFFFF",
          backgroundImage: "none",
        },
      }}
    >
      <DialogTitle sx={{ pr: 6, pb: 0.5 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <PushPinRoundedIcon sx={{ color: "primary.main", fontSize: 24 }} />
          <Typography variant="h6" fontWeight={800}>
            Keep PeerChat Visible (IPMsg Style)
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Windows automatically hides background apps inside the <b>^</b> menu. Drag
          PeerChat to your taskbar so you never miss a message or file.
        </Typography>
        <IconButton
          onClick={handleDismiss}
          sx={{ position: "absolute", top: 12, right: 12, color: "text.secondary" }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 2, pb: 1 }}>
        {/* Animated Windows Taskbar Simulation */}
        <Box
          sx={{
            width: "100%",
            height: 220,
            borderRadius: 1.5,
            bgcolor: "#0A0D12",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            position: "relative",
            overflow: "hidden",
            boxShadow: "inset 0 2px 10px rgba(0, 0, 0, 0.4)",
            userSelect: "none",
          }}
        >
          {/* Subtle Desktop Wallpaper background */}
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse 90% 70% at 50% 20%, rgba(15, 107, 92, 0.35), transparent 70%), linear-gradient(180deg, #0d1720 0%, #080c10 100%)",
            }}
          />

          {/* Dotted drag guide path */}
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          >
            <path
              d="M 256 94 Q 220 120 202 172"
              fill="none"
              stroke="rgba(0, 230, 118, 0.4)"
              strokeWidth="2"
              strokeDasharray="4 4"
            />
          </svg>

          {/* Notification Area Overflow Popup Flyout */}
          <Box
            sx={{
              position: "absolute",
              bottom: 52,
              right: 64,
              width: 140,
              p: 1.2,
              bgcolor: "rgba(30, 36, 46, 0.96)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: 2,
              boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 1,
              alignItems: "center",
              justifyItems: "center",
              animation: `${menuPop} 7s infinite ease-in-out`,
            }}
          >
            {/* Dummy Icons in flyout */}
            <Box
              sx={{
                width: 26,
                height: 26,
                borderRadius: 1,
                bgcolor: "rgba(255, 255, 255, 0.06)",
                display: "grid",
                placeItems: "center",
                fontSize: 10,
                color: "#90caf9",
              }}
            >
              🛡️
            </Box>
            <Box
              sx={{
                width: 26,
                height: 26,
                borderRadius: 1,
                bgcolor: "rgba(255, 255, 255, 0.06)",
                display: "grid",
                placeItems: "center",
                fontSize: 10,
                color: "#ffb74d",
              }}
            >
              ⚡
            </Box>
            {/* The PeerChat logo inside menu */}
            <Box
              component="img"
              src={PEERCHAT_ICON_B64}
              alt="PeerChat"
              sx={{
                width: 26,
                height: 26,
                borderRadius: "5px",
                boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
              }}
            />
          </Box>

          {/* Flying Dragged Icon */}
          <Box
            component="img"
            src={PEERCHAT_ICON_B64}
            alt="Dragging"
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 26,
              height: 26,
              zIndex: 10,
              pointerEvents: "none",
              animation: `${draggedIcon} 7s infinite cubic-bezier(0.2, 0.8, 0.2, 1)`,
              filter: "drop-shadow(0 4px 8px rgba(0, 230, 118, 0.5))",
            }}
          />

          {/* Animated Mouse Pointer */}
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 22,
              height: 22,
              zIndex: 15,
              pointerEvents: "none",
              animation: `${cursorMove} 7s infinite cubic-bezier(0.2, 0.8, 0.2, 1)`,
              filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.8))",
            }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path
                d="M3 2 L3 20 L8 15 L13 22 L16 20 L11 13 L18 13 Z"
                fill="#FFFFFF"
                stroke="#000000"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </Box>

          {/* Simulated Windows 10/11 Taskbar */}
          <Box
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 44,
              bgcolor: "rgba(18, 23, 31, 0.96)",
              backdropFilter: "blur(16px)",
              borderTop: "1px solid rgba(255, 255, 255, 0.1)",
              px: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            {/* Start Button & Search pill mock */}
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  width: 20,
                  height: 20,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "2px",
                  p: "2px",
                }}
              >
                <Box sx={{ bgcolor: "#00adef", borderRadius: "1px" }} />
                <Box sx={{ bgcolor: "#00adef", borderRadius: "1px" }} />
                <Box sx={{ bgcolor: "#00adef", borderRadius: "1px" }} />
                <Box sx={{ bgcolor: "#00adef", borderRadius: "1px" }} />
              </Box>
              <Box
                sx={{
                  width: 90,
                  height: 24,
                  bgcolor: "rgba(255, 255, 255, 0.08)",
                  borderRadius: "12px",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              />
            </Stack>

            {/* System Tray Area */}
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                bgcolor: "rgba(255, 255, 255, 0.04)",
                px: 1.2,
                py: 0.5,
                borderRadius: 1.5,
                border: "1px solid rgba(255, 255, 255, 0.06)",
              }}
            >
              {/* Chevron ^ Button */}
              <Box
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: 1,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "rgba(255, 255, 255, 0.08)",
                  color: "#FFFFFF",
                }}
              >
                <KeyboardArrowUpRoundedIcon sx={{ fontSize: 18 }} />
              </Box>

              {/* Pinned Target Slot (PeerChat Lands Here) */}
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: 1,
                  position: "relative",
                  display: "grid",
                  placeItems: "center",
                  border: "1px dashed rgba(0, 230, 118, 0.5)",
                }}
              >
                {/* Dropped Success Animation */}
                <Box
                  sx={{
                    animation: `${droppedSlotGlow} 7s infinite ease-out`,
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Box
                    component="img"
                    src={PEERCHAT_ICON_B64}
                    alt="Pinned PeerChat"
                    sx={{ width: 22, height: 22, borderRadius: "4px" }}
                  />
                  {/* Flashing Unread Notification Dot */}
                  <Box
                    component="img"
                    src={PEERCHAT_UNREAD_B64}
                    alt="Flashing Unread"
                    sx={{
                      position: "absolute",
                      inset: 0,
                      width: 22,
                      height: 22,
                      borderRadius: "4px",
                      animation: `${flashBadge} 7s infinite ease-in-out`,
                    }}
                  />
                </Box>
              </Box>

              {/* Standard tray indicators */}
              <WifiRoundedIcon sx={{ fontSize: 16, color: "rgba(255,255,255,0.7)" }} />
              <VolumeUpRoundedIcon sx={{ fontSize: 16, color: "rgba(255,255,255,0.7)" }} />
              <Typography
                variant="caption"
                sx={{
                  color: "#FFFFFF",
                  fontFamily: "monospace",
                  fontSize: 10,
                  fontWeight: 600,
                  ml: 0.5,
                }}
              >
                10:45 AM
              </Typography>
            </Stack>
          </Box>
        </Box>

        {/* 3 Step Instruction Guide */}
        <Stack spacing={1.2} sx={{ mt: 2.5 }}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                bgcolor: "primary.main",
                color: "primary.contrastText",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: 12,
                flexShrink: 0,
                mt: 0.2,
              }}
            >
              1
            </Box>
            <Typography variant="body2">
              Click the <b>^</b> (overflow arrow) next to the clock on your Windows
              taskbar.
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                bgcolor: "primary.main",
                color: "primary.contrastText",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: 12,
                flexShrink: 0,
                mt: 0.2,
              }}
            >
              2
            </Box>
            <Typography variant="body2">
              <b>Click and drag</b> the PeerChat icon down directly onto your taskbar next
              to the clock.
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                bgcolor: "success.main",
                color: "#FFFFFF",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: 12,
                flexShrink: 0,
                mt: 0.2,
              }}
            >
              <CheckCircleRoundedIcon sx={{ fontSize: 15 }} />
            </Box>
            <Typography variant="body2">
              <b>All set!</b> PeerChat will now stay always visible, showing an unread
              badge and flashing in the tray when new messages arrive.
            </Typography>
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          pb: 2,
          pt: 1,
          justifyContent: "space-between",
        }}
      >
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
          }
          label={<Typography variant="caption">Don't show this again on startup</Typography>}
        />
        <Button
          variant="contained"
          onClick={handleDismiss}
          sx={{ fontWeight: 700, px: 3, borderRadius: 1.25 }}
        >
          Got it, thanks!
        </Button>
      </DialogActions>
    </Dialog>
  );
}
