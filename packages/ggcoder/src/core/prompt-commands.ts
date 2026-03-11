/**
 * Prompt-template commands — slash commands that inject detailed prompts
 * into the agent loop. Each command maps to a full prompt the agent executes.
 */

export interface PromptCommand {
  name: string;
  aliases: string[];
  description: string;
  prompt: string;
}

export const PROMPT_COMMANDS: PromptCommand[] = [
  {
    name: "scan",
    aliases: [],
    description: "Find dead code, bugs, and security issues",
    prompt: `Find quick wins in this codebase. Spawn 5 sub-agents in parallel using the subagent tool (call the subagent tool 5 times in a single response, each with a different task), each focusing on one area. Adapt each area to what's relevant for THIS project's stack and architecture.

**Agent 1 - Performance**: Inefficient algorithms, unnecessary work, missing early returns, blocking operations, things that scale poorly

**Agent 2 - Dead Weight**: Unused code, unreachable paths, stale comments/TODOs, obsolete files, imports to nowhere

**Agent 3 - Lurking Bugs**: Unhandled edge cases, missing error handling, resource leaks, race conditions, silent failures

**Agent 4 - Security**: Hardcoded secrets, injection risks, exposed sensitive data, overly permissive access, unsafe defaults

**Agent 5 - Dependencies & Config**: Unused packages, vulnerable dependencies, misconfigured settings, dead environment variables, orphaned config files

## The Only Valid Findings

A finding is ONLY valid if it falls into one of these categories:

1. **Dead** - Code that literally does nothing. Unused, unreachable, no-op.
2. **Broken** - Will cause errors, crashes, or wrong behavior. Not "might" - WILL.
3. **Dangerous** - Security holes, data exposure, resource exhaustion.

That's it. Three categories. If it doesn't fit, don't report it.

**NOT valid findings:**
- "This works but could be cleaner" - NO
- "Modern best practice suggests..." - NO
- "This is verbose/repetitive but functional" - NO
- "You could use X instead of Y" - NO
- "This isn't how I'd write it" - NO

If the code works, isn't dangerous, and does something - leave it alone.

## Output Format

For each finding:
\`\`\`
[DEAD/BROKEN/DANGEROUS] file:line - What it is
Impact: What happens if left unfixed
\`\`\`

Finding nothing is a valid outcome. Most codebases don't have easy wins - that's fine.`,
  },
  {
    name: "verify",
    aliases: [],
    description: "Verify code against docs and best practices",
    prompt: `Verify this codebase against current best practices and official documentation. Spawn 8 sub-agents in parallel using the subagent tool (call the subagent tool 8 times in a single response, each with a different task), each focusing on one category. Each agent must VERIFY findings using real code samples or official docs - no assumptions allowed.

**Agent 1 - Core Framework**: Detect the main framework, verify usage patterns against official documentation

**Agent 2 - Dependencies/Libraries**: Check if library APIs being used are current or deprecated. Verify against library documentation

**Agent 3 - Language Patterns**: Identify the primary language, verify idioms and patterns are current

**Agent 4 - Configuration**: Examine build tools, bundlers, linters, and config files. Verify settings against current tool documentation

**Agent 5 - Security Patterns**: Review auth, data handling, secrets management. Verify against current security guidance and OWASP recommendations

**Agent 6 - Testing**: Identify test framework in use, verify testing patterns match current library recommendations

**Agent 7 - API/Data Handling**: Review data fetching, state management, storage patterns. Verify against current patterns and framework docs

**Agent 8 - Error Handling**: Examine error handling patterns, verify they match library documentation

## Agent Workflow

Each agent MUST follow this process:
1. **Identify** - What's relevant in THIS project for your category
2. **Find** - Locate specific implementations in the codebase
3. **Verify** - Check against real code or official docs
4. **Report** - Only report when verified current practice differs from codebase

## The Only Valid Findings

A finding is ONLY valid if:
1. **OUTDATED** - Works but uses old patterns with verified better alternatives
2. **DEPRECATED** - Uses APIs marked deprecated in current official docs
3. **INCORRECT** - Implementation contradicts official documentation

**NOT valid findings:**
- "I think there's a better way" without verification - NO
- "This looks old" without proof - NO
- Style preferences or subjective improvements - NO
- Anything not verified via real code or official docs - NO

## Output Format

For each finding:
\`\`\`
[OUTDATED/DEPRECATED/INCORRECT] file:line - What it is
Current: How it's implemented now
Verified: What the correct/current approach is
Source: URL to official docs or evidence
\`\`\`

No findings is a valid outcome. If implementations match current practices, that's good news.`,
  },
  {
    name: "init",
    aliases: [],
    description: "Generate or update CLAUDE.md for this project",
    prompt: `Generate or update a minimal CLAUDE.md with project structure, guidelines, and quality checks.

## Step 1: Check if CLAUDE.md Exists

If CLAUDE.md exists:
- Read the existing file
- Preserve custom sections the user may have added
- Update the structure, quality checks, and organization rules

If CLAUDE.md does NOT exist:
- Create a new one from scratch

## Step 2: Analyze Project (Use Sub-agents in Parallel)

Spawn 3 sub-agents in parallel using the subagent tool (call the subagent tool 3 times in a single response):

1. **Project Purpose Agent**: Analyze README, package.json description, main files to understand what the project does
2. **Directory Structure Agent**: Map out the folder structure and what each folder contains
3. **Tech Stack Agent**: Identify languages, frameworks, tools, dependencies

Wait for all sub-agents to complete, then synthesize the information.

## Step 3: Detect Project Type & Commands

Check for config files:
- package.json -> JavaScript/TypeScript (extract lint, typecheck, server scripts)
- pyproject.toml or requirements.txt -> Python
- go.mod -> Go
- Cargo.toml -> Rust

Extract linting commands, typechecking commands, and server start command (if applicable).

## Step 4: Generate Project Tree

Create a concise tree structure showing key directories and files with brief descriptions.

## Step 5: Generate or Update CLAUDE.md

Create CLAUDE.md with: project description, project structure tree, organization rules (one file per component, single responsibility), and zero-tolerance code quality checks with the exact commands for this project.

Keep total file under 100 lines. If updating, preserve any custom sections the user added.`,
  },
  {
    name: "setup-lint",
    aliases: [],
    description: "Generate a /fix command for linting and typechecking",
    prompt: `Detect the project type and generate a /fix command for linting and typechecking.

## Step 1: Detect Project Type

Check for config files:
- package.json -> JavaScript/TypeScript
- pyproject.toml or requirements.txt -> Python
- go.mod -> Go
- Cargo.toml -> Rust
- composer.json -> PHP

Read the relevant config file to understand the project structure.

## Step 2: Check Existing Tools

Based on the project type, check if linting/typechecking tools are already configured:

- **JS/TS**: eslint, prettier, typescript — check package.json scripts and config files
- **Python**: mypy, pylint, black, ruff — check dependencies and config files
- **Go**: go vet, gofmt, staticcheck
- **Rust**: clippy, rustfmt

## Step 3: Install Missing Tools (if needed)

Only install what's missing. Use the detected package manager.

## Step 4: Generate /fix Command

Create the directory \`.gg/commands/\` if it doesn't exist, then write \`.gg/commands/fix.md\`:

\`\`\`markdown
---
name: fix
description: Run typechecking and linting, then spawn parallel agents to fix all issues
---

Run all linting and typechecking tools, collect errors, group them by domain, and use the subagent tool to spawn parallel sub-agents to fix them.

## Step 1: Run Checks

[INSERT PROJECT-SPECIFIC COMMANDS — e.g. npm run lint, npm run typecheck, etc.]

## Step 2: Collect and Group Errors

Parse the output. Group errors by domain:
- **Type errors**: Issues from TypeScript, mypy, etc.
- **Lint errors**: Issues from eslint, pylint, ruff, clippy, etc.
- **Format errors**: Issues from prettier, black, rustfmt, gofmt

## Step 3: Spawn Parallel Agents

For each domain with issues, use the subagent tool to spawn a sub-agent to fix all errors in that domain.

## Step 4: Verify

After all agents complete, re-run all checks to verify all issues are resolved.
\`\`\`

Replace [INSERT PROJECT-SPECIFIC COMMANDS] with the actual commands for the detected project.

## Step 5: Confirm

Report what was detected, what was installed, and that /fix is now available.`,
  },
  {
    name: "setup-commit",
    aliases: [],
    description: "Generate a /commit command with quality checks",
    prompt: `Detect the project type and generate a /commit command that enforces quality checks before committing.

## Step 1: Detect Project and Extract Commands

Check for config files and extract the lint/typecheck commands:
- package.json -> Extract lint, typecheck scripts
- pyproject.toml -> Use mypy, pylint/ruff
- go.mod -> Use go vet, gofmt
- Cargo.toml -> Use cargo clippy, cargo fmt --check

## Step 2: Generate /commit Command

Create the directory \`.gg/commands/\` if it doesn't exist, then write \`.gg/commands/commit.md\`:

\`\`\`markdown
---
name: commit
description: Run checks, commit with AI message, and push
---

1. Run quality checks:
   [PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS]
   Fix ALL errors before continuing. Use auto-fix commands where available.

2. Review changes: run git status and git diff --staged and git diff

3. Stage relevant files with git add (specific files, not -A)

4. Generate a commit message:
   - Start with verb (Add/Update/Fix/Remove/Refactor)
   - Be specific and concise, one line preferred

5. Commit and push:
   git commit -m "your generated message"
   git push
\`\`\`

Replace [PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS] with the actual commands.

Keep the command file under 20 lines.

## Step 3: Confirm

Report that /commit is now available with quality checks and AI-generated commit messages.`,
  },
  {
    name: "setup-update",
    aliases: [],
    description: "Generate an /update command for dependency updates",
    prompt: `Detect the project type and generate an /update command for dependency updates and deprecation fixes.

## Step 1: Detect Project Type & Package Manager

Check for config files and lock files:
- package.json + package-lock.json -> npm
- package.json + yarn.lock -> yarn
- package.json + pnpm-lock.yaml -> pnpm
- pyproject.toml + poetry.lock -> poetry
- requirements.txt -> pip
- go.mod -> Go
- Cargo.toml -> Rust

## Step 2: Generate /update Command

Create the directory \`.gg/commands/\` if it doesn't exist, then write \`.gg/commands/update.md\`:

\`\`\`markdown
---
name: update
description: Update dependencies, fix deprecations and warnings
---

## Step 1: Check for Updates

[OUTDATED CHECK COMMAND for detected package manager]

## Step 2: Update Dependencies

[UPDATE COMMAND + SECURITY AUDIT]

## Step 3: Check for Deprecations & Warnings

Run a clean install and read ALL output carefully. Look for:
- Deprecation warnings
- Security vulnerabilities
- Peer dependency warnings
- Breaking changes

## Step 4: Fix Issues

For each warning/deprecation:
1. Research the recommended replacement or fix
2. Update code/dependencies accordingly
3. Re-run installation
4. Verify no warnings remain

## Step 5: Run Quality Checks

[PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS]

Fix all errors before completing.

## Step 6: Verify Clean Install

Delete dependency folders/caches, run a fresh install, verify ZERO warnings/errors.
\`\`\`

Replace all placeholders with the actual commands for the detected project type and package manager.

## Step 3: Confirm

Report that /update is now available with dependency updates, security audits, and deprecation fixes.`,
  },
];

/** Look up a prompt command by name or alias */
export function getPromptCommand(name: string): PromptCommand | undefined {
  return PROMPT_COMMANDS.find((cmd) => cmd.name === name || cmd.aliases.includes(name));
}
