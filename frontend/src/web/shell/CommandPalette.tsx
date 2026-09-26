import { cn } from "cn";
import { useState } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandItem, CommandInput, CommandList } from "@/components/ui/command";
import { useSave } from "../later/api";
import { extractUrl } from "../later/derive";
import { laterHref, navigate, usePathname } from "../router";
import { useUi } from "../store";
import { pageScore } from "./pageScore";
import { usePages, type PageGroup } from "./pages";

const GROUPS: readonly PageGroup[] = ["machines", "tasks", "ship", "later", "notes", "stats"];

export function CommandPalette() {
  const open = useUi(s => s.paletteOpen);
  const setOpen = useUi(s => s.setPaletteOpen);
  const ask = useUi(s => s.askMirAI);
  const pages = usePages();
  const [query, setQuery] = useState("");
  const here = usePathname();
  const save = useSave();
  const link = extractUrl(query);

  const go = (href: string) => {
    navigate(href);
    setOpen(false);
    setQuery("");
  };

  return (
    <CommandDialog filter={pageScore} open={open} onOpenChange={setOpen} title="search or ask mirAI" description="Go to any page or ask mirAI" className="border-rule bg-popover font-mono" showCloseButton={false}>
      <CommandInput value={query} onValueChange={setQuery} placeholder="search or ask mirAI" className="font-mono text-[12px]" />
      <CommandList>
        <CommandEmpty className="py-4 text-center text-dim">no page matches</CommandEmpty>
        {GROUPS.map(g => (
          <CommandGroup key={g} heading={g === "later" ? "content" : g}>
            {pages
              .filter(p => p.group === g)
              .map(p => {
                const current = p.href === here;
                return (
                  <CommandItem key={p.href} value={`${g} ${p.label}`} keywords={[...p.keywords]} onSelect={() => go(p.href)} aria-current={current ? "page" : undefined} className="font-mono text-[12px]">
                    {p.color ? <span className="size-2 rounded-full" style={{ background: p.color }} /> : <span className="size-2" />}
                    {p.label}
                    <span className={cn("ml-auto", current ? "text-fg" : "text-dim")}>{current ? "here" : p.hint}</span>
                  </CommandItem>
                );
              })}
          </CommandGroup>
        ))}
        {link && (
          <CommandGroup heading="save" forceMount>
            <CommandItem value={`save ${link}`} forceMount onSelect={() => save.mutate(link, { onSuccess: item => go(laterHref(item.kind)) })} className="font-mono text-[12px]">
              save to content: {URL.parse(link)?.hostname ?? link}
              <span className="ml-auto text-dim">{save.isPending ? "saving" : "↵"}</span>
            </CommandItem>
          </CommandGroup>
        )}
        {query.trim() && (
          <CommandGroup heading="mirAI" forceMount>
            <CommandItem value={`ask ${query}`} forceMount onSelect={() => ask(query.trim())} className="font-mono text-[12px]">
              ask mirAI: {query.trim()}
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
