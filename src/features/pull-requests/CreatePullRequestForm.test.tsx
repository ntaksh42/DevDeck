import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreatePullRequestForm } from "./CreatePullRequestForm";

afterEach(cleanup);

function renderForm(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={client}>
        <CreatePullRequestForm
          organizationId="contoso"
          projectId="platform"
          repositoryId="azdo-dashboard"
          onClose={onClose}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("CreatePullRequestForm", () => {
  it("rejects submission without a title or source branch", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(
      screen.getByText("Title, source branch, and target branch are required."),
    ).toBeTruthy();
  });

  it("rejects a source branch equal to the target branch", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Source branch"), { target: { value: "main" } });
    fireEvent.change(screen.getByLabelText("Pull request title"), {
      target: { value: "Test PR" },
    });
    // Target branch already defaults to "main".
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Source and target branches must differ.")).toBeTruthy();
  });

  it(
    "creates a pull request against the demo backend and reports success",
    async () => {
      renderForm();
      fireEvent.change(screen.getByLabelText("Source branch"), {
        target: { value: "feature/new-thing" },
      });
      fireEvent.change(screen.getByLabelText("Pull request title"), {
        target: { value: "Add new thing" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      expect(await screen.findByText(/Created PR #9100\./, {}, { timeout: 8000 })).toBeTruthy();
    },
    15000,
  );

  it("calls onClose when Close is clicked", () => {
    const { onClose } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
