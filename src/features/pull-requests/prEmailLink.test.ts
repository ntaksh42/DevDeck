import { describe, expect, it } from "vitest";
import { buildPullRequestEmailLink } from "./prEmailLink";

describe("buildPullRequestEmailLink", () => {
  it("builds a mailto link with the !id/title as subject and title+url as body", () => {
    expect(
      buildPullRequestEmailLink({
        pullRequestId: 42,
        title: "Fix login",
        webUrl: "https://dev.azure.com/contoso/Platform/_git/repo/pullrequest/42",
      }),
    ).toBe(
      "mailto:?subject=!42%20Fix%20login&body=Fix%20login%0Ahttps%3A%2F%2Fdev.azure.com%2Fcontoso%2FPlatform%2F_git%2Frepo%2Fpullrequest%2F42",
    );
  });

  it("falls back to the title alone in the body when there is no URL", () => {
    expect(
      buildPullRequestEmailLink({ pullRequestId: 1, title: "No link yet", webUrl: null }),
    ).toBe("mailto:?subject=!1%20No%20link%20yet&body=No%20link%20yet");
  });
});
