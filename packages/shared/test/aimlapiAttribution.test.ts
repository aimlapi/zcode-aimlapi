import assert from "node:assert/strict";
import test from "node:test";
import {
  AIMLAPI_ATTRIBUTION_HEADERS,
  isAimlapiBaseUrl,
  withAimlapiAttributionHeaders,
} from "../src/aimlapi-attribution.js";

test("partner id and source are in the shape the gateway accepts", () => {
  assert.match(AIMLAPI_ATTRIBUTION_HEADERS["X-AIMLAPI-Partner-ID"], /^part_[A-Za-z0-9_]{1,64}$/);
  assert.match(
    AIMLAPI_ATTRIBUTION_HEADERS["X-AIMLAPI-Source"],
    /^(web|agent|mcp)\/[a-z0-9-]{1,32}$/,
  );
  assert.equal(AIMLAPI_ATTRIBUTION_HEADERS["X-Title"], "ZCode");
});

test("only the exact api.aimlapi.com host over https counts", () => {
  assert.equal(isAimlapiBaseUrl("https://api.aimlapi.com/v1"), true);
  assert.equal(isAimlapiBaseUrl("https://API.AIMLAPI.COM"), true);
  assert.equal(isAimlapiBaseUrl("http://api.aimlapi.com/v1"), false);
  assert.equal(isAimlapiBaseUrl("https://api.aimlapi.com.evil.io/v1"), false);
  assert.equal(isAimlapiBaseUrl("https://aimlapi.com/v1"), false);
  assert.equal(isAimlapiBaseUrl("https://proxy.example/api.aimlapi.com/v1"), false);
  assert.equal(isAimlapiBaseUrl(undefined), false);
  assert.equal(isAimlapiBaseUrl("not a url"), false);
});

test("headers ride requests to the gateway and nothing else", () => {
  const base = { "X-Existing": "1" };
  const withHeaders = withAimlapiAttributionHeaders(base, "https://api.aimlapi.com/v1");
  assert.equal(withHeaders["X-Existing"], "1");
  assert.equal(withHeaders["X-AIMLAPI-Source"], "agent/zcode");
  assert.equal(
    withHeaders["X-AIMLAPI-Partner-ID"],
    AIMLAPI_ATTRIBUTION_HEADERS["X-AIMLAPI-Partner-ID"],
  );
  assert.strictEqual(withAimlapiAttributionHeaders(base, "https://openrouter.ai/api"), base);
  assert.strictEqual(withAimlapiAttributionHeaders(base, "https://proxy.example/aimlapi/v1"), base);
});

test("the shared table is never handed out or mutated", () => {
  const first = withAimlapiAttributionHeaders({}, "https://api.aimlapi.com/v1");
  first["X-AIMLAPI-Partner-ID"] = "mutated";
  assert.equal(
    withAimlapiAttributionHeaders({}, "https://api.aimlapi.com/v1")["X-AIMLAPI-Partner-ID"],
    AIMLAPI_ATTRIBUTION_HEADERS["X-AIMLAPI-Partner-ID"],
  );
});
