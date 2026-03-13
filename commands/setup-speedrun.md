---
name: setup-speedrun
description: One-time project setup for speedrun & speedrunp — detects stack, creates scripts, prints shell functions
---

# Setup Speedrun

One-time setup per project. Detects your stack, creates pipeline scripts from templates, and prints shell functions. After this, `speedrun N` and `speedrunp N` just work.

## Instructions

1. **Detect project type** from config files in the project root:
   - `package.json` → Node.js
   - `Cargo.toml` → Rust
   - `pyproject.toml` → Python
   - `go.mod` → Go

2. **Detect package manager** (Node.js only):
   - `bun.lock` or `bun.lockb` → `bun`
   - `pnpm-lock.yaml` → `pnpm`
   - `yarn.lock` → `yarn`
   - Otherwise → `npm`

3. **Determine check command**:
   - Node.js with `check` script in package.json: `{pm} run check`
   - Node.js without `check`: `{pm} run lint && {pm} run typecheck` (use whichever scripts exist)
   - Rust: `cargo clippy && cargo fmt --check`
   - Python: `ruff check . && mypy .`
   - Go: `go vet ./... && gofmt -l .`

4. **Determine test command** (for TEST_CMD env var):
   - Node.js with `test` script: `{pm} run test`
   - Rust: `cargo test`
   - Python: `pytest`
   - Go: `go test ./...`

5. **Create `scripts/` directory** if it doesn't exist: `mkdir -p scripts`

6. **Create `scripts/run-feature.sh`**: Read `~/.gg/templates/run-feature.sh`, replace:
   - `__PROJECT_DIR__` → absolute path to project root
   - `__CHECK_CMD__` → detected check command
   Write to `scripts/run-feature.sh`, `chmod +x`.

7. **Do NOT create `scripts/run-plan.sh`** — it is generated automatically by `run-feature.sh` during the build phase with the correct feature name and plan issue number for each run.

8. **Create `scripts/run-speedrun-parallel.sh`**: Copy `~/.gg/templates/run-speedrun-parallel.sh` directly to `scripts/run-speedrun-parallel.sh`, `chmod +x`. This script derives PROJECT_DIR from its own location — no placeholders to replace.

9. **Add to `.gitignore`** if not already present:
   ```
   .gg/logs/
   .gg/worktrees/
   ```

10. **Output**:
   ```
   ✓ Project: [name] ([type]) | Checks: [cmd] | Tests: [cmd]
   ✓ Created scripts/run-feature.sh
   ✓ Created scripts/run-speedrun-parallel.sh
   ℹ scripts/run-plan.sh will be auto-generated per feature during build phase

   Usage:

   # Single issue (full auto: plan → build → validate → ship):
   speedrun 42

   # All open issues labeled 'auto':
   speedrun

   # Range / specific issues:
   speedrun 210-257
   speedrun 42,43,44

   # Parallel (up to 3 concurrent via worktrees):
   speedrunp 42,43,44

   # Monitor parallel:
   speedrunp-check
   speedrunp-tail 42

   # Resume from specific phase:
   ./scripts/run-feature.sh --issue 42 --start-phase build
   ./scripts/run-feature.sh --issue 42 --skip-validate

   # Logs:
   tail -f .gg/logs/feature-42/plan.log

   Shell functions (add to ~/.zshrc if not already there):

     speedrun() {
       if [[ -z "$1" ]]; then
         ./scripts/run-feature.sh --all
       elif [[ "$1" == *-* ]]; then
         local start="${1%-*}" end="${1#*-}"
         for issue in $(gh issue list -l auto --state open --json number -q '.[].number' | sort -n); do
           [[ "$issue" -ge "$start" && "$issue" -le "$end" ]] && ./scripts/run-feature.sh --issue "$issue"
         done
       elif [[ "$1" == *,* ]]; then
         IFS=',' read -ra issues <<< "$1"
         for issue in "${issues[@]}"; do ./scripts/run-feature.sh --issue "$issue"; done
       else
         ./scripts/run-feature.sh --issue "$1"
       fi
     }
     speedrunp()      { ./scripts/run-speedrun-parallel.sh "$@"; }
     speedrunp-check() { ... }  # see install.sh output for full function
     speedrunp-tail()  { tail -f ".gg/logs/feature-$1/parallel.log"; }
   ```

## Important

- Do NOT execute any pipeline scripts — just create them and output instructions
- Run this once per project. Re-run if check command changes.
- Scripts need a real terminal to spawn ggcoder instances
- Requires `gh` CLI authenticated and a GitHub repo with issues
