import { z } from "zod";
import { invokeCommand } from "./runtime";

export type CommentImageTarget = {
  organizationId: string;
  projectId: string;
  pr?: { repositoryId: string; pullRequestId: number };
};

const imageExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function uploadCommentImage(target: CommentImageTarget, file: File) {
  const extension = imageExtensions[file.type];
  if (!extension) throw new Error("Use a PNG, JPEG, GIF, or WebP image.");
  if (!file.size || file.size > 10 * 1024 * 1024) {
    throw new Error("Image must be between 1 byte and 10 MiB.");
  }

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read the clipboard image."));
    reader.readAsDataURL(file);
  });
  const name = `image-${crypto.randomUUID()}.${extension}`;
  const result = await invokeCommand("upload_comment_image", {
    input: { ...target, name, base64 },
  });
  return new URL(z.string().url().parse(result)).href;
}
