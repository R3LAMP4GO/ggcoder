import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPlanModeManager, checkPlanModeBlock } from "./plan-mode.js";
import fs from "node:fs/promises";

// Mock logger + fs
vi.mock("./logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("createPlanModeManager", () => {
  let manager: ReturnType<typeof createPlanModeManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createPlanModeManager("/tmp/test");
  });

  it("starts in idle state", () => {
    expect(manager.state).toBe("idle");
    expect(manager.planContent).toBeNull();
    expect(manager.planFilePath).toBeNull();
  });

  it("enter() transitions from idle to planning", () => {
    manager.enter("test reason");
    expect(manager.state).toBe("planning");
  });

  it("enter() is a no-op from non-idle state", () => {
    manager.enter();
    expect(manager.state).toBe("planning");
    manager.enter("again");
    expect(manager.state).toBe("planning"); // still planning, not re-entered
  });

  it("exitWithPlan() transitions to reviewing and writes plan", async () => {
    manager.enter();
    await manager.exitWithPlan("# My Plan\n\nDo stuff");
    expect(manager.state).toBe("reviewing");
    expect(manager.planContent).toBe("# My Plan\n\nDo stuff");
    expect(manager.planFilePath).toContain(".gg/plans/");
    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(".gg/plans"),
      { recursive: true },
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".gg/plans/"),
      "# My Plan\n\nDo stuff",
      "utf-8",
    );
  });

  it("approve() transitions reviewing → executing → idle", () => {
    manager.enter();
    // Can't approve from planning, need to be in reviewing
    // Manually force to reviewing via exitWithPlan
    void manager.exitWithPlan("plan content").then(() => {
      manager.approve();
      expect(manager.state).toBe("idle");
    });
  });

  it("reject() stores feedback and transitions to planning", async () => {
    manager.enter();
    await manager.exitWithPlan("draft plan");
    expect(manager.state).toBe("reviewing");

    manager.reject("needs more detail");
    expect(manager.state).toBe("planning");
    expect(manager.rejectionFeedback).toBe("needs more detail");
  });

  it("cancel() resets to idle from any state", () => {
    manager.enter();
    expect(manager.state).toBe("planning");
    manager.cancel();
    expect(manager.state).toBe("idle");
    expect(manager.planContent).toBeNull();
    expect(manager.planFilePath).toBeNull();
  });

  it("updatePlanContent() updates plan in reviewing state", async () => {
    manager.enter();
    await manager.exitWithPlan("original plan");
    expect(manager.state).toBe("reviewing");
    expect(manager.planContent).toBe("original plan");

    const listener = vi.fn();
    manager.onChange(listener);
    manager.updatePlanContent("edited plan");
    expect(manager.planContent).toBe("edited plan");
    // Should notify listeners so UI re-renders
    expect(listener).toHaveBeenCalled();
  });

  it("updatePlanContent() is a no-op outside reviewing state", () => {
    manager.enter();
    expect(manager.state).toBe("planning");
    manager.updatePlanContent("should not work");
    expect(manager.planContent).toBeNull();
  });

  it("onChange() notifies listeners on state change", () => {
    const listener = vi.fn();
    const unsub = manager.onChange(listener);

    manager.enter();
    expect(listener).toHaveBeenCalledWith("planning", manager);

    manager.cancel();
    expect(listener).toHaveBeenCalledWith("idle", manager);

    unsub();
    manager.enter();
    // After unsub, listener should NOT be called again
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("checkPlanModeBlock", () => {
  it("returns null when not in planning state", () => {
    expect(checkPlanModeBlock("write", {}, "idle")).toBeNull();
    expect(checkPlanModeBlock("edit", {}, "executing")).toBeNull();
  });

  it("blocks write tool in planning state", () => {
    const result = checkPlanModeBlock("write", { file_path: "/src/foo.ts" }, "planning");
    expect(result).toContain("read-only");
  });

  it("allows write to .gg/plans/ in planning state", () => {
    const result = checkPlanModeBlock("write", { file_path: "/project/.gg/plans/plan.md" }, "planning");
    expect(result).toBeNull();
  });

  it("blocks edit tool in planning state", () => {
    const result = checkPlanModeBlock("edit", {}, "planning");
    expect(result).toContain("read-only");
  });

  it("blocks write bash commands in planning state", () => {
    expect(checkPlanModeBlock("bash", { command: "mkdir -p /tmp/foo" }, "planning")).toContain("read-only");
    expect(checkPlanModeBlock("bash", { command: "rm -rf /tmp" }, "planning")).toContain("read-only");
    expect(checkPlanModeBlock("bash", { command: "git add ." }, "planning")).toContain("read-only");
    expect(checkPlanModeBlock("bash", { command: "npm install express" }, "planning")).toContain("read-only");
  });

  it("allows read-only bash commands in planning state", () => {
    expect(checkPlanModeBlock("bash", { command: "ls -la" }, "planning")).toBeNull();
    expect(checkPlanModeBlock("bash", { command: "cat foo.ts" }, "planning")).toBeNull();
    expect(checkPlanModeBlock("bash", { command: "git status" }, "planning")).toBeNull();
    expect(checkPlanModeBlock("bash", { command: "git log --oneline -10" }, "planning")).toBeNull();
    expect(checkPlanModeBlock("bash", { command: "git diff HEAD~1" }, "planning")).toBeNull();
    expect(checkPlanModeBlock("bash", { command: "grep -rn 'foo' src/" }, "planning")).toBeNull();
    expect(checkPlanModeBlock("bash", { command: "head -20 package.json" }, "planning")).toBeNull();
    expect(checkPlanModeBlock("bash", { command: "wc -l src/*.ts" }, "planning")).toBeNull();
  });

  it("allows read/grep/find/ls tools in planning state", () => {
    expect(checkPlanModeBlock("read", {}, "planning")).toBeNull();
    expect(checkPlanModeBlock("grep", {}, "planning")).toBeNull();
    expect(checkPlanModeBlock("find", {}, "planning")).toBeNull();
    expect(checkPlanModeBlock("ls", {}, "planning")).toBeNull();
  });
});
