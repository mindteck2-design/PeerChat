import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import type { PaletteMode } from "@mui/material/styles";
import App from "./app/App";
import { buildTheme, ThemeMode } from "./theme";
import { ErrorBoundary } from "./shared/ErrorBoundary";
import { installAppLogging, appLog } from "./shared/appLog";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";

void installAppLogging();

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
    appLog("info", "Root mounted");
  }, []);

  return (
    <ThemeMode.Provider value={{ mode, setMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ThemeProvider>
    </ThemeMode.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
