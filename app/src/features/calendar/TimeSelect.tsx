import { TextField } from "@mui/material";

/** Compact native time input (locale 12/24h). Empty = all day. */
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
  return (
    <TextField
      size="small"
      label={label}
      type="time"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      InputLabelProps={{ shrink: true, sx: { color: "text.secondary" } }}
      inputProps={{ step: 300 }}
      sx={{
        flex: 1,
        minWidth: 0,
        "& input::-webkit-calendar-picker-indicator": {
          cursor: "pointer",
          opacity: 0.7,
          filter: "invert(0.85)",
        },
      }}
    />
  );
}
