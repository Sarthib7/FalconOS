import { handleResearchNearReplay } from './_research-mcp.mjs';

export function onRequest(context) {
  return handleResearchNearReplay(context.request);
}
