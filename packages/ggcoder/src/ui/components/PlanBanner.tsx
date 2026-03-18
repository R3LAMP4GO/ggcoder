import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";

interface PlanBannerProps {
  status?: "researching" | "drafting" | "awaiting_approval";
}

export function PlanBanner({ status = "researching" }: PlanBannerProps) {
  const theme = useTheme();

  const statusText =
    status === "awaiting_approval"
      ? "Awaiting approval..."
      : status === "drafting"
        ? "Drafting plan..."
        : "Researching...";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.planPrimary}>{"╔═══════════════════════════════════════╗"}</Text>
      <Text color={theme.planPrimary}>{"║ ▀█▀ █ █ █▀▀   █▀█ █   █▀█ █▄ █      ║"}</Text>
      <Text color={theme.planPrimary}>{"║  █  █▀█ ██▄   █▀▀ █▄▄ █▀█ █ ▀█      ║"}</Text>
      <Text color={theme.planPrimary}>{"╠═══════════════════════════════════════╣"}</Text>
      <Text color={theme.planPrimary}>
        {"║  "}
        <Text color={theme.planPrimary}>{"Read-only mode · "}</Text>
        <Text color={theme.planPrimary} bold>
          {statusText}
        </Text>
        {"  ║"}
      </Text>
      <Text color={theme.planPrimary}>{"╚═══════════════════════════════════════╝"}</Text>
    </Box>
  );
}
