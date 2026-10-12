import { createHash } from 'node:crypto';
import { renderSkill } from '../bot/install-commands.mjs';

export const SKILL_VERSION = '0.3.0';
export const REQUIRED_MCP_VERSION = '0.3.0';
export const CANONICAL_SKILL_URL = 'https://agents.falconos.markets/SKILLS.md';

function artifact(body, contentType, hashHeader) {
  const digest = createHash('sha256').update(body, 'utf8').digest();
  return Object.freeze({
    body,
    sha256: digest.toString('hex'),
    headers: Object.freeze({
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Content-Digest': 'sha-256=:' + digest.toString('base64') + ':',
      [hashHeader]: digest.toString('hex'),
      'X-Content-Type-Options': 'nosniff',
    }),
  });
}

function pagesHeaderLines(path, asset) {
  return [path, ...Object.entries(asset.headers).map(([name, value]) => '  ' + name + ': ' + value)].join('\n');
}

export function renderSkillsRelease(template, options) {
  const skill = artifact(renderSkill(template, options), 'text/markdown; charset=utf-8', 'X-Falcon-Skill-SHA256');
  const manifestBody = JSON.stringify({
    version: SKILL_VERSION,
    requiredMcpVersion: REQUIRED_MCP_VERSION,
    canonicalSkillUrl: CANONICAL_SKILL_URL,
    sha256: skill.sha256,
  }, null, 2) + '\n';
  const manifest = artifact(manifestBody, 'application/json; charset=utf-8', 'X-Falcon-Skill-Manifest-SHA256');
  const pagesHeaders = [
    pagesHeaderLines('/SKILLS.md', skill),
    pagesHeaderLines('/SKILLS.manifest.json', manifest),
    '',
  ].join('\n');
  return Object.freeze({ skill, manifest, pagesHeaders });
}