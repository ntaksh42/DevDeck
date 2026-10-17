import { beforeEach, describe, expect, it } from "vitest";
import { loadUiScale, resetUiScale, setUiScale, stepUiScale } from "./uiScale";

describe("uiScale", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.zoom = "";
  });

  it("defaults to 100% and ignores unknown stored values", () => {
    expect(loadUiScale()).toBe(100);
    window.localStorage.setItem("azdodeck:uiScale", "73");
    expect(loadUiScale()).toBe(100);
  });

  it("persists the scale and applies it as root zoom", () => {
    setUiScale(125);
    expect(loadUiScale()).toBe(125);
    expect(document.documentElement.style.zoom).toBe("125%");
  });

  it("steps through levels and clamps at both ends", () => {
    stepUiScale(1);
    expect(loadUiScale()).toBe(110);
    setUiScale(150);
    stepUiScale(1);
    expect(loadUiScale()).toBe(150);
    setUiScale(90);
    stepUiScale(-1);
    expect(loadUiScale()).toBe(90);
  });

  it("resets to 100% and clears the root zoom", () => {
    setUiScale(150);
    resetUiScale();
    expect(loadUiScale()).toBe(100);
    expect(document.documentElement.style.zoom).toBe("");
  });
});
