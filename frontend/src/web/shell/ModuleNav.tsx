import { cn } from "cn";
import { navigate, useRoute } from "../router";
import { useShipBadge } from "../ship/api";
import { MODULES } from "./modules";

export function ModuleNav({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const route = useRoute();
  const waiting = useShipBadge().data?.waiting ?? 0;
  return (
    <nav aria-label="modules" className={cn("flex items-center gap-6", className)}>
      {MODULES.map(m => {
        const href = m.href;
        if (!href) {
          return (
            <span key={m.id} aria-disabled className="text-[12px] text-dim">
              {m.label}
            </span>
          );
        }
        const active = route.module === m.id;
        return (
          <a
            key={m.id}
            href={href}
            aria-current={active ? "page" : undefined}
            onClick={e => {
              e.preventDefault();
              navigate(href);
              onNavigate?.();
            }}
            className={cn("flex h-full items-center gap-1.5 border-b-2 text-[12px] no-underline", active ? "border-fg font-semibold text-fg" : "border-transparent text-dim hover:text-fg")}
          >
            {m.label}
            {m.id === "ship" && waiting > 0 && (
              <span aria-label={`${waiting} waiting on you`} className="text-[10px] font-normal text-fg">
                {waiting}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}
