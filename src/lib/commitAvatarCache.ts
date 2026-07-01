import { fetchCommitAvatar } from "./azdoCommands";
import { createCachedImageFetcher } from "./workItemImageCache";

// Same LRU-by-organization+URL strategy as work item attachment images: the
// grid and preview both request the same author's avatar repeatedly as the
// user scrolls/selects, so this avoids re-fetching it over IPC each time.
export const fetchCommitAvatarCached = createCachedImageFetcher(fetchCommitAvatar);
