# AGENTS.md — Agent-Driven Development Process

This document describes the multi-agent development workflow used in TemplateWing
for non-trivial bug fixes and feature work. It is intended as operational guidance
for Claude Code (and any contributor driving a similar swarm workflow).

## Overview

For issues that require careful diagnosis (e.g., cross-browser editor quirks,
messaging races, API-surface uncertainty), we do **not** jump straight to a fix.
Instead the work is split across three phases, executed by isolated subagents
so each phase starts with a clean context and produces a focused artifact.

```
  ┌──────────────────────┐
  │  3× Analysis Agents  │  (parallel)
  └──────────┬───────────┘
             │  hypotheses, root-cause analysis, code pointers
             ▼
  ┌──────────────────────┐
  │ 1× Implementation    │
  │      Agent           │
  └──────────┬───────────┘
             │  code change
             ▼
  ┌──────────────────────┐
  │  5× Review Agents    │  (parallel)
  └──────────┬───────────┘
             │
   all pass? ├── yes ──► push to repo
             │
             └── any fail ──► feed findings back to implementation agent ──► re-review
```

## Phase 1 — Analysis (3 agents, parallel)

Goal: produce independent hypotheses about the root cause and the minimal fix,
each starting from a cold context so we get genuinely different reads.

- All three run **in parallel** (one message, three `Agent` tool calls).
- Each receives the full issue text and the relevant file paths, but is asked
  to reach its conclusions independently (no "build on the other agents").
- Output per agent:
  - Top hypothesis for the root cause, ranked.
  - Pointers to specific files and line numbers.
  - A concrete proposed fix (diff-level, not "refactor X").
  - Risks / regressions to watch for.

If the three analyses converge on the same root cause → high confidence, proceed.
If they diverge → the implementation agent must reconcile, or a fourth analysis
agent is added to break the tie. Do not forge ahead on a 1-of-3 vote.

## Phase 2 — Implementation (1 agent)

Goal: apply the smallest change that fixes the issue without introducing
regressions.

- Receives the three analysis reports verbatim plus the issue text.
- Must cite which hypothesis it is fixing and why.
- Constraint: **do not expand scope**. No drive-by refactors, no speculative
  guards, no new abstractions. Bug fix only.
- Must leave the working tree in a state the review agents can evaluate
  (`npm test` and `npm run lint` must pass).

## Phase 3 — Review (5 agents, parallel)

Goal: five independent sign-offs before the change leaves the branch.

- All five run **in parallel**.
- Each reviews the **same diff** but from a different angle. Suggested split:
  1. **Correctness** — does this actually fix the reported bug? Walk the code path.
  2. **Regression risk** — what existing flows could this break? Focus on the
     paths v2.3.1 → v2.3.4 already touched.
  3. **Cross-mode coverage** — HTML body + plaintext `<textarea>` + iframe
     editor. Does the fix handle all three, or does it silently fall back?
  4. **Messaging / lifecycle** — `compose_scripts` injection timing, existing
     windows vs. newly opened, `sendMessage` response shape, Promise returns.
  5. **Code quality & conventions** — CLAUDE.md rules (vanilla JS, no build,
     i18n coverage, CSP compliance, `messenger.*` namespace).

Each review returns a **PASS** or **FAIL** with a one-paragraph justification.
FAIL must cite file:line and the specific defect.

## Gate: all-pass or iterate

- **5/5 PASS** → commit and push. Include a short note in the commit body
  listing the review angles that signed off.
- **Any FAIL** → feed the failing reviews back to a new implementation agent
  (Phase 2 again) with the previous diff as context. Then re-run Phase 3
  with five fresh review agents on the new diff.
- Hard cap: after three implementation iterations without 5/5 PASS, stop and
  escalate to the user. Do not keep looping.

## Why this shape

- **3 analysts** — enough for a majority signal on root cause, cheap enough to
  run every time. Parallel, cold-context so they don't anchor on each other.
- **1 implementer** — a single author keeps the diff coherent; multiple
  implementers produce conflicting patches that then need merging.
- **5 reviewers** — catches the long tail. The cursor-insertion bug in issue
  #33 failed four times because each iteration was reviewed from a single
  angle. Five parallel reviewers with distinct mandates make that much
  less likely.

## What not to do

- Do not skip Phase 1 because "the fix is obvious" — the v2.3.1 → v2.3.4
  regression chain is exactly what happens when analysis is skipped.
- Do not let the implementation agent also review its own work.
- Do not push on 4/5 PASS "because the failing one is nitpicky". Either the
  concern is valid (fix it) or it is not (convince a fresh reviewer).
- Do not fold multiple fixes into one cycle. One issue, one swarm.
