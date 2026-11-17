import { Avatar } from "@mui/material";
import { avatarColor } from "./format";
import { avatarSrc } from "./avatars";

export function PeerAvatar(props: {
  name: string;
  avatarId?: string | null;
  size?: number;
  fontSize?: number | string;
  sx?: object;
}) {
  const { name, avatarId, size = 40, fontSize, sx } = props;
  const src = avatarSrc(avatarId);
  const initial = (name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return (
    <Avatar
      src={src}
      alt={name}
      sx={{
        width: size,
        height: size,
        fontSize: fontSize ?? Math.max(12, Math.round(size * 0.4)),
        fontWeight: 700,
        bgcolor: src ? "transparent" : avatarColor(name || "?"),
        color: "#FFFFFF",
        ...sx,
      }}
    >
      {!src ? initial : null}
    </Avatar>
  );
}
