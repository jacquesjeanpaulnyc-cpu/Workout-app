# MiroFish Project Review

**Repo:** https://github.com/666ghj/MiroFish
**Reviewed:** 2026-04-28
**Version:** 0.1.2 (March 2026), AGPL-3.0
**Stack:** Flask (Python 3.11+) + Vue 3 + OASIS (CAMEL-AI) + Zep Cloud + Qwen-plus LLM

---

## TL;DR

MiroFish bills itself as a "**swarm intelligence engine** that constructs a **high-fidelity parallel digital world** where thousands of agents undergo social evolution to predict the future." That language sets a very high bar.

What's actually in the repo:

- **A 3-week-old project with 1 commit total** (first and only commit: `2026-04-02`).
- **58K+ GitHub stars**, 9K+ forks, 381 watchers — **for a single-commit repo**. Almost certainly inorganic.
- **A clean Flask+Vue glue layer** around three external systems that do all the actual work:
  - **OASIS / CAMEL-AI** runs the multi-agent simulation.
  - **Zep Cloud** runs the knowledge graph + memory + retrieval.
  - **Qwen-plus** (or any OpenAI-compatible LLM) generates ontologies, agent personas, and report text.
- **No authentication, no rate limiting, permissive CORS, stack traces in JSON error responses, Docker as root** — clear self-host security gaps.

**Verdict:** Decent engineering for a glue project, but the README's claims wildly outrun the code. The star count is the most obvious red flag.

---

## Headline red flag: stars don't match reality

```bash
$ git log --oneline | wc -l
1
$ git log --reverse --format='%ai %s' | head -1
2026-04-02 16:51:30 +0800  docs: rename README-EN.md to README.md
```

One commit. 26 days old at time of review. The repo claims 58K+ stars on the README badge.

For comparison: a project this size + age would normally have under 100 stars unless it had a massive launch (HN front page, viral X thread, aggressive Trendshift placement). The README does include a Trendshift badge (`trendshift.io/repositories/16144`), so paid visibility is likely a factor, but Trendshift alone doesn't produce 58K stars.

Likely combination: paid promotion + corporate backing (Shanda Group is named) + some form of stargazer farming or coordinated boosting. Don't use star count as a signal of quality here.

---

## What it actually does (architecture review)

Standard 5-step web app pipeline, each step is a thin wrapper around an external service:

| Step | MiroFish file | Real engine |
| ---- | ------------- | ----------- |
| 1. Ontology extraction | `services/ontology_generator.py` (506 LOC) | LLM prompt to Qwen — "extract entity types from this text" |
| 2. Graph build | `services/graph_builder.py` (506 LOC) | **Zep Cloud `create_graph_from_documents`** does the real GraphRAG; MiroFish does chunking + task tracking |
| 3. Persona generation | `services/oasis_profile_generator.py` (1,205 LOC) | LLM prompt per entity → JSON persona |
| 4. Multi-agent simulation | `services/simulation_runner.py` spawns `scripts/run_twitter_simulation.py` | **OASIS (`from camel.models import ModelFactory`)** runs the actual agent loop; MiroFish reads `actions.jsonl` |
| 5. Report writing | `services/report_agent.py` (2,572 LOC) | LLM with a small ReACT loop calling Zep search + LLM synthesis per section |

A simulation with 20 agents over 144 rounds = ~2,880 LLM calls per run. The .env.example warns "注意消耗较大" (consumption is high).

### What MiroFish actually contributes
- A coherent web UI for what would otherwise be a mess of Python scripts.
- Project / task / IPC bookkeeping (`simulation_ipc.py`).
- Chunking + ontology prompt design.
- A ReACT-style report orchestration that's nicer than just dumping the action log.

### What it does NOT contribute
- No custom GraphRAG (Zep is the engine).
- No custom multi-agent runtime (OASIS is the engine).
- No statistical analysis, clustering, or causal modeling — "report" is LLM summarization.
- No "thousands of agents" — typical configs are tens.
- No real "consensus" or "swarm intelligence" beyond OASIS doing what OASIS does.

So the marketing framing ("predict anything", "rehearse the future", "swarm intelligence engine") badly overstates a competent web wrapper around three vendors.

### Hard dependency on Zep Cloud
`zep_tools.py` (1,736 LOC) and `zep_entity_reader.py` are the entire memory + retrieval layer. There is no local fallback. If Zep is down, rate-limited, or sunsets the API, the app does nothing. That's a single point of failure for the whole system.

---

## Security review (self-hosting risk)

I ran two parallel review agents and **verified the specific claims**. Here's what's confirmed.

### Verified true

| # | Issue | Evidence |
|---|-------|----------|
| 1 | **No authentication on any API endpoint** | `grep -E "@(require|auth|login|jwt|token)" backend/app/api/*.py` → **zero matches** |
| 2 | **Permissive CORS** | `backend/app/__init__.py:43` → `CORS(app, resources={r"/api/*": {"origins": "*"}})` |
| 3 | **Stack traces in JSON responses** | 8+ instances: `graph.py:254, 528, 593, 621`, `report.py:199, 315`, etc. all return `"traceback": traceback.format_exc()` to clients |
| 4 | **Docker runs as root** | `Dockerfile` has no `USER` directive → defaults to root in `python:3.11` |
| 5 | **No rate limiting** | No flask-limiter or equivalent imports anywhere |
| 6 | **Loose dep pinning** | `flask>=3.0.0`, `PyMuPDF>=1.24.0`, etc. — only `zep-cloud` and `camel-*` are pinned |

### Verified false (security agent overcalled)

| # | Claim | Reality |
|---|-------|---------|
| 1 | "Path traversal via uploaded filename" | `project.py:259` does `safe_filename = f"{uuid.uuid4().hex[:8]}{ext}"` — original filename is **discarded**, only the extension is reused |
| 2 | "Shell injection via subprocess" | `simulation_runner.py:438` uses `subprocess.Popen(cmd)` with `cmd` as a list, no `shell=True`. The `cmd` array is built from internal constants + a generated config-file path |

### Real concerns, ranked

**Critical (in combination):**
- Zero auth + `origins: "*"` + stack traces in JSON = anyone on the network can hit the API, learn its internals from error responses, and run paid LLM/Zep operations on your dime. **Do not expose this to the public internet without a reverse proxy doing auth.**

**High:**
- **Cost DoS**: any caller can kick off arbitrary simulations. Each one is thousands of LLM calls. Without rate limiting, a single attacker can rack up API bills.
- **Prompt injection surface**: user-uploaded PDFs/text feed straight into ontology + persona prompts. Generated personas are rendered in the Vue frontend — if the frontend ever uses `v-html` on report content, that's an XSS vector. Need to verify Vue rendering of report markdown.
- **PDF parsing on untrusted input** via PyMuPDF. Pinned `>=1.24.0` is good (recent CVEs are patched), but no upper bound means a future regression is possible.

**Medium:**
- API keys (`LLM_API_KEY`, `ZEP_API_KEY`, `LLM_BOOST_API_KEY`) loaded from env into module-level `Config` and passed around. Nothing redacts them in logs. If `traceback.format_exc()` ever includes a value from `Config`, that key leaks to whoever caused the error.
- Docker as root.
- AGPL-3.0: anyone you let interact with a hosted instance has a right to the source code (including your modifications). Worth knowing if you fork.

### If you want to self-host it safely
1. Put it behind an authenticated reverse proxy (e.g., Caddy + basic auth + IP allowlist) — never expose 5001 directly.
2. Replace the wildcard CORS with the specific origin you serve the frontend from.
3. Strip `traceback` keys from production responses (env-gate them on `FLASK_DEBUG`).
4. Add per-IP rate limits on `/simulation/start`.
5. Rebuild the Docker image with a non-root `USER`.
6. Treat the LLM/Zep keys as billing keys — set hard spend caps with the providers.

---

## Comparison: is it worth using?

**You'd want it if:**
- You have a use case that genuinely benefits from social-media-style multi-agent simulation (policy testing, public opinion modeling, narrative exploration).
- You're already paying for Zep Cloud and a Qwen/OpenAI-tier LLM.
- You'd otherwise have to build a Vue frontend on top of OASIS + Zep yourself.

**You'd skip it if:**
- You can use OASIS directly. The "extra" MiroFish gives you is project bookkeeping + a UI — both buildable in a weekend if you know the OASIS API.
- You don't trust an unauthenticated, single-commit, suspiciously-starred repo with your API keys.
- You believe the marketing — "thousands of agents" / "high-fidelity parallel world" — and expect that level of fidelity. The simulation is whatever OASIS produces with tens of LLM-driven personas, not a digital twin.

**For your Powerhouse workout app:** completely irrelevant.

---

## Honest take

Two sentences:

1. **MiroFish is a competent Flask+Vue wrapper around OASIS + Zep + Qwen** — useful if that's the stack you want, embarrassing if you take the README's "swarm intelligence engine" claims at face value.
2. **The 58K stars on a 3-week-old, 1-commit project should be the loudest signal here**, not the third-loudest — it tells you to trust the code and ignore the marketing.
