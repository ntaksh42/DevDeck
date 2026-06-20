import { afterEach, describe, expect, it } from "vitest";
import { readStoredJson, storageKey, writeStoredJson } from "./storage";

const KEY = "test:storage";

afterEach(() => {
  window.localStorage.clear();
});

describe("readStoredJson", () => {
  it("returns the fallback when the key is absent", () => {
    expect(readStoredJson(KEY, (raw) => raw as number, 42)).toBe(42);
  });

  it("returns the fallback when the stored text is not valid JSON", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(readStoredJson(KEY, (raw) => raw as number, 42)).toBe(42);
  });

  it("returns the fallback when parse rejects the value", () => {
    window.localStorage.setItem(KEY, JSON.stringify("nope"));
    const result = readStoredJson(
      KEY,
      (raw) => (typeof raw === "number" ? raw : undefined),
      42,
    );
    expect(result).toBe(42);
  });

  it("returns the parsed value when valid", () => {
    window.localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));
    const result = readStoredJson(
      KEY,
      (raw) => (Array.isArray(raw) ? raw : undefined),
      [],
    );
    expect(result).toEqual([1, 2, 3]);
  });
});

describe("storageKey", () => {
  it("appends a uniform :vN suffix", () => {
    expect(storageKey("azdodeck:layout:wiSearchGridColumnWidths", 2)).toBe(
      "azdodeck:layout:wiSearchGridColumnWidths:v2",
    );
  });

  it("uses :v1 for the first version", () => {
    expect(storageKey("azdodeck:view:wiSearchGridSort", 1)).toBe(
      "azdodeck:view:wiSearchGridSort:v1",
    );
  });
});

describe("writeStoredJson", () => {
  it("serializes the value as JSON", () => {
    writeStoredJson(KEY, { a: 1 });
    expect(window.localStorage.getItem(KEY)).toBe('{"a":1}');
  });

  it("round-trips with readStoredJson", () => {
    writeStoredJson(KEY, { count: 7 });
    const result = readStoredJson(
      KEY,
      (raw) => raw as { count: number },
      { count: 0 },
    );
    expect(result).toEqual({ count: 7 });
  });
});
