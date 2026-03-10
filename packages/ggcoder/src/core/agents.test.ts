import { describe, it, expect } from "vitest";
import { parseAgentFile } from "./agents.js";
import type { AgentDefinition } from "./agents.js";

describe("parseAgentFile", () => {
  it("parses basic frontmatter", () => {
    const raw = `---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls
model: claude-haiku-4-5
---

You are a scout.`;

    const agent = parseAgentFile(raw, "global");
    expect(agent.name).toBe("scout");
    expect(agent.description).toBe("Fast codebase recon");
    expect(agent.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(agent.model).toBe("claude-haiku-4-5");
    expect(agent.systemPrompt).toBe("You are a scout.");
    expect(agent.source).toBe("global");
  });

  it("parses disallowedTools with hyphenated key", () => {
    const raw = `---
name: reader
description: Read-only agent
disallowed-tools: write, edit
---

Read only.`;

    const agent = parseAgentFile(raw, "project");
    expect(agent.disallowedTools).toEqual(["write", "edit"]);
  });

  it("parses disallowedTools with camelCase key", () => {
    const raw = `---
name: reader
description: Read-only
disallowedTools: write, edit, subagent
---

Read only.`;

    const agent = parseAgentFile(raw, "project");
    expect(agent.disallowedTools).toEqual(["write", "edit", "subagent"]);
  });

  it("parses maxTurns with hyphenated and camelCase keys", () => {
    const raw1 = `---
name: a
description: d
max-turns: 25
---
prompt`;

    const raw2 = `---
name: b
description: d
maxTurns: 50
---
prompt`;

    expect(parseAgentFile(raw1, "global").maxTurns).toBe(25);
    expect(parseAgentFile(raw2, "global").maxTurns).toBe(50);
  });

  it("ignores invalid maxTurns", () => {
    const raw = `---
name: a
description: d
max-turns: -5
---
prompt`;

    expect(parseAgentFile(raw, "global").maxTurns).toBeUndefined();
  });

  it("parses background flag", () => {
    const raw = `---
name: bg
description: Background agent
background: true
---
prompt`;

    const agent = parseAgentFile(raw, "global");
    expect(agent.background).toBe(true);
  });

  it("parses skills list", () => {
    const raw = `---
name: api-dev
description: API developer
skills: api-conventions, error-handling
---
Implement API endpoints.`;

    const agent = parseAgentFile(raw, "project");
    expect(agent.skills).toEqual(["api-conventions", "error-handling"]);
  });

  it("parses permissionMode with camelCase key", () => {
    const raw = `---
name: planner
description: Plan agent
permissionMode: plan
---
Plan things.`;

    const agent = parseAgentFile(raw, "global");
    expect(agent.permissionMode).toBe("plan");
  });

  it("parses permissionMode with hyphenated key", () => {
    const raw = `---
name: auto
description: Auto agent
permission-mode: bypassPermissions
---
Auto things.`;

    const agent = parseAgentFile(raw, "global");
    expect(agent.permissionMode).toBe("bypassPermissions");
  });

  it("ignores invalid permissionMode values", () => {
    const raw = `---
name: x
description: d
permissionMode: invalidMode
---
prompt`;

    const agent = parseAgentFile(raw, "global");
    expect(agent.permissionMode).toBeUndefined();
  });

  it("accepts all valid permissionMode values", () => {
    const modes = ["default", "acceptEdits", "dontAsk", "bypassPermissions", "plan"] as const;
    for (const mode of modes) {
      const raw = `---
name: test-${mode}
description: d
permissionMode: ${mode}
---
prompt`;
      expect(parseAgentFile(raw, "global").permissionMode).toBe(mode);
    }
  });

  it("handles raw content without frontmatter", () => {
    const raw = "You are a simple agent with no config.";
    const agent = parseAgentFile(raw, "global");
    expect(agent.name).toBe("");
    expect(agent.description).toBe("");
    expect(agent.tools).toEqual([]);
    expect(agent.systemPrompt).toBe(raw);
  });

  it("handles all fields together", () => {
    const raw = `---
name: full-agent
description: Fully configured agent
tools: read, write, bash
disallowed-tools: subagent
model: claude-opus-4-6
max-turns: 100
background: true
skills: deploy, review
permission-mode: acceptEdits
---

You are a fully configured agent.`;

    const agent = parseAgentFile(raw, "project");
    expect(agent).toMatchObject({
      name: "full-agent",
      description: "Fully configured agent",
      tools: ["read", "write", "bash"],
      disallowedTools: ["subagent"],
      model: "claude-opus-4-6",
      maxTurns: 100,
      background: true,
      skills: ["deploy", "review"],
      permissionMode: "acceptEdits",
      source: "project",
    } satisfies Partial<AgentDefinition>);
    expect(agent.systemPrompt).toBe("You are a fully configured agent.");
  });
});
