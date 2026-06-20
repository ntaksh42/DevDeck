import { describe, expect, it } from "vitest";
import { z } from "zod";
import { commandErrorMessage } from "./azdoCommands";

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
