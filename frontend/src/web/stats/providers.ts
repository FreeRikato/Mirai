import type { Provider } from "@/shared/usage";
import { useFleet } from "../api";

export const PROVIDER_COLOR: Record<Provider, string> = { claude: "#d97757", codex: "var(--color-fg)" };

export const PROVIDER_LABEL: Record<Provider, string> = { claude: "Claude Code", codex: "Codex" };

export function useMachineColors(): (name: string) => string {
  const { data: fleet } = useFleet();
  return name => fleet?.machines.find(m => m.ts.name === name)?.color ?? "var(--color-dim)";
}
