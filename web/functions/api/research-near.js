import { handleResearchNear } from './_research-mcp.mjs';

export function onRequest(context) {
  return handleResearchNear(context.request);
}
