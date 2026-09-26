import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import type { Settings } from "@/shared/settings";
import { get, keys } from "./api";

const SettingsContext = createContext<Settings | null>(null);

export function SettingsGate({ children }: { children: ReactNode }) {
  const { data, error } = useQuery({ queryKey: keys.settings, queryFn: () => get<Settings>("/api/settings"), staleTime: Infinity });
  if (error) return <p className="m-0 p-4 text-bad md:p-8">cannot reach the hub: {error.message}</p>;
  if (!data) return <p className="m-0 p-4 text-dim md:p-8">connecting to the hub</p>;
  return <SettingsContext.Provider value={data}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(SettingsContext);
  if (!s) throw new Error("useSettings needs <SettingsGate> above it");
  return s;
}
