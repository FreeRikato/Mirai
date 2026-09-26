import type { Model } from "@earendil-works/pi-ai";
import { createAgentSession, createExtensionRuntime, ModelRuntime, SettingsManager, type AgentSession, type CreateAgentSessionOptions, type ResourceLoader, type SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { systemPrompt, type MiraiMap } from "./prompt";
import { miraiBash } from "./shell";

export type Thinking = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export type Engine = { label: string; open: (manager: SessionManager) => Promise<AgentSession> };

const resources = (prompt: string): ResourceLoader => ({
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => prompt,
  getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  extendResources: () => {},
  reload: async () => {},
});

const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const BASH_TIMEOUT_SEC = 120;

export function createEngine(deps: { runtime: ModelRuntime; model: Model<string>; thinking: Thinking; tools: ToolDefinition[]; dir: string; map: MiraiMap }): Engine {
  return {
    label: `${deps.model.provider}/${deps.model.id}`,
    open: async manager => {
      const { session } = await createAgentSession({
        cwd: deps.map.home,
        agentDir: deps.dir,
        modelRuntime: deps.runtime,
        model: deps.model,
        thinkingLevel: deps.thinking,
        tools: [...BUILTIN_TOOLS, ...deps.tools.map(t => t.name)],
        customTools: [miraiBash(deps.map.home, BASH_TIMEOUT_SEC), ...deps.tools],
        resourceLoader: resources(systemPrompt(deps.map)),
        settingsManager: SettingsManager.inMemory({ enableInstallTelemetry: false }),
        sessionManager: manager,
      });
      return session;
    },
  };
}

export type EngineConfig = { apiKey: string | undefined; model: string; thinking: Thinking; dir: string };

export async function loadEngine(config: EngineConfig, tools: ToolDefinition[], map: MiraiMap): Promise<Engine | { off: string }> {
  if (!config.apiKey) return { off: "OPENAI_API_KEY is not set in ~/.config/mirai/hub.env" };
  const slash = config.model.indexOf("/");
  const provider = config.model.slice(0, slash);
  const id = config.model.slice(slash + 1);
  try {
    const runtime = await ModelRuntime.create({ authPath: `${config.dir}/auth.json`, modelsPath: `${config.dir}/models.json` });
    await runtime.setRuntimeApiKey(provider, config.apiKey);
    const model = slash > 0 ? runtime.getModel(provider, id) : undefined;
    if (!model) return { off: `pi does not know the model ${config.model}` };
    return createEngine({ runtime, model, thinking: config.thinking, tools, dir: config.dir, map });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return { off: `pi could not start: ${reason.replaceAll(config.apiKey, "[key]")}` };
  }
}
