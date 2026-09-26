import { useVault } from "./api";
import { NotesGraph } from "./NotesGraph";
import { NoteView } from "./NoteView";

export function NotesView({ target }: { target: string | null }) {
  const { vault, reason } = useVault();
  if (!vault) return <p className="m-0 p-4 text-dim md:p-8">{reason}</p>;
  return target ? <NoteView target={target} vault={vault} /> : <NotesGraph vault={vault} />;
}
