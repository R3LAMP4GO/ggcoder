#!/bin/bash
set -eo pipefail

# ── CUSTOMIZE THESE (speedrun fills them in) ─────────────────────────────────
PROJECT_DIR="${WORKTREE_PROJECT_DIR:-__PROJECT_DIR__}"
CHECK_CMD="__CHECK_CMD__"
TEST_CMD="${TEST_CMD:-pnpm run test}"

# Ensure node_modules/.bin + bun in PATH for non-interactive shells
export PATH="$PROJECT_DIR/node_modules/.bin:$HOME/.bun/bin:$PATH"
# Disable git pager so diff/log never blocks on (END)
export GIT_PAGER=cat
# Prevent npm/ggcoder interactive prompts
export CI=1

# ── Pin ggcoder version to prevent auto-update breaking --print/--max-turns ──
GGCODER_VERSION="4.2.17"
if [[ "$(ggcoder --version 2>/dev/null)" != "$GGCODER_VERSION" ]]; then
  echo "Pinning ggcoder to $GGCODER_VERSION (current: $(ggcoder --version 2>/dev/null || echo 'none'))..."
  npm install -g "@kenkaiiii/ggcoder@$GGCODER_VERSION" --silent 2>/dev/null || true
fi
# Block ggcoder's built-in auto-update by faking a recent check timestamp
# (ggcoder checks every 4hrs; we set lastCheckedAt far in the future)
mkdir -p "$HOME/.gg"
echo '{"lastCheckedAt":9999999999999,"lastSeenVersion":"'"$GGCODER_VERSION"'"}' > "$HOME/.gg/update-state.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Timing helper ─────────────────────────────────────────────────────────────
_timer_start() { _TIMER_START=$(date +%s); }
_timer_elapsed() {
  local elapsed=$(( $(date +%s) - _TIMER_START ))
  local mins=$((elapsed / 60)) secs=$((elapsed % 60))
  echo "${mins}m${secs}s"
}

# ── ggcoder wrapper with transient-error retry ───────────────────────────────
# Retries on: rate limits, API disconnects, connection errors, overload
run_ggcoder() {
  local log_file="$1"; shift
  local max_retries=5
  local delay=60
  local attempt=1

  while true; do
    ggcoder "$@" < /dev/null 2>&1 | tee "$log_file"
    local rc=${PIPESTATUS[0]}

    # Check for transient/retryable errors in log output
    if grep -qiE "rate.limit|Rate limited|overloaded|429|too many requests|terminated|Connection error|ECONNRESET|ETIMEDOUT|socket hang up|503|502|SIGTERM|AbortError|network|fetch failed" "$log_file" 2>/dev/null; then
      if [[ $attempt -ge $max_retries ]]; then
        echo -e "${RED}✗ Transient error after $max_retries retries — giving up${NC}"
        return 1
      fi
      echo -e "${YELLOW}⚠ Transient error (attempt $attempt/$max_retries) — waiting ${delay}s...${NC}"
      sleep "$delay"
      delay=$((delay * 2))
      [[ $delay -gt 600 ]] && delay=600  # cap at 10 minutes
      attempt=$((attempt + 1))
      continue
    fi

    return $rc
  done
}

# ── gh CLI wrapper with rate-limit retry ──────────────────────────────────────
gh_with_retry() {
  local max_retries=5
  local delay=60
  local attempt=1
  local rc=0
  local output=""
  local err_file
  err_file=$(mktemp)

  while [[ $attempt -le $max_retries ]]; do
    output=$(gh "$@" 2>"$err_file") && rc=0 || rc=$?

    if [[ $rc -ne 0 ]]; then
      local err_msg
      err_msg=$(cat "$err_file")
      if echo "$err_msg" | grep -qiE "rate limit|403|secondary rate limit|abuse detection|API rate limit"; then
        echo -e "${YELLOW}⚠ gh rate-limited (attempt $attempt/$max_retries) — waiting ${delay}s...${NC}" >&2
        sleep "$delay"
        delay=$((delay * 2))
        [[ $delay -gt 600 ]] && delay=600
        attempt=$((attempt + 1))
        continue
      fi
      # Not a rate limit — fail immediately
      cat "$err_file" >&2
      rm -f "$err_file"
      return $rc
    fi

    # Success
    echo "$output"
    rm -f "$err_file"
    return 0
  done

  echo -e "${RED}✗ gh rate-limited after $max_retries retries — giving up${NC}" >&2
  rm -f "$err_file"
  return 1
}

# Defaults
FEATURE_ISSUE=""
START_PHASE="plan"
SKIP_VALIDATE=false
PLAN_ISSUE=""
LABEL="auto"
RUN_ALL=false
SKIP_SHIP=false

# Per-user branch prefix (override via SHIPIT_USER env var)
_raw_user="${SHIPIT_USER:-$(git config user.name 2>/dev/null || echo user)}"
BRANCH_PREFIX="$(echo "$_raw_user" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')"
unset _raw_user

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --issue) FEATURE_ISSUE="$2"; shift 2 ;;
    --start-phase) START_PHASE="$2"; shift 2 ;;
    --skip-validate) SKIP_VALIDATE=true; shift ;;
    --plan-issue) PLAN_ISSUE="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --all) RUN_ALL=true; shift ;;
    --skip-ship) SKIP_SHIP=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --all mode: loop through all open issues with label
if [[ "$RUN_ALL" == "true" ]]; then
  echo -e "${BLUE}Fetching all open issues labeled '$LABEL'...${NC}"
  ISSUES=$(gh_with_retry issue list -l "$LABEL" --state open --json number -q '.[].number' | sort -n)
  ISSUE_COUNT=$(echo "$ISSUES" | wc -w | tr -d ' ')
  echo -e "${GREEN}✓${NC} Found $ISSUE_COUNT issues: $ISSUES"
  echo ""
  ISSUE_DELAY=${ISSUE_DELAY:-30}
  CONSECUTIVE_FAILS=0
  TOTAL_ISSUES=$ISSUE_COUNT
  SUCCEEDED_ISSUES=0
  FAILED_ISSUES=0
  SPEEDRUN_START=$(date +%s)
  for issue in $ISSUES; do
    echo -e "${BLUE}════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Starting issue #$issue ($ISSUE_COUNT remaining)${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════${NC}"
    if "$0" --issue "$issue" --label "$LABEL"; then
      echo -e "${GREEN}✓ Issue #$issue complete${NC}"
      CONSECUTIVE_FAILS=0
      SUCCEEDED_ISSUES=$((SUCCEEDED_ISSUES + 1))
    else
      echo -e "${RED}✗ Issue #$issue failed — continuing to next${NC}"
      CONSECUTIVE_FAILS=$((CONSECUTIVE_FAILS + 1))
      FAILED_ISSUES=$((FAILED_ISSUES + 1))
    fi
    ISSUE_COUNT=$((ISSUE_COUNT - 1))
    # Backoff between issues — exponential on consecutive failures, capped at 300s
    if [[ $ISSUE_COUNT -gt 0 ]]; then
      local_delay=$ISSUE_DELAY
      if [[ $CONSECUTIVE_FAILS -gt 0 ]]; then
        local_delay=$(( ISSUE_DELAY * (2 ** (CONSECUTIVE_FAILS - 1)) ))
        [[ $local_delay -gt 300 ]] && local_delay=300
        echo -e "${YELLOW}⚠ $CONSECUTIVE_FAILS consecutive failure(s) — backoff ${local_delay}s${NC}"
      fi
      sleep "$local_delay"
    fi
  done
  SPEEDRUN_ELAPSED=$(( $(date +%s) - SPEEDRUN_START ))
  SPEEDRUN_MINS=$((SPEEDRUN_ELAPSED / 60))
  echo -e "\n${GREEN}══════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  All issues processed!${NC}"
  echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  ✓ Succeeded: $SUCCEEDED_ISSUES / $TOTAL_ISSUES${NC}"
  [[ $FAILED_ISSUES -gt 0 ]] && echo -e "${RED}  ✗ Failed: $FAILED_ISSUES${NC}"
  echo -e "${CYAN}  ⏱ Total time: ${SPEEDRUN_MINS}m${NC}"
  exit 0
fi

[[ -z "$FEATURE_ISSUE" ]] && echo -e "${RED}✗ --issue N or --all required${NC}" && exit 1

# Validate --start-phase
VALID_PHASES="plan build validate ship"
if [[ ! " $VALID_PHASES " =~ " $START_PHASE " ]]; then
  echo -e "${RED}✗ Invalid --start-phase '$START_PHASE'. Must be: $VALID_PHASES${NC}" && exit 1
fi

# ── Setup ──────────────────────────────────────────────────────────────────────
PROJECT_NAME=$(basename "$PROJECT_DIR")
LOG_DIR="$PROJECT_DIR/.gg/logs/feature-$FEATURE_ISSUE"
mkdir -p "$LOG_DIR"

# Fetch feature issue
echo -e "${BLUE}Fetching feature issue #${FEATURE_ISSUE}...${NC}"
FEATURE_TITLE=$(gh_with_retry issue view "$FEATURE_ISSUE" --json title -q '.title') || { echo -e "${RED}✗ Cannot fetch issue #${FEATURE_ISSUE}${NC}"; exit 1; }
FEATURE_BODY=$(gh_with_retry issue view "$FEATURE_ISSUE" --json body -q '.body') || FEATURE_BODY=""

echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Feature Pipeline - $PROJECT_NAME${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓${NC} Feature: $FEATURE_TITLE (#$FEATURE_ISSUE)"
echo -e "${GREEN}✓${NC} Checks: $CHECK_CMD"
echo -e "${GREEN}✓${NC} Start: $START_PHASE"
[[ -n "$PLAN_ISSUE" ]] && echo -e "${GREEN}✓${NC} Plan: #$PLAN_ISSUE"
echo ""

# ── Escape string for sed replacement (handles &, \, |) ────────────────────────
sed_escape() {
  local val="$1"
  val="${val//\\/\\\\}"
  val="${val//&/\\&}"
  val="${val//|/\\|}"
  printf '%s' "$val"
}

# ── Validate plan issue is set (from --plan-issue or .plan_issue state) ────────
detect_plan_issue() {
  if [[ -n "$PLAN_ISSUE" ]]; then return; fi
  if [[ -f "$LOG_DIR/.plan_issue" ]]; then
    PLAN_ISSUE=$(cat "$LOG_DIR/.plan_issue")
    echo -e "${GREEN}✓${NC} Loaded plan issue #$PLAN_ISSUE from state"
  fi
}

# ── Phase ordering ─────────────────────────────────────────────────────────────
should_run() {
  local phase=$1
  local phases=(plan build validate ship)
  local start_idx=0 phase_idx=0
  for i in "${!phases[@]}"; do
    [[ "${phases[$i]}" == "$START_PHASE" ]] && start_idx=$i
    [[ "${phases[$i]}" == "$phase" ]] && phase_idx=$i
  done
  [[ "$phase_idx" -ge "$start_idx" ]]
}

# ── Ensure we're on the feature branch (recovery helper) ─────────────────────
ensure_feature_branch() {
  cd "$PROJECT_DIR"
  local current expected="$1"
  current=$(git branch --show-current)
  if [[ "$current" != "$expected" ]]; then
    echo -e "${YELLOW}  ⚠ Branch drifted to $current — restoring $expected${NC}"
    # Stash any uncommitted work, switch back, apply
    if ! git diff --quiet || ! git diff --cached --quiet; then
      git stash push -m "auto-recovery: drift from $current to $expected" 2>/dev/null || true
      git checkout "$expected" 2>/dev/null || true
      git stash pop 2>/dev/null || true
    else
      git checkout "$expected" 2>/dev/null || true
    fi
  fi
}

# ── PHASE 1: PLAN ─────────────────────────────────────────────────────────────
run_plan() {
  _timer_start

  # Claim issue — skip if assigned to someone else
  local _assignees _me
  _me=$(gh api user -q '.login' 2>/dev/null || true)
  _assignees=$(gh_with_retry issue view "$FEATURE_ISSUE" --json assignees -q '.assignees[].login' 2>/dev/null || true)
  if [[ -n "$_assignees" && "$_assignees" != *"$_me"* ]]; then
    echo -e "${YELLOW}⚠ Issue #$FEATURE_ISSUE assigned to $_assignees — skipping${NC}"
    exit 0
  fi
  if [[ -z "$_assignees" && -n "$_me" ]]; then
    gh_with_retry issue edit "$FEATURE_ISSUE" --add-assignee "@me" 2>/dev/null || true
    echo -e "${GREEN}✓${NC} Claimed issue #$FEATURE_ISSUE"
  fi

  detect_plan_issue
  if [[ -n "$PLAN_ISSUE" ]]; then
    echo -e "${GREEN}✓${NC} Plan issue #$PLAN_ISSUE exists — skipping plan phase"
    return 0
  fi

  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}▶ Phase 1: Plan${NC}  Log: $LOG_DIR/plan.log"

  local prompt
  prompt=$(cat << PROMPT
Working on $PROJECT_NAME at $PROJECT_DIR.
Feature: $FEATURE_TITLE (#$FEATURE_ISSUE) — $FEATURE_BODY

1. Read CLAUDE.md + codebase. Detect stack (framework, backend, DB, UI).

2. RESEARCH (mandatory — do NOT skip):
   Use mcp__grep__searchGitHub to find production code for each capability.
   Search for LITERAL CODE, not keywords:
     Good: "createTRPCRouter", "QueryClientProvider", "export async function GET"
     Bad: "trpc tutorial", "react query best practices"
   Use regex for multi-line: query="(?s)useEffect\\\\(.*cleanup", useRegexp=true
   Filter by language (e.g., language=["TypeScript"]).
   For each pattern found:
     - Use WebSearch to verify it is current for 2026 (not deprecated)
     - If good: save the COMPLETE working code block (not descriptions)
     - If a raw GitHub URL is available, fetch full file context
   Identify any new packages needed. Check package.json — install missing ones.

3. CORRECTNESS BY CONSTRUCTION — apply these patterns in all code:
   - Discriminated unions for state: type State = { status: 'loading' } | { status: 'success', data: T } | { status: 'error', error: Error }
   - Exhaustive switch with never default: default: { const _exhaustive: never = status; throw new Error(_exhaustive); }
   - Branded types for domain primitives (UserId, MoneyString, etc.) — never pass raw strings
   - Result<T,E> over throwing when callers need to handle errors
   - Zod validation at every boundary (API input, env vars, external data)
   - Readonly/const for data that should not mutate

4. Decompose into 2-4 logical chunks. Each chunk MUST have:
   - Files list
   - "What to build" description
   - "Code to adapt" with ACTUAL code snippets from research (copy-paste ready)
   - Dependencies on other chunks

5. Create GH issue with plan:
   - ## Progress checklist (- [ ] Chunk N: Name)
   - #### Chunk N: headers (regex: ^#{3,4} Chunk [0-9]+:)
   - Research findings + gotchas section

   CRITICAL: After creating the plan issue, write ONLY the issue number to this file:
   bash -c 'echo ISSUE_NUMBER > $LOG_DIR/.plan_issue'
   Just the bare number, no # prefix — e.g. echo 123 > path

6. Update CLAUDE.md status line: **Phase:** plan - Chunk 0/N - #ISSUE

IMPORTANT: Do NOT run git checkout, git switch, or change branches. Stay on the current branch.
Every pattern MUST be verified via grep MCP or WebSearch. No guessing from training data.
Do NOT ask questions. Do NOT stop.
PROMPT
)

  cd "$PROJECT_DIR"
  if run_ggcoder "$LOG_DIR/plan.log" --max-turns 80 \
            --print "$prompt"; then
    if grep -qE "max.turns|turn limit|Maximum number of turns" "$LOG_DIR/plan.log"; then
      echo -e "${RED}✗ Hit turn limit — output may be incomplete${NC}"; exit 1
    fi
    echo -e "${GREEN}✓ Plan phase done ($(_timer_elapsed))${NC}"
  else
    echo -e "${RED}✗ Plan phase failed — check $LOG_DIR/plan.log${NC}"; exit 1
  fi

  # Extract plan issue number — prefer file written by ggcoder, fall back to log scraping
  if [[ -f "$LOG_DIR/.plan_issue" ]]; then
    PLAN_ISSUE=$(cat "$LOG_DIR/.plan_issue" | tr -d '[:space:]#')
    echo -e "${GREEN}✓${NC} Plan issue from file: #$PLAN_ISSUE"
  fi
  if [[ -z "$PLAN_ISSUE" ]]; then
    PLAN_ISSUE=$(grep -oE '/issues/[0-9]+' "$LOG_DIR/plan.log" | grep -oE '[0-9]+' | tail -1 || true)
  fi
  if [[ -z "$PLAN_ISSUE" ]]; then
    PLAN_ISSUE=$(grep -oE '(Created|created|Plan|plan).*#[0-9]+' "$LOG_DIR/plan.log" | grep -oE '#[0-9]+' | tail -1 | tr -d '#' || true)
  fi
  if [[ -z "$PLAN_ISSUE" ]]; then
    PLAN_ISSUE=$(grep -oE '#[0-9]+' "$LOG_DIR/plan.log" | grep -oE '[0-9]+' | sort -n | tail -1 || true)
  fi
  if [[ -z "$PLAN_ISSUE" ]]; then
    PLAN_ISSUE=$(grep '^\*\*Phase:\*\*' "$PROJECT_DIR/CLAUDE.md" 2>/dev/null | grep -oE '#[0-9]+' | tail -1 | tr -d '#' || true)
  fi
  [[ -z "$PLAN_ISSUE" ]] && echo -e "${RED}✗ Could not detect plan issue #${NC}" && exit 1
  echo "$PLAN_ISSUE" > "$LOG_DIR/.plan_issue"
  echo -e "${GREEN}✓${NC} Plan issue: #$PLAN_ISSUE"
}

# ── PHASE 2: BUILD ─────────────────────────────────────────────────────────────
run_build() {
  _timer_start
  detect_plan_issue
  [[ -z "$PLAN_ISSUE" ]] && echo -e "${RED}✗ No plan issue # — run plan phase first or pass --plan-issue N${NC}" && exit 1

  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}▶ Phase 2: Build${NC}  Plan: #$PLAN_ISSUE"

  # Clean up any changes from plan phase (ggcoder may have written CLAUDE.md, etc.)
  cd "$PROJECT_DIR"
  if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    echo -e "${CYAN}  Stashing plan phase changes...${NC}"
    git add -A
    git stash push -m "speedrun: plan phase changes for #$FEATURE_ISSUE" 2>>"$LOG_DIR/build.log" || true
  fi

  # Create branch from base (prefer dev if it exists)
  cd "$PROJECT_DIR"
  local branch="$BRANCH_PREFIX/feature-$FEATURE_ISSUE"
  local base_branch
  base_branch=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || echo "main")
  if git rev-parse --verify dev &>/dev/null; then
    base_branch="dev"
  fi
  if ! git rev-parse --verify "$branch" &>/dev/null; then
    git checkout "$base_branch" 2>>"$LOG_DIR/build.log" || { echo -e "${RED}✗ Cannot checkout $base_branch${NC}"; return 1; }
    git pull --ff-only 2>>"$LOG_DIR/build.log" || { echo -e "${RED}✗ Cannot pull $base_branch — see $LOG_DIR/build.log${NC}"; return 1; }
    git checkout -b "$branch" 2>>"$LOG_DIR/build.log" || { echo -e "${RED}✗ Cannot create branch $branch${NC}"; return 1; }
    echo -e "${GREEN}✓${NC} Branch: $branch (from $base_branch)"
  else
    git checkout "$branch" 2>>"$LOG_DIR/build.log" || { echo -e "${RED}✗ Cannot checkout $branch${NC}"; return 1; }
    echo -e "${GREEN}✓${NC} Switched to: $branch"
  fi

  # Generate run-plan.sh if missing
  local run_plan_script="$PROJECT_DIR/scripts/run-plan.sh"
  if [[ ! -f "$run_plan_script" ]]; then
    echo -e "${CYAN}  Generating run-plan.sh from template...${NC}"
    mkdir -p "$PROJECT_DIR/scripts"
    local p1="__PROJECT""_DIR__" p2="__CHECK""_CMD__" p3="__FEATURE""_NAME__" p4="__ISSUE""_NUM__"
    sed -e "s|$p1|$(sed_escape "$PROJECT_DIR")|g" \
        -e "s|$p2|$(sed_escape "$CHECK_CMD")|g" \
        -e "s|$p3|$(sed_escape "$FEATURE_TITLE")|g" \
        -e "s|$p4|$(sed_escape "$PLAN_ISSUE")|g" \
        ~/.gg/templates/run-plan.sh > "$run_plan_script"
    chmod +x "$run_plan_script"
    echo -e "${GREEN}✓${NC} Created $run_plan_script"
  fi

  # Run plan executor
  if "$run_plan_script" --issue "$PLAN_ISSUE" 2>&1 | tee "$LOG_DIR/build.log"; then
    echo -e "${GREEN}✓ Build phase done ($(_timer_elapsed))${NC}"
  else
    echo -e "${RED}✗ Build phase failed — check $LOG_DIR/build.log${NC}"; exit 1
  fi
}

# ── PHASE 3: VALIDATE (retry loop) ───────────────────────────────────────────
run_validate() {
  if [[ "$SKIP_VALIDATE" == "true" ]]; then
    echo -e "${YELLOW}⚠ Skipping validate phase${NC}"
    return 0
  fi

  _timer_start
  local max_attempts=3
  local attempt=1
  local prev_errors=""

  while [[ $attempt -le $max_attempts ]]; do
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}▶ Phase 3: Validate (attempt $attempt/$max_attempts)${NC}  Log: $LOG_DIR/validate.log"

    local context=""
    if [[ -n "$prev_errors" ]]; then
      context="
Previous validate attempt failed. Remaining errors to fix:
\`\`\`
$prev_errors
\`\`\`"
    fi

    # Save expected branch before ggcoder might switch
    local expected_branch
    expected_branch=$(git branch --show-current)

    local prompt
    prompt=$(cat << PROMPT
At $PROJECT_DIR. Feature: $FEATURE_TITLE. Plan: #$PLAN_ISSUE.$context
1. Run: $CHECK_CMD. Fix all errors.
2. Check for pre-commit hooks (.gg/hooks/, .husky/, .git/hooks/). Run what they run (mypy, eslint, etc). Fix all errors — ship phase will fail if hooks fail.
3. Run tests: look for test scripts in package.json / Makefile / pyproject.toml. Fix failures.
4. Read modified files (git diff --name-only). Verify feature works e2e.
5. Fix breaking issues: crashes, null refs, missing awaits, auth holes, API mismatches.
6. Trace capabilities through all layers. Fix wiring gaps (dropped config, stale wrappers, shape mismatches).
7. Stage and commit all changes: git add -A && git commit -m "validate: fix issues for $FEATURE_TITLE"
IMPORTANT: Do NOT run git checkout, git switch, or change branches. Stay on the current branch.
Skip perfectionism (style, naming, theoretical edge cases). Sequential mode.
Do NOT ask questions. Do NOT stop. Do NOT generate reports.
PROMPT
)

    cd "$PROJECT_DIR"
    run_ggcoder "$LOG_DIR/validate.log" --max-turns 40 \
              --print "$prompt" || true

    # Restore branch if ggcoder drifted
    ensure_feature_branch "$expected_branch"

    # Commit partial fixes before gate check
    cd "$PROJECT_DIR"
    if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
      git add -A
      git commit -m "validate: attempt $attempt for $FEATURE_TITLE" 2>/dev/null || true
      echo -e "${GREEN}  ✓ Partial fixes committed${NC}"
    fi

    # Quality gate
    echo -e "${CYAN}  Quality gate after validate attempt $attempt...${NC}"
    if eval "$CHECK_CMD" > "$LOG_DIR/validate-gate.log" 2>&1; then
      echo -e "${GREEN}✓ Validate phase done — attempt $attempt ($(_timer_elapsed))${NC}"
      return 0
    fi

    local error_count
    error_count=$(grep -cE "error|Error|ERROR" "$LOG_DIR/validate-gate.log" 2>/dev/null || echo "?")
    prev_errors="$error_count errors remaining:
$(cat "$LOG_DIR/validate-gate.log")"
    echo -e "${YELLOW}⚠ $error_count errors after attempt $attempt — retrying${NC}"
    attempt=$((attempt + 1))
  done

  echo -e "${RED}✗ Validate failed after $max_attempts attempts — check $LOG_DIR/validate-gate.log${NC}"
  return 1
}

# ── PHASE 4: SHIP (merge to dev) ──────────────────────────────────────────────
run_ship() {
  detect_plan_issue
  if [[ "$SKIP_SHIP" == "true" ]]; then
    echo -e "${GREEN}✓ Ship skipped (parallel mode)${NC}"
    return 0
  fi
  _timer_start
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}▶ Phase 4: Ship (merge to dev)${NC}"

  cd "$PROJECT_DIR"

  local feature_branch
  feature_branch=$(git branch --show-current)

  # Recovery: if we're on dev/main, try to find the feature branch
  if [[ "$feature_branch" == "dev" || "$feature_branch" == "main" ]]; then
    local expected_branch="$BRANCH_PREFIX/feature-$FEATURE_ISSUE"
    if git rev-parse --verify "$expected_branch" &>/dev/null; then
      echo -e "${YELLOW}  ⚠ Was on $feature_branch — recovering to $expected_branch${NC}"
      git checkout "$expected_branch" 2>/dev/null || { echo -e "${RED}✗ Cannot recover feature branch${NC}"; return 1; }
      feature_branch="$expected_branch"
    else
      echo -e "${RED}✗ On $feature_branch and feature branch $expected_branch doesn't exist${NC}"
      return 1
    fi
  fi

  # Auto-commit any leftover changes
  if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    echo -e "${CYAN}  Committing leftover changes...${NC}"
    git add -A
    if ! git commit -m "chore: pre-ship cleanup for $FEATURE_TITLE" 2>>"$LOG_DIR/ship.log"; then
      echo -e "${RED}✗ Auto-commit failed — check git status${NC}"
      git status
      return 1
    fi
  fi

  # Final quality gate
  echo -e "${CYAN}  Running checks...${NC}"
  if ! eval "$CHECK_CMD" > "$LOG_DIR/ship-checks.log" 2>&1; then
    echo -e "${RED}✗ Checks failed — check $LOG_DIR/ship-checks.log${NC}"
    return 1
  fi
  echo -e "${GREEN}  ✓ Checks passed${NC}"

  # Detect base branch (same logic as build phase)
  local base_branch
  base_branch=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || echo "main")
  # Prefer 'dev' if it exists, otherwise use detected default
  if git rev-parse --verify dev &>/dev/null; then
    base_branch="dev"
  fi
  echo -e "${GREEN}  ✓ Target branch: $base_branch${NC}"

  # Guard: feature branch must have commits ahead of base
  if [[ -z "$(git log "$base_branch".."$feature_branch" --oneline 2>/dev/null)" ]]; then
    echo -e "${RED}✗ No new commits on $feature_branch — nothing to ship${NC}"
    return 1
  fi

  local pre_merge_sha
  pre_merge_sha=$(git rev-parse "$base_branch" 2>/dev/null)

  echo -e "${CYAN}  Switching to $base_branch...${NC}"
  git checkout "$base_branch" 2>>"$LOG_DIR/ship.log" || { echo -e "${RED}✗ Cannot checkout $base_branch${NC}"; return 1; }
  if ! git pull --ff-only origin "$base_branch" 2>>"$LOG_DIR/ship.log"; then
    echo -e "${RED}✗ $base_branch diverged from origin — cannot fast-forward. See $LOG_DIR/ship.log${NC}"
    git checkout "$feature_branch" 2>/dev/null || true
    return 1
  fi
  pre_merge_sha=$(git rev-parse HEAD)
  echo -e "${GREEN}  ✓ $base_branch up to date${NC}"

  echo -e "${CYAN}  Merging $feature_branch into $base_branch...${NC}"
  if ! git merge --no-ff "$feature_branch" -m "Merge $feature_branch: $FEATURE_TITLE

Refs #$FEATURE_ISSUE. Plan: #$PLAN_ISSUE." 2>>"$LOG_DIR/ship.log"; then
    local _conflicts _non_trivial="" _auto_resolved=""
    _conflicts=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
    for _f in $_conflicts; do
      case "$_f" in
        # Accept ours (base) for lockfiles/metadata; theirs (feature) for source
        CLAUDE.md|pnpm-lock.yaml|package-lock.json|yarn.lock|bun.lockb)
          git checkout --ours "$_f" 2>/dev/null
          git add "$_f" 2>/dev/null
          _auto_resolved="$_auto_resolved $_f"
          ;;
        package.json|tsconfig.json|scripts/run-plan.sh)
          git checkout --theirs "$_f" 2>/dev/null
          git add "$_f" 2>/dev/null
          _auto_resolved="$_auto_resolved $_f"
          ;;
        *)
          _non_trivial="$_non_trivial $_f"
          ;;
      esac
    done
    if [[ -n "$_non_trivial" ]]; then
      echo -e "${RED}✗ Merge conflict in:$_non_trivial — aborting${NC}"
      git merge --abort 2>/dev/null || true
      git checkout "$feature_branch" 2>/dev/null || true
      return 1
    fi
    git commit --no-edit 2>>"$LOG_DIR/ship.log" || true
    echo -e "${YELLOW}  Auto-resolved conflicts in:$_auto_resolved${NC}"
  fi
  echo -e "${GREEN}  ✓ Merged${NC}"

  if ! git push origin "$base_branch" 2>>"$LOG_DIR/ship.log"; then
    echo -e "${RED}✗ Push $base_branch failed — rolling back local merge. See $LOG_DIR/ship.log${NC}"
    git reset --hard "$pre_merge_sha" 2>/dev/null || true
    git checkout "$feature_branch" 2>/dev/null || true
    return 1
  fi
  echo -e "${GREEN}  ✓ Pushed $base_branch${NC}"

  git branch -d "$feature_branch" 2>/dev/null || true
  git push origin --delete "$feature_branch" 2>/dev/null || true
  echo -e "${GREEN}  ✓ Deleted branch $feature_branch${NC}"

  # Close feature issue + plan issue
  gh issue close "$FEATURE_ISSUE" --comment "Merged to $base_branch via $(git rev-parse --short HEAD). Plan: #$PLAN_ISSUE" 2>/dev/null || true
  gh issue edit "$FEATURE_ISSUE" --add-label "done" 2>/dev/null || true
  echo -e "${GREEN}  ✓ Issue #$FEATURE_ISSUE closed with 'done' label${NC}"

  # Also close the plan issue (prevents orphaned plan issues)
  if [[ -n "$PLAN_ISSUE" ]]; then
    gh issue close "$PLAN_ISSUE" --comment "Feature #$FEATURE_ISSUE shipped." 2>/dev/null || true
    echo -e "${GREEN}  ✓ Plan issue #$PLAN_ISSUE closed${NC}"
  fi

  echo -e "${GREEN}  ⏱ Ship: $(_timer_elapsed)${NC}"
}

# ── Main ───────────────────────────────────────────────────────────────────────
FEATURE_START=$(date +%s)
echo -e "${BLUE}Starting from phase: $START_PHASE${NC}\n"

# Run phases sequentially — if any phase fails, abort cleanly (not via set -e)
if should_run "plan"; then
  run_plan || { echo -e "${RED}✗ Plan phase failed${NC}"; exit 1; }
fi
if should_run "build"; then
  run_build || { echo -e "${RED}✗ Build phase failed${NC}"; exit 1; }
fi
if should_run "validate"; then
  run_validate || { echo -e "${RED}✗ Validate phase failed${NC}"; exit 1; }
fi
if should_run "ship"; then
  run_ship || { echo -e "${RED}✗ Ship phase failed${NC}"; exit 1; }
fi

FEATURE_ELAPSED=$(( $(date +%s) - FEATURE_START ))
FEATURE_MINS=$((FEATURE_ELAPSED / 60))
echo -e "\n${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Feature #$FEATURE_ISSUE complete! (${FEATURE_MINS}m)${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
