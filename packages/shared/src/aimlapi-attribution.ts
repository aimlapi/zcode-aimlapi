// AI/ML API (aimlapi.com) 的归因头。partner id 由 AI/ML API 为 ZCode 签发，
// X-AIMLAPI-Source 标记流量来源；HTTP-Referer / X-Title 说明调用方是 ZCode。
// 这些头只对 api.aimlapi.com 有意义：主机必须精确匹配，前置代理或相似域名一律不带。
export const AIMLAPI_ATTRIBUTION_HEADERS = {
  "HTTP-Referer": "https://github.com/zai-org/ZCode",
  "X-Title": "ZCode",
  "X-AIMLAPI-Partner-ID": "part_T2hR1Ms6R0yufWHxz7PQ15R7",
  "X-AIMLAPI-Source": "agent/zcode",
} as const;

export function isAimlapiBaseUrl(baseUrl: string | undefined): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "api.aimlapi.com";
  } catch {
    return false;
  }
}

export function withAimlapiAttributionHeaders(
  headers: Record<string, string>,
  baseUrl: string | undefined,
): Record<string, string> {
  if (!isAimlapiBaseUrl(baseUrl)) {
    return headers;
  }
  return {
    ...headers,
    ...AIMLAPI_ATTRIBUTION_HEADERS,
  };
}
