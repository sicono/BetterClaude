---
description: Report ~/.claude disk usage (deletes nothing)
disable-model-invocation: true
allowed-tools: Bash(node:*), Glob
---
Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/space.js"`. If `${CLAUDE_PLUGIN_ROOT}` is not expanded, locate `better-claude/hooks/space.js` under the user's `.claude/plugins` folder (Glob) and run that path with node.
Show the output as is, then add at most 3 lines: what is taking the most space and the single most useful action (usually `cleanupPeriodDays` in `~/.claude/settings.json`). Do not delete or modify anything.
