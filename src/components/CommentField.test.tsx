import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { uploadCommentImage } from "@/lib/commands/commentImages";
import { CommentField } from "./CommentField";

vi.mock("@/lib/commands/commentImages", () => ({ uploadCommentImage: vi.fn() }));

it("inserts an uploaded clipboard image at the selection and leaves text paste native", async () => {
  const target = { organizationId: "org", projectId: "project" };
  const url = "https://dev.azure.com/org/_apis/wit/attachments/image";
  vi.mocked(uploadCommentImage).mockResolvedValue(url);
  const onImagePaste = vi.fn();
  render(
    <CommentField
      defaultValue="before replace after"
      imageTarget={target}
      onImagePaste={onImagePaste}
      submitLabel="Comment"
      onSubmit={vi.fn()}
    />,
  );
  const field = screen.getByRole<HTMLTextAreaElement>("textbox");
  field.setSelectionRange(7, 14);
  expect(fireEvent.paste(field, { clipboardData: { files: [] } })).toBe(true);

  const file = new File(["image"], "screenshot.png", { type: "image/png" });
  expect(fireEvent.paste(field, { clipboardData: { files: [file] } })).toBe(false);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Comment" }).disabled).toBe(true);
  const inserted = `before \n![Pasted image](<${url}>)\n`;
  await waitFor(() => expect(onImagePaste).toHaveBeenCalledWith(inserted + " after", inserted.length));
  expect(uploadCommentImage).toHaveBeenCalledWith(target, file);
});
