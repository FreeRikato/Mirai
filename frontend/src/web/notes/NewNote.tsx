import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NoteIdSchema } from "@/shared/notes";
import { navigate, notesHref } from "../router";
import { useCreateNote, type Vault } from "./api";

export function NewNoteButton({ vault }: { vault: Vault }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateNote();
  const id = name.trim().replace(/\.md$/i, "");
  const valid = NoteIdSchema.safeParse(id).success;
  const existing = valid ? vault.resolve(id) : null;

  const done = (target: string) => {
    setOpen(false);
    setName("");
    create.reset();
    navigate(notesHref(target));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="xs" className="h-7 border-fg font-mono text-[10px]">
          new note
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-3 border-rule bg-popover p-4 font-mono sm:max-w-md">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-[12px] font-semibold">new note</DialogTitle>
          <DialogDescription className="text-[10px] text-dim">name it, or use folder/name to file it</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={e => {
            e.preventDefault();
            if (existing) done(existing);
            else if (valid && !create.isPending) create.mutate(id, { onSuccess: () => done(id) });
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            aria-label="note name"
            placeholder="databrain/rls policies"
            className="h-8 border border-rule bg-bg px-2.5 font-mono text-[11px] text-fg outline-none placeholder:text-dim focus:border-fg"
          />
          <span className={create.error ? "text-[10px] text-bad" : "text-[10px] text-dim"}>
            {create.error ? create.error.message : existing ? `${existing} already exists` : name && !valid ? "names cannot start with a dot or climb out of the vault" : `saved as ${id || "name"}.md`}
          </span>
          <DialogFooter>
            <Button type="submit" size="xs" disabled={!valid || create.isPending} className="font-mono text-[10px]">
              {existing ? "open it" : create.isPending ? "creating" : "create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
