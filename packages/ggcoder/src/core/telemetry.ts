/**
 * Structured telemetry tracking — mirrors Claude Code's event patterns.
 *
 * Uses the existing log() infrastructure for output. Events are logged
 * with structured data for querying and analysis.
 */

import { log } from "./logger.js";

// ── Plan mode events ──────────────────────────────────────

export interface PlanModeEvent {
  event: "plan_enter" | "plan_exit" | "plan_approve" | "plan_reject" | "plan_cancel";
  entryMethod: "tool" | "hotkey" | "command";
  planLengthChars?: number;
  outcome?: "approved" | "rejected" | "cancelled";
  interviewPhaseEnabled: boolean;
  questionCount?: number;
  interviewQuestionsAsked?: number;
  durationMs?: number;
}

export function trackPlanMode(data: PlanModeEvent): void {
  log("INFO", "telemetry:plan", data.event, data as unknown as Record<string, unknown>);
}

// ── Question/elicitation events ───────────────────────────

export interface QuestionEvent {
  event: "question_asked" | "question_answered" | "question_declined" | "question_cancelled";
  questionCount: number;
  source?: string;
  fieldTypes?: string[];
  outcome: "accept" | "decline" | "cancel";
  durationMs?: number;
}

export function trackQuestion(data: QuestionEvent): void {
  log("INFO", "telemetry:question", data.event, data as unknown as Record<string, unknown>);
}
