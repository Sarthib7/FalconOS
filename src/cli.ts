import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoCycles } from './demo.ts';
import { createScan, inputAmount } from './scan.ts';
import { collectCycles } from './sources.ts';
import {
  buildAgentRequest,
  createAgentRun,
  type AgentOrigin,
  type AgentRoute,
  type AgentTransport,
} from './agent.ts';
import { exportScan, exportThesis } from './vault.ts';

const HELP = `FalconOS quote research

node src/cli.ts demo                         Synthetic scan, no network
node src/cli.ts scan --amount 100            One live Solana/Base scan
node src/cli.ts watch --interval 300         Repeat live scans until Ctrl+C
node src/cli.ts thesis --evidence runs/<id>.json --evidence-sha256 <hash> --route base-solana --task "..." --agent fixture

Options:
  --amount <USDC>      0.01 to 500, up to six decimal places (default 100)
  --data <directory>   Evidence root (default ./data)
  --vault <directory>  Obsidian vault (default ./data/vault)
  --interval <sec>     Delay after each watch cycle, minimum 60 (default 300)
  --cycles <number>    Stop watch after this many cycles (default unlimited)
  --evidence <path>    Evidence JSON relative to --data (thesis only)
  --evidence-sha256 <hash>  Caller-provided evidence hash (thesis only)
  --route <route>      solana-base or base-solana (thesis only)
  --task <text>        Bounded research task (thesis only)
  --note <path>        Untrusted note relative to --data, repeatable
  --cutoff <time|now>  UTC source cutoff (default now)
  --agent <name>       fixture or codex (thesis only)
  --help              Show this help

Live mode sends public token IDs and sizes to Jupiter and KyberSwap.
No wallet, taker, signing, transaction submission, or paid model calls.
JSON output contains results and paths to the complete evidence.
`;

function wholeNumber(value: string, name: string, min: number, max: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return number;
}

export interface CliDependencies {
  collectCycles?: typeof collectCycles;
  exportScan?: typeof exportScan;
  buildAgentRequest?: typeof buildAgentRequest;
  createAgentRun?: typeof createAgentRun;
  exportThesis?: typeof exportThesis;
  agentTransport?: AgentTransport;
  now?: () => Date;
  pause?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

export async function runCli(argv: readonly string[] = process.argv.slice(2), dependencies: CliDependencies = {}): Promise<number> {
  const {values, positionals} = parseArgs({args: [...argv], allowPositionals: true, strict: true, options: {
    amount: {type: 'string', default: '100'}, data: {type: 'string', default: './data'},
    vault: {type: 'string'}, interval: {type: 'string', default: '300'}, cycles: {type: 'string'},
    evidence: {type: 'string'}, 'evidence-sha256': {type: 'string'}, route: {type: 'string'},
    task: {type: 'string'}, note: {type: 'string', multiple: true}, cutoff: {type: 'string', default: 'now'},
    agent: {type: 'string'},
    help: {type: 'boolean', default: false},
  }});
  if (values.help || positionals.length === 0) { console.log(HELP); return 0; }
  const [command] = positionals;
  if (positionals.length !== 1 || !['demo', 'scan', 'watch', 'thesis'].includes(command ?? '')) throw new Error('Use demo, scan, watch, or thesis. See --help.');
  if (command !== 'watch' && (values.cycles !== undefined || values.interval !== '300')) throw new Error('--cycles and --interval require watch');
  const thesisOptions = [values.evidence, values['evidence-sha256'], values.route, values.task, values.agent].some(value => value !== undefined)
    || (values.note?.length ?? 0) > 0 || values.cutoff !== 'now';
  if (command !== 'thesis' && thesisOptions) throw new Error('Thesis options require the thesis command');
  if (command === 'thesis') {
    if (values.evidence === undefined || values['evidence-sha256'] === undefined || values.route === undefined
      || values.task === undefined || values.agent === undefined) {
      throw new Error('Thesis requires --evidence, --evidence-sha256, --route, --task, and --agent');
    }
    const route = values.route;
    if (route !== 'solana-base' && route !== 'base-solana') throw new Error('Route must be solana-base or base-solana');
    const agent = values.agent;
    if (agent !== 'fixture' && agent !== 'codex') throw new Error('Agent must be fixture or codex');
    if (agent === 'codex' && dependencies.agentTransport === undefined) {
      throw new Error('Codex agent is disabled until approval and web-search controls are verified');
    }
    const now = dependencies.now ?? (() => new Date());
    const build = dependencies.buildAgentRequest ?? buildAgentRequest;
    const run = dependencies.createAgentRun ?? createAgentRun;
    const publish = dependencies.exportThesis ?? exportThesis;
    const controller = dependencies.signal ? undefined : new AbortController();
    const signal = dependencies.signal ?? controller!.signal;
    const stop = () => controller?.abort();
    if (controller) {
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    }
    try {
      signal.throwIfAborted();
      const bundle = await build({
        dataDirectory: values.data,
        evidencePath: values.evidence,
        expectedEvidenceSha256: values['evidence-sha256'],
        notePaths: values.note,
        route: route as AgentRoute,
        task: values.task,
        cutoff: values.cutoff,
        now,
      });
      signal.throwIfAborted();
      const transport = agent === 'codex' ? dependencies.agentTransport : undefined;
      const record = await run(bundle, agent as AgentOrigin, transport, signal, now);
      const paths = await publish(record, values.data, values.vault ?? resolve(values.data, 'vault'));
      console.log(JSON.stringify({
        requestId: record.request.requestId,
        origin: record.origin,
        fixture: record.response.fixture,
        route: record.response.route,
        status: record.response.status,
        evidencePath: record.request.evidence[0]!.path,
        evidenceSha256: record.request.evidence[0]!.sha256,
        ...(record.execution === undefined ? {} : {execution: record.execution}),
        ...paths,
      }));
      return 0;
    } catch (error) {
      if (!signal.aborted) throw error;
      console.error('Stopped. No thesis was accepted.');
      return 0;
    } finally {
      if (controller) {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
      }
    }
  }
  const amount = inputAmount(values.amount);
  const interval = wholeNumber(values.interval, 'Interval', 60, 86_400);
  const cycles = values.cycles === undefined ? Infinity : wholeNumber(values.cycles, 'Cycles', 1, 100_000);
  const collect = dependencies.collectCycles ?? collectCycles;
  const exportEvidence = dependencies.exportScan ?? exportScan;
  const now = dependencies.now ?? (() => new Date());
  const pause = dependencies.pause ?? (async (milliseconds: number, signal?: AbortSignal) => {
    await sleep(milliseconds, undefined, {signal});
  });
  const controller = dependencies.signal ? undefined : new AbortController();
  const signal = dependencies.signal ?? controller!.signal;
  const stop = () => controller?.abort();
  if (controller) {
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
  let consecutiveFailures = 0;
  let exitCode = 0;
  try {
    let completed = 0;
    do {
      signal.throwIfAborted();
      const demoNow = command === 'demo' ? now() : undefined;
      const observations = command === 'demo' ? demoCycles(amount, demoNow)
        : await collect(amount, {signal});
      const assessedAt = demoNow ?? now();
      const scan = createScan(observations, command === 'demo' ? 'demo' : 'live', assessedAt);
      const paths = await exportEvidence(scan, values.data, values.vault ?? resolve(values.data, 'vault'));
      const failed = scan.candidates.some(candidate => candidate.status === 'UNAVAILABLE');
      console.log(JSON.stringify({
        id: scan.id, mode: scan.mode, assessedAt: scan.assessedAt,
        amountScale: scan.amountScale,
        coverage: {pair: 'USDC/EURC', chains: ['solana', 'base'], providers: ['jupiter', 'kyberswap'],
          validQuotes: observations.flatMap(c => c.legs).filter(leg => leg.quote !== null).length,
          expectedQuotes: 4, complete: !failed},
        candidates: scan.candidates, ...paths,
      }));
      completed++;
      consecutiveFailures = failed ? consecutiveFailures + 1 : 0;
      if (command !== 'watch') { if (failed) exitCode = 2; break; }
      if (consecutiveFailures >= 3) {
        console.error('Stopped after three consecutive incomplete scans. Check recorded source errors before restarting.');
        exitCode = 2;
        break;
      }
      if (completed >= cycles) {
        if (failed) exitCode = 2;
        break;
      }
      await pause(interval * 1000, signal);
    } while (!signal.aborted);
  } catch (error) {
    if (!signal.aborted) throw error;
    console.error('Stopped. Completed evidence records remain on disk.');
  } finally {
    if (controller) {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error instanceof Error ? error.message : 'Scan failed');
    process.exitCode = 1;
  });
}
