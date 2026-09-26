import type { MermaidConfig } from "mermaid";
import { useEffect, useMemo, useRef } from "react";
import { createSanitizer } from "../safeHtml";

const sanitizeGithubHtml = createSanitizer("https://github.com");

const MERMAID_THEME = {
  darkMode: true,
  background: "#000000",
  primaryColor: "#0e0e0e",
  primaryTextColor: "#ffffff",
  primaryBorderColor: "#3a3a3a",
  lineColor: "#8c8c8c",
  secondaryColor: "#141414",
  tertiaryColor: "#0a0a0a",
  fontFamily: '"Martian Mono", ui-monospace, monospace',
  fontSize: "11px",
};

type Mermaid = { initialize: (config: MermaidConfig) => void; render: (id: string, text: string) => Promise<{ svg: string }> };

const isMermaid = (m: unknown): m is Mermaid =>
  typeof m === "object" && m !== null && "initialize" in m && typeof m.initialize === "function" && "render" in m && typeof m.render === "function";

let mermaidLoad: Promise<Mermaid> | undefined;

function loadMermaid() {
  const url = new URL("/vendor/mermaid/mermaid.esm.min.mjs", window.location.origin).href;
  mermaidLoad ??= import(url).then((mod: { default?: unknown }) => {
    const mermaid = mod.default;
    if (!isMermaid(mermaid)) throw new Error("mermaid did not load");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: MERMAID_THEME,
      flowchart: { useMaxWidth: false },
      sequence: { useMaxWidth: false },
      class: { useMaxWidth: false },
      state: { useMaxWidth: false },
      er: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "theme", "themeVariables", "themeCSS", "darkMode", "fontFamily"],
    });
    return mermaid;
  });
  return mermaidLoad;
}

let mermaidSeq = 0;

async function renderMermaidBlocks(root: HTMLElement, isStale: () => boolean) {
  const blocks = [...root.querySelectorAll<HTMLPreElement>('pre[lang="mermaid"]')];
  if (blocks.length === 0) return;
  const mermaid = await loadMermaid().catch(() => {
    mermaidLoad = undefined;
    return null;
  });
  for (const pre of blocks) {
    if (isStale()) return;
    const host = pre.closest("section") ?? pre;
    const figure = document.createElement("div");
    figure.className = "gh-mermaid";
    const svg = mermaid
      ? await mermaid.render(`gh-mermaid-${++mermaidSeq}`, pre.textContent ?? "").then(
          r => r.svg,
          () => null,
        )
      : null;
    if (svg) figure.innerHTML = svg;
    else figure.append(pre);
    if (isStale()) return;
    host.replaceWith(figure);
  }
}

export function GithubHtml({ html }: { html: string }) {
  const clean = useMemo(() => sanitizeGithubHtml(html), [html]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let stale = false;
    void renderMermaidBlocks(root, () => stale);
    return () => {
      stale = true;
    };
  }, [clean]);
  return <div ref={ref} className="gh-body" dangerouslySetInnerHTML={{ __html: clean }} />;
}
