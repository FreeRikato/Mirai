import { EditorView } from "@codemirror/view";

export type EditorVariant = "prose" | "compact";

const FG = "var(--color-fg)";
const DIM = "var(--color-dim)";
const FAINT = "var(--color-faint)";
const RULE = "var(--color-rule)";
const RAISE = "var(--color-raise)";
const LINK = "var(--color-link)";
const WARN = "var(--color-warn)";
const OK = "var(--color-ok)";
const MONO = "var(--font-mono)";
const SERIF = '"Source Serif 4", Georgia, serif';

const TYPE: Record<EditorVariant, { font: string; size: string; lineHeight: string }> = {
  prose: { font: SERIF, size: "17px", lineHeight: "1.65" },
  compact: { font: MONO, size: "12px", lineHeight: "1.7" },
};

export function editorTheme(variant: EditorVariant) {
  const t = TYPE[variant];
  return EditorView.theme(
    {
      "&": { color: FG, backgroundColor: "transparent", fontSize: t.size },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { fontFamily: t.font, lineHeight: t.lineHeight, overflow: "visible" },
      ".cm-content": { padding: "0", caretColor: FG },
      ".cm-line": { padding: "0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: FG },
      ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--color-selection) 20%, transparent)" },
      ".cm-md-h1": { fontSize: "1.7em", fontWeight: "600", color: FG, lineHeight: "1.3" },
      ".cm-md-h2": { fontSize: "1.35em", fontWeight: "600", color: FG, lineHeight: "1.35" },
      ".cm-md-h3": { fontSize: "1.15em", fontWeight: "600", color: FG },
      ".cm-md-h4, .cm-md-h5, .cm-md-h6": { fontWeight: "600", color: FG },
      ".cm-md-strong": { fontWeight: "700", color: FG },
      ".cm-md-em": { fontStyle: "italic" },
      ".cm-md-strike": { textDecoration: "line-through", color: DIM },
      ".cm-md-code": { fontFamily: MONO, fontSize: "0.82em", color: WARN, backgroundColor: RAISE },
      ".cm-md-codeblock": { fontFamily: MONO, fontSize: "0.8em", backgroundColor: RAISE, color: FG },
      ".cm-md-fence-mark": { color: FAINT },
      ".cm-md-quote": { borderLeft: `2px solid ${RULE}`, paddingLeft: "12px !important", color: DIM },
      ".cm-md-link": { color: LINK, cursor: "pointer" },
      ".cm-md-wikilink": { color: FG, textDecoration: "underline", textDecorationColor: DIM, textUnderlineOffset: "3px", cursor: "pointer" },
      ".cm-md-wikilink-missing": { color: DIM, textDecorationStyle: "dashed" },
      ".cm-md-bracket": { color: FAINT },
      ".cm-md-bullet": { color: DIM, display: "inline-block", minWidth: "1ch" },
      ".cm-md-hr": { display: "inline-block", width: "100%", borderTop: `1px solid ${RULE}`, verticalAlign: "middle" },
      ".cm-md-task-closed": { color: DIM },
      ".cm-md-task": {
        display: "inline-block",
        width: "0.8em",
        height: "0.8em",
        marginRight: "0.5em",
        verticalAlign: "-0.05em",
        border: "1.5px solid currentColor",
        borderRadius: "50%",
        cursor: "pointer",
        color: FG,
      },
      ".cm-md-task-doing": { color: WARN, background: `linear-gradient(90deg, ${WARN} 50%, transparent 50%)` },
      ".cm-md-task-done": { color: OK, backgroundColor: OK },
      ".cm-md-task-dropped, .cm-md-task-carried": { color: DIM, background: `linear-gradient(135deg, transparent 45%, ${DIM} 45%, ${DIM} 55%, transparent 55%)` },
      ".cm-tooltip": { backgroundColor: "var(--color-popover)", border: `1px solid ${FG}`, borderRadius: "0", color: FG },
      ".cm-wiki-peek": { width: "300px", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px", fontFamily: MONO, fontSize: "10px", color: DIM },
      ".cm-wiki-peek-head": { display: "flex", justifyContent: "space-between", gap: "8px" },
      ".cm-wiki-peek-head strong": { color: FG, fontSize: "11px", fontWeight: "600" },
      ".cm-wiki-peek p": { margin: "0", fontFamily: SERIF, fontSize: "13px", lineHeight: "1.5", color: "var(--color-soft)" },
      ".cm-tooltip-autocomplete > ul": { fontFamily: MONO, fontSize: "11px", maxHeight: "16em" },
      ".cm-tooltip-autocomplete > ul > li": { padding: "4px 10px" },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--color-accent)", color: FG },
      ".cm-completionDetail": { color: DIM, fontStyle: "normal", marginLeft: "1em" },
    },
    { dark: true },
  );
}
