import { fetchWorkItemImage } from "./azdoCommands";

type ImageRequest = { organizationId: string; url: string };
type ImageFetcher = (input: ImageRequest) => Promise<string>;

// Attachment data URLs can be megabytes each; cap how many stay resident.
const IMAGE_CACHE_LIMIT = 50;

/**
 * Wraps an attachment fetcher with an LRU cache keyed by organization + URL.
 * Preview iframes reload whenever their HTML changes (apply, new comment),
 * which would otherwise re-download every embedded image over IPC.
 */
export function createCachedImageFetcher(
  fetcher: ImageFetcher,
  limit = IMAGE_CACHE_LIMIT,
): ImageFetcher {
  const cache = new Map<string, Promise<string>>();
  return (input) => {
    const key = `${input.organizationId}:${input.url}`;
    const hit = cache.get(key);
    if (hit) {
      // Re-insert so frequently shown images stay at the recent end.
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const pending = fetcher(input).catch((error: unknown) => {
      // Failures (expired auth, deleted attachment) must stay retryable.
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
    if (cache.size > limit) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return pending;
  };
}

export const fetchWorkItemImageCached = createCachedImageFetcher(fetchWorkItemImage);
