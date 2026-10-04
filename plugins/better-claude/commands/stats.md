---
description: Show how many calls better-claude has blocked, by rule
allowed-tools: Bash(node:*), Glob
---
Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/stats.js"`. If `${CLAUDE_PLUGIN_ROOT}` is not expanded, locate `better-claude/hooks/stats.js` under the user's `.claude/plugins` folder (Glob) and run that path with node.
Print the output exactly as is. Add nothing else.
