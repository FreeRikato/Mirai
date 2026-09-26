import type { Machine } from "@/shared/schema";
import { useHostDetail, useHostError, type HostError } from "../api";
import { ago, bytes } from "../format";
import { useNow } from "../hooks";
import { Ago, Page, PageHeader, Pills } from "../ui";
import { Processes } from "./Processes";
import { Services } from "./Services";
import { Cores, Disks, Health, Io, Memory } from "./vitals";

function Unavailable({ m }: { m: Machine }) {
  return (
    <p className="m-0 text-[13px] text-dim">
      {m.kind === "offline"
        ? `${m.ts.name} is offline. Last seen ${ago(m.ts.lastSeen)} ago.`
        : `${m.ts.name} is online but mirai-agent is not answering on ${m.ts.ip}:7070.`}
    </p>
  );
}

const STALE_AFTER_MS = 60_000;

function staleNote(at: number, failure: HostError | null, now: number): string | null {
  const old = now - at >= STALE_AFTER_MS ? `data ${ago(at, now)} old` : null;
  if (failure) return [`agent error: ${failure.error}`, old].filter(Boolean).join(", ");
  return old;
}

function HostDetailSection({ host }: { host: string }) {
  const { data: detail } = useHostDetail(host);
  const { data: failure } = useHostError(host);
  const now = useNow(10_000);
  if (!detail) {
    return failure ? <p className="m-0 text-bad">could not load processes and services: {failure.error}</p> : <p className="m-0 text-dim">loading processes and services</p>;
  }
  return (
    <>
      <Services services={detail.services} />
      <Processes host={host} detail={detail} note={staleNote(detail.at, failure, now)} />
    </>
  );
}

export function HostView({ m }: { m: Machine }) {
  const live = m.kind === "live" ? m.metrics : null;
  const facts = live
    ? [live.info.os, live.info.cpuModel, `${live.info.threads}t`, bytes(live.info.memTotal), m.ts.ip, <>agent <Ago at={live.at} /></>]
    : [m.ts.os, m.ts.ip];

  return (
    <Page className="gap-[26px]">
      <PageHeader title={m.ts.name}>
        <Pills items={facts} color={m.color} label="host facts" />
      </PageHeader>
      {live ? (
        <>
          <div className="flex flex-col gap-8 @4xl:flex-row @4xl:gap-10">
            <Cores m={live} color={m.color} />
            <Memory m={live} color={m.color} />
          </div>
          <div className="grid grid-cols-1 gap-x-12 gap-y-7 @2xl:grid-cols-2 @4xl:grid-cols-3">
            <Disks m={live} />
            <Io m={live} />
            <Health m={live} />
          </div>
          <HostDetailSection host={m.ts.name} />
        </>
      ) : (
        <Unavailable m={m} />
      )}
    </Page>
  );
}
