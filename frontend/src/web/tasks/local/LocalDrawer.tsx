import { cn } from "cn";
import { Code } from "lucide-react";
import { useState } from "react";
import type { LocalState, LocalTask } from "@/shared/tasks";
import { imageEmbeds, noteTargets, unwrapWikiLinks } from "@/shared/wikilinks";
import { LazyMarkdownEditor } from "../../editor/LazyMarkdownEditor";
import { useWiki } from "../../notes/api";
import { useEditLocalBlock } from "../api";
import { Drawer, DrawerSection } from "../ui/Drawer";
import { GlyphIcon, type Glyph } from "../ui/Glyph";
import { LinkPieces } from "../ui/Links";
import { VaultImages } from "../ui/VaultImages";
import { LinkedNotes } from "./LinkedNotes";

export const localGlyph: Record<LocalState, Glyph> = { open: "open", doing: "doing", done: "done", dropped: "dropped" };

export function LocalDrawer({ task, onClose }: { task: LocalTask; onClose: () => void }) {
  const title = imageEmbeds(task.title);
  const text = unwrapWikiLinks(title.text);
  return (
    <Drawer title={text || "task"} onClose={onClose}>
      <DrawerSection className="pr-12">
        <div className="flex items-start gap-2">
          <GlyphIcon glyph={localGlyph[task.state]} className="mt-[3px] size-4" />
          <h2 className="m-0 min-w-0 text-[14px] leading-[1.4] font-semibold break-words">{text || "untitled"}</h2>
        </div>
        <span className="text-[10px] text-dim">
          {task.date}.md line {task.line + 1}
        </span>
        <VaultImages names={title.images} className="max-h-[360px] object-contain" />
        <LinkPieces links={task.links} />
      </DrawerSection>
      <LinkedNotes targets={noteTargets(task.block)} />
      <BlockEditor key={`${task.id}\n${task.block}`} task={task} />
    </Drawer>
  );
}

function Label({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-dim">
      {icon}
      {children}
    </span>
  );
}

function BlockEditor({ task }: { task: LocalTask }) {
  const [draft, setDraft] = useState(task.block);
  const edit = useEditLocalBlock();
  const wiki = useWiki();
  const dirty = draft !== task.block;
  const save = () => {
    if (dirty && !edit.isPending) edit.mutate({ date: task.date, line: task.line, block: task.block, next: draft });
  };

  return (
    <DrawerSection className="border-b-0 bg-sunk">
      <div className="flex items-center justify-between">
        <Label icon={<Code aria-hidden className="size-3" />}>markdown</Label>
        <span className={cn("text-[10px]", edit.error ? "text-bad" : dirty ? "text-warn" : "text-dim")}>
          {edit.error ? edit.error.message : edit.isPending ? "saving" : dirty ? "unsaved, saves on blur" : "saved to disk"}
        </span>
      </div>
      <LazyMarkdownEditor value={draft} onChange={setDraft} onBlur={save} onSave={save} label="task markdown" wiki={wiki} className="min-h-24" />
    </DrawerSection>
  );
}
