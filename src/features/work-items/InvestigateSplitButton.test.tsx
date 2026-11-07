import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InvestigateSplitButton, type InvestigateAgentChoice } from "./InvestigateSplitButton";

const onRun = vi.fn();

function Harness({ initial = "" }: { initial?: InvestigateAgentChoice }) {
  const [agent, setAgent] = useState<InvestigateAgentChoice>(initial);
  return <InvestigateSplitButton agent={agent} onAgentChange={setAgent} onRun={onRun} pending={false} title="Investigate" />;
}

afterEach(() => {
  cleanup();
  onRun.mockReset();
});

const toggle = () => screen.getByRole("button", { name: "Choose the agent for the investigation" });

describe("InvestigateSplitButton", () => {
  it("runs with the main button and shows no agent name for the default", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Codex/)).toBeNull();
  });

  it("picks an agent from the menu with the keyboard and returns focus to the arrow", async () => {
    render(<Harness />);
    toggle().focus();
    fireEvent.keyDown(toggle(), { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "Agent" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: /Default agent/ })));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Codex" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Codex" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(toggle());
    expect(screen.getByRole("button", { name: /Investigate\s*\(Codex\)/ })).toBeTruthy();
  });

  it("closes with Escape and keeps the current choice", async () => {
    render(<Harness initial="claude" />);
    fireEvent.click(toggle());
    const menu = await screen.findByRole("menu", { name: "Agent" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "Claude" })));
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(toggle());
    expect(screen.getByRole("button", { name: /Investigate\s*\(Claude\)/ })).toBeTruthy();
  });
});
