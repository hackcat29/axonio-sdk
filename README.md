# Axonio SDK

SDKs, CLI, ROS2 package and framework adapters for **[Axonio](https://axonio.xyz)**: persistent memory for AI agents. Formerly ClawDB.

The TypeScript, Python, Go and Rust packages are clients for the Axonio HTTP API. An API key alone connects them to the Axonio cloud; point them at a self-hosted `clawdb-server` with `AXONIO_URL`. The engine underneath that server lives in the repositories listed under [The engine](#the-engine).

[![CI](https://github.com/hackcat29/axonio-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/hackcat29/axonio-sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/axonio)](https://www.npmjs.com/package/axonio)
[![PyPI](https://img.shields.io/pypi/v/axonio)](https://pypi.org/project/axonio/)
[![crates.io](https://img.shields.io/crates/v/axonio)](https://crates.io/crates/axonio)
[![Go](https://img.shields.io/badge/go-hackcat29%2Faxonio--sdk%2Fsdks%2Fgo-00ADD8)](https://pkg.go.dev/github.com/hackcat29/axonio-sdk/sdks/go)
![Founder School · FS26-2 alumni](https://img.shields.io/badge/Founder%20School-FS26--2%20alumni-111111)

---

## Packages

| Package | Language | Description |
|---|---|---|
| [`axonio`](sdks/typescript/) | TypeScript | Client: HTTPS to the Axonio cloud, gRPC to a self-hosted server |
| [`axonio-cli`](packages/cli/) | TypeScript | The `clawdb` command-line tool |
| [`axonio-langchain`](adapters/langchain/) | TypeScript | LangChain.js adapter |
| [`axonio-openai-agents`](adapters/openai/) | TypeScript | OpenAI Agents SDK adapter |
| [`axonio-vercel-ai`](adapters/vercel-ai/) | TypeScript | Vercel AI SDK adapter |
| [`axonio-anthropic`](adapters/anthropic/) | TypeScript | Anthropic SDK adapter |
| [`axonio-google-genai`](adapters/google-genai/) | TypeScript | Google GenAI adapter |
| [`axonio-openclaw`](adapters/openclaw/) | TypeScript | OpenClaw adapter |
| [`axonio-mcp`](sdks/mcp-adapter/) | TypeScript | MCP server (stdio transport) |
| [`axonio`](sdks/python/) | Python | Sync and async client over HTTPS |
| [`axonio-ros2`](sdks/ros2/) | Python | ROS2 package: fleet-wide spatial memory for robots |
| [`axonio`](sdks/rust/) | Rust | Async client (tokio, rustls) |
| [`github.com/hackcat29/axonio-sdk/sdks/go`](sdks/go/) | Go | Go client |

The old names keep working: `pip install clawdb` and `clawdb-ros2` install the new packages, the `ClawDB` class is still exported next to `Axonio`, and `CLAWDB_*` environment variables are read after `AXONIO_*`. The old `@clawdb/*` npm packages are deprecated with a pointer to these.

## Architecture

There are two layers:

- The **engine** (`clawdb-server`, written in Rust) is the database: storage, semantic search, branching, reflection.
- The **SDKs in this repository** are clients that talk to a server, either the Axonio cloud or one you run yourself.

For a self-hosted server, one of these has to be true:

- `clawdb-server` is already running locally. The HTTP API is on port 8080 and gRPC on `http://localhost:50050`
- you ran `npx axonio-cli@latest init`, which provisions a local server
- you are pointing the SDK at a managed cloud endpoint

---

## The engine

The open-source engine is maintained in these repositories:

| Repository | What it is |
|---|---|
| [`hackcat29/ClawDB`](https://github.com/hackcat29/ClawDB) | The runtime and `clawdb-server` binary |
| [`hackcat29/claw-vector`](https://github.com/hackcat29/claw-vector) | Semantic memory engine: embeddings and vector search |
| [`hackcat29/claw-reflect`](https://github.com/hackcat29/claw-reflect) | Memory distillation: turns raw memories into durable summaries |

They are forks of the original `Claw-DB` projects (now `Axoniodev`) and carry the fixes the Axonio cloud runs on: sessions, search, transactions and merge conflicts in the server; PostgreSQL migrations, UUID ids and workspace API keys in reflect; cluster-internal gRPC and a working embedder image in vector.

---

## 30-second quickstart

All of these use the Axonio cloud: create an API key in the [dashboard](https://axonio.xyz) and export it.

```bash
export AXONIO_API_KEY="ck_live_..."
```

### TypeScript

```ts
import { Axonio } from 'axonio';

const db = Axonio.fromEnv(); // an API key alone means the Axonio cloud

const id = await db.rememberTyped('Deploy at 3 PM UTC', { type: 'task', tags: ['ops'] });
const hits = await db.search('deploy schedule', { topK: 5 });
console.log(hits[0]);
```

### Python

```python
from axonio import Axonio

with Axonio(api_key="ck_live_...", endpoint="https://api.axonio.xyz/api/v1/gateway") as db:
    memory_id = db.memory.remember("Deploy at 3 PM UTC", memory_type="task")
    hits = db.memory.search("deploy schedule", top_k=5)
    print(hits[0].content)
```

### Rust

```rust
use axonio::{Axonio, RememberOptions, SearchOptions};

#[tokio::main]
async fn main() -> axonio::Result<()> {
    let db = Axonio::from_env()?;

    let id = db.remember_typed("Deploy at 3 PM UTC", RememberOptions::default()).await?;
    for hit in db.search("deploy schedule", SearchOptions::default()).await? {
        println!("[{:.2}] {}", hit.score, hit.content);
    }

    db.delete_memory(&id).await?;
    db.close().await;
    Ok(())
}
```

### Go

```go
package main

import (
	"context"
	"fmt"
	"log"

	axonio "github.com/hackcat29/axonio-sdk/sdks/go"
)

func main() {
	db, err := axonio.New() // AXONIO_API_KEY alone means the Axonio cloud
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	ctx := context.Background()
	id, _ := db.Memory.Remember(ctx, "Deploy at 3 PM UTC", nil)
	results, _ := db.Memory.Search(ctx, "deploy schedule", &axonio.SearchOptions{TopK: 5})
	fmt.Println(id, len(results))
}
```

For a self-hosted server, set `AXONIO_URL` (or pass an endpoint) and see each package's README.

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
    "axonio": {
      "command": "npx",
      "args": ["-y", "axonio-mcp"],
      "env": { "AXONIO_API_KEY": "ck_live_...", "AXONIO_AGENT_ID": "my-agent" }
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
