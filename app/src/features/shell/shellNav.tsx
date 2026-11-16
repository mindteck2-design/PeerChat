import { useSyncExternalStore, type ReactNode } from "react";
import { Box } from "@mui/material";
import type { ShellNav } from "./NavRail";

/**
 * Nav/list tab live outside ChatScreen state so switching sections does not
 * re-render the message transcript (that reconciliation was freezing the window).
 */
let nav: ShellNav = "chats";
let listTab = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getShellNav(): ShellNav {
  return nav;
}

export function getShellTab(): number {
  return listTab;
}

export function setShellNav(next: ShellNav) {
  if (next === nav) return;
  nav = next;
  emit();
}

export function setShellTab(next: number) {
  if (next === listTab) return;
  listTab = next;
  emit();
}

export function useShellNav(): ShellNav {
  return useSyncExternalStore(subscribe, getShellNav, getShellNav);
}

export function useShellTab(): number {
  return useSyncExternalStore(subscribe, getShellTab, getShellTab);
}

export function ShellMain(props: {
  calendar: ReactNode;
  games: ReactNode;
  saved: ReactNode;
  settings: ReactNode;
  chat: ReactNode;
}) {
  const current = useShellNav();
  const showChat =
    current === "chats" || current === "people" || current === "announcements";
  return (
    <>
      {current === "calendar" ? props.calendar : null}
      {current === "games" ? props.games : null}
      {current === "saved" ? props.saved : null}
      {current === "settings" ? props.settings : null}
      {showChat ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {props.chat}
        </Box>
      ) : null}
    </>
  );
}
