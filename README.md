# ClawDB SDK

The official multi-language SDK, CLI, and framework adapters for **ClawDB**.

ClawDB itself is implemented in Rust. For TypeScript, Python, and Go, the packages in this repository are gRPC clients that talk to a running `clawdb-server` process locally or to a hosted cloud endpoint. The Rust runtime is the engine layer underneath that server.

[![CI](https://github.com/clawdb/sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/clawdb/sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/axonio)](https://www.npmjs.com/package/axonio)
[![PyPI](https://img.shields.io/pypi/v/clawdb)](https://pypi.org/project/clawdb/)
[![crates.io](https://img.shields.io/crates/v/clawdb)](https://crates.io/crates/clawdb)

---

## Packages

| Package | Language | Description |
|---|---|---|
| [`axonio`](sdks/typescript/) | TypeScript | Core gRPC client |
| [`axonio-cli`](packages/cli/) | TypeScript | `clawdb` CLI |
| [`axonio-langchain`](adapters/langchain/) | TypeScript | LangChain.js adapter |
| [`axonio-openai-agents`](adapters/openai/) | TypeScript | OpenAI Agents SDK adapter |
| [`axonio-vercel-ai`](adapters/vercel-ai/) | TypeScript | Vercel AI SDK adapter |
| [`axonio-mcp`](sdks/mcp-adapter/) | TypeScript | MCP server (stdio transport) |
| [`clawdb`](sdks/python/) | Python | Sync + async Python client |
| [`clawdb`](sdks/rust/) | Rust | Tokio async Rust client |
| [`github.com/Claw-DB/claw-sdk/sdks/go`](sdks/go/) | Go | Go client |

## Architecture

There are two layers in the ClawDB product:

- The Rust runtime and `clawdb-server` binary are the database engine.
- The TypeScript, Python, and Go SDKs in this repository are clients that connect to that engine over gRPC.

That means the non-Rust SDKs assume one of the following is true:

- `clawdb-server` is already running locally on `http://localhost:50050`
- you have run `npx axonio-cli@latest init` successfully to provision a local server
- you are pointing the SDK at a managed cloud endpoint

The Rust surface is different from the other SDK tabs conceptually: Rust is the implementation layer the server is built on, while the non-Rust packages are network clients.

---

## 30-second quickstart

TypeScript, Python, and Go examples below assume `clawdb-server` is already running locally or that you are using a cloud endpoint. If you want the local path, start with:

```bash
npx axonio-cli@latest init
```

If auto-provision is unavailable in your environment, start `clawdb-server` manually and then use the SDKs against `http://localhost:50050`.

### TypeScript

```ts
import { ClawDB } from 'axonio';

const db = new ClawDB({ endpoint: 'http://localhost:50050', agentId: 'my-agent' });
await db.connect();

const id = await db.memory.remember('Deploy at 3 PM UTC', { memoryType: 'task', tags: ['ops'] });
const results = await db.memory.search('deploy schedule', { topK: 5 });
console.log(results[0].memory.content); // "Deploy at 3 PM UTC"
```

### Python

```python
from clawdb import ClawDB

db = ClawDB(endpoint="http://localhost:50050", agent_id="my-agent")

memory_id = db.memory.remember("Deploy at 3 PM UTC", memory_type="task")
results = db.memory.search("deploy schedule", top_k=5)
print(results[0].memory.content)  # "Deploy at 3 PM UTC"
```

### Rust

The Rust quickstart below shows the Rust package in this repository. Product-wise, Rust is the engine layer ClawDB is built on; the other SDKs connect to that engine through `clawdb-server`.

```rust
use clawdb::Client;

#[tokio::main]
async fn main() -> clawdb::Result<()> {
    let db = Client::builder()
        .endpoint("http://localhost:50050")
        .agent_id("my-agent")
        .build()
        .await?;

    let id = db.memory().remember("Deploy at 3 PM UTC")
        .memory_type("task")
        .call().await?;

    let results = db.memory().search("deploy schedule").top_k(5).call().await?;
    println!("{}", results[0].memory.content);
    Ok(())
}
```

### Go

```go
package main

import (
    "context"
    "fmt"
    "github.com/Claw-DB/claw-sdk/sdks/go"
)

func main() {
    db, _ := clawdb.New(clawdb.Options{
        Endpoint: "http://localhost:50050",
        AgentID:  "my-agent",
    })
    defer db.Close()

    ctx := context.Background()
    id, _ := db.Memory.Remember(ctx, "Deploy at 3 PM UTC", nil)
    results, _ := db.Memory.Search(ctx, "deploy schedule", &clawdb.SearchOptions{TopK: 5})
    fmt.Println(results[0].Memory.Content)
}
```

---

## Framework integrations

### LangChain.js

```ts
import { ClawDBRetriever, ClawDBChatMessageHistory, createClawDBTools } from 'axonio-langchain';

const retriever = new ClawDBRetriever({ client: db, topK: 10 });
const history = new ClawDBChatMessageHistory({ client: db, sessionId: 'chat-123' });
const tools = createClawDBTools(db);
```

### OpenAI Agents SDK

```ts
import { createClawDBAgentTools, ClawDBToolHandler, withClawDBMemory } from 'axonio-openai-agents';

const tools = createClawDBAgentTools(db, { enableBranching: true });
const agent = withClawDBMemory(myAgent, db);
```

### Vercel AI SDK

```ts
import { clawdbTools, clawdbMiddleware } from 'axonio-vercel-ai';

const tools = clawdbTools(db);
const result = await generateText({ model, tools, prompt: 'What do you remember?' });
```

### Claude Desktop (MCP)

```json
{
  "mcpServers": {
    "clawdb": {
      "command": "npx",
      "args": ["-y", "axonio-mcp"],
      "env": { "CLAWDB_ENDPOINT": "http://localhost:50050", "CLAWDB_AGENT_ID": "my-agent" }
    }
  }
}
```

---

## CLI

```bash
npm install -g axonio-cli
clawdb init
clawdb memory search "deploy schedule"
clawdb branch fork my-experiment
clawdb sync
clawdb status
```

For ephemeral usage, prefer:

```bash
npx axonio-cli@latest init
```

---

## Development

```bash
# Prerequisites: Node 20.14+, pnpm 9+
corepack enable
pnpm install

# Build all packages
pnpm -r build

# Run all TypeScript tests
pnpm -r test

# Run integration tests (requires running clawdb-server)
CLAWDB_INTEGRATION=1 pnpm --filter axonio-integration-tests test:integration
```

---

## License

MIT — see [LICENSE](LICENSE)
