import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { searchPullRequestMentions } from "@/lib/azdoCommands";
import { PrSearchPersonPicker } from "./PrSearchPersonPicker";
import type { PrSearchPerson } from "./prSearchHistoryHelpers";

vi.mock("@/lib/azdoCommands", async (original) => ({ ...(await original<typeof import("@/lib/azdoCommands")>()), searchPullRequestMentions: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("does not confirm a previous term's person while the new term is waiting to debounce", async () => {
  vi.mocked(searchPullRequestMentions).mockImplementation(async ({ query }) => query === "alex" ? [{ id: "alex", displayName: "Alex Chen", uniqueName: "alex@contoso.com" }] : []);
  const chosen = vi.fn();
  function Picker() {
    const [person, setPerson] = useState<PrSearchPerson | null>(null);
    return <PrSearchPersonPicker label="Author" organizationId="org-a" value={person} onChange={(next) => { chosen(next); setPerson(next); }} onUnresolvedChange={() => {}} />;
  }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Picker /></QueryClientProvider>);
  const input = screen.getByRole("combobox", { name: "Author" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "alex" } });
  await screen.findByRole("option", { name: /Alex Chen/ });
  fireEvent.change(input, { target: { value: "yuki" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(chosen.mock.calls.some(([person]) => person?.id === "alex")).toBe(false);
  await waitFor(() => expect(searchPullRequestMentions).toHaveBeenLastCalledWith({ organizationId: "org-a", query: "yuki" }));
});

it("keeps edited text when clearing a previously selected person", async () => {
  function Picker() {
    const [person, setPerson] = useState<PrSearchPerson | null>({ id: "alex", displayName: "Alex Chen" });
    return <PrSearchPersonPicker label="Author" organizationId="org-a" value={person} onChange={setPerson} onUnresolvedChange={() => {}} />;
  }
  render(<QueryClientProvider client={new QueryClient()}><Picker /></QueryClientProvider>);
  const input = screen.getByRole("combobox", { name: "Author" }) as HTMLInputElement;
  await act(async () => fireEvent.change(input, { target: { value: "Yuki" } }));
  expect(input.value).toBe("Yuki");
});
