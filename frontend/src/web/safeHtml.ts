import DOMPurify from "dompurify";

export function createSanitizer(base: string): (html: string) => string {
  const purifier = DOMPurify();
  purifier.addHook("afterSanitizeAttributes", node => {
    if (node instanceof HTMLAnchorElement) {
      const href = node.getAttribute("href");
      if (href?.startsWith("/")) node.setAttribute("href", `${base}${href}`);
      if (!node.getAttribute("href")?.startsWith("#")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (node instanceof HTMLImageElement) {
      node.setAttribute("loading", "lazy");
      node.setAttribute("referrerpolicy", "no-referrer");
    }
    if (node instanceof HTMLVideoElement) {
      node.setAttribute("controls", "");
      node.setAttribute("preload", "metadata");
      node.setAttribute("playsinline", "");
    }
    if (node instanceof HTMLInputElement) node.setAttribute("disabled", "");
  });
  return html =>
    purifier.sanitize(html, {
      ADD_TAGS: ["video", "source", "picture", "details", "summary"],
      ADD_ATTR: ["controls", "muted", "srcset", "media", "open", "target", "playsinline", "preload", "loading", "referrerpolicy"],
      FORBID_TAGS: ["svg", "style", "form", "button", "iframe", "object", "embed"],
      FORBID_ATTR: ["style", "class", "id"],
      ALLOW_DATA_ATTR: false,
    });
}
