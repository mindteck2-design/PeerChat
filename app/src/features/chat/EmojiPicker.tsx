import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Box,
  Popover,
  InputBase,
  IconButton,
  Typography,
  Tooltip,
  useTheme,
} from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import {
  EmojiItem,
  STATIC_EMOJI_CATEGORIES,
  getRecentEmojis,
  saveRecentEmoji,
} from "../../emoji";

interface EmojiPickerProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
}

const CATEGORY_TABS = [
  { id: "recent", label: "Recent", icon: "🕒" },
  { id: "smileys", label: "Smileys", icon: "😀" },
  { id: "people", label: "People", icon: "🧑" },
  { id: "animals", label: "Animals", icon: "🐶" },
  { id: "food", label: "Food", icon: "🍔" },
  { id: "activities", label: "Activities", icon: "⚽" },
  { id: "travel", label: "Travel", icon: "🚗" },
  { id: "objects", label: "Objects", icon: "💡" },
  { id: "symbols", label: "Symbols", icon: "🔣" },
];

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  open,
  anchorEl,
  onClose,
  onSelectEmoji,
}) => {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("recent");
  const [recentList, setRecentList] = useState<string[]>([]);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const categoryHeaderRefs = useRef<Record<string, HTMLElement | null>>({});

  // Sync recent emojis whenever picker opens
  useEffect(() => {
    if (open) {
      setRecentList(getRecentEmojis());
      setSearch("");
      setActiveCategory("recent");
    }
  }, [open]);

  // All static emojis flattened for fast search lookup
  const allEmojis = useMemo(() => {
    const map = new Map<string, EmojiItem>();
    for (const cat of STATIC_EMOJI_CATEGORIES) {
      for (const item of cat.emojis) {
        if (!map.has(item.emoji)) {
          map.set(item.emoji, item);
        }
      }
    }
    return Array.from(map.values());
  }, []);

  // Filtered search results
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return allEmojis.filter(
      (item) =>
        item.emoji.includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q)
    );
  }, [search, allEmojis]);

  const handleSelect = (emoji: string) => {
    onSelectEmoji(emoji);
    const updated = saveRecentEmoji(emoji);
    setRecentList(updated);
  };

  // Scroll to category section
  const scrollToCategory = (catId: string) => {
    setActiveCategory(catId);
    const target = categoryHeaderRefs.current[catId];
    if (target && scrollContainerRef.current) {
      const containerTop = scrollContainerRef.current.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      const offset = targetTop - containerTop + scrollContainerRef.current.scrollTop - 4;
      scrollContainerRef.current.scrollTo({
        top: Math.max(0, offset),
        behavior: "smooth",
      });
    }
  };

  // Update active tab on scroll
  const handleScroll = useCallback(() => {
    if (search || !scrollContainerRef.current) return;
    const containerTop = scrollContainerRef.current.getBoundingClientRect().top;

    let current = activeCategory;
    for (const tab of CATEGORY_TABS) {
      const el = categoryHeaderRefs.current[tab.id];
      if (el) {
        const rect = el.getBoundingClientRect();
        // If header is at or above middle of view
        if (rect.top - containerTop <= 36) {
          current = tab.id;
        }
      }
    }
    setActiveCategory(current);
  }, [search, activeCategory]);

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "left" }}
      transformOrigin={{ vertical: "bottom", horizontal: "left" }}
      PaperProps={{
        elevation: 0,
        sx: {
          width: 320,
          height: 320,
          display: "flex",
          flexDirection: "column",
          borderRadius: "14px",
          bgcolor: dark ? "#1a222d" : "#ffffff",
          color: "text.primary",
          backgroundImage: "none",
          border: "1px solid",
          borderColor: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)",
          boxShadow: dark
            ? "0 14px 40px rgba(0, 0, 0, 0.65), 0 2px 8px rgba(0, 0, 0, 0.4)"
            : "0 12px 32px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.04)",
          overflow: "hidden",
        },
      }}
    >
      {/* ── Top Bar: Search ── */}
      <Box
        sx={{
          p: "8px 10px 6px 10px",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            height: 32,
            px: 1,
            borderRadius: "8px",
            bgcolor: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)",
            border: "1px solid",
            borderColor: dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
            transition: "border-color 0.15s, background-color 0.15s",
            "&:focus-within": {
              borderColor: dark ? "primary.light" : "primary.main",
              bgcolor: dark ? "rgba(255, 255, 255, 0.09)" : "#ffffff",
            },
          }}
        >
          <SearchRoundedIcon
            sx={{ fontSize: 18, color: "text.secondary", mr: 0.75, flexShrink: 0 }}
          />
          <InputBase
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emoji..."
            fullWidth
            inputProps={{
              "aria-label": "Search emoji",
              style: {
                padding: 0,
                fontSize: "12.5px",
                lineHeight: 1.3,
              },
            }}
          />
          {search && (
            <IconButton
              size="small"
              onClick={() => setSearch("")}
              sx={{
                p: 0.25,
                color: "text.secondary",
                "&:hover": { color: "text.primary" },
              }}
            >
              <CloseRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* ── Compact Sticky Category Bar ── */}
      {!search && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: "6px",
            py: "2px",
            flexShrink: 0,
            borderBottom: "1px solid",
            borderColor: dark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)",
            bgcolor: dark ? "rgba(26, 34, 45, 0.95)" : "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(4px)",
          }}
        >
          {CATEGORY_TABS.map((tab) => {
            const isActive = activeCategory === tab.id;
            return (
              <Tooltip key={tab.id} title={tab.label} arrow enterDelay={400}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => scrollToCategory(tab.id)}
                  aria-label={tab.label}
                  sx={{
                    border: "none",
                    outline: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 30,
                    height: 28,
                    p: 0,
                    borderRadius: "6px",
                    fontSize: 16,
                    lineHeight: 1,
                    bgcolor: isActive
                      ? dark
                        ? "rgba(255, 255, 255, 0.12)"
                        : "rgba(0, 0, 0, 0.08)"
                      : "transparent",
                    opacity: isActive ? 1 : 0.65,
                    transition: "all 0.15s ease",
                    "&:hover": {
                      opacity: 1,
                      bgcolor: dark
                        ? "rgba(255, 255, 255, 0.08)"
                        : "rgba(0, 0, 0, 0.05)",
                    },
                  }}
                >
                  {tab.icon}
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      )}

      {/* ── Scrollable Emoji Container ── */}
      <Box
        ref={scrollContainerRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          px: 1,
          py: 0.5,
          overflowX: "hidden",
          overflowY: "auto",
          scrollbarWidth: "thin",
          scrollbarColor: dark
            ? "transparent transparent"
            : "transparent transparent",
          "&:hover": {
            scrollbarColor: dark
              ? "rgba(255, 255, 255, 0.18) transparent"
              : "rgba(0, 0, 0, 0.18) transparent",
          },
          "&::-webkit-scrollbar": {
            width: "5px",
          },
          "&::-webkit-scrollbar-track": {
            background: "transparent",
          },
          "&::-webkit-scrollbar-thumb": {
            background: "transparent",
            borderRadius: "4px",
            transition: "background-color 0.2s ease",
          },
          "&:hover::-webkit-scrollbar-thumb": {
            background: dark
              ? "rgba(255, 255, 255, 0.18)"
              : "rgba(0, 0, 0, 0.18)",
          },
          "&::-webkit-scrollbar-thumb:hover": {
            background: dark
              ? "rgba(255, 255, 255, 0.35)"
              : "rgba(0, 0, 0, 0.35)",
          },
        }}
      >
        {/* Search Results Mode */}
        {searchResults !== null ? (
          <Box sx={{ py: 0.5 }}>
            {searchResults.length > 0 ? (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(8, 1fr)",
                  gap: "2px",
                }}
              >
                {searchResults.map((item) => (
                  <EmojiCell
                    key={item.emoji}
                    emoji={item.emoji}
                    title={item.name}
                    dark={dark}
                    onSelect={() => handleSelect(item.emoji)}
                  />
                ))}
              </Box>
            ) : (
              <Box sx={{ textAlign: "center", py: 4, px: 2 }}>
                <Typography
                  sx={{
                    fontSize: 13,
                    color: "text.secondary",
                  }}
                >
                  No emojis found for &ldquo;{search}&rdquo;
                </Typography>
              </Box>
            )}
          </Box>
        ) : (
          /* Categorized Mode */
          <Box sx={{ pb: 1 }}>
            {/* 1. Recent Category */}
            {recentList.length > 0 && (
              <Box sx={{ mb: 1.25 }}>
                <Box
                  ref={(el) => {
                    categoryHeaderRefs.current["recent"] = el as HTMLElement | null;
                  }}
                  sx={{
                    px: 0.5,
                    py: 0.5,
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "text.secondary",
                  }}
                >
                  Recent
                </Box>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(8, 1fr)",
                    gap: "2px",
                  }}
                >
                  {recentList.map((e, idx) => (
                    <EmojiCell
                      key={`recent-${e}-${idx}`}
                      emoji={e}
                      dark={dark}
                      onSelect={() => handleSelect(e)}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* Static Categories */}
            {STATIC_EMOJI_CATEGORIES.map((cat) => (
              <Box key={cat.id} sx={{ mb: 1.25 }}>
                <Box
                  ref={(el) => {
                    categoryHeaderRefs.current[cat.id] = el as HTMLElement | null;
                  }}
                  sx={{
                    px: 0.5,
                    py: 0.5,
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "text.secondary",
                  }}
                >
                  {cat.label}
                </Box>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(8, 1fr)",
                    gap: "2px",
                  }}
                >
                  {cat.emojis.map((item) => (
                    <EmojiCell
                      key={item.emoji}
                      emoji={item.emoji}
                      title={item.name}
                      dark={dark}
                      onSelect={() => handleSelect(item.emoji)}
                    />
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Popover>
  );
};

interface EmojiCellProps {
  emoji: string;
  title?: string;
  dark: boolean;
  onSelect: () => void;
}

const EmojiCell: React.FC<EmojiCellProps> = React.memo(
  ({ emoji, title, dark, onSelect }) => {
    return (
      <Tooltip title={title || emoji} arrow enterDelay={500} placement="top">
        <Box
          component="button"
          type="button"
          onClick={onSelect}
          aria-label={title || emoji}
          sx={{
            width: "100%",
            height: 35,
            p: 0,
            m: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            border: "none",
            outline: "none",
            bgcolor: "transparent",
            borderRadius: "8px",
            fontSize: "21px",
            lineHeight: 1,
            userSelect: "none",
            transition: "background-color 0.12s ease, transform 0.1s ease",
            "&:hover": {
              bgcolor: dark
                ? "rgba(255, 255, 255, 0.1)"
                : "rgba(0, 0, 0, 0.06)",
              transform: "scale(1.18)",
            },
            "&:active": {
              transform: "scale(0.94)",
            },
          }}
        >
          {emoji}
        </Box>
      </Tooltip>
    );
  }
);
