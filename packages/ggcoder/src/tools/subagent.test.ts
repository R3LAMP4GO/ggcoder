import { describe, it, expect } from "vitest";
import { createSubAgentTool } from "./subagent.js";
import type { AgentDefinition } from "../core/agents.js";
import type { Skill } from "../core/skills.js";

// We can't easily test the spawn behavior, but we CAN test:
// 1. The tool description includes all agent types
// 2. Sub-sub-agent prevention
// 3. Unknown agent handling

describe("createSubAgentTool", () => {
  const agents: AgentDefinition[] = [
    {
      name: "explore",
      description: "Fast search",
      tools: ["read", "grep"],
      disallowedTools: ["write"],
      maxTurns: 10,
      systemPrompt: "You are an explorer.",
      source: "global",
    },
    {
      name: "custom-agent",
      description: "My custom agent",
      tools: ["read"],
      skills: ["api-conventions"],
      maxTurns: 5,
      systemPrompt: "You are custom.",
      source: "project",
    },
  ];

  const skills: Skill[] = [
    {
      name: "api-conventions",
      description: "API design patterns",
      content: "When writing APIs, use RESTful conventions.",
      source: "project",
    },
    {
      name: "unused-skill",
      description: "Not referenced",
      content: "This should not be included.",
      source: "global",
    },
  ];

  it("creates a tool named 'subagent'", () => {
    const tool = createSubAgentTool("/tmp", agents, "anthropic", "claude-opus-4-6", skills);
    expect(tool.name).toBe("subagent");
  });

  it("tool description mentions all built-in agent types", () => {
    const tool = createSubAgentTool("/tmp", agents, "anthropic", "claude-opus-4-6", skills);
    expect(tool.description).toContain("explore");
    expect(tool.description).toContain("plan");
    expect(tool.description).toContain("worker");
    expect(tool.description).toContain("fork");
  });

  it("tool description mentions thoroughness levels for explore", () => {
    const tool = createSubAgentTool("/tmp", agents, "anthropic", "claude-opus-4-6", skills);
    expect(tool.description).toContain("quick");
    expect(tool.description).toContain("medium");
    expect(tool.description).toContain("very thorough");
  });

  it("tool description lists custom agents", () => {
    const tool = createSubAgentTool("/tmp", agents, "anthropic", "claude-opus-4-6", skills);
    expect(tool.description).toContain("custom-agent");
  });

  describe("sub-sub-agent prevention", () => {
    it("returns error tool when GG_IS_SUBAGENT=1", () => {
      const original = process.env.GG_IS_SUBAGENT;
      process.env.GG_IS_SUBAGENT = "1";
      try {
        const tool = createSubAgentTool("/tmp", agents, "anthropic", "claude-opus-4-6", skills);
        expect(tool.description).toContain("cannot spawn");
      } finally {
        if (original === undefined) {
          delete process.env.GG_IS_SUBAGENT;
        } else {
          process.env.GG_IS_SUBAGENT = original;
        }
      }
    });
  });
});
