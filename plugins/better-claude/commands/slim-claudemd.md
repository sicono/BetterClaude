---
description: Propose a slimmer CLAUDE.md (never overwrites)
disable-model-invocation: true
allowed-tools: Read, Glob, Write(CLAUDE.slim.md)
---
Read the project's `CLAUDE.md` and write a proposal to `CLAUDE.slim.md`. Do NOT modify `CLAUDE.md`.

Keep: build/test/deploy commands, conventions and gotchas that are not inferable from the code, explicit user rules and preferences, constraints and warnings.
Drop only: content inferable from the code or framework conventions, duplicated statements, history/narrative, stale TODOs.
Never invent content. Never drop an explicit rule, preference or constraint; if unsure, keep it. Keep the original language and wording of what stays.

Then reply in at most 8 lines: approx tokens before/after (chars / 4) and one line per removed item so the user can veto. Tell them to review and replace `CLAUDE.md` themselves.
