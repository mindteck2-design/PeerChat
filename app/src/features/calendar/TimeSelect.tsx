import { FormControl, InputLabel, MenuItem, Select, Stack, Typography } from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTimeRounded";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function splitTime(value: string): { h: string; m: string } | null {
  const t = value.trim();
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, "0");
  const min = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, "0");
  // Snap minutes to nearest 5 for select options if needed
  const snapped = String(Math.round(Number(min) / 5) * 5).padStart(2, "0");
  const mm = snapped === "60" ? "55" : snapped;
  return { h, m: MINUTES.includes(min) ? min : mm };
}

export function TimeSelect({
  value,
  onChange,
  disabled,
  label = "Time",
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const parts = splitTime(value);
  const hour = parts?.h ?? "";
  const minute = parts?.m ?? "";

  function setHour(h: string) {
    if (!h) {
      onChange("");
      return;
    }
    onChange(`${h}:${minute || "00"}`);
  }

  function setMinute(m: string) {
    if (!m) {
      onChange("");
      return;
    }
    onChange(`${hour || "09"}:${m}`);
  }

  return (
    <Stack spacing={0.75} sx={{ flex: 1, minWidth: 160 }}>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <AccessTimeIcon sx={{ fontSize: 18, color: "action.active" }} />
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          {label}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <FormControl size="small" sx={{ flex: 1 }} disabled={disabled}>
          <InputLabel shrink id="cal-time-hour-label" sx={{ color: "text.secondary" }}>
            Hour
          </InputLabel>
          <Select
            labelId="cal-time-hour-label"
            label="Hour"
            value={hour}
            displayEmpty
            onChange={(e) => setHour(String(e.target.value))}
            notched
          >
            <MenuItem value="">
              <em>All day</em>
            </MenuItem>
            {HOURS.map((h) => (
              <MenuItem key={h} value={h}>
                {h}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography color="text.secondary">:</Typography>
        <FormControl size="small" sx={{ flex: 1 }} disabled={disabled || !hour}>
          <InputLabel shrink id="cal-time-min-label" sx={{ color: "text.secondary" }}>
            Min
          </InputLabel>
          <Select
            labelId="cal-time-min-label"
            label="Min"
            value={minute}
            displayEmpty
            onChange={(e) => setMinute(String(e.target.value))}
            notched
          >
            <MenuItem value="">
              <em>—</em>
            </MenuItem>
            {MINUTES.map((m) => (
              <MenuItem key={m} value={m}>
                {m}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
    </Stack>
  );
}
