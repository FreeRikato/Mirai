import { cn } from "cn";
import type { Service } from "@/shared/schema";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bodyCell as td, Heading, headCell as th } from "../ui";

const stateClass: Record<Service["state"], string> = { failed: "text-bad", restarting: "text-warn", running: "text-fg", stopped: "text-dim" };

export function Services({ services }: { services: readonly Service[] }) {
  const count = (s: Service["state"]) => services.filter(x => x.state === s).length;
  return (
    <section className="flex flex-col gap-2.5">
      <Heading
        right={
          <>
            <span>{count("running")} running</span>
            {count("failed") > 0 && <span className="text-bad">{count("failed")} failed</span>}
            {count("restarting") > 0 && <span className="text-warn">{count("restarting")} restarting</span>}
          </>
        }
      >
        services
      </Heading>
      {services.length === 0 ? (
        <p className="m-0 text-dim">no services of your own on this machine</p>
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="border-rule hover:bg-transparent">
              <TableHead className={th}>service</TableHead>
              <TableHead className={cn(th, "hidden w-[80px] @3xl:table-cell")}>kind</TableHead>
              <TableHead className={cn(th, "w-[120px] @xl:w-[150px] @3xl:w-[200px]")}>state</TableHead>
              <TableHead className={cn(th, "hidden w-[110px] text-right @3xl:table-cell")}>since</TableHead>
              <TableHead className={cn(th, "hidden w-[70px] text-right @3xl:table-cell")}>restarts</TableHead>
              <TableHead className={cn(th, "w-[64px] text-right @xl:w-[90px] @3xl:w-[120px]")}>ports</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map(s => (
              <TableRow key={`${s.kind}-${s.name}`} className="border-rule hover:bg-raise">
                <TableCell className={cn(td, "truncate")}>{s.name}</TableCell>
                <TableCell className={cn(td, "hidden text-dim @3xl:table-cell")}>{s.kind}</TableCell>
                <TableCell className={cn(td, "truncate", stateClass[s.state])}>{s.state === "running" ? s.detail || "running" : s.detail}</TableCell>
                <TableCell className={cn(td, "hidden truncate text-right text-dim @3xl:table-cell")}>{s.since ?? "--"}</TableCell>
                <TableCell className={cn(td, "hidden text-right @3xl:table-cell", (s.restarts ?? 0) > 3 ? "text-bad" : "text-dim")}>{s.restarts ?? "--"}</TableCell>
                <TableCell className={cn(td, "truncate text-right text-dim")}>{s.ports || "--"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
