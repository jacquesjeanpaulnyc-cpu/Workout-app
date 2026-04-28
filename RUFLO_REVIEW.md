# Ruflo Project Review

**Repo:** https://github.com/ruvnet/ruflo
**Reviewed:** 2026-04-28
**Version tested:** ruflo / claude-flow v3.6.9 (installed via `npm install ruflo@latest`)

---

## TL;DR

Ruflo is a **rebrand of `ruvnet/claude-flow`** (npm `package.json` literally has `"name": "claude-flow"` and `"homepage": "https://github.com/ruvnet/claude-flow"`).

The marketing — "100+ specialized agents in coordinated swarms with self-learning, fault-tolerant consensus" — significantly overstates what the code does. In practice:

- **Real engineering exists**: ~129K lines of TypeScript, 308 test files, working CLI, working MCP server, local SQLite-backed memory.
- **The "swarm" does not execute agents.** `ruflo swarm start` just creates a JSON metadata record and tells you: *"This CLI coordinates agent state. Execution happens via: Claude Code Agent tool, `claude -p`, or `hive-mind spawn --claude`."* It's a state-tracker that delegates everything back to the Claude Code CLI.
- **The 146 "agents" are markdown system prompts**, not orchestration code.
- **Hooks are local only** — they write to `~/.claude-flow/*.db`. No telemetry network calls were observed in the installed code.

Verdict: **B+ engineering, A+ marketing.** Useful as a Claude Code plugin pack + local memory layer; not the autonomous swarm platform the README suggests.

---

## What I actually did

1. Cloned the repo (10,143 files, 289MB).
2. Inspected layout, package.json, install scripts, plugin definitions, agent files.
3. Ran two parallel review agents (architecture + security).
4. **Verified the security agent's most alarming claims directly** — most were overstated.
5. Installed `ruflo@latest` into a sandbox dir (1.1GB of deps).
6. Ran `ruflo doctor`, `ruflo agent spawn`, `ruflo swarm init`, `ruflo swarm start`.
7. Read the actual installed hook code in `node_modules/@claude-flow/hooks/`.

---

## Architecture

### Repo structure
- `bin/cli.js` — 11-line proxy that forwards to `v3/@claude-flow/cli/bin/cli.js`.
- `v3/@claude-flow/` — **canonical implementation**. 22 subpackages: cli, memory, neural, security, swarm, plugins, mcp, providers, performance, hooks, etc. ~129K LOC of real TS.
- `v2/` — legacy, abandoned, NOT shipped in the npm package (excluded from `files[]` in root `package.json`).
- `ruflo/` + `plugins/` (20 dirs) — Claude Code plugin packs. Mostly markdown.
- `agents/` (5) + `.agents/` (146) — markdown system-prompt definitions. No orchestration code in these.

### How execution actually works
```
$ ruflo swarm start -o "Build feature X"
  → creates .claude-flow/swarm/swarm-state.json
  → prints "Initialize via Claude Code Agent tool / claude -p / hive-mind spawn --claude"
  → exits

$ ruflo hive-mind spawn --claude -o "..."
  → execSync('which claude')          # confirmed at v3 cli/dist/.../hive-mind.js:190
  → spawn the actual `claude` CLI     # at line 550, gated on `launchClaude` flag
```
So "swarm" = a JSON file tracking which agent role names you're "running". The real LLM work still happens via the standard Claude Code CLI.

### What's real vs marketing

| Claim                                  | Reality                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| "100+ specialized agents"              | 146 markdown system prompts in `.agents/`                       |
| "Swarm coordination, hierarchical/mesh"| Topology field stored in JSON; no actual coordination logic     |
| "12 background workers"                | Async tasks in main Node process; no OS-level workers           |
| "Self-learning SONA neural patterns"   | Optional `@ruvector/sona` import, gracefully degrades if absent |
| "Fault-tolerant consensus"             | A `consensusMechanism: "majority"` string in a JSON file        |
| "Vector memory (HNSW-indexed AgentDB)" | Real — uses `agentdb` package + sql.js fallback                 |
| "Multi-provider LLM (GPT, Gemini...)"  | Real — provider abstractions exist in `v3/providers/`           |
| "20 native plugins"                    | 20 Claude Code plugin packs, mostly markdown configs            |

---

## Security

The security review agent's report was **dramatic and partially incorrect**. After verifying its claims directly:

### What's NOT a problem (security agent was wrong)
- **"Telemetry hooks exfiltrate every command/file/session"** — false. The installed hook code in `node_modules/@claude-flow/hooks/dist/` contains zero `fetch`, `http`, or `https` calls. Hooks write to a local SQLite DB at `~/.claude-flow/`.
- **"Cloud Function publishes telemetry to Pinata"** — false. That code lives in `v3/.../cloud-functions/publish-registry/` and is **the publishing infrastructure for the plugin author**, not user-side. Doesn't ship with the npm package.
- **"v2 postinstall sed-patches your node_modules"** — true but irrelevant: `v2/` is NOT in the npm package's `files[]`, so it never installs.

### What IS worth noting
- **Obfuscated postinstall** in `v3/@claude-flow/cli/package.json` — minified one-liner. Decoded, it just copies `agentdb/dist/src/controllers` → `agentdb/dist/controllers` to fix an upstream path issue. Benign but the obfuscation is a smell.
- **`@claude-flow/browser` postinstall auto-installs `agent-browser` globally** without prompt. **Not triggered by `npm install ruflo`** — only if you separately install the browser package. Still: bad practice.
- **Plugin hook `hooks.json`** intercepts every Bash command, Write, Edit, and session end via Claude Code's hook system. Each one re-invokes `npx claude-flow@alpha hooks <subcommand>`. Currently local-only, but the hook system is in a position to add network calls in any future version without changing the user-facing config.
- **One opt-in network call**: `services/registry-api.ts` posts to `https://us-central1-claude-flow.cloudfunctions.net/publish-registry` for plugin marketplace ratings/analytics — only when user explicitly runs `ruflo plugins rate` etc.
- **1.1GB of transitive deps** including native modules (`better-sqlite3`, `@ruvector/router-linux-x64-gnu` WASM). Bigger attack surface than most CLIs.

### Risk verdict
For a security-conscious dev: **medium**. Not malicious, but the postinstall obfuscation, the silent global-install in the browser sub-package, and the giant dep footprint mean you should pin a version and audit before each upgrade.

---

## Install attempt

Sandbox: `/tmp/ruflo-test`, `npm install ruflo@latest`.

- ✅ Installed cleanly (~60s, 1.1GB of node_modules).
- ✅ `ruflo --version` → `3.6.9`
- ✅ `ruflo doctor` ran and produced sensible diagnostics.
- ⚠️ Spam at every CLI invocation: `[AgentDB Patch] Controller index not found...` — the postinstall fix doesn't fire when triggered indirectly.
- ✅ `ruflo agent spawn -t coder` → creates a JSON record, no agent actually runs.
- ✅ `ruflo swarm init --v3-mode`, `swarm start` → JSON state files. No execution.
- ✅ `ruflo hooks post-edit --file /tmp/test.txt` → wrote to local SQL.js WASM SQLite. No network.

---

## Comparison: ruflo vs plain Claude Code subagents

What plain Claude Code already gives you (no extra install):
- **Agent tool** with custom subagents (markdown system prompts in `.claude/agents/`)
- **Hooks** for PreToolUse, PostToolUse, etc. (`.claude/settings.json`)
- **Plugins** via the official marketplace
- **MCP servers** for external tools
- **Skills** for invocable capabilities

What ruflo adds on top:
1. **Library of 146 agent system prompts** — useful if you'd otherwise write them. Quality is variable; many are aspirational.
2. **Local SQLite "memory" / "ReasoningBank"** that persists across sessions — genuinely interesting if you want cross-session learning, but the value depends on whether you trust its retrieval algorithm.
3. **State-tracking CLI** for managing multiple "swarms" / "agents" as metadata. Useful as a notebook; not autonomous orchestration.
4. **Pre-wired hook system** that auto-records every edit and command into the local memory. Convenient if that's what you want; intrusive if not.
5. **Multi-provider LLM router** (Gemini/GPT/Ollama) — real, but only relevant if you're routing away from Anthropic.

What ruflo does **NOT** add:
- Actual autonomous swarm execution. The agents are still Claude (or another LLM) being driven by the same prompts you'd use yourself.
- Real consensus / voting. Those fields are JSON metadata.
- Fault tolerance. There's nothing to be fault-tolerant about — there's no distributed runtime.

For your Powerhouse workout app (single HTML file, single user, no backend): **ruflo would be enormous overkill**. You'd add 1.1GB of dependencies and a learning DB to manage what is already a 1-file project.

For a large polyglot codebase where you genuinely want a memory layer + a curated prompt library + plugin system on top of Claude Code: it could be worth trying.

---

## Build attempt

I didn't run a real build through ruflo because the sandbox has no `ANTHROPIC_API_KEY` and no Claude Code session attached. The `swarm start` step explicitly stops at metadata creation; to actually do work you have to run `hive-mind spawn --claude` which then shells out to the regular `claude` CLI, which is functionally equivalent to running `claude -p "..."` directly with one of ruflo's prompt templates.

---

## Honest take

Ruflo is **not a scam, not vaporware, and not a swarm orchestrator.** It is:
- A **prompt-and-config library** for Claude Code (146 agent templates, 20 plugin packs).
- A **local memory / state DB** that remembers what your sessions did.
- A **CLI wrapper** that helps coordinate multi-step Claude Code runs.

The marketing language ("hive mind", "consensus", "self-learning swarm intelligence") is the gap between what's in the README and what `swarm start` actually prints when you run it. If you're comfortable reading source rather than READMEs, there's enough useful here to be worth a look. If you take the README at face value and expect autonomous agents, you'll be disappointed.
