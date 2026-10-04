---
description: Save a compact handoff to .claude/handoff.md; after /clear it loads automatically, once
allowed-tools: Write(.claude/handoff.md)
---
Write a handoff of this session to `.claude/handoff.md` (create the folder if needed), max 15 lines, in the user's language:
- Goal
- Decisions (why, in a few words)
- Files changed (paths only)
- Verified working / NOT verified yet
- Next step
- Gotchas or open problems

No code listings, no narration. Then reply with one line: run /clear and it will load by itself in the new session. If a .gitignore exists and lacks `.claude/handoff*`, mention that in one extra line (do not edit it).
