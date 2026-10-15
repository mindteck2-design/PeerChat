import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Button, Typography } from "@mui/material";
import { appLog, appLogPath } from "./appLog";

type Props = { children: ReactNode };
type State = { error: Error | null; logPath: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, logPath: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    appLog("error", "React ErrorBoundary", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
    void appLogPath().then((logPath) => this.setState({ logPath }));
  }

  render() {
    const { error, logPath } = this.state;
    if (!error) return this.props.children;

    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          px: 3,
          bgcolor: "background.default",
          color: "text.primary",
        }}
      >
        <Box maxWidth={520}>
          <Typography variant="h5" fontWeight={800} gutterBottom>
            PeerChat hit an error
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {error.message}
          </Typography>
          {logPath && (
            <Typography
              variant="body2"
              sx={{ mb: 2, wordBreak: "break-all", fontFamily: "monospace" }}
            >
              Details were written to:{" "}
              <Box component="span" fontWeight={700}>
                {logPath}
              </Box>
            </Typography>
          )}
          <Button
            variant="contained"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload
          </Button>
        </Box>
      </Box>
    );
  }
}
