import { cn } from "cn";
import { useMemo } from "react";
import { buildModel, PROJECT_VIEWS, type Model, type ProjectView } from "@/shared/projects";
import { bytes } from "../format";
import { navigate, projectsHref } from "../router";
import { useMachineColors } from "../stats/providers";
import { useProjects } from "./api";
import { SkyView } from "./SkyView";
import { StackView } from "./StackView";
import { useProjectsUi } from "./store";
import { TreemapView } from "./TreemapView";

export type ViewProps = { model: Model; color: (host: string) => string };

function Summary({ model }: { model: Model }) {
  const services = model.projects.flatMap(p => p.lanes.flatMap(l => l.services));
  const orphans = model.projects.find(p => p.kind === "orphans")?.lanes.reduce((n, l) => n + l.services.length, 0) ?? 0;
  return (
    <span className="flex items-center gap-3.5 text-[10px] whitespace-nowrap text-dim">
      <span>
        <b className="font-normal text-fg">{model.projects.filter(p => p.kind === "repo").length}</b> projects
      </span>
      <span>
        <b className="font-normal text-fg">{services.length}</b> services
      </span>
      <span>
        <b className="font-normal text-fg">{bytes(services.reduce((s, x) => s + x.memBytes, 0))}</b> resident
      </span>
      {orphans > 0 && (
        <span>
          <b className="font-normal text-bad">{orphans}</b> orphans
        </span>
      )}
    </span>
  );
}

export function ProjectsView({ view }: { view: ProjectView }) {
  const ui = useProjectsUi();
  const color = useMachineColors();
  const { data: report, isPending } = useProjects();
  const model = useMemo(() => buildModel(report?.hosts ?? [], { hidden: ui.hidden, tools: ui.tools }), [report, ui.hidden, ui.tools]);
  const hosts = report?.hosts ?? [];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-rule px-4 py-2 md:flex-nowrap md:px-6 md:py-0">
        <nav aria-label="project views" className="flex h-8 items-center gap-5 md:h-11">
          {PROJECT_VIEWS.map(v => {
            const href = projectsHref(v);
            return (
              <a
                key={v}
                href={href}
                aria-current={v === view ? "page" : undefined}
                onClick={e => {
                  e.preventDefault();
                  navigate(href);
                }}
                className={cn("flex h-full items-center border-b text-[11px] no-underline", v === view ? "border-fg text-fg" : "border-transparent text-dim hover:text-fg")}
              >
                {v}
              </a>
            );
          })}
        </nav>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <Summary model={model} />
          <div role="group" aria-label="machines" className="flex h-6 items-center gap-2.5 border border-rule px-2.5">
            {hosts.map(h => {
              const on = !ui.hidden.includes(h.host);
              return (
                <button
                  key={h.host}
                  type="button"
                  aria-pressed={on}
                  title={h.error ?? undefined}
                  onClick={() => ui.toggleHost(h.host)}
                  className={cn("flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-[10px]", on ? "text-fg" : "text-dim line-through hover:text-soft")}
                >
                  <span aria-hidden className="size-2" style={on ? { background: color(h.host) } : { boxShadow: `inset 0 0 0 1px ${color(h.host)}` }} />
                  {h.host}
                  {h.error && <span className="text-warn">!</span>}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={ui.tools}
            onClick={() => ui.setTools(!ui.tools)}
            className={cn("flex h-6 cursor-pointer items-center gap-1.5 border border-rule bg-transparent px-2.5 font-mono text-[10px]", ui.tools ? "text-fg" : "text-dim hover:text-soft")}
          >
            <span aria-hidden className={cn("size-2", ui.tools ? "bg-soft" : "shadow-[inset_0_0_0_1px_var(--color-dim)]")} />
            host tools
          </button>
        </div>
      </div>
      {isPending ? (
        <p className="m-0 p-4 text-dim md:p-8">asking the agents what is running</p>
      ) : model.projects.length === 0 ? (
        <p className="m-0 p-4 text-dim md:p-8">{hosts.length === 0 ? "no agent has reported projects yet" : "nothing is running on the machines you have switched on"}</p>
      ) : view === "treemap" ? (
        <TreemapView model={model} color={color} />
      ) : view === "sky" ? (
        <SkyView model={model} color={color} />
      ) : (
        <StackView model={model} color={color} />
      )}
    </div>
  );
}
