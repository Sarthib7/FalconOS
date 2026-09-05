# Codex CLI boundary

[VERIFIED, local inspection, 2026-09-05] This note records the installed Codex CLI controls that matter for P1-T07. It records no model call, authenticated call, paid call, credential read, or external post.

## MVP boundary

[INFERRED, MVP boundary] The first usable FalconOS MVP contains four results:

1. A Solana and Base collector with validated public quotes and durable raw evidence.
2. One cited thesis from the selected existing agent, using bounded Obsidian evidence.
3. One paper-cycle outcome with explicit synthetic balances or separately approved capital.
4. One review view that connects a candidate, its evidence, thesis, and paper outcome.

[INFERRED, later scope] Broader strategies, a third chain, live capital, signing, investor pooling, and execution remain later work. The MVP does not need wallet access or a live trade.

[VERIFIED, current records, 2026-09-05] The collector and ten-scan operating check have scoped evidence. The approved escalated watch completed ten scans with four valid quotes per scan. The historical use_default failure remains separate. The current records keep live failure diagnosis and runtime metadata revalidation open.

[REPORTED, current task board, 2026-09-05] P1-T06 and CHK-26 preparation are marked complete for the selected Codex CLI adapter. The synthetic request and response pass the structural check. No real agent thesis run exists.

[VERIFIED, current records, 2026-09-05] P1-T07 still needs the actual bounded adapter path. A paper-cycle outcome and a usable review view also have no implemented acceptance result. Obsidian desktop rendering remains an open CP1A item.

## Installed CLI surface

[VERIFIED, local command, 2026-09-05] The executable path is /Users/sarthiborkar/.local/bin/codex. Version output was:

~~~text
codex-cli 0.153.4
~~~

## Model and reasoning identifiers

[VERIFIED, codex debug models --bundled, 2026-09-05] The bundled catalog contains 11 model entries. The entry for the selected Codex adapter is:

~~~json
{"slug":"gpt-5.6-luna","display_name":"GPT-5.6-Luna","default_reasoning_level":"medium","supported_reasoning_levels":["low","medium","high","xhigh","max"]}
~~~

[VERIFIED, codex exec --help, 2026-09-05] The command help exposes --model <MODEL>, but it does not list --reasoning-effort or --reasoning-level. The generic -c, --config <key=value> override exists. This inspection did not confirm the configuration key for reasoning effort.

[VERIFIED, local binary inspection, 2026-09-05] The compiled binary contains these reasoning field names:

~~~text
$ strings /Users/sarthiborkar/.codex/packages/standalone/current/bin/codex | rg -o 'model_reasoning_effort|plan_mode_reasoning_effort|default_subagent_reasoning_effort' | sort -u
default_subagent_reasoning_effort
model_reasoning_effort
plan_mode_reasoning_effort
~~~

[INFERRED, model boundary] The selected local catalog is positive capability evidence for max, and the executable contains model_reasoning_effort as a configuration field. A model-free check did not show the effective runtime configuration. Treat -c model_reasoning_effort=max as an unverified candidate override. Do not silently downgrade the selected model or effort. Remote availability and account access remain unverified.

[VERIFIED, official OpenAI Codex configuration reference, retrieved 2026-09-05] The documented config key is model_reasoning_effort. Its documented values are:

~~~text
model_reasoning_effort: minimal | low | medium | high | xhigh
~~~

The public list does not include max. The local bundled catalog includes max for gpt-5.6-luna, so the public and local lists differ. The omission does not establish that max is unsupported for the selected local model. Runtime acceptance and application remain untested. Do not silently downgrade the selected model or effort.

[VERIFIED, codex exec --help, 2026-09-05] The installed help accepts these controls:

~~~text
--model <MODEL>
-s, --sandbox <SANDBOX_MODE>
-C, --cd <DIR>
--add-dir <DIR>
--skip-git-repo-check
--ephemeral
--ignore-user-config
--ignore-rules
--output-schema <FILE>
-o, --output-last-message <FILE>
--json
~~~

The help describes sandbox as: "Select the sandbox policy to use when executing model-generated shell commands." This scope is the child command path. It does not prove a network or tool boundary for model transport.

[VERIFIED, codex exec --help, 2026-09-05] The help describes the isolation controls as follows:

~~~text
--ephemeral
    Run without persisting session files to disk
--ignore-user-config
    Do not load $CODEX_HOME/config.toml; auth still uses CODEX_HOME
--ignore-rules
    Do not load user or project execpolicy .rules files
--output-schema <FILE>
    Path to a JSON Schema file describing the model's final response shape
--output-last-message <FILE>
    Specifies file where the last message from the agent should be written
~~~

[VERIFIED, codex sandbox --help, 2026-09-05] The separate codex sandbox command accepts:

~~~text
--sandbox-state-disable-network
    Disable direct network access in the supplied sandbox state
--sandbox-state-readable-root <SANDBOX_STATE_READABLE_ROOT>
    Add a readable root to the supplied sandbox state
~~~

[INFERRED, process boundary] The installed codex exec help has no direct network-deny flag. The official config controls and the named read-only profile provide the child boundary. A process-wide network deny could still block a remote model transport, so the adapter must keep that transport test separate.

[VERIFIED, child authority] The named :read-only profile denies direct child writes and direct child network access in the local probe below. Built-in tools beyond this direct child path remain untested. The adapter must omit extra writable directories and must use a separate empty working directory.

[VERIFIED, official OpenAI Codex security documentation, retrieved 2026-09-05] The official docs state that the agent starts with network access turned off. They define the safe read-only CLI combination as --sandbox read-only --ask-for-approval on-request and state that network access then requires approval. The config reference lists sandbox_mode values read-only, workspace-write, and danger-full-access. It lists sandbox_workspace_write.network_access as the workspace-write network switch.

~~~text
"By default, the agent runs with network access turned off."
"Codex requires approval to make edits, run commands, or access network."
~~~

[INFERRED, scope of official controls] These network statements cover commands, scripts, and subprocesses spawned by the agent. They do not prove that model transport uses the same network policy. The direct child probe below confirms the read-only profile for this installed CLI.

## Sandbox state probe

[VERIFIED, local probe, 2026-09-05] The default nested sandbox could not start a canary process:

~~~text
$ codex sandbox /bin/echo canary
exit 71
sandbox-exec: sandbox_apply: Operation not permitted
~~~

[VERIFIED, local probe, 2026-09-05] The network-deny switch requires a supplied sandbox state:

~~~text
$ codex sandbox --sandbox-state-disable-network /bin/echo canary
exit 2
error: the following required arguments were not provided: --sandbox-state-json <JSON>
~~~

[VERIFIED, approved local probe, 2026-09-05] An empty state value was rejected before the canary ran:

~~~text
$ codex sandbox --sandbox-state-json '{}' --sandbox-state-disable-network /bin/echo canary
exit 1
Error: invalid --sandbox-state-json value: missing field permissionProfile at line 1 column 2
~~~

[VERIFIED, prior probe limit, 2026-09-05] The earlier state-JSON attempts did not reach a loopback canary. The nested default sandbox could not apply, and an empty state lacked permissionProfile. Do not construct a state value from user session or credential files.

[VERIFIED, approved local sandbox probe, 2026-09-05] A supported named profile then ran outside the nested sandbox. The probe used only owned files under /private/tmp and a server bound to 127.0.0.1:

~~~text
Support server output: READY 59621
$ codex sandbox --permission-profile :read-only -C /private/tmp/falconos-codex-sandbox-luna.hlswsg /Users/sarthiborkar/.nvm/versions/node/v25.2.1/bin/node probe.js
exit 0
{"read":"owned-canary\n","write":{"code":"EPERM","message":"EPERM: operation not permitted, open '/private/tmp/falconos-codex-sandbox-luna.hlswsg/write-attempt.txt'"},"loopback":{"code":"EPERM","name":"Error","message":"connect EPERM 127.0.0.1:59621 - Local (0.0.0.0:0)"}}
write-attempt.txt: absent
~~~

The child read the owned input, could not create the output, and could not connect to the loopback server. This verifies the :read-only child profile for file writes and direct network access. It does not test model transport.

[INFERRED, process recommendation] Use --permission-profile :read-only for the child process when the active profile is available. Use a separate empty working directory and omit additional writable roots. Keep the model transport test separate because no model call was authorized.

[INFERRED, authentication boundary] ignore-user-config prevents loading the Codex config file, but the help states that authentication still uses CODEX_HOME. A future adapter must pass a reviewed model choice and a sanitized environment. This task did not inspect credential files or test authentication.

## Smallest proposed invocation

[INFERRED, proposed adapter shape] The smallest documented command shape is:

~~~sh
codex exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --cd <empty-dir> --skip-git-repo-check --output-schema <schema-file> --output-last-message <response-file> --model gpt-5.6-luna -
~~~

The final hyphen reads the prompt from standard input. The adapter can send fixed instructions and the validated AgentRequest JSON through that stream. It should read only the response file as the thesis candidate. It should record exit status, stderr, response bytes, and timing.

[VERIFIED, parser check, 2026-09-05] The proposed argv shape passed the CLI parser when combined with --help:

~~~text
$ codex exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --cd /private/tmp --skip-git-repo-check --output-schema /private/tmp/falconos-missing-schema.json --output-last-message /private/tmp/falconos-missing-response.json --model gpt-5.6-luna --help
exit 0
~~~

This proves flag syntax only. It did not launch a model or validate the schema path.

[VERIFIED, help surface] The help also exposes dangerous approval and sandbox bypass flags. The proposed command excludes them. No model call used this command shape.

## Existing-agent handoff fallback

[INFERRED, fallback boundary] If a direct Codex model invocation cannot run, use a file handoff. The builder writes one validated AgentRequest JSON and its manifest into a dedicated temporary directory. The existing agent reads that request and writes one AgentThesis JSON to a dedicated response path. FalconOS then validates the response bytes, request ID, evidence hashes, source cutoff, expiry, citations, and authority fields. This keeps the application boundary reviewable without granting the existing agent wallet, signing, or execution authority.

## MVP requirements still open

[INFERRED, implementation boundary] P1-T07 must still:

1. Validate bundle paths, IDs, schema, source cutoff, hashes, expiry, and untrusted notes.
2. Invoke the selected executable with a reviewed model and sanitized environment.
3. Capture one final JSON response and reject invalid request IDs, citations, hashes, expiry, or status.
4. Store one cited thesis, one paper-cycle outcome, and one reviewable link path.

[VERIFIED, local process evidence] The named :read-only profile test covers reading an owned file, a denied child write, and a denied loopback connection. It does not cover built-in tools or model transport.

[INFERRED, unresolved MVP evidence] The remaining CLI integration gap is effective reasoning configuration, the real model response, and any built-in tools that the adapter would expose. A synthetic fixture cannot establish those paths. A real model call also needs separate authorization.

[VERIFIED, record inconsistency, 2026-09-05] CONTEXT.md still says the ten-scan operating check is running. The final status and plan records say CHK-09 is complete under the approved escalated context. docs/agent-contract.md still says CHK-26 needs a root controlled check, while the current task board marks its preparation complete. Root should synchronize those older statements in a later records pass.

[VERIFIED, record inconsistency, 2026-09-05] plans/roadmap.md D4 still says "Prefer the flight-path mark." docs/brand-brief.md records Alpine Vector as the selected direction. Root should update the current roadmap wording without removing the earlier flight-path history.

## Records used

[VERIFIED, repository read, 2026-09-05] The MVP boundary and open task state use the [context record](../../CONTEXT.md), the [task board](../../plans/tasks.md#p1b-one-existing-agent-uses-graph-evidence), and the [agent contract](../agent-contract.md).

[VERIFIED, official documentation read, 2026-09-05] The CLI configuration and child network findings use the [Codex configuration reference](https://developers.openai.com/codex/config-reference/), [agent approvals and security](https://developers.openai.com/codex/agent-approvals-security), and [sandboxing](https://developers.openai.com/codex/sandboxing).

## Least confident decisions

1. [INFERRED] A local Codex CLI process is the smallest first agent boundary.
2. [INFERRED] An OS process policy can separate child network authority from remote model transport.
3. [INFERRED] A synthetic paper cycle is sufficient for the first usable MVP before capital ownership is decided.
