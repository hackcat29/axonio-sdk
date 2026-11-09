# axonio-cli

Command line interface for provisioning ClawDB, managing local server state, and exercising the full API surface from a terminal.

## Install

```bash
npm install -g axonio-cli
```

Or run it without installing:

```bash
npx axonio-cli@latest <command>
```

## Quick Start

```bash
clawdb init
clawdb status
clawdb memory remember "Ship release notes on Thursday"
clawdb memory search "release notes"
```

## Command Groups

Top-level commands:
- `init`
- `start`
- `stop`
- `status`
- `ready`
- `version`

Cloud commands:
- `cloud login`
- `cloud logout`
- `cloud status`

MCP commands:
- `mcp install-claude`
- `mcp install-cursor`
- `mcp install-vscode`
- `mcp install-continue`
- `mcp install-zed`
- `mcp print-config`

Session commands:
- `session create`
- `session validate`
- `session revoke <sessionId>`
- `session count`

Memory commands:
- `memory remember <content>`
- `memory remember-typed <content>`
- `memory update <id> <content>`
- `memory search <query>`
- `memory recall <ids...>`
- `memory list`
- `memory delete <id>`

Branch commands:
- `branch fork <name>`
- `branch list`
- `branch get <id>`
- `branch get-by-name <name>`
- `branch trunk`
- `branch diff <id>`
- `branch merge <source>`
- `branch discard <id>`
- `branch archive <id>`

Sync commands:
- `sync run`
- `sync push`
- `sync pull`
- `sync reconcile`
- `sync status`

Reflection commands:
- `reflect run`
- `reflect jobs`
- `reflect job <jobId>`
- `reflect facts <agentId>`
- `reflect preferences <agentId>`
- `reflect contradictions <agentId>`
- `reflect resolve <agentId> <contradictionId>`

Transaction commands:
- `tx begin`
- `tx remember <txId> <content>`
- `tx remember-typed <txId> <content>`
- `tx commit <txId>`
- `tx rollback <txId>`

## Environment

The CLI reads `CLAWDB_URL`, `CLAWDB_API_KEY`, `CLAWDB_AGENT_ID`, `DATABASE_URL`, and `.clawdb.env` when present.
