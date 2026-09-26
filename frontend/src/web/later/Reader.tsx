import { useEffect, useRef, useState } from "react";
import type { LaterItem } from "@/shared/later";
import { useSettings } from "../settings";
import { useReader } from "./api";
import { useSurface } from "./ReadingTools";
import { READER_MAX_WIDTH, useLaterUi, type ReaderFace, type ReaderWidth } from "./store";

const FACE: Record<ReaderFace, string> = {
  serif: '"Source Serif 4", Georgia, serif',
  sans: "Inter, system-ui, sans-serif",
  mono: '"Martian Mono", ui-monospace, monospace',
};

function applyPrefs(root: HTMLElement, p: { fontSize: number; face: ReaderFace; width: ReaderWidth }) {
  root.style.setProperty("--size", `${p.fontSize}px`);
  root.style.setProperty("--face", FACE[p.face]);
  root.style.setProperty("--width", READER_MAX_WIDTH[p.width]);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function header(item: LaterItem): string {
  const meta = [item.site, item.author].filter((s): s is string => Boolean(s)).map(escapeHtml).join(" · ");
  const tldr = item.tldr.length ? `<aside class="tldr"><div class="tag"><span>mirAI tl;dr</span><span class="mock">mock</span></div><ul>${item.tldr.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul></aside>` : "";
  return `<header><div class="meta">${meta}</div><h1>${escapeHtml(item.title)}</h1>${tldr}</header>`;
}

function readerDoc(html: string, item: LaterItem): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${escapeHtml(item.url)}" target="_blank"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Inter:wght@400;600&family=Martian+Mono:wght@400&display=swap"><style>
:root{color-scheme:dark;--size:17px;--face:serif;--width:640px}
html,body{margin:0;background:#000;color:#d9d9d9}
*{scrollbar-width:none}::-webkit-scrollbar{display:none}
body{font-family:var(--face);font-size:var(--size);line-height:1.65;padding:28px 24px 30vh}
main{max-width:var(--width);margin:0 auto}
h1,h2,h3,h4{color:#fff;line-height:1.25;font-weight:600}
a{color:#7fa7ff}
img,video,figure,iframe{max-width:100%;height:auto}
pre,code{font-family:"Martian Mono",ui-monospace,monospace;font-size:.78em;background:#0e0e0e}
pre{padding:12px 16px;overflow-x:auto;border:1px solid #1e1e1e}
blockquote{margin:0;padding-left:16px;border-left:2px solid #3a3a3a;color:#bdbdbd}
table{border-collapse:collapse;font-size:.85em}td,th{border:1px solid #1e1e1e;padding:4px 8px}
hr{border:0;border-top:1px solid #1e1e1e}
header h1{font-size:1.75em;margin:.3em 0 .6em}
.meta,.tag{font-family:"Martian Mono",ui-monospace,monospace;font-size:10px;color:#8c8c8c}
.tldr{border-left:2px solid #fff;background:#0a0a0a;padding:12px 16px;margin:0 0 2em}
.tag{display:flex;justify-content:space-between;color:#fff}.mock{color:#3a3a3a}
.tldr ul{margin:.5em 0 0;padding:0;list-style:none;font-size:.85em;color:#fff;line-height:1.45}.tldr li{margin:.25em 0}
mark[data-mark=hl]{background:rgb(244 182 63/.22);color:inherit;border-bottom:1px solid #f4b63f;cursor:pointer}mark[data-mark=hl][data-note]{border-bottom-style:dashed}
mark[data-mark=cite]{background:none;color:#fff;outline:1px solid #7fa7ff;outline-offset:3px}
mark[data-mark=find]{background:none;color:inherit;box-shadow:inset 0 -2px #7fa7ff}mark[data-mark=find][data-current]{background:#7fa7ff;color:#000;box-shadow:none}
</style></head><body><main>${header(item)}${html}</main></body></html>`;
}

export function Reader({ item, onProgress }: { item: LaterItem; onProgress: (progress: number, position: number) => void }) {
  const { data } = useReader(item.id, item.embed.type === "article");
  const { saveEveryMs } = useSettings().later;
  const { fontSize, face, width } = useLaterUi();
  const frame = useRef<HTMLIFrameElement>(null);
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  useSurface(surface, surface ? frame.current : null);
  const report = useRef(onProgress);
  report.current = onProgress;
  const startAt = useRef(item.progress >= 1 ? 0 : item.position);
  const html = data?.kind === "ready" ? readerDoc(data.html, item) : null;

  useEffect(() => {
    const root = frame.current?.contentDocument?.documentElement;
    if (root) applyPrefs(root, { fontSize, face, width });
  });

  useEffect(() => {
    const el = frame.current;
    if (!el || !html) return;
    let last = -1;
    let win: Window | null = null;
    const ratio = (): number | null => {
      const d = win?.document.documentElement;
      const room = d ? d.scrollHeight - d.clientHeight : 0;
      return d && room > 0 ? d.scrollTop / room : null;
    };
    const save = () => {
      const r = ratio();
      if (r === null || Math.abs(r - last) < 0.01) return;
      last = r;
      report.current(r, r);
    };
    const onLoad = () => {
      win = el.contentWindow;
      const d = win?.document.documentElement;
      if (!d) return;
      applyPrefs(d, useLaterUi.getState());
      setSurface(win?.document.querySelector("main") ?? null);
      d.scrollTop = startAt.current * (d.scrollHeight - d.clientHeight);
      last = ratio() ?? last;
    };
    el.addEventListener("load", onLoad);
    const id = setInterval(save, saveEveryMs);
    return () => {
      el.removeEventListener("load", onLoad);
      clearInterval(id);
      save();
    };
  }, [html, saveEveryMs]);

  if (item.embed.type === "pdf") return <iframe title={item.title} src={`/api/later/${item.id}/pdf`} className="h-full w-full border-0 bg-sunk" />;
  if (!data) return <p className="m-0 p-5 text-dim">loading reader view</p>;
  if (data.kind === "unavailable" || !html) return <p className="m-0 p-5 text-dim">{data.kind === "unavailable" ? data.reason : "no reader view"}</p>;
  return <iframe ref={frame} title={`${item.title} (reader view)`} srcDoc={html} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="h-full w-full border-0 bg-bg" />;
}
