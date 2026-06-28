import { useEffect, useMemo, useRef, useState } from "react";
import { buildRichHtmlDocument, hydrateAuthenticatedImages } from "./workItemHtml";

export function RichHtmlFrame({
  baseUrl,
  density = "compact",
  framed = true,
  html,
  lazy = false,
  minHeight = 40,
  onHeight,
  onImageOpen,
  resolveImageSource,
  title,
}: {
  baseUrl?: string | null;
  density?: "compact" | "comfortable";
  framed?: boolean;
  html: string;
  // Defer mounting the iframe until it scrolls near the viewport. Comment
  // threads can hold dozens of these sandboxed documents; mounting them all at
  // once is the preview's heaviest cost.
  lazy?: boolean;
  minHeight?: number;
  onHeight?: (height: number) => void;
  onImageOpen?: (src: string) => void;
  resolveImageSource?: (url: string) => Promise<string | null>;
  title: string;
}) {
  const [height, setHeight] = useState(minHeight);
  const [visible, setVisible] = useState(!lazy);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const srcDoc = useMemo(() => buildRichHtmlDocument(html, density), [density, html]);

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, []);

  // Mount once on first intersection and stay mounted — remounting would reload
  // the document and lose its measured height.
  useEffect(() => {
    if (visible) return;
    const el = placeholderRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) {
    return (
      <div
        ref={placeholderRef}
        aria-hidden="true"
        className={`block w-full bg-white ${framed ? "rounded border border-border" : ""}`}
        style={{ height: minHeight }}
      />
    );
  }

  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      scrolling="no"
      className={`block w-full bg-white ${framed ? "rounded border border-border" : ""}`}
      style={{ height }}
      onLoad={(event) => {
        const frame = event.currentTarget;
        const doc = frame.contentDocument;
        const body = doc?.body;
        if (!body) return;
        const syncHeight = () => {
          const next = Math.max(minHeight, Math.ceil(body.scrollHeight));
          setHeight(next);
          onHeight?.(next);
        };
        syncHeight();
        frame.contentWindow?.requestAnimationFrame(syncHeight);
        doc.querySelectorAll("img, video").forEach((media) => {
          media.addEventListener("load", syncHeight, { once: true });
          media.addEventListener("error", syncHeight, { once: true });
        });
        doc.querySelectorAll("img").forEach((image) => {
          image.addEventListener("click", () => {
            if (image.src) onImageOpen?.(image.src);
          });
        });
        hydrateAuthenticatedImages(doc, baseUrl, resolveImageSource, syncHeight);
        resizeObserverRef.current?.disconnect();
        const frameWindow = frame.contentWindow as
          | (Window & { ResizeObserver?: typeof ResizeObserver })
          | null;
        const ResizeObserverCtor = frameWindow?.ResizeObserver;
        if (ResizeObserverCtor) {
          const resizeObserver = new ResizeObserverCtor(syncHeight);
          resizeObserver.observe(body);
          resizeObserverRef.current = resizeObserver;
        }
      }}
    />
  );
}
