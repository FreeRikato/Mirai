import type { BunRequest } from "bun";
import { NoteCreateSchema, NoteSaveSchema } from "@/shared/notes";
import type { ServerMessage } from "@/shared/schema";
import type { Config } from "../config";
import { readWrite } from "../http";
import { createNotesStore, type NoteWrite } from "./store";

export type NotesDeps = {
  config: Config["notes"];
  publish: (msg: ServerMessage) => void;
};

const SEARCH_LIMIT = 20;

const written = (out: NoteWrite) => (out.ok ? Response.json(out) : Response.json({ error: out.error }, { status: out.status }));

export function createNotes({ config, publish }: NotesDeps) {
  const store = createNotesStore({ ...config, onChange: snapshot => publish({ type: "notes", snapshot }) });

  const routes = {
    "/api/notes": () => Response.json(store.snapshot()),
    "/api/notes/search": (req: BunRequest) => Response.json(store.search(new URL(req.url).searchParams.get("q") ?? "", SEARCH_LIMIT)),
    "/api/notes/file": {
      GET: async (req: BunRequest) => {
        const note = await store.read(new URL(req.url).searchParams.get("id") ?? "");
        return note ? Response.json(note) : Response.json({ error: "no such note" }, { status: 404 });
      },
      POST: async (req: BunRequest) => {
        const r = await readWrite(req, NoteSaveSchema, "{ id, base, next }");
        return r.ok ? written(await store.save(r.body)) : r.res;
      },
    },
    "/api/notes/asset": (req: BunRequest) => {
      const path = store.asset(new URL(req.url).searchParams.get("name") ?? "");
      return path ? new Response(Bun.file(path), { headers: { "cache-control": "private, max-age=3600" } }) : Response.json({ error: "no such image in the vault" }, { status: 404 });
    },
    "/api/notes/new": {
      POST: async (req: BunRequest) => {
        const r = await readWrite(req, NoteCreateSchema, "{ id }");
        return r.ok ? written(await store.create(r.body.id)) : r.res;
      },
    },
  };

  return { routes, start: () => store.start(), search: (query: string, limit: number) => store.search(query, limit) };
}
