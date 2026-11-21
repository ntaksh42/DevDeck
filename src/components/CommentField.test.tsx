import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { uploadCommentImage } from "@/lib/commands/commentImages";
import { CommentField } from "./CommentField";

vi.mock("@/lib/commands/commentImages", () => ({ uploadCommentImage: vi.fn() }));
afterEach(cleanup);

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

it("discards a delayed image when the empty comment field changes scope", async () => {
  let finishUpload!: (url: string) => void;
  const upload = new Promise<string>((resolve) => { finishUpload = resolve; });
  vi.mocked(uploadCommentImage).mockClear().mockReturnValueOnce(upload);
  const onImagePaste = vi.fn();
  const target = { organizationId: "org", projectId: "project" };
  const field = (item: number) => (
    <CommentField key={item} imageTarget={target} onImagePaste={onImagePaste} submitLabel="Comment" onSubmit={vi.fn()} />
  );
  const { rerender } = render(field(1));
  const files = ["first.png", "second.png"].map((name) => new File(["image"], name, { type: "image/png" }));
  fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files } });
  expect(screen.getByRole("status").textContent).toContain("Uploading image");

  rerender(field(2));
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => finishUpload("https://dev.azure.com/org/_apis/wit/attachments/image"));
  expect(onImagePaste).not.toHaveBeenCalled();
  expect(uploadCommentImage).toHaveBeenCalledTimes(1);
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("");
});
