import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import type { PaletteMode } from "@mui/material/styles";
import App from "./App";
import { buildTheme, ThemeMode } from "./theme";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";

function Root() {
  const [mode, setModeState] = useState<PaletteMode>(() =>
    localStorage.getItem("peerchat.theme") === "light" ? "light" : "dark"
  );
  const theme = useMemo(() => buildTheme(mode), [mode]);

  function setMode(next: PaletteMode) {
    setModeState(next);
    localStorage.setItem("peerchat.theme", next);
  }

  useEffect(() => {
    document.title = "PeerChat";
  }, []);

  return (
    <ThemeMode.Provider value={{ mode, setMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </ThemeMode.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
