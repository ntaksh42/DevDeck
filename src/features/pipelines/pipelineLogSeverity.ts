export type LogSeverity = "error" | "warning" | null;

// Matches "error:", "Error: ...", "error CS1002:" and "npm ERR!" but not prose
// such as "0 errors", "no error" or "error handling".
const ERROR_LINE = /\b(?:error|fatal)(?:\s+[A-Za-z]{1,6}\d+)?:|\bERR!/i;
const WARNING_LINE = /\bwarning(?:\s+[A-Za-z]{1,6}\d+)?:/i;

// Classifies an Azure Pipelines log line by its severity markers so the UI can
// highlight failures and optionally filter to just them. The explicit
// ##[error] / ##[warning] commands win; a bare word only counts when it is
// followed by a colon, so summary lines like "0 errors" stay unhighlighted.
export function logLineSeverity(line: string): LogSeverity {
  if (/##\[error\]/i.test(line)) return "error";
  if (/##\[warning\]/i.test(line)) return "warning";
  if (ERROR_LINE.test(line)) return "error";
  if (WARNING_LINE.test(line)) return "warning";
  return null;
}
