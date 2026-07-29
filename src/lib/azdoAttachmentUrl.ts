/**
 * Shared detection for Azure DevOps attachment image URLs.
 *
 * Attachment images embedded in work item descriptions, work item comments, PR
 * descriptions, and PR threads all require the organization's PAT/bearer token.
 * A plain <img> fetch from the webview omits that auth, so the image 401s and
 * the browser falls back to rendering the alt text ("Image"). Both preview
 * renderers — the work item iframe in `features/work-items/workItemHtml.ts` and
 * the markdown view in `lib/markdown.tsx` — must therefore recognize the same
 * set of URLs and hydrate them through the backend. Keeping the predicate here
 * stops the two paths from drifting apart, which is exactly what left work item
 * previews rendering PR attachments as bare alt text.
 *
 * The accepted shapes deliberately mirror `is_allowed_attachment_path()` in
 * `crates/azdo-client/src/client/helpers.rs`, which is the real security
 * boundary. Matching anything broader here only produces IPC calls the backend
 * rejects, surfacing an error where the image simply cannot be fetched.
 */

// The work item rich-text editor's shared attachment store.
const WIT_ATTACHMENT_PATH = "/_apis/wit/attachments/";

// Images pasted into a PR description or thread comment:
// /_apis/git/repositories/{repoId}/pullRequests/{prId}/attachments/{fileName}
const PR_REPOSITORIES_PREFIX = "/_apis/git/repositories/";

function isPullRequestAttachmentPath(path: string): boolean {
  const rest = path.split(PR_REPOSITORIES_PREFIX)[1];
  if (rest === undefined) return false;
  const [repoId, pullRequests, prId, attachments, fileName] = rest.split("/");
  return (
    !!repoId &&
    pullRequests === "pullrequests" &&
    !!prId &&
    attachments === "attachments" &&
    !!fileName
  );
}

/**
 * True when `pathname` points at an authenticated Azure DevOps attachment
 * endpoint the backend is willing to fetch.
 */
export function isAzdoAttachmentPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path.includes(WIT_ATTACHMENT_PATH) || isPullRequestAttachmentPath(path);
}

/**
 * True when `src` is already an absolute http(s) attachment URL. Unlike
 * `toAzdoAttachmentUrl` this never falls back to the page location, so it is
 * safe for inspecting raw service HTML where a relative src carries no meaning.
 */
export function isAbsoluteAzdoAttachmentUrl(src: string): boolean {
  try {
    const url = new URL(src);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return isAzdoAttachmentPath(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Points `image` at a hydrated data URL.
 *
 * `srcset` takes precedence over `src` when the browser picks a candidate, so
 * swapping only `src` leaves the authenticated URL in play: it 401s and the
 * image falls back to rendering its alt text. Azure DevOps emits `srcset` for
 * high-DPI pasted screenshots, which is why the image only failed sometimes.
 * Dropping the responsive attributes leaves the data URL as the only candidate.
 */
export function applyHydratedImageSource(image: HTMLImageElement, dataUrl: string) {
  image.removeAttribute("srcset");
  image.removeAttribute("sizes");
  image.src = dataUrl;
}

/**
 * Resolves `src` against `baseUrl` and returns the absolute URL when it is an
 * authenticated Azure DevOps attachment that needs backend hydration, or null
 * when the image can be fetched directly (data:/blob:, non-http schemes,
 * ordinary README or avatar images).
 */
export function toAzdoAttachmentUrl(
  src: string,
  baseUrl: string | null | undefined,
): string | null {
  try {
    const url = new URL(src, baseUrl || window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!isAzdoAttachmentPath(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}
