import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0F6B5C", contrastText: "#F4FFFB" },
    secondary: { main: "#C45C26" },
    background: { default: "#F3F6F4", paper: "#FFFFFF" },
    success: { main: "#1B9E6E" },
    text: { primary: "#14201C", secondary: "#4A5C55" },
  },
  shape: { borderRadius: 16 },
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
      styleOverrides: {
        root: { borderRadius: 999, paddingInline: 18 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
      },
    },
  },
});
