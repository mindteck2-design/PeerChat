import { createContext } from "react";
import { createTheme, type PaletteMode } from "@mui/material/styles";

/** Soft Midnight — dark-only chat surface tokens (light keeps existing look). */
export const softMidnight = {
  appBg: "#101622",
  panel: "#171F2D",
  chatCanvas: "#111927",
  sentBubble: "#202B40",
  receivedBubble: "#192333",
  hover: "#26344A",
  primary: "#82A9F8",
  secondary: "#A0B8E8",
  textPrimary: "#E0E6EF",
  textSecondary: "#9AAEC8",
  divider: "#2A3546",
  success: "#65C99A",
  error: "#F07878",
  input: "#1A2333",
} as const;

declare module "@mui/material/styles" {
  interface Palette {
    chat: {
      canvas: string;
      sent: string;
      received: string;
      input: string;
    };
  }
  interface PaletteOptions {
    chat?: {
      canvas?: string;
      sent?: string;
      received?: string;
      input?: string;
    };
  }
}

export const ThemeMode = createContext<{
  mode: PaletteMode;
  setMode: (mode: PaletteMode) => void;
}>({ mode: "dark", setMode: () => {} });

export function buildTheme(mode: PaletteMode) {
  const dark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      primary: {
        main: dark ? softMidnight.primary : "#0F6B5C",
        // Soft midnight: avoid pure white on accent buttons.
        contrastText: dark ? softMidnight.appBg : "#F4FFFB",
        dark: dark ? "#6B93E0" : undefined,
        light: dark ? softMidnight.secondary : undefined,
      },
      secondary: { main: dark ? softMidnight.secondary : "#C45C26" },
      background: {
        default: dark ? softMidnight.appBg : "#F3F6F4",
        paper: dark ? softMidnight.panel : "#FFFFFF",
      },
      success: { main: dark ? softMidnight.success : "#1B9E6E" },
      error: { main: dark ? softMidnight.error : "#C62828" },
      text: {
        primary: dark ? softMidnight.textPrimary : "#14201C",
        secondary: dark ? softMidnight.textSecondary : "#4A5C55",
      },
      divider: dark ? softMidnight.divider : "#D5E3DD",
      ...(dark
        ? {
            action: {
              active: "rgba(224, 230, 239, 0.56)",
              hover: "rgba(38, 52, 74, 0.72)",
              hoverOpacity: 0.12,
              // Used by some MUI surfaces; ListItemButton still alphas primary.main —
              // override that component below so Soft Midnight hover keeps light text readable.
              selected: softMidnight.hover,
              selectedOpacity: 0.18,
              disabled: "rgba(154, 174, 200, 0.38)",
              disabledBackground: "rgba(38, 52, 74, 0.45)",
              focus: "rgba(130, 169, 248, 0.22)",
              focusOpacity: 0.12,
              activatedOpacity: 0.16,
            },
          }
        : {}),
      chat: dark
        ? {
            canvas: softMidnight.chatCanvas,
            sent: softMidnight.sentBubble,
            received: softMidnight.receivedBubble,
            input: softMidnight.input,
          }
        : {
            // Preserve existing light chat look.
            canvas: "#F3F6F4",
            sent: "#DCEFE9",
            received: "#FFFFFF",
            input: "#F7FAF8",
          },
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
      MuiCssBaseline: {
        styleOverrides: {
          ":root": {
            "--pc-scrollbar-size": "7px",
            "--pc-scrollbar-thumb": dark ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.2)",
            "--pc-scrollbar-thumb-hover": dark ? "rgba(255, 255, 255, 0.38)" : "rgba(0, 0, 0, 0.38)",
            "--pc-scrollbar-thumb-active": dark ? "rgba(255, 255, 255, 0.52)" : "rgba(0, 0, 0, 0.52)",
            "--pc-scrollbar-track": "transparent",
          },
          "*, *::before, *::after, html, body": {
            scrollbarWidth: "thin",
            scrollbarColor: `${dark ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.2)"} transparent`,
          },
          "*:hover": {
            scrollbarColor: `${dark ? "rgba(255, 255, 255, 0.38)" : "rgba(0, 0, 0, 0.38)"} transparent`,
          },
          "::-webkit-scrollbar, *::-webkit-scrollbar": {
            width: "7px",
            height: "7px",
          },
          "::-webkit-scrollbar-button, *::-webkit-scrollbar-button": {
            display: "none !important",
            width: "0 !important",
            height: "0 !important",
          },
          "::-webkit-scrollbar-track, *::-webkit-scrollbar-track, ::-webkit-scrollbar-track-piece, *::-webkit-scrollbar-track-piece": {
            background: "transparent !important",
            border: "none !important",
          },
          "::-webkit-scrollbar-corner, *::-webkit-scrollbar-corner": {
            background: "transparent !important",
          },
          "::-webkit-scrollbar-thumb, *::-webkit-scrollbar-thumb": {
            backgroundColor: "var(--pc-scrollbar-thumb)",
            borderRadius: "9999px !important",
            border: "none !important",
            outline: "none !important",
            transition: "background-color 0.15s ease-in-out",
          },
          "*:hover::-webkit-scrollbar-thumb, html:hover::-webkit-scrollbar-thumb, body:hover::-webkit-scrollbar-thumb": {
            backgroundColor: "var(--pc-scrollbar-thumb-hover)",
          },
          "::-webkit-scrollbar-thumb:hover, *::-webkit-scrollbar-thumb:hover": {
            backgroundColor: "var(--pc-scrollbar-thumb-active) !important",
          },
          "::-webkit-scrollbar-thumb:active, *::-webkit-scrollbar-thumb:active": {
            backgroundColor: "var(--pc-scrollbar-thumb-active) !important",
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            scrollbarWidth: "thin",
            scrollbarColor: `${dark ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.2)"} transparent`,
          },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            color: "#FFFFFF",
            fontWeight: 700,
          },
        },
      },
      MuiButton: {
        styleOverrides: { root: { borderRadius: 999, paddingInline: 16 } },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            marginInline: 8,
            ...(dark
              ? {
                  // Default MUI selected = solid primary (#82A9F8) which washes out
                  // light preview/time text. Use Soft Midnight hover instead.
                  "&.Mui-selected": {
                    backgroundColor: softMidnight.hover,
                    color: softMidnight.textPrimary,
                    "&:hover": {
                      backgroundColor: "#2E3E58",
                    },
                    "&.Mui-focusVisible": {
                      backgroundColor: softMidnight.hover,
                    },
                  },
                }
              : {}),
          },
        },
      },
      ...(dark
        ? {
            MuiTooltip: {
              styleOverrides: {
                tooltip: {
                  backgroundColor: softMidnight.hover,
                  color: softMidnight.textPrimary,
                  border: `1px solid ${softMidnight.divider}`,
                },
              },
            },
            MuiMenu: {
              styleOverrides: {
                paper: {
                  backgroundColor: softMidnight.panel,
                  border: `1px solid ${softMidnight.divider}`,
                },
              },
            },
          }
        : {}),
    },
  });
}

export const theme = buildTheme("dark");
