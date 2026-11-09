# github.com/hackcat29/axonio-sdk/sdks/go

Go client for [Axonio](https://axonio.xyz): persistent memory for AI agents.

Formerly `github.com/Claw-DB/claw-sdk/sdks/go` (package `clawdb`). The old import path belongs to a GitHub account that is no longer available, so the module moved here as v0.2.0 and the package is now `axonio`. The old names (`ClawDB`, `ClawDBError`) still compile as aliases.

## Install

```bash
go get github.com/hackcat29/axonio-sdk/sdks/go@latest
```

Go 1.22 or newer. No dependencies beyond the standard library.

## Quick start

Create an API key in the Axonio dashboard, then:

```bash
export AXONIO_API_KEY="ck_live_..."
```

```go
package main

import (
	"context"
	"fmt"
	"log"

	axonio "github.com/hackcat29/axonio-sdk/sdks/go"
)

func main() {
	db, err := axonio.New() // an API key alone means the Axonio cloud
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()

	id, err := db.Memory.Remember(ctx, "The user prefers concise answers", &axonio.RememberOptions{
		Tags: []string{"preferences"},
	})
	if err != nil {
		log.Fatal(err)
	}

	hits, err := db.Memory.Search(ctx, "how should I phrase answers?", nil) // by meaning, not just keywords
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(id, len(hits))
}
```

For a self-hosted server use `axonio.WithEndpoint("https://db.example.com")` or set `AXONIO_URL`.

## Configuration

Environment variables are read first as `AXONIO_*`, then as the older `CLAWDB_*`: `API_KEY`, `URL`, `AGENT_ID`, `ROLE`, `TIMEOUT_MS`. Options passed to `New` win over the environment.

The client opens a session on the first call, renews it a minute before it expires (and once more if the server rejects it), retries network errors and 502/503/504 with backoff, and waits out 429s. `db.Connect(ctx)` opens the session up front so a bad key fails early.

## What it covers

- Memory: `Remember`, `Search`, `Get`, `Update`, `Forget`, `List`, `Recall`
- Branches: `Fork`, `List`, `Get`, `GetByName`, `GetTrunk`, `Diff`, `Merge`, `Discard`, `Archive`
- Transactions: `Begin`, `Remember`, `RememberTyped`, `Commit`, `Rollback`
- Reflection: `Trigger`, `ListJobs`, `GetJob`, `GetFacts`, `GetPreferences`, `GetContradictions`, `ResolveContradiction`
- Sync, sessions, health

Errors are `*axonio.Error` with a `Code` (`ErrorCodeAuth`, `ErrorCodeNotFound`, ...), the server's message, the HTTP status and the request id.

## Changes from 0.1.x

0.1.x never opened a session, so a real server rejected its calls; its tests were switched off in CI. 0.2.0 fixes the transport (sessions, the `q` search parameter, response shapes), adds real tests against a fake server, removes the gRPC dependency, and adds `AutoProvision` for finding or starting a local `clawdb-server`. `FromGRPCError` is gone.

## Test

```bash
go test ./...
AXONIO_LIVE_KEY=ck_live_... go test -run TestLiveCloud -v .   # against the Axonio cloud
```
