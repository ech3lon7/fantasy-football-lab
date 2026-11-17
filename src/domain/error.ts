export function errorMessage(
  error: unknown,
  fallback = "An unexpected error occurred.",
): string {
  if (error instanceof Error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
    if (typeof record.error_description === "string" && record.error_description.trim()) {
      return record.error_description;
    }
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Circular or non-serializable objects fall through to fallback.
    }
  }
  return fallback;
}

export function toError(
  error: unknown,
  fallback = "An unexpected error occurred.",
): Error {
  if (error instanceof Error) return error;
  const msg = errorMessage(error, fallback);
  const err = new Error(msg);
  if (typeof error === "object" && error !== null) {
    Object.assign(err, error);
  }
  return err;
}
