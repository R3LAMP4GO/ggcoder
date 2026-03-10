# GG Coder vs Claude Code — Feature Parity Gap Analysis

**Date:** March 10, 2026
**Claude Code version compared:** Latest (from https://github.com/anthropics/claude-code)
**GG Coder version:** v4.1.1 (commit e558419)

---

## ✅ Features GG Coder HAS (Parity Achieved)

| Feature | Claude Code | GG Coder | Notes |
|---------|------------|----------|-------|
| **Core agent loop** | ✅ | ✅ | Multi-turn agentic execution |
| **Tool suite** | read, write, edit, bash, grep, glob, ls | read, write, edit, bash, grep, find, ls, web_fetch | GG Coder has `web_fetch` (CC uses server-side `web_search`) |
| **Subagents** | Explore, Plan, General-purpose | Explore, Plan, Worker | ✅ Full parity with built-in agents |
| **Sub-sub-agent prevention** | `GG_IS_SUBAGENT` env var | ✅ `GG_IS_SUBAGENT` env var | Same pattern |
| **Tool restrictions per agent** | `--restricted-tools` | ✅ `--restricted-tools` CLI flag | Same implementation |
| **Plan mode** | EnterPlanMode/ExitPlanMode tools + state machine | ✅ Full state machine + tools | `plan-mode.ts` + `plan-tools.ts` |
| **Plan mode tool guards** | Write/Edit blocked in planning state | ✅ `checkPlanModeBlock()` | |
| **AskUserQuestion** | Elicitation tool with schema support | ✅ `ask-user-question.ts` | Options + elicitation modes |
| **Inline slash commands** | Scan entire input for `/command` | ✅ `extractEmbedded()` | |
| **Skills** | `.claude/skills/` with frontmatter | ✅ `.gg/skills/` with frontmatter | Basic parity |
| **Custom agents** | `.claude/agents/*.md` | ✅ `.gg/agents/*.md` | |
| **Custom commands** | `.claude/commands/*.md` | ✅ `.gg/commands/*.md` | |
| **MCP support** | Full MCP client | ✅ MCPClientManager | |
| **Session management** | Save/resume/continue | ✅ SessionManager | |
| **Context compaction** | `/compact` with token estimation | ✅ Compactor + token estimator | |
| **Background processes** | `run_in_background`, task_output, task_stop | ✅ ProcessManager + tools | |
| **Task management** | Task pane with add/list/done/remove | ✅ tasks tool | |
| **Multi-provider** | Anthropic, (others via API keys) | ✅ Anthropic, OpenAI, GLM, Moonshot, Ollama | GG Coder has MORE providers |
| **OAuth login** | ✅ | ✅ Anthropic + OpenAI OAuth, API key for others | |
| **Telemetry** | ✅ | ✅ `telemetry.ts` | |
| **Extensions** | Plugins | ✅ ExtensionLoader (basic) | Needs expansion |
| **Print mode** | `--print` / pipe mode | ✅ `--print` mode | |
| **JSON mode** | `--json` NDJSON streaming | ✅ `--json` mode | |
| **Auto-update** | Background auto-update | ✅ `auto-update.ts` | |
| **Project context** | CLAUDE.md | ✅ CLAUDE.md + AGENTS.md | |
| **Thinking/extended thinking** | ✅ | ✅ `--thinking` levels | |
| **Model switching** | `/model` command | ✅ | |

---

## 🔴 CRITICAL GAPS — Will Cause Bottlenecks

### 1. Hooks System (HIGH PRIORITY)
**Claude Code has:** A full lifecycle hook system with 15+ events:
- `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`
- `PermissionRequest`, `Notification`, `SubagentStart`, `SubagentStop`
- `Stop`, `TeammateIdle`, `TaskCompleted`, `InstructionsLoaded`
- `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `SessionEnd`

Each hook supports:
- **Matcher patterns** (regex-based filtering by tool name, event type)
- **4 handler types**: command (shell), HTTP, prompt (LLM), agent (subagent)
- **Decision control**: hooks can block/allow/modify tool calls
- **Async hooks**: run in background without blocking
- **Config locations**: user-level, project-level, local, managed policy, plugin, skill/agent frontmatter

**GG Coder has:** An `EventBus` class but NO hook execution system. The extension system exists but has no lifecycle events to intercept tool calls or control flow.

**Why critical:** Hooks are the foundation of Claude Code's customizability. Without them:
- Can't auto-format after file edits
- Can't lint on write
- Can't block dangerous commands
- Can't enforce team policies
- Plugins/skills are severely limited in what they can do

### 2. Checkpointing & Rewind (HIGH PRIORITY)
**Claude Code has:** Automatic checkpoint tracking of all file edits with:
- `Esc+Esc` or `/rewind` to open rewind menu
- Restore code and conversation
- Restore conversation only (keep code)
- Restore code only (keep conversation)
- Summarize from a point forward (targeted compaction)
- Persists across sessions

**GG Coder has:** Nothing. No file change tracking, no rewind, no undo.

**Why critical:** Without checkpointing, users can't recover from bad edits. This is a safety net — Claude Code users rely on it constantly. The agent makes mistakes, and rewind is how you fix them without `git stash`.

### 3. Plugin System (HIGH PRIORITY)
**Claude Code has:** A full plugin architecture:
- `.claude-plugin/plugin.json` manifest
- Namespace-scoped skills (`/plugin-name:skill-name`)
- Plugin-bundled agents, hooks, MCP servers, LSP servers, settings
- `--plugin-dir` for development/testing
- `/plugin` command for install/manage
- Plugin marketplace submission
- Settings priority: enterprise > personal > project > plugin

**GG Coder has:** A basic `ExtensionLoader` that loads `.js` files — no manifest, no namespacing, no marketplace, no plugin discovery.

**Why critical:** The plugin ecosystem is how Claude Code scales. Without it, users can't share reusable configurations, and teams can't standardize workflows.

### 4. Permission System (MEDIUM-HIGH PRIORITY)
**Claude Code has:**
- Permission modes: `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan`
- Per-tool permission prompts
- Permission persistence across sessions
- `--dangerously-skip-permissions` flag
- Hooks can intercept permission requests
- Subagents can have different permission modes

**GG Coder has:** No permission system. All tools execute without user confirmation.

**Why critical:** Running bash commands, writing files, and editing code without any permission gate is dangerous. Users running GG Coder on unfamiliar codebases have no safety rails.

---

## 🟡 IMPORTANT GAPS — Significant Missing Features

### 5. Agent Teams (Experimental in CC)
**Claude Code has:**
- Multiple Claude instances coordinating via shared task list and mailbox
- Lead agent + teammates with independent context windows
- Direct teammate-to-teammate messaging
- tmux/iTerm2 split-pane display mode
- Task assignment, claiming, dependency tracking
- `TeammateIdle` and `TaskCompleted` hooks for quality gates

**GG Coder has:** Nothing. Subagents are serial/parallel but don't form persistent teams.

**Impact:** Advanced users doing large refactors or parallel research lose significant productivity.

### 6. Output Styles
**Claude Code has:**
- Built-in styles: Default, Explanatory, Learning
- Custom output styles via `.claude/output-styles/*.md`
- Styles modify the system prompt, can strip coding instructions
- `/output-style` command to switch
- `keep-coding-instructions` frontmatter option

**GG Coder has:** Nothing. System prompt is fixed.

**Impact:** Can't repurpose GG Coder for non-coding tasks (writing, research, teaching). Claude Code positions output styles as the way to turn it into "any type of agent."

### 7. LSP Integration
**Claude Code has:**
- Language Server Protocol support
- `.lsp.json` configuration
- Pre-built LSP plugins for TypeScript, Python, Rust
- Real-time code intelligence (completions, diagnostics, go-to-definition)

**GG Coder has:** Nothing.

**Impact:** Claude Code can use LSP for more accurate code understanding. Without it, GG Coder relies entirely on grep/read.

### 8. Worktree Isolation
**Claude Code has:**
- `isolation: "worktree"` in agent frontmatter
- Subagents can work in temporary git worktrees
- Automatic cleanup when agent finishes with no changes
- `/batch` skill uses worktrees for parallel agents

**GG Coder has:** Nothing. All agents work in the same working directory.

**Impact:** Parallel agents can create file conflicts. Worktree isolation is how Claude Code safely runs multiple agents modifying the same files.

### 9. Bundled Skills (/simplify, /batch, /debug, /loop, /claude-api)
**Claude Code has:**
- `/simplify`: spawns 3 parallel review agents, fixes issues
- `/batch <instruction>`: decomposes work into parallel worktree agents
- `/debug [description]`: reads session debug log
- `/loop [interval] <prompt>`: runs prompt on schedule (cron)
- `/claude-api`: loads API reference for your language

**GG Coder has:** Basic skill loading but no bundled power skills.

### 10. Session Forking
**Claude Code has:** `--continue --fork-session` to branch off a session while preserving the original.

**GG Coder has:** `continue` subcommand but no forking.

### 11. Persistent Memory / Auto-Memory
**Claude Code has:**
- Auto-memory that saves learnings across sessions
- Memory scopes: `user`, `project`, `local`
- Subagents can have their own memory scope

**GG Coder has:** Nothing. Context is lost between sessions (except session resume).

### 12. Statusline
**Claude Code has:** `/statusline` command that configures terminal status line showing current model, token usage, agent state.

**GG Coder has:** Nothing.

---

## 🟢 MINOR GAPS — Nice to Have

### 13. Remote Control / Teleport / Desktop App
Claude Code has cross-device session continuity, `/teleport` to move sessions between surfaces, and a desktop app. These are platform features GG Coder doesn't need to replicate immediately.

### 14. Chrome Extension
Browser integration for debugging live web apps. Low priority for CLI tool.

### 15. Slack / GitHub Actions Integration
CI/CD and chat integrations. Can be built on top of print/JSON modes.

### 16. `/bug` Command
Built-in bug reporting. Minor convenience feature.

### 17. Agent SDK (Programmatic API)
Claude Code exposes a programmatic SDK for building custom agents. GG Coder's `--json` mode partially covers this.

---

## Recommended Implementation Order

### Phase 1: Safety & Recovery (CRITICAL)
1. **Checkpointing & Rewind** — Track file edits, enable `Esc+Esc` / `/rewind`
2. **Permission System** — Add tool permission prompts with persistence

### Phase 2: Extensibility Foundation (CRITICAL)
3. **Hooks System** — Lifecycle events with command/HTTP/prompt handlers
4. **Plugin System** — Manifest, namespacing, `--plugin-dir`, `/plugin` command

### Phase 3: Productivity (IMPORTANT)
5. **Output Styles** — Custom system prompt styles, `/output-style`
6. **Bundled Skills** — `/simplify`, `/batch`, `/debug`, `/loop`
7. **Persistent Memory** — Auto-memory with user/project/local scopes
8. **Worktree Isolation** — Git worktree support for subagents
9. **Session Forking** — `--fork-session` flag

### Phase 4: Advanced (NICE TO HAVE)
10. **Agent Teams** — Multi-instance coordination (experimental even in CC)
11. **LSP Integration** — Language server support
12. **Statusline** — Terminal status display
