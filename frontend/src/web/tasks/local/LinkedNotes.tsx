import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { noteBody } from "@/shared/notes";
import { useCreateNote, useNoteFile, useVault, type Vault } from "../../notes/api";
import { navigate, notesHref } from "../../router";
import { DrawerSection } from "../ui/Drawer";
import { Markdown } from "../ui/Markdown";

export function LinkedNotes({ targets }: { targets: readonly string[] }) {
  const { vault, reason } = useVault();
  if (targets.length === 0) return null;
  return (
    <>
      {targets.map(target => (
        <DrawerSection key={target}>
          {vault ? <LinkedNote target={target} vault={vault} /> : <NoteHeader title={target} status={reason ?? "vault unavailable"} />}
        </DrawerSection>
      ))}
    </>
  );
}

function LinkedNote({ target, vault }: { target: string; vault: Vault }) {
  const id = vault.resolve(target);
  return id ? <FoundNote id={id} vault={vault} /> : <MissingNote target={target} />;
}

function FoundNote({ id, vault }: { id: string; vault: Vault }) {
  const { data: file, error } = useNoteFile(id);
  const note = vault.byId.get(id);
  const body = file ? noteBody(file.text).trim() : "";
  return (
    <>
      <NoteHeader title={note?.title ?? id} href={notesHref(id)} status={note?.folder || null} />
      {error ? <span className="text-[10px] text-bad">{error.message}</span> : !file ? <span className="text-[10px] text-dim">opening</span> : body ? <Markdown>{body}</Markdown> : <span className="text-[10px] text-dim">empty note</span>}
    </>
  );
}

function MissingNote({ target }: { target: string }) {
  const create = useCreateNote();
  return (
    <>
      <NoteHeader title={target} status="not in vault" />
      <Button size="xs" variant="outline" disabled={create.isPending} onClick={() => create.mutate(target)} className="self-start font-mono text-[10px]">
        create {target}.md
      </Button>
      {create.error && <span className="text-[10px] text-bad">{create.error.message}</span>}
    </>
  );
}

function NoteHeader({ title, href, status }: { title: string; href?: string; status: string | null }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-dim">
      <FileText aria-hidden className="size-3 shrink-0" />
      {href ? (
        <a
          href={href}
          onClick={e => {
            e.preventDefault();
            navigate(href);
          }}
          className="truncate text-fg no-underline hover:underline"
        >
          {title}
        </a>
      ) : (
        <span className="truncate text-fg">{title}</span>
      )}
      {status && <span className="ml-auto shrink-0">{status}</span>}
    </span>
  );
}
