---
description: Self-test better-claude
disable-model-invocation: true
allowed-tools: Bash(node:*), Glob
---
Run the self-test: `node "${CLAUDE_PLUGIN_ROOT}/hooks/selftest.js"`. If `${CLAUDE_PLUGIN_ROOT}` is not expanded, locate `better-claude/hooks/selftest.js` under the user's `.claude/plugins` folder (Glob) and run that path with node.
Reply in at most 5 lines: ALL OK or which cases FAILED, plus Node version. If node is missing, say hooks cannot run. If everything passes but the user suspects the hooks are inactive, tell them to check `/hooks`. Do not run anything else.
