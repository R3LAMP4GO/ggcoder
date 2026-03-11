import React, { useState, useRef, useEffect, useMemo } from "react";
import { Text, Box, useInput, useStdout, useStdin, useApp } from "ink";
import type { EventEmitter } from "events";
import { useTheme } from "../theme/theme.js";
import type { ImageAttachment } from "../../utils/image.js";
import {
  extractImagePaths,
  readImageFile,
  getClipboardImage,
  clipboardHasImage,
  getNoImageMessage,
} from "../../utils/image.js";
import { SlashCommandMenu, filterCommands, type SlashCommandInfo } from "./SlashCommandMenu.js";

const MAX_VISIBLE_LINES = 5;
const PROMPT = "❯ ";

export interface PasteInfo {
  offset: number; // char index where paste starts in value
  length: number; // char length of pasted content
  lineCount: number; // number of lines in pasted content
}

interface InputAreaProps {
  onSubmit: (value: string, images: ImageAttachment[], paste?: PasteInfo) => void;
  onAbort: () => void;
  disabled?: boolean;
  /** When true, input stays typeable but submissions are queued */
  isAgentRunning?: boolean;
  isActive?: boolean;
  onDownAtEnd?: () => void;
  onShiftTab?: () => void;
  onTogglePlan?: () => void;
  onToggleTasks?: () => void;
  cwd: string;
  commands?: SlashCommandInfo[];
}

// Border (1 each side) + padding (1 each side) = 4 characters of overhead
const BOX_OVERHEAD = 4;

/**
 * Split text into visual lines based on terminal width.
 * Accounts for the prompt prefix, border, and padding.
 */
function wrapLine(text: string, contentWidth: number): string[] {
  if (text.length === 0) return [""];
  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= contentWidth) {
      lines.push(remaining);
      break;
    }

    let breakAt = remaining.lastIndexOf(" ", contentWidth);
    if (breakAt <= 0) {
      breakAt = contentWidth;
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt);
    } else {
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt + 1);
    }
  }

  return lines;
}

function getVisualLines(text: string, columns: number): string[] {
  const contentWidth = columns - PROMPT.length - BOX_OVERHEAD;
  if (contentWidth <= 0) return [text];
  if (text.length === 0) return [""];

  // Split on real newlines first, then wrap each
  const hardLines = text.split("\n");
  const result: string[] = [];
  for (const line of hardLines) {
    result.push(...wrapLine(line, contentWidth));
  }
  return result;
}

export function InputArea({
  onSubmit,
  onAbort,
  disabled = false,
  isAgentRunning = false,
  isActive = true,
  onDownAtEnd,
  onShiftTab,
  onTogglePlan,
  onToggleTasks,
  cwd,
  commands = [],
}: InputAreaProps) {
  const theme = useTheme();
  const app = useApp();
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const pastingRef = useRef(false);
  const historyRef = useRef<Array<{ text: string; images: ImageAttachment[] }>>([]);
  const historyIndexRef = useRef(-1);
  const lastEscRef = useRef(0);
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const [menuIndex, setMenuIndex] = useState(0);
  const [pasteText, setPasteText] = useState(""); // accumulated pasted content
  const [pasteOffset, setPasteOffset] = useState(0); // where in value the paste starts
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect if we're in slash command mode
  const isSlashMode = value.startsWith("/") && !value.includes(" ") && commands.length > 0;
  const slashFilter = isSlashMode ? value.slice(1) : "";
  const filteredCommands = useMemo(
    () => (isSlashMode ? filterCommands(commands, slashFilter) : []),
    [isSlashMode, commands, slashFilter],
  );

  // Reset menu index when filter changes
  useEffect(() => {
    setMenuIndex(0);
  }, [slashFilter]);

  // Border color pulse (when idle/waiting for input)
  const borderPulseColors = useMemo(
    () => [theme.primary, theme.accent, theme.secondary, theme.accent],
    [theme.primary, theme.accent, theme.secondary],
  );
  const [borderFrame, setBorderFrame] = useState(0);
  useEffect(() => {
    if (disabled) return;
    const timer = setInterval(() => {
      setBorderFrame((f) => (f + 1) % borderPulseColors.length);
    }, 800);
    return () => clearInterval(timer);
  }, [disabled, borderPulseColors]);

  // Cursor blink — always active so user can type while agent is busy
  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    const timer = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(timer);
  }, []);

  // Auto-clear image status message after 3 seconds
  useEffect(() => {
    if (!imageStatus) return;
    const timer = setTimeout(() => setImageStatus(null), 3000);
    return () => clearTimeout(timer);
  }, [imageStatus]);

  // Auto-detect image paths as they're pasted/typed — debounce so full paste arrives
  const extractingRef = useRef(false);
  useEffect(() => {
    if (!value || extractingRef.current) return;
    const timer = setTimeout(() => {
      extractingRef.current = true;
      extractImagePaths(value, cwd)
        .then(async ({ imagePaths, cleanText }) => {
          if (imagePaths.length === 0) return;
          const newImages: ImageAttachment[] = [];
          for (const imgPath of imagePaths) {
            try {
              newImages.push(await readImageFile(imgPath));
            } catch {
              // Not a valid image file — leave in text
            }
          }
          if (newImages.length > 0) {
            setImages((prev) => [...prev, ...newImages]);
            setValue(cleanText);
            setCursor(Math.min(cursor, cleanText.length));
          }
        })
        .finally(() => {
          extractingRef.current = false;
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [value, cwd, disabled]);

  // Normalize numpad Enter (kpenter) to regular Enter.  With the kitty
  // keyboard protocol enabled, numpad Enter sends codepoint 57414 which Ink
  // parses as "kpenter" instead of "return", so key.return is never set.
  // We listen on Ink's internal event emitter and re-emit the sequence as
  // a plain carriage return (\r) that Ink recognises as key.return.
  const { internal_eventEmitter } = useStdin() as ReturnType<typeof useStdin> & {
    internal_eventEmitter: EventEmitter;
  };
  useEffect(() => {
    if (!isActive || !internal_eventEmitter) return;
    // Matches ESC[57414u  or  ESC[57414;Nu  (N = modifier) — numpad Enter
    // in the kitty keyboard protocol.
    // eslint-disable-next-line no-control-regex
    const kpEnterRe = /^\x1b\[57414(;\d+)?u$/;
    const onInput = (data: string): void => {
      if (kpEnterRe.test(data)) {
        // Determine modifier flags from the sequence
        const modMatch = /;(\d+)u$/.exec(data);
        const mod = modMatch ? Math.max(0, parseInt(modMatch[1], 10) - 1) : 0;
        const hasShift = !!(mod & 1);
        const hasMeta = !!(mod & 10);
        // Re-emit as regular Enter, preserving shift/meta for newline insertion
        const synth = hasShift ? "\x1b[13;2u" : hasMeta ? "\x1b\r" : "\r";
        internal_eventEmitter.emit("input", synth);
      }
    };
    internal_eventEmitter.on("input", onInput);
    return () => {
      internal_eventEmitter.removeListener("input", onInput);
    };
  }, [isActive, internal_eventEmitter]);

  useInput(
    (input, key) => {
      // Shift+` (tilde) toggles task overlay — works even while agent is running
      if (input === "~") {
        onToggleTasks?.();
        return;
      }

      if (disabled) {
        if ((key.ctrl && input === "c") || key.escape) {
          onAbort();
          return;
        }
        // When disabled (agent running), allow typing but block submission
        if (key.return) return;
      }

      if (key.return && (key.shift || key.meta)) {
        setValue((v) => v.slice(0, cursor) + "\n" + v.slice(cursor));
        setCursor((c) => c + 1);
        return;
      }

      if (key.return) {
        // If slash menu is open and a command is selected, fill it in
        if (isSlashMode && filteredCommands.length > 0) {
          const selected = filteredCommands[Math.min(menuIndex, filteredCommands.length - 1)];
          const cmd = "/" + selected.name;
          // Submit the command directly
          historyRef.current.push({ text: cmd, images: [] });
          historyIndexRef.current = -1;
          onSubmit(cmd, []);
          setValue("");
          setCursor(0);
          setImages([]);
          setSelectedImageIndex(null);
          setPasteText("");
          return;
        }

        const trimmed = value.trim();
        if (trimmed || images.length > 0) {
          if (trimmed || images.length > 0) {
            historyRef.current.push({ text: trimmed, images: [...images] });
          }
          historyIndexRef.current = -1;
          // Compute paste info adjusted for trimming
          const trimLeading = value.length - value.trimStart().length;
          const paste: PasteInfo | undefined =
            pasteText && pasteText.includes("\n")
              ? {
                  offset: Math.max(0, pasteOffset - trimLeading),
                  length: pasteText.length,
                  lineCount: pasteText.split("\n").length,
                }
              : undefined;
          onSubmit(trimmed, [...images], paste);
          setValue("");
          setCursor(0);
          setImages([]);
          setSelectedImageIndex(null);
          setPasteText("");
        }
        return;
      }

      // Option+Tab — toggle plan mode
      if (key.meta && key.tab) {
        onTogglePlan?.();
        return;
      }

      // Ctrl+P — toggle plan mode (alternate binding)
      if (key.ctrl && input === "p") {
        onTogglePlan?.();
        return;
      }

      // Ctrl+V — paste image from clipboard (like Claude Code)
      // Check clipboard for image first; if none, let text paste through normally
      if (key.ctrl && input === "v") {
        if (pastingRef.current) return;
        pastingRef.current = true;
        clipboardHasImage()
          .then(async (hasImage) => {
            if (hasImage) {
              const img = await getClipboardImage();
              if (img) {
                setImages((prev) => [...prev, img]);
                setImageStatus(`📎 Image pasted`);
              } else {
                setImageStatus(getNoImageMessage());
              }
            }
            // If no image on clipboard, do nothing — Ink handles text paste natively
          })
          .catch(() => {
            // Clipboard check failed — ignore
          })
          .finally(() => {
            pastingRef.current = false;
          });
        return;
      }

      // Ctrl+I — paste image from clipboard (alternative binding)
      if (key.ctrl && input === "i") {
        if (pastingRef.current) return;
        pastingRef.current = true;
        getClipboardImage()
          .then((img) => {
            if (img) {
              setImages((prev) => [...prev, img]);
              setImageStatus(`📎 Image pasted`);
            } else {
              setImageStatus(getNoImageMessage());
            }
          })
          .finally(() => {
            pastingRef.current = false;
          });
        return;
      }

      if (key.ctrl && input === "c") {
        if (value || images.length > 0) {
          setValue("");
          setCursor(0);
          setImages([]);
          setPasteText("");
        } else {
          onAbort();
        }
        return;
      }

      if (key.ctrl && input === "d") {
        app.exit();
        return;
      }

      // Home / End
      if (key.ctrl && input === "a") {
        setCursor(0);
        return;
      }
      if (key.ctrl && input === "e") {
        setCursor(value.length);
        return;
      }

      if (key.backspace || key.delete) {
        // Delete selected image
        if (selectedImageIndex !== null) {
          setImages((prev) => prev.filter((_, i) => i !== selectedImageIndex));
          setSelectedImageIndex(null);
          return;
        }
        if (cursor > 0) {
          setValue((v) => v.slice(0, cursor - 1) + v.slice(cursor));
          setCursor((c) => c - 1);
        } else if (!value && images.length > 0) {
          setImages((prev) => prev.slice(0, -1));
        }
        return;
      }

      if (key.upArrow) {
        // If slash menu is open, navigate it
        if (isSlashMode && filteredCommands.length > 0) {
          setMenuIndex((i) => Math.max(0, i - 1));
          return;
        }
        // Select images when cursor is at start of input and images are attached
        if (images.length > 0 && cursor === 0) {
          if (selectedImageIndex === null) {
            setSelectedImageIndex(images.length - 1);
          } else if (selectedImageIndex > 0) {
            setSelectedImageIndex(selectedImageIndex - 1);
          }
          return;
        }
        const history = historyRef.current;
        if (history.length === 0) return;
        const newIndex =
          historyIndexRef.current === -1
            ? history.length - 1
            : Math.max(0, historyIndexRef.current - 1);
        historyIndexRef.current = newIndex;
        const entry = history[newIndex];
        setValue(entry.text);
        setCursor(entry.text.length);
        setImages(entry.images);
        setSelectedImageIndex(null);
        return;
      }

      if (key.downArrow) {
        // If slash menu is open, navigate it
        if (isSlashMode && filteredCommands.length > 0) {
          setMenuIndex((i) => Math.min(filteredCommands.length - 1, i + 1));
          return;
        }
        // Deselect image on down arrow
        if (selectedImageIndex !== null) {
          setSelectedImageIndex(null);
          return;
        }
        const history = historyRef.current;
        if (historyIndexRef.current === -1) {
          if (onDownAtEnd) onDownAtEnd();
          return;
        }
        const newIndex = historyIndexRef.current + 1;
        if (newIndex >= history.length) {
          historyIndexRef.current = -1;
          setValue("");
          setCursor(0);
          setImages([]);
        } else {
          historyIndexRef.current = newIndex;
          const entry = history[newIndex];
          setValue(entry.text);
          setCursor(entry.text.length);
          setImages(entry.images);
          setSelectedImageIndex(null);
        }
        return;
      }

      if (key.escape) {
        if (selectedImageIndex !== null) {
          setSelectedImageIndex(null);
          return;
        }
        const now = Date.now();
        if ((value || images.length > 0) && now - lastEscRef.current < 400) {
          setValue("");
          setCursor(0);
          setImages([]);
          setPasteText("");
        }
        lastEscRef.current = now;
        return;
      }

      if (key.tab && key.shift) {
        onShiftTab?.();
        return;
      }

      // Tab completion for slash commands
      if (key.tab) {
        if (isSlashMode && filteredCommands.length > 0) {
          const selected = filteredCommands[Math.min(menuIndex, filteredCommands.length - 1)];
          const cmd = "/" + selected.name;
          setValue(cmd);
          setCursor(cmd.length);
        }
        return;
      }

      if (key.leftArrow) {
        // Navigate between selected images
        if (selectedImageIndex !== null && images.length > 1) {
          setSelectedImageIndex((i) => (i !== null && i > 0 ? i - 1 : i));
          return;
        }
        if (cursor > 0) setCursor((c) => c - 1);
        return;
      }

      if (key.rightArrow) {
        // Navigate between selected images
        if (selectedImageIndex !== null && images.length > 1) {
          setSelectedImageIndex((i) => (i !== null && i < images.length - 1 ? i + 1 : i));
          return;
        }
        if (cursor < value.length) setCursor((c) => c + 1);
        return;
      }

      if (input) {
        setSelectedImageIndex(null);
        const normalized = input.replace(/\r\n?/g, "\n");
        setValue((v) => v.slice(0, cursor) + normalized + v.slice(cursor));
        setCursor((c) => c + normalized.length);

        // Detect paste: Ink delivers pasted text as input.length > 1
        // For large pastes, Ink may split into multiple chunks, so we
        // accumulate and debounce to capture the full paste.
        if (input.length > 1) {
          setPasteText((prev) => {
            if (!prev) setPasteOffset(cursor); // record where paste starts on first chunk
            return prev + normalized;
          });
          if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
          pasteTimerRef.current = setTimeout(() => {
            // After 100ms of quiet, finalize: only keep paste state if it had newlines
            setPasteText((p) => (p.includes("\n") ? p : ""));
            pasteTimerRef.current = null;
          }, 100);
        }
      }
    },
    { isActive },
  );

  // Calculate visual lines and cap at MAX_VISIBLE_LINES (scroll to cursor)
  const visualLines = getVisualLines(value, columns);
  const contentWidth = columns - PROMPT.length - BOX_OVERHEAD;

  // Find which visual line and column the cursor is on
  const cursorLineInfo = useMemo(() => {
    let pos = 0;
    const hardLines = value.split("\n");
    let visualLineIndex = 0;
    for (let h = 0; h < hardLines.length; h++) {
      const wrapped = wrapLine(hardLines[h], contentWidth > 0 ? contentWidth : value.length + 1);
      for (let w = 0; w < wrapped.length; w++) {
        const lineLen = wrapped[w].length;
        const lineStart = pos;
        const lineEnd = pos + lineLen;
        // Cursor is on this visual line if it falls within [lineStart, lineEnd]
        // For the last wrapped segment of a hard line, also include the newline position
        const isLastWrap = w === wrapped.length - 1;
        const effectiveEnd = isLastWrap ? lineEnd : lineEnd;
        if (cursor >= lineStart && cursor <= effectiveEnd) {
          return { line: visualLineIndex, col: cursor - lineStart };
        }
        pos += lineLen;
        // Account for the space consumed by word-wrap break
        if (!isLastWrap) {
          // wrapped lines don't consume extra chars unless word-broken
        }
        visualLineIndex++;
      }
      pos++; // newline character
    }
    // Fallback: cursor at end
    return { line: visualLines.length - 1, col: visualLines[visualLines.length - 1]?.length ?? 0 };
  }, [value, cursor, contentWidth, visualLines]);

  // Scroll window to keep cursor visible
  const totalLines = visualLines.length;
  let startLine: number;
  if (totalLines <= MAX_VISIBLE_LINES) {
    startLine = 0;
  } else {
    // Ensure the cursor line is visible
    const cursorLine = cursorLineInfo.line;
    // Try to keep current scroll position, but adjust if cursor is out of view
    const idealStart = Math.max(0, cursorLine - MAX_VISIBLE_LINES + 1);
    startLine = Math.min(idealStart, totalLines - MAX_VISIBLE_LINES);
  }
  const displayLines = visualLines.slice(startLine, startLine + MAX_VISIBLE_LINES);
  const cursorDisplayLine = cursorLineInfo.line - startLine;

  // Build a set of known command names for highlighting (start-of-line + inline)
  const knownCommandNames = useMemo(() => {
    const names = new Set<string>();
    for (const cmd of commands) {
      names.add(cmd.name);
      for (const alias of cmd.aliases) names.add(alias);
    }
    return names;
  }, [commands]);

  // Determine if the input starts with a known slash command and find command boundary
  const commandEndIndex = useMemo(() => {
    if (!value.startsWith("/")) return 0;
    const spaceIdx = value.indexOf(" ");
    const cmdToken = spaceIdx === -1 ? value.slice(1) : value.slice(1, spaceIdx);
    if (!knownCommandNames.has(cmdToken.toLowerCase())) return 0;
    return spaceIdx === -1 ? value.length : spaceIdx;
  }, [value, knownCommandNames]);
  const isCommand = commandEndIndex > 0;

  // Find all inline /command token positions for highlighting
  const inlineCommandRanges = useMemo(() => {
    if (isCommand) return []; // start-of-line commands use the existing highlight
    const ranges: Array<{ start: number; end: number }> = [];
    const regex = /(?:^|\s)(\/([a-z][\w-]*))/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value)) !== null) {
      const name = match[2].toLowerCase();
      if (knownCommandNames.has(name)) {
        const tokenStart = match.index + match[0].length - match[1].length;
        ranges.push({ start: tokenStart, end: tokenStart + match[1].length });
      }
    }
    return ranges;
  }, [value, isCommand, knownCommandNames]);

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={disabled ? theme.textDim : borderPulseColors[borderFrame]}
        paddingLeft={1}
        paddingRight={1}
      >
        {images.length > 0 && (
          <Box>
            {images.map((img, i) => (
              <Text
                key={i}
                color={i === selectedImageIndex ? theme.text : theme.accent}
                backgroundColor={i === selectedImageIndex ? theme.error : undefined}
                bold={i === selectedImageIndex}
                underline={i !== selectedImageIndex}
              >
                {i > 0 ? " " : ""}
                {img.kind === "text" ? `[File: ${img.fileName}]` : `[Image #${i + 1}]`}
              </Text>
            ))}
            {selectedImageIndex === null ? (
              <Text color={theme.textDim}>{" (↑ to select)"}</Text>
            ) : (
              <Text color={theme.textDim}>
                {images.length > 1 ? " → to next · ← to prev · " : " "}
                {"Delete to remove · Esc to cancel"}
              </Text>
            )}
          </Box>
        )}
        {(() => {
          if (pasteText && value) {
            const pasteLineCount = pasteText.split("\n").length;
            const indicator = `[Pasted text #${pasteText.length} +${pasteLineCount} lines]`;
            const pasteLen = pasteText.length;
            const typedBefore = value.slice(0, pasteOffset);
            const typedAfter = value.slice(pasteOffset + pasteLen);
            const displayStr = typedBefore + indicator + typedAfter;

            // Map real cursor to display cursor
            let cursorInDisplay: number;
            if (cursor <= pasteOffset) {
              cursorInDisplay = cursor;
            } else if (cursor >= pasteOffset + pasteLen) {
              cursorInDisplay = cursor - pasteLen + indicator.length;
            } else {
              cursorInDisplay = pasteOffset + indicator.length;
            }

            return (
              <Box>
                <Text color={disabled ? theme.textDim : theme.inputPrompt} bold>
                  {PROMPT}
                </Text>
                <Text color={theme.text}>{displayStr.slice(0, cursorInDisplay)}</Text>
                <Text color={theme.text} inverse={cursorVisible}>
                  {cursorInDisplay < displayStr.length ? displayStr[cursorInDisplay] : " "}
                </Text>
                {cursorInDisplay + 1 < displayStr.length && (
                  <Text color={theme.text}>{displayStr.slice(cursorInDisplay + 1)}</Text>
                )}
              </Box>
            );
          }

          return displayLines.map((line, i) => {
            const showCursor = i === cursorDisplayLine;
            const col = cursorLineInfo.col;

            // Calculate the absolute character offset where this display line starts
            let lineStartOffset = 0;
            for (let j = 0; j < startLine + i; j++) {
              lineStartOffset += visualLines[j].length;
            }
            const hardLines = value.split("\n");
            let offset = 0;
            let vlIndex = 0;
            for (let h = 0; h < hardLines.length && vlIndex <= startLine + i; h++) {
              const wrapped = wrapLine(
                hardLines[h],
                contentWidth > 0 ? contentWidth : value.length + 1,
              );
              for (let w = 0; w < wrapped.length && vlIndex <= startLine + i; w++) {
                if (vlIndex === startLine + i) {
                  lineStartOffset = offset;
                }
                offset += wrapped[w].length;
                vlIndex++;
              }
              offset++; // newline
            }

            // Check if a character offset falls inside a highlighted command range
            const isInCommandRange = (absOffset: number): boolean => {
              // Start-of-line known command
              if (isCommand && absOffset < commandEndIndex) return true;
              // Inline command tokens
              for (const range of inlineCommandRanges) {
                if (absOffset >= range.start && absOffset < range.end) return true;
              }
              return false;
            };

            // Render text with command tokens highlighted in blue
            const renderSegments = (text: string, textStartOffset: number) => {
              if (inlineCommandRanges.length === 0 && !isCommand) {
                return <Text color={theme.text}>{text}</Text>;
              }
              // Split text into highlighted and non-highlighted segments
              const segments: React.ReactNode[] = [];
              let pos = 0;
              while (pos < text.length) {
                const absPos = textStartOffset + pos;
                if (isInCommandRange(absPos)) {
                  // Find the end of the highlighted run
                  let end = pos + 1;
                  while (end < text.length && isInCommandRange(textStartOffset + end)) end++;
                  segments.push(
                    <Text key={`cmd-${pos}`} color={theme.commandColor} bold>
                      {text.slice(pos, end)}
                    </Text>,
                  );
                  pos = end;
                } else {
                  // Find the end of the non-highlighted run
                  let end = pos + 1;
                  while (end < text.length && !isInCommandRange(textStartOffset + end)) end++;
                  segments.push(
                    <Text key={`txt-${pos}`} color={theme.text}>
                      {text.slice(pos, end)}
                    </Text>,
                  );
                  pos = end;
                }
              }
              return <>{segments}</>;
            };

            const before = showCursor ? line.slice(0, col) : line;
            const charUnderCursor = showCursor ? (col < line.length ? line[col] : " ") : "";
            const after = showCursor ? line.slice(col + (col < line.length ? 1 : 0)) : "";
            const cursorCharOffset = lineStartOffset + col;
            const cursorInCommand = isInCommandRange(cursorCharOffset);

            return (
              <Box key={i}>
                <Text color={disabled ? theme.textDim : theme.inputPrompt} bold>
                  {i === 0 ? PROMPT : "  "}
                </Text>
                {renderSegments(before, lineStartOffset)}
                {showCursor && (
                  <Text
                    color={cursorInCommand ? theme.commandColor : theme.text}
                    bold={cursorInCommand}
                    inverse={cursorVisible}
                  >
                    {charUnderCursor}
                  </Text>
                )}
                {after &&
                  renderSegments(after, lineStartOffset + col + (col < line.length ? 1 : 0))}
              </Box>
            );
          });
        })()}
      </Box>
      {/* Image paste status message */}
      {imageStatus && (
        <Box paddingLeft={1}>
          <Text color={theme.textDim}>{imageStatus}</Text>
        </Box>
      )}
      {/* Queue hint — shown when agent is running and user has typed something */}
      {isAgentRunning && !disabled && value.length > 0 && !imageStatus && (
        <Box paddingLeft={1}>
          <Text color={theme.warning ?? theme.accent}>{"⏳ Enter to queue — will send after current task"}</Text>
        </Box>
      )}
      {/* Hints — shown when input is empty and not disabled */}
      {!disabled && value.length === 0 && !isSlashMode && !imageStatus && (
        <Box paddingLeft={1}>
          {isAgentRunning ? (
            <Text color={theme.textDim}>{"Type to queue a message…"}</Text>
          ) : (
            <>
              <Text color={theme.textDim}>
                {"⌥Tab "}
              </Text>
              <Text color={theme.border}>{"plan"}</Text>
              <Text color={theme.textDim}>{" · "}</Text>
              <Text color={theme.textDim}>
                {"⇧` "}
              </Text>
              <Text color={theme.border}>{"tasks"}</Text>
              <Text color={theme.textDim}>{" · "}</Text>
              <Text color={theme.textDim}>
                {"/ "}
              </Text>
              <Text color={theme.border}>{"commands"}</Text>
            </>
          )}
        </Box>
      )}
      {/* Slash command menu — shown below the input box */}
      {isSlashMode && filteredCommands.length > 0 && (
        <SlashCommandMenu commands={commands} filter={slashFilter} selectedIndex={menuIndex} />
      )}
    </Box>
  );
}
