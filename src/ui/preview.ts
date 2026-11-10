// Store the Gameday Plus preview choice in the existing string-valued filter record so it syncs without a schema change.
export const uiPreviewKey = "uiPreview";

// Treat only an explicit "on" as enabled; missing or unknown values keep the current interface.
export const readUiPreview = (raw?: string): boolean => raw === "on";

// Write "on" for the preview and an empty string otherwise so turning it off leaves no stale value.
export const writeUiPreview = (enabled: boolean): string =>
  enabled ? "on" : "";
