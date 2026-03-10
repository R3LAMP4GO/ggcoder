# GG Coder vs Claude Code — Deep Feature Comparison

## 1. Inline Slash Commands

### What Claude Code Has

| Capability | Claude Code | Detail |
|-----------|-------------|--------|
| Start-of-line commands | ✅ | `/command args` — standard slash command |
| Inline (embedded) commands | ✅ | `fix auth /research` detects `/research` mid-prompt |
| UI-handled commands | ✅ | `/quit`, `/model`, `/compact`, `/clear` — processed client-side before LLM |
| Prompt-template commands | ✅ | `/scan`, `/research` etc — template injected as context alongside user text |
| Custom commands | ✅ | `.claude/commands/*.md` — user-defined |
| Skills (superset of commands) | ✅ | `.claude/skills/*/SKILL.md` with frontmatter, supporting files, auto-invocation |
| Bundled skills | ✅ | `/simplify`, `/batch`, `/debug`, `/loop`, `/claude-api` |
| Plugin-namespaced commands | ✅ | `/plugin-name:skill-name` — prevents conflicts |
| `$ARGUMENTS` substitution | ✅ | `/deploy $ARGUMENTS` — args injected into template |
| `$ARGUMENTS[N]` indexed access | ✅ | `$0`, `$1` for positional args |
| `${CLAUDE_SESSION_ID}` | ✅ | Session-aware dynamic substitution |
| `${CLAUDE_SKILL_DIR}` | ✅ | Skill directory path for bundled scripts |
| `disable-model-invocation` | ✅ | Prevent Claude from auto-loading a skill |
| `user-invocable: false` | ✅ | Hide from `/` menu (background knowledge only) |
| `context: fork` | ✅ | Run skill in a forked subagent context |
| `agent` frontmatter | ✅ | Choose which subagent runs the skill |
| `allowed-tools` | ✅ | Tool restrictions per-skill |
| `argument-hint` | ✅ | Autocomplete hint like `[issue-number]` |
| `!` bash prefix | ✅ | `!ls` runs bash directly, adds output to session |
| `@` file mention | ✅ | `@src/auth.ts` triggers file path autocomplete |
| MCP prompts as commands | ✅ | `/mcp__server__prompt` discovered from connected servers |
| `/agents` interactive manager | ✅ | Create/edit/delete agents with guided setup |
| `/hooks` interactive manager | ✅ | Create/edit hooks interactively |
| `/plugin` manager | ✅ | Install/manage plugins |

### What GG Coder Has

| Capability | GG Coder | Detail |
|-----------|----------|--------|
| Start-of-line commands | ✅ | `parse(input)` in `SlashCommandRegistry` |
| Inline (embedded) commands | ✅ | `extractEmbedded()` scans for `/command` anywhere in input |
| UI-handled commands | ✅ | `/quit`, `/model`, `/compact`, `/new`, `/session`, `/settings`, `/help` |
| Prompt-template commands | ✅ | `/scan`, `/verify`, `/research`, `/init`, `/setup-lint`, `/setup-commit`, `/setup-tests`, `/setup-update` |
| Custom commands | ✅ | `.gg/commands/*.md` with frontmatter |
| Skills | ✅ | `.gg/skills/*.md` with name/description frontmatter |
| Bundled skills | ❌ | No `/simplify`, `/batch`, `/debug`, `/loop` |
| Plugin-namespaced commands | ❌ | No plugin namespace system |
| `$ARGUMENTS` substitution | ✅ | Prompt commands support `$ARGUMENTS` |
| `$ARGUMENTS[N]` indexed access | ❌ | No positional arg access |
| `${CLAUDE_SESSION_ID}` | ❌ | No session-aware substitution |
| `${CLAUDE_SKILL_DIR}` | ❌ | No skill directory path variable |
| `disable-model-invocation` | ❌ | No control over auto-invocation |
| `user-invocable: false` | ❌ | No way to hide skills from menu |
| `context: fork` | ❌ | No forked subagent context for skills |
| `agent` frontmatter | ❌ | No agent selection per-skill |
| `allowed-tools` | ❌ | No per-skill tool restrictions |
| `argument-hint` | ❌ | No autocomplete hints |
| `!` bash prefix | ❌ | No bash shortcut |
| `@` file mention | ❌ | No file path autocomplete |
| MCP prompts as commands | ❌ | MCP tools work but prompts aren't surfaced |
| `/agents` interactive manager | ❌ | No interactive agent CRUD |
| `/hooks` manager | ❌ | No hooks system at all |
| `/plugin` manager | ❌ | No plugin system |

### Critical Gaps in Inline Commands

1. **Skills frontmatter is minimal** — GG Coder's skills only parse `name` and `description`. Claude Code supports `disable-model-invocation`, `user-invocable`, `context`, `agent`, `allowed-tools`, `model`, `hooks`, `argument-hint`. This limits how skills behave.

2. **No `$ARGUMENTS[N]` or `${CLAUDE_*}` substitutions** — GG Coder passes full args as a single string. Claude Code supports indexed args (`$0`, `$1`) and dynamic variables (`${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`).

3. **No `!` bash prefix or `@` file mentions** — These are high-frequency UX shortcuts that Claude Code users rely on constantly.

4. **No `/agents` interactive manager** — Claude Code lets users create/edit/delete agents interactively with guided setup + Claude generation. GG Coder requires manual file editing.

5. **No bundled power skills** — `/simplify` (3 parallel review agents), `/batch` (decompose + parallel worktree agents), `/debug` (session log analysis), `/loop` (scheduled prompts) are missing.

---

## 2. Plan Mode

### What Claude Code Has

| Capability | Claude Code | Detail |
|-----------|-------------|--------|
| Mode toggle | ✅ | `Shift+Tab` cycles: normal → auto-accept → plan → normal |
| `/plan` command | ✅ | Enter plan mode directly |
| EnterPlanMode tool | ✅ | Model calls proactively for non-trivial tasks |
| ExitPlanMode tool | ✅ | Signals plan is ready for review |
| Read-only enforcement | ✅ | Write/Edit tools denied in planning state |
| Bash allowed (read-only) | ✅ | Bash works but only for read-only ops |
| Plan subagent delegation | ✅ | Claude delegates research to Plan subagent (separate context) |
| Plan approval flow | ✅ | User can approve/edit/reject/cancel |
| Plan file persistence | ✅ | Plans saved to `.claude/plans/` |
| Permission mode `plan` | ✅ | Can set as permission mode for subagents |
| VS Code plan review | ✅ | Visual diff review in IDE |
| Plan approval for teammates | ✅ | Agent team teammates can require plan approval |
| AskUserQuestion/Elicitation | ✅ | Structured questions during planning |
| Integrated with hooks | ✅ | Hooks fire during plan mode (PreToolUse can validate) |

### What GG Coder Has

| Capability | GG Coder | Detail |
|-----------|----------|--------|
| Mode toggle | ❓ | State machine exists but **Shift+Tab keybinding not wired in UI** |
| `/plan` command | ❓ | **Not registered as a slash command** |
| EnterPlanMode tool | ✅ | `enter_plan_mode` tool with reason parameter |
| ExitPlanMode tool | ✅ | `exit_plan_mode` tool with plan parameter |
| Read-only enforcement | ✅ | `checkPlanModeBlock()` blocks write/edit |
| Bash blocked entirely | ⚠️ | GG blocks bash completely vs CC allows read-only bash |
| Plan subagent delegation | ❌ | No automatic delegation to Plan subagent during planning |
| Plan approval flow | ✅ | Manager supports approve/reject/cancel + feedback |
| Plan file persistence | ✅ | Plans saved to `.gg/plans/{timestamp}-{slug}.md` |
| Permission mode `plan` | ❌ | No permission system at all |
| VS Code plan review | ❌ | No IDE integration |
| Plan approval for teammates | ❌ | No agent teams |
| AskUserQuestion/Elicitation | ✅ | Full options + MCP-style elicitation |
| Integrated with hooks | ❌ | No hooks system |
| System prompt injection | ✅ | `PLAN_MODE_SYSTEM_PROMPT` injected when `state === "planning"` |
| Telemetry tracking | ✅ | `trackPlanMode()` with entry method, duration, question count |
| Plan content update after edit | ✅ | `updatePlanContent()` for external edits |
| State change listeners | ✅ | `onChange(listener)` subscription pattern |

### Critical Gaps in Plan Mode

1. **Bash is completely blocked** — GG Coder blocks ALL bash in plan mode. Claude Code allows read-only bash (`ls`, `git status`, `git log`, `git diff`, `find`, `cat`, `head`, `tail`). This is a significant limitation — the agent can't run `git log`, `git diff`, or any read-only shell command during planning. The system prompt even says "DO NOT: use bash — it is completely blocked" which contradicts Claude Code's approach.

2. **No Shift+Tab keybinding** — The state machine exists but there's no UI keybinding to toggle plan mode. Users can only enter plan mode when the model calls `enter_plan_mode` proactively, or if a `/plan` command exists (it doesn't appear to be registered).

3. **No `/plan` slash command** — There's no registered slash command to enter plan mode manually. The user has no way to trigger plan mode except hoping the model does it.

4. **No Plan subagent delegation** — Claude Code's plan mode automatically delegates codebase research to the Plan subagent (separate context window) to avoid filling the main context with exploration results. GG Coder's plan mode runs everything in the main context.

5. **No permission mode integration** — Claude Code's plan mode is also a `permissionMode` option for subagents. GG Coder has no permission system, so this entire dimension is missing.

6. **PlanModeManager not wired to tools/index.ts** — Looking at `createTools()`, `planModeManager` is only passed if explicitly provided in options. In `cli.ts → runInkTUI()`, there's no `PlanModeManager` creation or injection. The plan mode state machine exists but **may not be wired to the actual agent loop**.

---

## 3. Subagents

### What Claude Code Has

| Capability | Claude Code | Detail |
|-----------|-------------|--------|
| Built-in: Explore | ✅ | Haiku model, read-only, thoroughness levels (quick/medium/thorough) |
| Built-in: Plan | ✅ | Inherits model, read-only, for plan mode research |
| Built-in: General-purpose | ✅ | Inherits model, all tools |
| Built-in: Bash | ✅ | Inherits model, runs terminal commands in separate context |
| Built-in: statusline-setup | ✅ | Sonnet, for `/statusline` configuration |
| Built-in: Claude Code Guide | ✅ | Haiku, answers questions about CC features |
| Custom agents (project) | ✅ | `.claude/agents/*.md` |
| Custom agents (user) | ✅ | `~/.claude/agents/*.md` |
| Custom agents (CLI) | ✅ | `--agents '{json}'` for session-only agents |
| Custom agents (plugin) | ✅ | Plugin `agents/` directory |
| `/agents` interactive UI | ✅ | Create/edit/delete with guided setup + Claude generation |
| `claude agents` CLI listing | ✅ | List all agents grouped by source |
| **Frontmatter fields:** | | |
| `name` | ✅ | Required |
| `description` | ✅ | Required — Claude uses this for auto-delegation |
| `tools` (allowlist) | ✅ | Restrict to specific tools |
| `disallowedTools` (denylist) | ✅ | Deny specific tools |
| `model` | ✅ | `sonnet`, `opus`, `haiku`, or `inherit` |
| `permissionMode` | ✅ | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan` |
| `maxTurns` | ✅ | Limit agentic turns |
| `skills` | ✅ | Preload skill content into subagent context |
| `mcpServers` | ✅ | Per-subagent MCP server config |
| `hooks` | ✅ | Lifecycle hooks scoped to subagent |
| `memory` | ✅ | Persistent memory (`user`, `project`, `local` scopes) |
| `background` | ✅ | Always run as background task |
| `isolation` | ✅ | `worktree` — isolated git worktree per agent |
| **Runtime features:** | | |
| Sub-sub-agent prevention | ✅ | Subagents cannot spawn other subagents |
| `Agent(type)` tool restriction | ✅ | Main agent can restrict which subagents it spawns |
| Foreground/background modes | ✅ | `Ctrl+B` to background a running task |
| Permission pre-approval for bg | ✅ | Background agents get permissions approved upfront |
| Auto-compaction | ✅ | Subagents auto-compact when context fills |
| Resumable subagents | ✅ | Background subagents can be resumed in foreground |
| Automatic delegation | ✅ | Claude proactively delegates based on descriptions |
| Tool name: `Agent` | ✅ | Was `Task`, renamed in v2.1.63 |
| Color coding per agent | ✅ | UI shows agent-specific background colors |
| Thoroughness levels | ✅ | Explore agent accepts quick/medium/very thorough |

### What GG Coder Has

| Capability | GG Coder | Detail |
|-----------|----------|--------|
| Built-in: Explore | ✅ | Cheapest model via `getExploreModel()`, read-only tools |
| Built-in: Plan | ✅ | Inherits model, read-only |
| Built-in: Worker | ✅ | Inherits model, all tools (empty tools array = inherit) |
| Built-in: Bash | ❌ | No separate Bash agent |
| Built-in: statusline-setup | ❌ | No statusline feature |
| Built-in: Guide | ❌ | No self-help agent |
| Custom agents (project) | ✅ | `.gg/agents/*.md` |
| Custom agents (user) | ✅ | `~/.gg/agents/*.md` |
| Custom agents (CLI) | ❌ | No `--agents '{json}'` flag |
| Custom agents (plugin) | ❌ | No plugin system |
| `/agents` interactive UI | ❌ | No interactive agent management |
| CLI agent listing | ❌ | No `ggcoder agents` subcommand |
| **Frontmatter fields:** | | |
| `name` | ✅ | Parsed from frontmatter or filename |
| `description` | ✅ | Parsed from frontmatter |
| `tools` (allowlist) | ✅ | Passed via `--restricted-tools` CLI flag |
| `disallowedTools` (denylist) | ❌ | No denylist — only allowlist |
| `model` | ✅ | Parsed from frontmatter, explore gets cheapest via provider mapping |
| `permissionMode` | ❌ | No permission system |
| `maxTurns` | ✅ | Hardcoded to 10 (`SUB_AGENT_MAX_TURNS`) — not configurable per-agent |
| `skills` | ❌ | No skill preloading into subagents |
| `mcpServers` | ❌ | Subagents don't get MCP servers |
| `hooks` | ❌ | No hooks system |
| `memory` | ❌ | No persistent memory |
| `background` | ❌ | No always-background flag |
| `isolation` | ❌ | No worktree isolation |
| **Runtime features:** | | |
| Sub-sub-agent prevention | ✅ | `GG_IS_SUBAGENT=1` env var blocks recursion |
| `Agent(type)` restriction | ❌ | No spawn restriction syntax |
| Foreground/background modes | ❌ | All subagents run in foreground (blocking) |
| Permission pre-approval | ❌ | No permissions |
| Auto-compaction | ❌ | No auto-compaction for subagents |
| Resumable subagents | ❌ | No resume capability |
| Automatic delegation | ✅ | Tool description guides model on when to delegate |
| Tool name | `subagent` | Different name from Claude Code's `Agent` |
| Color coding | ❌ | No per-agent colors |
| Thoroughness levels | ❌ | No thoroughness parameter |
| Output truncation | ✅ | `truncateTail()` — 100K chars / 500 lines max |
| NDJSON streaming | ✅ | Reads `text_delta`, `tool_call_start/end`, `turn_end` events |
| Token tracking | ✅ | Tracks input/output tokens per subagent |
| Progress updates | ✅ | `context.onUpdate()` with tool count, tokens, activity |
| Abort handling | ✅ | `context.signal` + SIGTERM/SIGKILL |
| Stderr capture | ✅ | Capped at 10K chars |

### Critical Gaps in Subagents

1. **`maxTurns` is hardcoded to 10** — Every subagent gets exactly 10 turns. Claude Code allows `maxTurns` per-agent definition. Complex worker agents may need 30+ turns. This is a hard ceiling that will cause subagents to stop mid-task.

2. **No `disallowedTools` (denylist)** — GG Coder only supports allowlists (`tools: [...]`). Claude Code supports both `tools` (allowlist) and `disallowedTools` (denylist). Denylists are more flexible when you want "everything except Write and Edit."

3. **No background/foreground mode** — All GG Coder subagents run in foreground, blocking the main conversation. Claude Code lets users `Ctrl+B` to background a task, or set `background: true` in agent frontmatter. This means GG Coder can't do concurrent work.

4. **No `--agents` CLI flag** — Claude Code supports `--agents '{json}'` for session-only agents defined at launch. Useful for CI/CD and automation scripts.

5. **No skill preloading** — Claude Code can inject skill content into a subagent's context at startup (`skills: [api-conventions, error-handling]`). GG Coder subagents start with only their system prompt.

6. **No per-agent MCP servers** — Claude Code subagents can have their own MCP server configurations. GG Coder subagents inherit nothing from MCP.

7. **No worktree isolation** — Claude Code can run each subagent in an isolated git worktree, preventing file conflicts between parallel agents. This is essential for `/batch`-style parallel operations.

8. **No persistent memory** — Claude Code subagents can maintain memory across sessions (`memory: user|project|local`). GG Coder subagents are completely stateless.

9. **No auto-compaction** — Claude Code subagents auto-compact when their context fills up. GG Coder subagents just hit the 10-turn limit and stop.

10. **No thoroughness levels** — Claude Code's Explore agent accepts `quick`, `medium`, `very thorough` to control search depth. GG Coder's explore agent has no such parameter.

11. **No `Agent(type)` spawn restriction** — Claude Code lets the main agent restrict which subagents it can spawn (`tools: Agent(worker, researcher)`). GG Coder has no such mechanism.

12. **Agent frontmatter is minimal** — GG Coder's `parseAgentFile()` only reads `name`, `description`, `tools`, `model`. Claude Code supports 13 frontmatter fields: `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `isolation`.

---

## Priority Summary

### Must Fix Now (Blocking Issues)

| Issue | Feature | Impact |
|-------|---------|--------|
| Bash blocked in plan mode | Plan Mode | Agent can't `git log`, `git diff`, `ls` during planning — severely limits research |
| maxTurns hardcoded to 10 | Subagents | Complex worker tasks fail mid-execution |
| No Shift+Tab / `/plan` command | Plan Mode | Users can't manually enter plan mode |
| PlanModeManager may not be wired | Plan Mode | State machine exists but may not be connected to agent loop |
| No background subagent mode | Subagents | Can't do concurrent work — everything blocks |

### Should Fix Soon (Significant Gaps)

| Issue | Feature | Impact |
|-------|---------|--------|
| No `!` bash prefix or `@` file mentions | Commands | Missing high-frequency UX shortcuts |
| No `disallowedTools` for agents | Subagents | Can't express "all tools except X" |
| No `--agents` CLI flag | Subagents | Can't define session-only agents for automation |
| No skill preloading into subagents | Subagents | Subagents lack domain context |
| No interactive `/agents` manager | Commands | Users must manually create agent files |
| No bundled skills (`/simplify`, `/batch`) | Commands | Missing power-user workflows |
| Skills frontmatter missing key fields | Commands | No `disable-model-invocation`, `context: fork`, `allowed-tools` |

### Fix Later (Nice-to-Have for Parity)

| Issue | Feature | Impact |
|-------|---------|--------|
| No worktree isolation | Subagents | Parallel agents may conflict on files |
| No persistent memory | Subagents | Subagents don't learn across sessions |
| No auto-compaction for subagents | Subagents | Long-running subagents can't manage context |
| No thoroughness levels for explore | Subagents | No control over search depth |
| No `${CLAUDE_*}` substitutions | Commands | Less dynamic skill templates |
| No `Agent(type)` spawn restrictions | Subagents | Can't limit which agents are spawnable |
| No color coding per agent | Subagents | UI doesn't visually distinguish agents |
| No Plan subagent delegation | Plan Mode | Plan mode research fills main context |
