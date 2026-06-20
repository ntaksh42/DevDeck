import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  commandErrorCode,
  commandErrorMessage,
  isUnauthorizedError,
} from "./azdoCommands";

describe("commandErrorMessage", () => {
  it("returns string errors verbatim", () => {
    expect(commandErrorMessage("boom")).toBe("boom");
  });

  it("reads the message from AppError-shaped objects", () => {
    expect(commandErrorMessage({ message: "not authorized" })).toBe(
      "not authorized",
    );
  });

  it("converts ZodError into a human-readable message", () => {
    let zodError: unknown;
    try {
      z.object({ id: z.number() }).parse({ id: "nope" });
    } catch (error) {
      zodError = error;
    }

    expect(zodError).toBeInstanceOf(z.ZodError);
    const message = commandErrorMessage(zodError);
    expect(message).toBe(
      "Received an unexpected response format from the server.",
    );
    expect(message).not.toContain("[");
  });

  it("falls back for unknown error shapes", () => {
    expect(commandErrorMessage(42)).toBe("Unexpected error");
  });
});

describe("commandErrorCode / isUnauthorizedError", () => {
  it("reads the machine-readable code from CommandError-shaped objects", () => {
    expect(commandErrorCode({ message: "auth failed", code: "unauthorized" })).toBe(
      "unauthorized",
    );
    expect(isUnauthorizedError({ message: "auth failed", code: "unauthorized" })).toBe(
      true,
    );
  });

  it("returns null and false when no code is present", () => {
    expect(commandErrorCode({ message: "boom" })).toBeNull();
    expect(isUnauthorizedError({ message: "boom" })).toBe(false);
    expect(commandErrorCode("boom")).toBeNull();
    expect(isUnauthorizedError(42)).toBe(false);
  });

  it("does not treat other codes as unauthorized", () => {
    expect(isUnauthorizedError({ message: "x", code: "rate_limited" })).toBe(false);
  });
});
