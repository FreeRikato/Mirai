import { lazy, Suspense, useEffect } from "react";
import { useFleet, useLiveSocket } from "./api";
import { FleetView } from "./fleet/FleetView";
import { HostView } from "./host/HostView";
import { MirAISidebar } from "./mirai/MirAISidebar";
import { LinkPeek } from "./peek/LinkPeek";
import { usePeekLinks } from "./peek/links";
import { routeHost, usePathname, useRoute, type Route } from "./router";
import { ErrorBoundary } from "./ErrorBoundary";
import { CommandPalette } from "./shell/CommandPalette";
import { NavDrawer, Rail } from "./shell/Rail";
import { ImageLightbox } from "./shell/ImageLightbox";
import { TopBar } from "./shell/TopBar";
import { SettingsGate } from "./settings";
import { useUi } from "./store";

const LaterView = lazy(() => import("./later/LaterView").then(m => ({ default: m.LaterView })));
const NotesView = lazy(() => import("./notes/NotesView").then(m => ({ default: m.NotesView })));
const ProjectsView = lazy(() => import("./projects/ProjectsView").then(m => ({ default: m.ProjectsView })));
const StatsView = lazy(() => import("./stats/StatsView").then(m => ({ default: m.StatsView })));
const ReviewView = lazy(() => import("./ship/review/ReviewView").then(m => ({ default: m.ReviewView })));
const ShipView = lazy(() => import("./ship/ShipView").then(m => ({ default: m.ShipView })));
const TasksView = lazy(() => import("./tasks/TasksView").then(m => ({ default: m.TasksView })));

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const ui = useUi.getState();
      if (e.key === "k") {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
      } else if (e.key === "j") {
        e.preventDefault();
        ui.setMirAIOpen(!ui.mirAIOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Machines({ host }: { host: string | null }) {
  const { data: fleet, isPending } = useFleet();
  if (isPending) return <p className="m-0 p-4 text-dim md:p-8">connecting to the hub</p>;
  if (!fleet) return <p className="m-0 p-4 text-dim md:p-8">the hub has not heard from tailscale yet</p>;
  if (!host) return <FleetView fleet={fleet} />;
  const m = fleet.machines.find(x => x.ts.name === host);
  return m ? <HostView m={m} /> : <p className="m-0 p-4 text-dim md:p-8">{host} is not a PC on this tailnet</p>;
}

function ModuleBody({ route }: { route: Route }) {
  if (route.module === "tasks") return <TasksView board={route.board} />;
  if (route.module === "ship") return route.review ? <ReviewView queue={route.queue} id={route.review} /> : <ShipView queue={route.queue} />;
  if (route.module === "later") return <LaterView view={route.view} />;
  if (route.module === "notes") return <NotesView target={route.target} />;
  if (route.module === "stats") return <StatsView />;
  if (route.module === "projects") return <ProjectsView view={route.view} />;
  return (
    <>
      <Rail />
      <main className="@container min-w-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <Machines host={route.host} />
      </main>
    </>
  );
}

export function App() {
  const route = useRoute();
  const pathname = usePathname();
  useLiveSocket(routeHost(route), route.module === "machines");
  useShortcuts();
  usePeekLinks();
  return (
    <SettingsGate>
      <div className="flex h-dvh flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<p className="m-0 p-4 text-dim md:p-8">loading</p>}>
              <ModuleBody route={route} />
            </Suspense>
          </ErrorBoundary>
          <LinkPeek />
          <MirAISidebar />
          <ImageLightbox />
        </div>
        <NavDrawer />
        <CommandPalette />
      </div>
    </SettingsGate>
  );
}
