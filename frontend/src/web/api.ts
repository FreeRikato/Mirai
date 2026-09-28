import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { create } from "zustand";
import type { ClientMessage, DesktopMessage, Fleet, FleetEvent, HostDetail, KillRequest, LoadRange, LoadStrip, ServerMessage } from "@/shared/schema";
import { navigate } from "./router";
import { applySystemTheme, desktopMachineForSearch } from "./systemTheme";

export const keys = {
  fleet: ["fleet"] as const,
  events: ["events"] as const,
  load: (range: LoadRange) => ["load", range] as const,
  host: (name: string) => ["host", name] as const,
  hostError: (name: string) => ["host-error", name] as const,
  settings: ["settings"] as const,
  tasksLocal: ["tasks", "local"] as const,
  tasksLinear: ["tasks", "linear"] as const,
  tasksGithub: ["tasks", "github"] as const,
  tasksPriority: ["tasks", "priority"] as const,
  tasksOrder: ["tasks", "order"] as const,
  ship: ["ship"] as const,
  notes: ["notes"] as const,
  noteFiles: ["notes", "file"] as const,
  noteFile: (id: string) => ["notes", "file", id] as const,
  noteSearch: (q: string) => ["notes", "search", q] as const,
  shipSearch: (q: string) => ["ship", "search", q] as const,
  shipReadiness: ["ship", "readiness"] as const,
  shipBadge: ["ship", "badge"] as const,
  shipBody: (id: string) => ["ship", "body", id] as const,
  shipReview: (id: string) => ["ship", "review", id] as const,
  githubRef: (ref: string) => ["ship", "ref", ref] as const,
  linearRef: (id: string) => ["tasks", "linear", "ref", id] as const,
  codeHighlight: (query: string) => ["code", "highlight", query] as const,
  px0: ["px0"] as const,
};

export const vaultImageUrl = (name: string): string => `/api/notes/asset?name=${encodeURIComponent(name)}`;

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const fleetQuery = { queryKey: keys.fleet, queryFn: () => get<Fleet | null>("/api/fleet"), staleTime: Infinity };
export const useFleet = () => useQuery(fleetQuery);
export const useFleetSlice = <T,>(select: (fleet: Fleet | null) => T) => useQuery({ ...fleetQuery, select });
export const useEvents = () => useQuery({ queryKey: keys.events, queryFn: () => get<FleetEvent[]>("/api/events"), staleTime: Infinity });
export const useLoad = (range: LoadRange) =>
  useQuery({ queryKey: keys.load(range), queryFn: () => get<LoadStrip>(`/api/load?range=${range}`), refetchInterval: 60_000 });
export function useHostDetail(name: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.host(name),
    queryFn: async () => (await get<HostDetail | null>(`/api/host/${encodeURIComponent(name)}`)) ?? qc.getQueryData<HostDetail>(keys.host(name)) ?? null,
    staleTime: Infinity,
  });
}

export type HostError = { error: string; at: number };

export const useHostError = (name: string) =>
  useQuery({ queryKey: keys.hostError(name), queryFn: () => null as HostError | null, initialData: null, staleTime: Infinity });

type HubLink = { connected: boolean; since: number };

export const useHubLink = create<HubLink>()(() => ({ connected: true, since: Date.now() }));

const setLinked = (connected: boolean) => {
  if (useHubLink.getState().connected !== connected) useHubLink.setState({ connected, since: Date.now() });
};

const ErrorBodySchema = z.object({ error: z.string() });

async function send(path: string, body: unknown): Promise<Response> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return res;
  const parsed = ErrorBodySchema.safeParse(await res.json().catch(() => null));
  throw new Error(parsed.success ? parsed.data.error : `${path} failed (${res.status})`);
}

export async function post(path: string, body: unknown): Promise<void> {
  await send(path, body);
}

export async function postFor<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  return schema.parse(await (await send(path, body)).json());
}

export const useKill = (host: string) =>
  useMutation({
    mutationFn: async (req: KillRequest) => {
      const res = await fetch(`/api/host/${encodeURIComponent(host)}/kill`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      if (res.ok) return;
      const body = ErrorBodySchema.safeParse(await res.json().catch(() => null));
      throw new Error(body.success ? body.data.error : `kill failed (${res.status})`);
    },
  });

function apply(qc: QueryClient, msg: ServerMessage) {
  switch (msg.type) {
    case "fleet":
      qc.setQueryData(keys.fleet, msg.fleet);
      if (typeof window !== "undefined") {
        const desktopMachine = desktopMachineForSearch(window.location.search);
        const machine = desktopMachine ? msg.fleet.machines.find(m => m.ts.name === desktopMachine) : undefined;
        applySystemTheme(machine?.kind === "live" ? machine.metrics.system : undefined);
      }
      return;
    case "events":
      qc.setQueryData(keys.events, msg.events);
      return;
    case "host":
      qc.setQueryData(keys.host(msg.name), msg.detail);
      qc.setQueryData(keys.hostError(msg.name), null);
      return;
    case "host-error":
      qc.setQueryData(keys.hostError(msg.name), { error: msg.error, at: msg.at });
      return;
    case "tasks-local":
      qc.setQueryData(keys.tasksLocal, msg.snapshot);
      return;
    case "notes":
      qc.setQueryData(keys.notes, msg.snapshot);
      void qc.invalidateQueries({ queryKey: keys.noteFiles });
      return;
    case "open":
      navigate(msg.path);
      return;
  }
}

export function useLiveSocket(watching: string | null, liveFleet: boolean, desktopMachine: string | null = null) {
  const qc = useQueryClient();
  const socket = useRef<WebSocket | null>(null);
  const watchRef = useRef<ClientMessage>({ type: "watch", fleet: liveFleet, host: watching });
  const desktopRef = useRef<DesktopMessage | null>(desktopMachine ? { type: "desktop", machine: desktopMachine } : null);
  watchRef.current = { type: "watch", fleet: liveFleet, host: watching };
  desktopRef.current = desktopMachine ? { type: "desktop", machine: desktopMachine } : null;

  useEffect(() => {
    let closed = false;
    let retry = 500;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      socket.current = ws;
      ws.onopen = () => {
        retry = 500;
        setLinked(true);
        ws.send(JSON.stringify(watchRef.current));
        if (desktopRef.current) ws.send(JSON.stringify(desktopRef.current));
        void qc.invalidateQueries({ queryKey: keys.events });
      };
      ws.onmessage = e => {
        const msg = JSON.parse(String(e.data)) as ServerMessage;
        apply(qc, msg);
      };
      ws.onclose = () => {
        if (closed) return;
        setLinked(false);
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 10_000);
      };
    };
    connect();
    return () => {
      closed = true;
      socket.current?.close();
    };
  }, [qc]);

  useEffect(() => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(watchRef.current));
    if (desktopRef.current) ws.send(JSON.stringify(desktopRef.current));
  }, [watching, liveFleet, desktopMachine]);
}
