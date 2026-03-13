---
name: speedrun
description: Full auto feature pipeline — plan → build → validate → ship. Give it a GitHub issue, walk away, come back to merged code.
argument-hint: "[issue number]"
---

# Speedrun

Automates the full feature lifecycle: plan → build → validate → ship. Zero intervention.

## Prerequisites

- `scripts/run-feature.sh` and `scripts/run-plan.sh` exist (run `/setup-speedrun` first if not)
- Feature issue on GitHub (title + body describing what to build)
- `gh` CLI authenticated

## Instructions

1. **Check scripts exist**: If `scripts/run-feature.sh` or `scripts/run-plan.sh` don't exist, tell user to run `/setup-speedrun` first and stop.

2. **Extract feature issue #** from user input or CLAUDE.md Phase line (`#(\d+)` at end). If not found, ask user.

3. **Fetch issue**: `gh issue view #N --json title,body` — extract title and body.

4. **Output**:
   ```
   Feature: [title] (#N)

   # Single issue:
   speedrun N

   # All auto-labeled issues:
   speedrun

   # Range of issues:
   speedrun 210-257

   # Resume from build:
   ./scripts/run-feature.sh --issue N --start-phase build

   # Skip validation:
   ./scripts/run-feature.sh --issue N --skip-validate

   Monitor: tail -f .gg/logs/feature-N/plan.log
   ```

## Important

- Do NOT execute the script — just output the commands
- Script runs ggcoder instances needing a real terminal
- Plan phase uses ~50 turns (research-heavy via grep MCP + WebSearch)
- Build phase delegates to run-plan.sh (50 turns/chunk, 20 fix)
- Validate phase uses ~40 turns
- Ship phase is pure bash (no ggcoder, $0 cost)
- All GH operations are non-fatal
- Logs per feature at `.gg/logs/feature-N/`
