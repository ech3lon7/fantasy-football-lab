import { expect, it } from "vitest";
import { errorMessage, toError } from "../src/domain/error";

it("extracts clean messages from structured errors and never produces [object Object]", () => {
  // Supabase PostgrestError plain object
  const postgrestError = {
    message: "TOO_MANY_ROWS",
    details: "table ModelHistory exceeds row limit",
    hint: "",
    code: "P0001",
  };
  expect(errorMessage(postgrestError)).toBe("TOO_MANY_ROWS");
  expect(errorMessage(postgrestError)).not.toContain("[object Object]");

  // Fetch failure plain object
  const fetchError = {
    message: "TypeError: fetch failed",
    details: "getaddrinfo ENOTFOUND",
  };
  expect(errorMessage(fetchError)).toBe("TypeError: fetch failed");

  // Standard Error instance
  expect(errorMessage(new Error("Standard error message"))).toBe("Standard error message");

  // Raw string
  expect(errorMessage("Direct error text")).toBe("Direct error text");

  // Auth description object
  expect(errorMessage({ error_description: "Invalid token" })).toBe("Invalid token");

  // Empty or unknown object falls back cleanly without [object Object]
  expect(errorMessage({})).not.toContain("[object Object]");
  expect(errorMessage(null)).not.toContain("[object Object]");
  expect(errorMessage(undefined)).not.toContain("[object Object]");
});

it("converts raw objects to Error instances with message preserved", () => {
  const raw = {
    message: "TOO_MANY_ROWS",
    code: "P0001",
    details: "table ModelHistory exceeds row limit",
  };
  const converted = toError(raw);
  expect(converted).toBeInstanceOf(Error);
  expect(converted.message).toBe("TOO_MANY_ROWS");
  expect((converted as any).code).toBe("P0001");
  expect(String(converted)).not.toBe("[object Object]");

  const alreadyError = new Error("Already an error");
  expect(toError(alreadyError)).toBe(alreadyError);
});
