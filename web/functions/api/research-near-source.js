import { handleResearchNearSource } from './_research-mcp.mjs';

export function onRequest(context) {
  return handleResearchNearSource(context.request);
}
