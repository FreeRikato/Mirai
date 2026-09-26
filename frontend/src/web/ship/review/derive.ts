type Pathed = { path: string; viewed: boolean };

export type Folder<F> = { folder: string; files: (F & { name: string })[] };

const split = (path: string) => {
  const cut = path.lastIndexOf("/");
  return { folder: cut === -1 ? "" : path.slice(0, cut), name: path.slice(cut + 1) };
};

export function byFolder<F extends Pathed>(files: readonly F[]): Folder<F>[] {
  const folders = new Map<string, (F & { name: string })[]>();
  for (const f of files.toSorted((a, b) => a.path.localeCompare(b.path))) {
    const { folder, name } = split(f.path);
    folders.set(folder, [...(folders.get(folder) ?? []), { ...f, name }]);
  }
  return [...folders].map(([folder, list]) => ({ folder, files: list })).toSorted((a, b) => a.folder.localeCompare(b.folder));
}

export const treeOrder = <F extends Pathed>(files: readonly F[]): F[] => byFolder(files).flatMap(g => g.files);

export function firstToOpen(files: readonly Pathed[]): string | null {
  const ordered = treeOrder(files);
  return (ordered.find(f => !f.viewed) ?? ordered[0])?.path ?? null;
}

export const typing = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
