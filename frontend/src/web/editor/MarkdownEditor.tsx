import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { Annotation, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { cn } from "cn";
import { useEffect, useRef } from "react";
import { livePreview, refreshPreview } from "./livePreview";
import { editorTheme, type EditorVariant } from "./theme";
import { wikiCompletion, wikiHover, type WikiRef, type WikiSource } from "./wiki";

const External = Annotation.define<boolean>();

export type MarkdownEditorProps = {
  value: string;
  onChange: (next: string) => void;
  label: string;
  wiki: WikiSource | null;
  onBlur?: () => void;
  onSave?: () => void;
  variant?: EditorVariant;
  className?: string;
};

export function MarkdownEditor({ value, onChange, label, wiki, onBlur, onSave, variant = "compact", className }: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const wikiRef = useRef<WikiSource | null>(wiki);
  const handlers = useRef({ onChange, onBlur, onSave });
  handlers.current = { onChange, onBlur, onSave };

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const shared: WikiRef = wikiRef;
    const save = () => {
      handlers.current.onSave?.();
      return handlers.current.onSave !== undefined;
    };
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([{ key: "Mod-s", run: save, preventDefault: true }, { key: "Mod-Enter", run: save }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          indentUnit.of("\t"),
          EditorState.tabSize.of(4),
          EditorView.lineWrapping,
          livePreview(shared),
          autocompletion({ override: [wikiCompletion(shared)], icons: false }),
          wikiHover(shared),
          editorTheme(variant),
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          EditorView.updateListener.of(u => {
            if (u.docChanged && !u.transactions.some(t => t.annotation(External))) handlers.current.onChange(u.state.doc.toString());
            if (u.focusChanged && !u.view.hasFocus) handlers.current.onBlur?.();
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [label, variant]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    const anchor = Math.min(editor.state.selection.main.anchor, value.length);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, selection: { anchor }, annotations: External.of(true) });
  }, [value]);

  useEffect(() => {
    wikiRef.current = wiki;
    view.current?.dispatch({ effects: refreshPreview.of(null) });
  }, [wiki]);

  return <div ref={host} className={cn("min-w-0", className)} />;
}
