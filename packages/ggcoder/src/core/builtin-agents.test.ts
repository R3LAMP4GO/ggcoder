import { describe, it, expect } from "vitest";
import {
  BUILTIN_AGENTS,
  getExploreModel,
  applyCommonSuffix,
  SUBAGENT_SUFFIX,
  STANDALONE_SUFFIX,
} from "./builtin-agents.js";

describe("BUILTIN_AGENTS", () => {
  it("has 4 built-in agents", () => {
    expect(BUILTIN_AGENTS).toHaveLength(4);
  });

  it("includes explore, plan, worker, fork", () => {
    const names = BUILTIN_AGENTS.map((a) => a.name);
    expect(names).toContain("explore");
    expect(names).toContain("plan");
    expect(names).toContain("worker");
    expect(names).toContain("fork");
  });

  describe("explore agent", () => {
    const explore = BUILTIN_AGENTS.find((a) => a.name === "explore")!;

    it("has read-only tools", () => {
      expect(explore.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
    });

    it("disallows write, edit, subagent", () => {
      expect(explore.disallowedTools).toContain("write");
      expect(explore.disallowedTools).toContain("edit");
      expect(explore.disallowedTools).toContain("subagent");
    });

    it("has maxTurns of 10", () => {
      expect(explore.maxTurns).toBe(10);
    });

    it("system prompt contains READ-ONLY prohibition", () => {
      expect(explore.systemPrompt).toContain("READ-ONLY");
      expect(explore.systemPrompt).toContain("STRICTLY PROHIBITED");
    });

    it("system prompt mentions thoroughness levels", () => {
      expect(explore.description).toContain("quick");
      expect(explore.description).toContain("medium");
      expect(explore.description).toContain("very thorough");
    });

    it("system prompt lists banned bash commands", () => {
      expect(explore.systemPrompt).toContain("mkdir");
      expect(explore.systemPrompt).toContain("npm install");
      expect(explore.systemPrompt).toContain("pip install");
      expect(explore.systemPrompt).toContain("git commit");
    });

    it("system prompt mentions parallel tool calls", () => {
      expect(explore.systemPrompt).toContain("parallel tool calls");
    });

    it("system prompt mentions absolute paths", () => {
      expect(explore.systemPrompt).toContain("absolute paths");
    });
  });

  describe("plan agent", () => {
    const plan = BUILTIN_AGENTS.find((a) => a.name === "plan")!;

    it("has read-only tools", () => {
      expect(plan.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
    });

    it("has permissionMode plan", () => {
      expect(plan.permissionMode).toBe("plan");
    });

    it("system prompt contains Critical Files output section", () => {
      expect(plan.systemPrompt).toContain("Critical Files for Implementation");
    });

    it("system prompt contains READ-ONLY prohibition", () => {
      expect(plan.systemPrompt).toContain("READ-ONLY");
    });
  });

  describe("worker agent", () => {
    const worker = BUILTIN_AGENTS.find((a) => a.name === "worker")!;

    it("inherits all tools (empty tools list)", () => {
      expect(worker.tools).toEqual([]);
    });

    it("has maxTurns of 30", () => {
      expect(worker.maxTurns).toBe(30);
    });
  });

  describe("fork agent", () => {
    const fork = BUILTIN_AGENTS.find((a) => a.name === "fork")!;

    it("inherits all tools", () => {
      expect(fork.tools).toEqual([]);
    });

    it("has maxTurns of 200", () => {
      expect(fork.maxTurns).toBe(200);
    });

    it("system prompt enforces structured output", () => {
      expect(fork.systemPrompt).toContain("Scope:");
      expect(fork.systemPrompt).toContain("Result:");
      expect(fork.systemPrompt).toContain("Key files:");
      expect(fork.systemPrompt).toContain("Files changed:");
      expect(fork.systemPrompt).toContain("Issues:");
    });

    it("system prompt forbids sub-agent spawning", () => {
      expect(fork.systemPrompt).toContain("Do NOT spawn sub-agents");
    });

    it("system prompt requires commit before reporting", () => {
      expect(fork.systemPrompt).toContain("commit your changes before reporting");
    });

    it("system prompt limits report to 500 words", () => {
      expect(fork.systemPrompt).toContain("500 words");
    });
  });
});

describe("getExploreModel", () => {
  it("returns haiku for anthropic", () => {
    expect(getExploreModel("anthropic", "claude-opus-4-6")).toBe("claude-haiku-4-5");
  });

  it("returns o4-mini for openai", () => {
    expect(getExploreModel("openai", "gpt-5")).toBe("o4-mini");
  });

  it("returns parent model for unknown provider", () => {
    expect(getExploreModel("unknown", "some-model")).toBe("some-model");
  });
});

describe("applyCommonSuffix", () => {
  it("appends subagent suffix when isSubagent=true", () => {
    const result = applyCommonSuffix("Base prompt.", true);
    expect(result).toContain("Base prompt.");
    expect(result).toContain("concise report");
    expect(result).toContain("avoid using emojis");
    expect(result).not.toContain("detailed writeup");
  });

  it("appends standalone suffix when isSubagent=false", () => {
    const result = applyCommonSuffix("Base prompt.", false);
    expect(result).toContain("Base prompt.");
    expect(result).toContain("detailed writeup");
    expect(result).toContain("avoid using emojis");
    expect(result).not.toContain("concise report");
  });

  it("subagent suffix requires absolute paths", () => {
    expect(SUBAGENT_SUFFIX).toContain("absolute, never relative");
  });

  it("standalone suffix requires absolute paths", () => {
    expect(STANDALONE_SUFFIX).toContain("MUST be absolute");
  });
});
