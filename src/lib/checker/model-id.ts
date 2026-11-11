/** Maps vendor ids like `anthropic/claude-sonnet-4-6-20260115` onto reference ids like `claude-sonnet-4.6`. */
export function normalizeModelId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^.*\//, "")
    .replace(/:.*$/, "")
    .replace(/-(latest|\d{8}|\d{4}-\d{2}-\d{2})$/, "")
    .replace(/(\d)-(\d)(?!\d{2,})/g, "$1.$2");
}
