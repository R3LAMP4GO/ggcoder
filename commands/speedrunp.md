---
name: speedrunp
description: Parallel speedrun — run multiple feature issues simultaneously via git worktrees (sliding window of 3)
argument-hint: "[issue numbers: 214 | 214-220 | 214,216,220]"
---

# Speedrun Parallel

Runs multiple feature issues simultaneously using git worktrees (sliding window of 3). Each issue gets an isolated copy of the repo — no file conflicts. Ship phase runs sequentially after all builds complete.

## Prerequisites

- `scripts/run-feature.sh`, `scripts/run-plan.sh`, and `scripts/run-speedrun-parallel.sh` exist (run `/setup-speedrun` first if not)
- Clean main checkout (no uncommitted changes)
- `gh` CLI authenticated

## Instructions

1. **Check scripts exist**: If any of the 3 scripts are missing, tell user to run `/setup-speedrun` first and stop.

2. **Output**:
   ```
   # All auto-labeled issues (sliding window of 3):
   speedrunp

   # Specific issues:
   speedrunp 210,211,212

   # Range:
   speedrunp 210-218

   # Single issue (runs in worktree, useful for isolation):
   speedrunp 210

   # Monitor status:
   speedrunp-check

   # Tail a specific issue's log:
   speedrunp-tail 214
   ```

## How it works

1. **Parses issues** — same 4 modes as `speedrun` (all/single/range/comma)
2. **Creates worktrees** — `git worktree add .gg/worktrees/feature-N` per issue
3. **Sliding window** — up to 3 concurrent ggcoder instances, each in its own worktree
4. **Build phase** — each instance runs `run-feature.sh --skip-ship` (plan → build → validate)
5. **Ship phase** — sequential from main checkout (one merge to dev at a time)
6. **Cleanup** — removes all worktrees + prunes

## Important

- Do NOT execute the script — just output the commands
- Issues must be independent (no cross-dependencies between issues)
- If one issue fails, others continue. Failed issues are logged, not shipped.
- Ship pulls latest dev + ff-only guard before each merge — safe against race conditions
- Worktree path: `.gg/worktrees/feature-N/` (gitignored)
