import { cn } from "cn";
import { vaultImageUrl } from "../../api";

export function VaultImages({ names, className }: { names: readonly string[]; className?: string }) {
  if (names.length === 0) return null;
  return (
    <span className="flex flex-col gap-1.5">
      {names.map(name => (
        <img key={name} src={vaultImageUrl(name)} alt={name} loading="lazy" className={cn("block w-full border border-rule object-cover", className)} />
      ))}
    </span>
  );
}
