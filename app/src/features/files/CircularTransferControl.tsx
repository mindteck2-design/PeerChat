import { Box, CircularProgress, IconButton, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/CloseRounded";
import PauseIcon from "@mui/icons-material/PauseRounded";
import PlayArrowIcon from "@mui/icons-material/PlayArrowRounded";
import StopIcon from "@mui/icons-material/StopRounded";

type Props = {
  /** 0–100 */
  value: number;
  paused?: boolean;
  cancelled?: boolean;
  size?: number;
  /** Light ring on dark media tiles; dark ring on light doc cards. */
  tone?: "onDark" | "onLight";
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
};

/** WhatsApp-style circular progress ring around pause / stop / retry. */
export function CircularTransferControl({
  value,
  paused,
  cancelled,
  size = 52,
  tone = "onDark",
  onPause,
  onResume,
  onStop,
  onRetry,
  onDismiss,
}: Props) {
  const track = tone === "onDark" ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.12)";
  const bar = tone === "onDark" ? "#fff" : "primary.main";
  const btnBg = tone === "onDark" ? "rgba(20,20,20,0.72)" : "rgba(255,255,255,0.92)";
  const btnColor = tone === "onDark" ? "#fff" : "text.primary";
  const iconPx = Math.round(size * 0.42);
  const thickness = size >= 48 ? 3.2 : 2.8;
  const pct = Math.max(0, Math.min(100, value));

  return (
    <Box
      sx={{
        position: "relative",
        width: size,
        height: size,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      {!cancelled && (
        <>
          <CircularProgress
            variant="determinate"
            value={100}
            size={size}
            thickness={thickness}
            sx={{ color: track, position: "absolute", inset: 0 }}
          />
          <CircularProgress
            variant="determinate"
            value={pct}
            size={size}
            thickness={thickness}
            sx={{
              color: bar,
              position: "absolute",
              inset: 0,
              opacity: paused ? 0.55 : 1,
              [`& .MuiCircularProgress-circle`]: { strokeLinecap: "round" },
            }}
          />
        </>
      )}
      {cancelled ? (
        <Box sx={{ display: "flex", gap: 0.25 }}>
          {onRetry && (
            <Tooltip title="Retry">
              <IconButton
                size="small"
                aria-label="Retry download"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry();
                }}
                sx={{
                  width: size * 0.72,
                  height: size * 0.72,
                  bgcolor: btnBg,
                  color: btnColor,
                  "&:hover": { bgcolor: btnBg },
                }}
              >
                <PlayArrowIcon sx={{ fontSize: iconPx }} />
              </IconButton>
            </Tooltip>
          )}
          {onDismiss && (
            <Tooltip title="Dismiss">
              <IconButton
                size="small"
                aria-label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss();
                }}
                sx={{
                  width: size * 0.55,
                  height: size * 0.55,
                  bgcolor: btnBg,
                  color: btnColor,
                  "&:hover": { bgcolor: btnBg },
                }}
              >
                <CloseIcon sx={{ fontSize: iconPx * 0.85 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      ) : (
        <Box
          sx={{
            width: size * 0.72,
            height: size * 0.72,
            borderRadius: "50%",
            bgcolor: btnBg,
            display: "grid",
            placeItems: "center",
            position: "relative",
            zIndex: 1,
          }}
        >
          <Tooltip title={paused ? "Resume" : "Pause"}>
            <IconButton
              size="small"
              aria-label={paused ? "Resume" : "Pause"}
              onClick={(e) => {
                e.stopPropagation();
                if (paused) onResume?.();
                else onPause?.();
              }}
              sx={{ color: btnColor, p: 0.25 }}
            >
              {paused ? (
                <PlayArrowIcon sx={{ fontSize: iconPx }} />
              ) : (
                <PauseIcon sx={{ fontSize: iconPx }} />
              )}
            </IconButton>
          </Tooltip>
          {onStop && (
            <Tooltip title="Stop">
              <IconButton
                size="small"
                aria-label="Stop"
                color="error"
                onClick={(e) => {
                  e.stopPropagation();
                  onStop();
                }}
                sx={{
                  position: "absolute",
                  right: -10,
                  bottom: -8,
                  width: 22,
                  height: 22,
                  bgcolor: tone === "onDark" ? "rgba(40,10,10,0.85)" : "background.paper",
                  border: "1px solid",
                  borderColor: "error.main",
                  p: 0,
                  "&:hover": { bgcolor: "error.dark", color: "#fff" },
                }}
              >
                <StopIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}
    </Box>
  );
}
