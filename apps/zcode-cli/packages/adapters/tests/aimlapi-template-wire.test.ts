import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRegistryModelConfig,
  createRegistryProviderConfig,
  parseProviderConfig,
  parseZCodeBuiltinModelConfigRules,
  parseZCodeBuiltinProviderConfigRules,
} from "@zcode/provider";
import { AiSdkModelAdapter } from "../src/model/runner.js";

const TEMPLATE_ID = "aimlapi";
const BASE_URL = "https://api.aimlapi.com/v1";

async function loadRelease(file: string) {
  const release = JSON.parse(
    await readFile(new URL(`../../../../../config/provider/${file}`, import.meta.url), "utf8"),
  );
  return {
    config: {
      providerTemplates: parseZCodeBuiltinProviderConfigRules(release.config.providerConfigRules)
        .providerTemplates,
      modelConfigRules: parseZCodeBuiltinModelConfigRules(release.config.modelConfigRules),
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("AI/ML API 模板（openai-chat-completions 聚合入口）", () => {
  for (const file of ["zcode-builtin.json", "zcode-builtin.test.json"]) {
    it(`${file}：位于聚合区尾部，只声明 Key 与精确 API 地址`, async () => {
      const release = await loadRelease(file);
      const ids = [...release.config.providerTemplates.keys()];
      // 新品牌进入聚合区尾部，不改变已有模板相对顺序。
      expect(ids.at(-1)).toBe(TEMPLATE_ID);
      expect(ids.indexOf("opencode-zen-chat")).toBe(ids.length - 2);
      const template = release.config.providerTemplates.get(TEMPLATE_ID)!;
      expect(template.config.access).toMatchObject({
        type: "api-key",
        apiKeyManagementUrl: "https://aimlapi.com/app/keys",
      });
      expect(template.config.api).toEqual({ type: "openai-chat-completions", baseUrl: BASE_URL });
      expect(template.config.builtinModelIds).toEqual([
        "zhipu/glm-5.3",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v4-flash",
        "moonshot/kimi-k3",
        "alibaba/qwen3.8-max",
      ]);
    });
  }

  it("每个成员都有精确启停声明，能力完整，推理档位只发送 AI/ML API 接受的 reasoning_effort", async () => {
    const release = await loadRelease("zcode-builtin.json");
    const rules = release.config.modelConfigRules;
    const members = release.config.providerTemplates.get(TEMPLATE_ID)!.config.builtinModelIds!;
    const exact = rules
      .rules()
      .filter((rule) => rule.type === "template-model" && rule.templateId === TEMPLATE_ID);
    expect(exact.map((rule) => ("modelId" in rule ? rule.modelId : undefined))).toEqual(members);
    for (const modelId of members) {
      const resolved = createRegistryModelConfig(
        rules.resolve({
          providerId: "fixture",
          templateId: TEMPLATE_ID,
          modelId,
          apiType: "openai-chat-completions",
          baseUrl: BASE_URL,
        }),
      );
      if (!resolved.ok) throw new Error(`${modelId} 配置不完整`);
      const config = resolved.config.toJSON();
      expect(config.enabled).toBe(true);
      expect(config.properties?.supportsToolCall).toBe(true);
      expect(config.optionSpecs?.reasoningLevel?.values).toEqual(["high", "low"]);
    }
  });

  it("真实 SDK 请求打到 api.aimlapi.com/v1/chat/completions，携带用户 Key、工具与 reasoning_effort", async () => {
    const release = await loadRelease("zcode-builtin.json");
    const modelId = "zhipu/glm-5.3";
    const config = createRegistryModelConfig(
      release.config.modelConfigRules.resolve({
        providerId: "fixture",
        templateId: TEMPLATE_ID,
        modelId,
        apiType: "openai-chat-completions",
        baseUrl: BASE_URL,
      }),
    );
    const provider = createRegistryProviderConfig(
      parseProviderConfig({
        group: "standard-personal",
        access: { type: "api-key", apiKey: "aiml-fixture-key" },
        api: { type: "openai-chat-completions", baseUrl: BASE_URL },
      }),
    );
    if (!config.ok || !provider.ok) throw new Error("incomplete fixture");
    const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(url, init);
      requests.push({ url: request.url, headers: request.headers, body: await request.json() });
      return Response.json({
        id: "fixture",
        object: "chat.completion",
        created: 1,
        model: modelId,
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });
    const adapter = new AiSdkModelAdapter({ env: {}, retry: { maxAttempts: 1 } });
    const model = adapter.createModel({
      providerId: "fixture",
      modelId,
      modelConfig: config.config,
      providerConfig: provider.config,
      options: { reasoningLevel: "high", maxOutputTokens: 4096 },
    });
    await model.generateText({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [
        {
          name: "Read",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
      ],
    });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(new URL(request!.url).origin).toBe("https://api.aimlapi.com");
    expect(new URL(request!.url).pathname).toBe("/v1/chat/completions");
    expect(request!.headers.get("authorization")).toBe("Bearer aiml-fixture-key");
    // 不附带归因或合作方头：只有 OpenRouter 有专属 Header。
    expect([...request!.headers.keys()].filter((key) => /aimlapi|openrouter/i.test(key))).toEqual(
      [],
    );
    expect(request!.body).toMatchObject({
      model: modelId,
      reasoning_effort: "high",
      max_tokens: 4096,
    });
    // 通用 Chat 映射会发送 thinking.type=disabled / effort=none，AI/ML API 会以 400 拒绝。
    expect(request!.body).not.toHaveProperty("thinking");
    expect(request!.body).not.toHaveProperty("reasoning");
    expect(request!.body.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "function" })]),
    );
  });

  it("跨源重定向时用户 Key 不随请求转发到其他主机", async () => {
    const release = await loadRelease("zcode-builtin.json");
    const modelId = "deepseek/deepseek-v4-flash";
    const config = createRegistryModelConfig(
      release.config.modelConfigRules.resolve({
        providerId: "fixture",
        templateId: TEMPLATE_ID,
        modelId,
        apiType: "openai-chat-completions",
        baseUrl: release.config.providerTemplates.get(TEMPLATE_ID)!.config.api!.baseUrl,
      }),
    );
    const provider = createRegistryProviderConfig(
      parseProviderConfig({
        group: "standard-personal",
        access: { type: "api-key", apiKey: "aiml-fixture-key" },
        api: { type: "openai-chat-completions", baseUrl: BASE_URL },
      }),
    );
    if (!config.ok || !provider.ok) throw new Error("incomplete fixture");
    const seen: { host: string; authorization: string | null }[] = [];
    const foreign = createServer((req, res) => {
      seen.push({ host: "foreign", authorization: req.headers.authorization ?? null });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "fixture",
          object: "chat.completion",
          created: 1,
          model: modelId,
          choices: [
            { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
    const origin = createServer((req, res) => {
      seen.push({ host: "origin", authorization: req.headers.authorization ?? null });
      const port = (foreign.address() as AddressInfo).port;
      res.writeHead(307, { location: `http://localhost:${port}/v1/chat/completions` });
      res.end();
    });
    await Promise.all(
      [foreign, origin].map((server) => new Promise<void>((done) => server.listen(0, done))),
    );
    const realFetch = globalThis.fetch;
    // 把 api.aimlapi.com 映射到本地源站，源站再 307 到另一个 Origin，复现跨主机重定向。
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(url, init);
      expect(new URL(request.url).host).toBe("api.aimlapi.com");
      const local = new URL(request.url);
      local.protocol = "http:";
      local.host = `127.0.0.1:${(origin.address() as AddressInfo).port}`;
      // 缓冲 body，307 重定向需要重放请求体。
      return realFetch(local, {
        method: request.method,
        headers: request.headers,
        body: await request.text(),
        signal: init?.signal,
      });
    });
    try {
      const adapter = new AiSdkModelAdapter({ env: {}, retry: { maxAttempts: 1 } });
      const model = adapter.createModel({
        providerId: "fixture",
        modelId,
        modelConfig: config.config,
        providerConfig: provider.config,
        options: { reasoningLevel: "low", maxOutputTokens: 256 },
      });
      await model.generateText({
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      });
    } finally {
      origin.close();
      foreign.close();
    }
    expect(seen).toEqual([
      { host: "origin", authorization: "Bearer aiml-fixture-key" },
      { host: "foreign", authorization: null },
    ]);
  });
});
