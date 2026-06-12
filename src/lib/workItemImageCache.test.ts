import { describe, expect, it, vi } from "vitest";
import { createCachedImageFetcher } from "./workItemImageCache";

describe("createCachedImageFetcher", () => {
  it("fetches each unique image once", async () => {
    const fetcher = vi.fn(async ({ url }: { organizationId: string; url: string }) => `data:${url}`);
    const cached = createCachedImageFetcher(fetcher);

    await expect(cached({ organizationId: "org", url: "a" })).resolves.toBe("data:a");
    await expect(cached({ organizationId: "org", url: "a" })).resolves.toBe("data:a");
    await expect(cached({ organizationId: "org", url: "b" })).resolves.toBe("data:b");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keys the cache by organization", async () => {
    const fetcher = vi.fn(async () => "data");
    const cached = createCachedImageFetcher(fetcher);

    await cached({ organizationId: "org1", url: "a" });
    await cached({ organizationId: "org2", url: "a" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const fetcher = vi
      .fn<(input: { organizationId: string; url: string }) => Promise<string>>()
      .mockRejectedValueOnce(new Error("auth expired"))
      .mockResolvedValueOnce("data");
    const cached = createCachedImageFetcher(fetcher);

    await expect(cached({ organizationId: "org", url: "a" })).rejects.toThrow("auth expired");
    await expect(cached({ organizationId: "org", url: "a" })).resolves.toBe("data");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used entry beyond the limit", async () => {
    const fetcher = vi.fn(async ({ url }: { organizationId: string; url: string }) => url);
    const cached = createCachedImageFetcher(fetcher, 2);

    await cached({ organizationId: "org", url: "a" });
    await cached({ organizationId: "org", url: "b" });
    await cached({ organizationId: "org", url: "a" }); // refresh recency of "a"
    await cached({ organizationId: "org", url: "c" }); // evicts "b"
    await cached({ organizationId: "org", url: "a" }); // still cached
    await cached({ organizationId: "org", url: "b" }); // refetched
    expect(fetcher.mock.calls.map(([input]) => input.url)).toEqual(["a", "b", "c", "b"]);
  });
});
