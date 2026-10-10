import { createContext } from "react";
import { createTheme, type PaletteMode } from "@mui/material/styles";

export const ThemeMode = createContext<{
  mode: PaletteMode;
  setMode: (mode: PaletteMode) => void;
}>({ mode: "dark", setMode: () => {} });

export function buildTheme(mode: PaletteMode) {
  const dark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? "#4C8DFF" : "#0F6B5C", contrastText: "#F4FFFB" },
      secondary: { main: dark ? "#8EB4FF" : "#C45C26" },
      background: {
        default: dark ? "#0B1220" : "#F3F6F4",
        paper: dark ? "#121A2B" : "#FFFFFF",
      },
      success: { main: dark ? "#3DDC97" : "#1B9E6E" },
      error: { main: dark ? "#FF6B6B" : "#C62828" },
      text: {
        primary: dark ? "#E7EEF8" : "#14201C",
        secondary: dark ? "#9AABC4" : "#4A5C55",
      },
      divider: dark ? "#243044" : "#D5E3DD",
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Source Sans 3", "Segoe UI", sans-serif',
      h1: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 700 },
      h2: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 700 },
      h3: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 600 },
      h4: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 600 },
      h5: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 600 },
      h6: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiButton: {
        styleOverrides: { root: { borderRadius: 999, paddingInline: 16 } },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            marginInline: 8,
          },
        },
      },
    },
  });
}

export const theme = buildTheme("dark");
