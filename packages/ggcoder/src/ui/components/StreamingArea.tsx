import React, { useState, useEffect, useRef } from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";
import { Markdown } from "./Markdown.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";

// "⏺ " prefix = 2 chars
const PREFIX_WIDTH = 2;

interface StreamingAreaProps {
  isRunning: boolean;
  streamingText: string;
  streamingThinking: string;
  showThinking?: boolean;
  thinkingMs?: number;
  planMode?: boolean;
}

export function StreamingArea({
  isRunning,
  streamingText,
  streamingThinking,
  showThinking = true,
  thinkingMs,
  planMode,
}: StreamingAreaProps) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const contentWidth = Math.max(10, columns - PREFIX_WIDTH);

  // Blinking cursor — only blink when text is NOT actively changing.
  // While text streams, the reveal animation already provides visual feedback,
  // so we show a static cursor and avoid the extra re-renders from blinking.
  const [cursorVisible, setCursorVisible] = useState(true);
  const prevTextRef = useRef(streamingText);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether text is actively changing.  The stale flag is promoted to
  // React state so it can gate the blink interval — when text is actively
  // streaming we skip the blink entirely (no interval running = no extra
  // re-renders).
  const [textStale, setTextStale] = useState(false);

  useEffect(() => {
    if (streamingText !== prevTextRef.current) {
      prevTextRef.current = streamingText;
      // Only trigger a re-render if we're transitioning from stale → active
      if (textStale) setTextStale(false);
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
      staleTimerRef.current = setTimeout(() => {
        setTextStale(true);
      }, 600);
    }
    return () => {
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
  }, [streamingText]); // textStale intentionally omitted — we only read it to gate the setState

  useEffect(() => {
    if (!isRunning || !textStale) {
      setCursorVisible(true);
      return;
    }
    const timer = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 800);
    return () => clearInterval(timer);
  }, [isRunning, textStale]);

  // Return null when there is nothing to display.  Previously this kept an
  // empty <Box marginTop={1}> alive while isRunning was true, adding phantom
  // height to Ink's live area.  When isRunning later flipped to false in a
  // separate render batch, the live area shrank and Ink's cursor math
  // miscalculated the rewrite offset — clipping the bottom of the content.
  if (!streamingText && !streamingThinking) return null;
  if (!isRunning && !streamingText) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      {showThinking && streamingThinking && (
        <ThinkingBlock text={streamingThinking} streaming durationMs={thinkingMs} />
      )}

      {streamingText && (
        <Box flexDirection="row">
          <Box width={PREFIX_WIDTH} flexShrink={0}>
            <Text color={planMode ? theme.planPrimary : theme.primary}>
              {planMode ? "⊞ " : "⏺ "}
            </Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} width={contentWidth}>
            <Markdown>
              {streamingText.trimStart() + (isRunning && cursorVisible ? "\u258D" : "")}
            </Markdown>
          </Box>
        </Box>
      )}
    </Box>
  );
}
