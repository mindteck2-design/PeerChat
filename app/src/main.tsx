import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import type { PaletteMode } from "@mui/material/styles";
import App from "./app/App";
import {
  buildTheme,
  readThemePreference,
  resolveThemeMode,
  ThemeMode,
  type ThemePreference,
} from "./theme";
import { ErrorBoundary } from "./shared/ErrorBoundary";
import { installAppLogging, appLog } from "./shared/appLog";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "./index.css";

void installAppLogging();

function Root() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference()
  );
  const [mode, setModeState] = useState<PaletteMode>(() =>
    resolveThemeMode(readThemePreference())
  );
  const theme = useMemo(() => buildTheme(mode), [mode]);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    try {
      localStorage.setItem("peerchat.theme", next);
    } catch {
      /* ignore */
    }
    setModeState(resolveThemeMode(next));
  }

  function setMode(next: PaletteMode) {
    setPreference(next);
  }

  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setModeState(mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [preference]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    document.body.setAttribute("data-theme", mode);
  }, [mode]);

  useEffect(() => {
    document.title = "PeerChat";
    appLog("info", "Root mounted");
  }, []);

  return (
    <ThemeMode.Provider value={{ mode, preference, setPreference, setMode }}>
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
