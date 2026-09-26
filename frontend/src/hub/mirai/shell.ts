import { createBashToolDefinition, defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|SESSION|CREDENTIAL|AUTH|COOKIE|DSN|_PAT$|_URL$/i;

export const withoutSecrets = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(env).filter(([name]) => !SECRET_NAME.test(name)));

export function miraiBash(home: string, defaultTimeoutSec: number): ToolDefinition {
  const bash = createBashToolDefinition(home, { spawnHook: context => ({ ...context, env: withoutSecrets(context.env) }) });
  return defineTool({
    ...bash,
    execute: (id, params, signal, onUpdate, ctx) => bash.execute(id, { ...params, timeout: params.timeout ?? defaultTimeoutSec }, signal, onUpdate, ctx),
  });
}
