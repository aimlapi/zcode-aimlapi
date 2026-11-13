// Run: pnpm exec tsx --test packages/ui/test/mcpServerPresets.test.ts
// (packages/ui unit tests are not in any upstream runner since the App unit-test chain was retired.)
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMcpServerPreset,
  EMPTY_FORM,
  formToConfig,
  formToJsonDraft,
  MCP_SERVER_PRESETS,
  type FormState,
} from "../src/settings/mcpSettingsShared.js";

const aimlapi = () => {
  const preset = MCP_SERVER_PRESETS.find((p) => p.id === "aimlapi");
  assert.ok(preset, "AI/ML API preset is listed");
  return preset;
};

test("the AI/ML API preset is the hosted Streamable HTTP server on the exact host", () => {
  const preset = aimlapi();
  assert.equal(preset.label, "AI/ML API");
  assert.deepEqual(preset.form, {
    name: "aimlapi",
    type: "http",
    url: "https://mcp.aimlapi.com/mcp",
  });
  const url = new URL(preset.form.url);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "mcp.aimlapi.com");
  assert.match(preset.docsUrl, /^https:\/\/docs\.aimlapi\.com\//);
});

test("applying it on an empty draft yields a saveable http config with no credentials", () => {
  const form = applyMcpServerPreset({ ...EMPTY_FORM }, aimlapi());
  assert.deepEqual(JSON.parse(JSON.stringify(formToConfig(form))), {
    type: "http",
    url: "https://mcp.aimlapi.com/mcp",
  });
  assert.deepEqual(JSON.parse(formToJsonDraft(form)), {
    aimlapi: { type: "http", url: "https://mcp.aimlapi.com/mcp" },
  });
});

test("a credential typed for another server never rides along to the gateway", () => {
  const dirty: FormState = {
    ...EMPTY_FORM,
    name: "other",
    type: "stdio",
    command: "npx",
    args: "-y some-server",
    env: '{"OTHER_KEY":"secret"}',
    url: "https://other.example/mcp",
    headers: '{"Authorization":"Bearer other-token"}',
    oauth: '{"clientId":"other"}',
  };
  const form = applyMcpServerPreset(dirty, aimlapi());
  assert.equal(form.headers, "");
  assert.equal(form.env, "");
  assert.equal(form.oauth, "");
  assert.equal(form.command, "");
  assert.equal(form.args, "");
  assert.doesNotMatch(JSON.stringify(formToConfig(form)), /other|secret|Bearer/);
});

test("where the user chose to store it and their timeout survive the preset", () => {
  const form = applyMcpServerPreset(
    { ...EMPTY_FORM, storageLevel: "workspace", timeoutMs: "90000", protocolVersion: "legacy" },
    aimlapi(),
  );
  assert.equal(form.storageLevel, "workspace");
  assert.equal(form.scope, "zcodeagentmcp");
  assert.equal(form.timeoutMs, "90000");
  assert.equal(form.protocolVersion, "legacy");
});

test("the preset object is not mutated by applying it", () => {
  const preset = aimlapi();
  const form = applyMcpServerPreset({ ...EMPTY_FORM }, preset);
  form.url = "https://changed.example";
  assert.equal(preset.form.url, "https://mcp.aimlapi.com/mcp");
});
