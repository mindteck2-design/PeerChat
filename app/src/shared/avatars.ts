import fox from "../assets/avatars/avatar-fox.jpg";
import leaf from "../assets/avatars/avatar-leaf.jpg";
import mountain from "../assets/avatars/avatar-mountain.jpg";
import bird from "../assets/avatars/avatar-bird.jpg";
import fish from "../assets/avatars/avatar-fish.jpg";
import compass from "../assets/avatars/avatar-compass.jpg";
import owl from "../assets/avatars/avatar-owl.jpg";
import sun from "../assets/avatars/avatar-sun.jpg";
import panda from "../assets/avatars/avatar-panda.jpg";
import turtle from "../assets/avatars/avatar-turtle.jpg";
import rabbit from "../assets/avatars/avatar-rabbit.jpg";
import robot from "../assets/avatars/avatar-robot.jpg";

export type AvatarId =
  | "fox"
  | "leaf"
  | "mountain"
  | "bird"
  | "fish"
  | "compass"
  | "owl"
  | "sun"
  | "panda"
  | "turtle"
  | "rabbit"
  | "robot";

export type AvatarPreset = {
  id: AvatarId;
  label: string;
  src: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "fox", label: "Fox", src: fox },
  { id: "owl", label: "Owl", src: owl },
  { id: "bird", label: "Bird", src: bird },
  { id: "fish", label: "Fish", src: fish },
  { id: "panda", label: "Panda", src: panda },
  { id: "turtle", label: "Turtle", src: turtle },
  { id: "rabbit", label: "Rabbit", src: rabbit },
  { id: "robot", label: "Robot", src: robot },
  { id: "leaf", label: "Leaf", src: leaf },
  { id: "mountain", label: "Mountain", src: mountain },
  { id: "sun", label: "Sun", src: sun },
  { id: "compass", label: "Compass", src: compass },
];

const SRC_BY_ID: Record<string, string> = Object.fromEntries(
  AVATAR_PRESETS.map((p) => [p.id, p.src])
);

export function isAvatarId(id: string | null | undefined): id is AvatarId {
  return !!id && id in SRC_BY_ID;
}

export function avatarSrc(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return SRC_BY_ID[id];
}

export function normalizeAvatarId(id: string | null | undefined): AvatarId | "" {
  return isAvatarId(id) ? id : "";
}
