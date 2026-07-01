import { useQuery } from "@tanstack/react-query";
import { fetchCommitAvatarCached } from "@/lib/commitAvatarCache";

const FALLBACK_PALETTE = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-pink-500",
];

function initialsFor(name: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

// Deterministic so the same author gets the same fallback color in both the
// grid and the preview panel.
function fallbackColorFor(name: string | null): string {
  const key = name?.trim() || "?";
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

/**
 * Author/committer avatar with an initials fallback. Avatar `imageUrl`s
 * require the same auth as the rest of the API, so they are fetched (and
 * cached) through `fetch_commit_avatar` rather than used directly as an
 * `<img src>`; the fallback also covers a missing URL or a failed fetch.
 */
export function CommitAvatar({
  organizationId,
  imageUrl,
  name,
  size = "sm",
}: {
  organizationId: string;
  imageUrl: string | null;
  name: string | null;
  size?: "sm" | "md";
}) {
  const dimension = size === "sm" ? "h-4 w-4" : "h-7 w-7";
  const avatarQuery = useQuery({
    queryKey: ["commitAvatar", organizationId, imageUrl],
    queryFn: () => fetchCommitAvatarCached({ organizationId, url: imageUrl as string }),
    enabled: Boolean(imageUrl),
    staleTime: Infinity,
    retry: false,
  });

  if (avatarQuery.data) {
    return (
      <img
        src={avatarQuery.data}
        alt=""
        className={`${dimension} shrink-0 rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      className={`${dimension} flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${fallbackColorFor(name)} ${
        size === "sm" ? "text-[8px]" : "text-[11px]"
      }`}
      title={name ?? undefined}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </span>
  );
}
