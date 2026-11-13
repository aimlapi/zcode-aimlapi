import { readFileSync } from "node:fs";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { createRegistryProviderConfig, parseProviderConfig } from "@zcode/provider";
import { AIMLAPI_ATTRIBUTION_HEADERS } from "@zcode/shared";
import { AiSdkModelExecution } from "../src/model/model-execution.js";

type ApiType = "anthropic-messages" | "openai-chat-completions";

const anthropicReply = {
  id: "msg_aimlapi",
  type: "message",
  role: "assistant",
  model: "model-a",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};
const chatReply = {
  id: "chatcmpl_aimlapi",
  object: "chat.completion",
  created: 0,
  model: "model-a",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

async function send(
  baseUrl: string,
  apiType: ApiType,
  headers?: Record<string, string>,
): Promise<Request> {
  const requests: Request[] = [];
  const execution = new AiSdkModelExecution(
    { defaultHeaders: { "X-ZCode-App-Version": "3.18.2" }, env: {} },
    {
      transport: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(apiType === "anthropic-messages" ? anthropicReply : chatReply);
      },
    },
  );
  const provider = createRegistryProviderConfig(
    parseProviderConfig({
      group: "standard-personal",
      access: { type: "api-key", apiKey: "key" },
      api: { type: apiType, baseUrl, ...(headers ? { headers } : {}) },
    }),
  );
  if (!provider.ok) throw new Error("invalid provider fixture");
  const bound = execution.bindModel({
    providerId: "fixture",
    modelId: "model-a",
    providerConfig: provider.config,
    supportsJsonSchemaOutput: false,
    optionSpecs: { reasoningLevel: { map: "{}" }, maxOutputTokens: { map: "{}" } },
  });
  const { model } = bound.resolveRequest({
    options: { reasoningLevel: "disabled", maxOutputTokens: 64 },
  });
  await generateText({ model, prompt: "hello", maxRetries: 0 });
  expect(requests).toHaveLength(1);
  return requests[0]!;
}

describe("AI/ML API attribution on the wire", () => {
  it.each([
    ["https://api.aimlapi.com/v1", "openai-chat-completions", true],
    ["https://api.aimlapi.com", "anthropic-messages", true],
    ["https://API.AIMLAPI.COM/v1", "openai-chat-completions", true],
    ["http://api.aimlapi.com/v1", "openai-chat-completions", false],
    ["https://aimlapi.com/v1", "openai-chat-completions", false],
    ["https://api.aimlapi.com.example.test/v1", "openai-chat-completions", false],
    ["https://eu.api.aimlapi.com/v1", "openai-chat-completions", false],
    ["https://proxy.example.test/api.aimlapi.com/v1", "openai-chat-completions", false],
    ["https://openrouter.ai/api", "anthropic-messages", false],
  ] as const)("%s (%s) carries attribution: %s", async (baseUrl, apiType, expected) => {
    const request = await send(baseUrl, apiType);
    expect(request.headers.get("x-aimlapi-partner-id")).toBe(
      expected ? AIMLAPI_ATTRIBUTION_HEADERS["X-AIMLAPI-Partner-ID"] : null,
    );
    expect(request.headers.get("x-aimlapi-source")).toBe(expected ? "agent/zcode" : null);
    expect(request.headers.get("authorization") ?? request.headers.get("x-api-key")).toBeTruthy();
  });

  it("does not leak OpenRouter attribution to the gateway, nor ours to OpenRouter", async () => {
    const gateway = await send("https://api.aimlapi.com/v1", "openai-chat-completions");
    expect(gateway.headers.get("x-openrouter-title")).toBeNull();
    const router = await send("https://openrouter.ai/api", "anthropic-messages");
    expect(router.headers.get("x-openrouter-title")).toBe("ZCode");
    expect(router.headers.get("x-aimlapi-source")).toBeNull();
  });

  it("a user header still overrides the default, like the OpenRouter ones", async () => {
    const request = await send("https://api.aimlapi.com/v1", "openai-chat-completions", {
      "x-aimlapi-source": "agent/custom",
    });
    expect(request.headers.get("x-aimlapi-source")).toBe("agent/custom");
  });

  // Production builds bundle zcode-builtin.json, every other build zcode-builtin.test.json
  // (scripts/builtin-provider-config.mjs), so both must carry the templates, like OpenRouter.
  it.each(["zcode-builtin.json", "zcode-builtin.test.json"])(
    "both templates in %s point at the exact gateway host and get attribution",
    async (file) => {
      const builtin = JSON.parse(
        readFileSync(new URL(`../../../../../config/provider/${file}`, import.meta.url), "utf8"),
      ) as {
        config: {
          providerConfigRules: {
            templateRules: {
              templateId: string;
              config: { api: { type: ApiType; baseUrl: string } };
            }[];
          };
        };
      };
      const templates = builtin.config.providerConfigRules.templateRules.filter((t) =>
        t.templateId.startsWith("aimlapi-"),
      );
      expect(templates.map((t) => t.templateId)).toEqual(["aimlapi-chat", "aimlapi-messages"]);
      for (const { config } of templates) {
        expect(new URL(config.api.baseUrl).hostname).toBe("api.aimlapi.com");
        const request = await send(config.api.baseUrl, config.api.type);
        expect(request.headers.get("x-aimlapi-source")).toBe("agent/zcode");
      }
    },
  );
});
