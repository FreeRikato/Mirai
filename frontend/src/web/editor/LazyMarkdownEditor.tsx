import { lazy, Suspense } from "react";
import type { MarkdownEditorProps } from "./MarkdownEditor";

const Editor = lazy(() => import("./MarkdownEditor").then(m => ({ default: m.MarkdownEditor })));

export function LazyMarkdownEditor(props: MarkdownEditorProps) {
  return (
    <Suspense fallback={<pre className={props.className}>{props.value}</pre>}>
      <Editor {...props} />
    </Suspense>
  );
}
