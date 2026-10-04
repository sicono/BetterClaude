---
description: Audit fixed token overhead (CLAUDE.md, MCP, plugins, skills) and propose concrete cuts
allowed-tools: Bash(node:*), Glob
---
Run: `node "${CLAUDE_PLUGIN_ROOT}/hooks/audit.js"`. If `${CLAUDE_PLUGIN_ROOT}` is not expanded, locate `better-claude/hooks/audit.js` under the user's `.claude/plugins` folder (Glob) and run that path with node.
Print the output as is, then at most 4 lines: the biggest cuts first (large CLAUDE.md, unused MCP servers, unused plugins). Do not edit anything.
