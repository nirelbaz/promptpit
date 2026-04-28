import { Box, Text } from "ink";
import { ListPicker } from "../primitives.js";
import { safe } from "../../shared/text.js";
import type { DryRunEntry } from "../../adapters/types.js";

/** Error card shared by every wizard. Headline names the failed action; the
 *  rest is constant. Optional Retry — drop it if the operation isn't
 *  retriable (e.g., destructive flows after the bundle is gone). */
export function WizardErrorBody({
  headline,
  message,
  onRetry,
  onBack,
}: {
  headline: string;
  message: string;
  onRetry?: () => void;
  onBack: () => void;
}) {
  const options = onRetry
    ? [{ value: "retry", label: "Retry" }, { value: "back", label: "Back" }]
    : [{ value: "back", label: "Back" }];
  return (
    <>
      <Box paddingX={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor="red">
        <Box><Text color="red">✖ </Text><Text bold>{headline}</Text></Box>
        <Text dimColor>{safe(message)}</Text>
      </Box>
      <ListPicker
        options={options}
        onSelect={(v) => (v === "retry" && onRetry ? onRetry() : onBack())}
        onCancel={onBack}
      />
    </>
  );
}

/** Color for a dry-run action label — green/yellow/red/gray by action type. */
export function actionColor(action: DryRunEntry["action"]): string {
  if (action === "remove") return "red";
  if (action === "modify") return "yellow";
  if (action === "skip") return "gray";
  return "green";
}
