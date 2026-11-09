package main

import (
	"context"
	"fmt"
	"log"

	axonio "github.com/hackcat29/axonio-sdk/sdks/go"
)

func main() {
	// Reads AXONIO_API_KEY (the Axonio cloud) or AXONIO_URL (a self-hosted server).
	db, err := axonio.New()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	ctx := context.Background()

	id, err := db.Memory.Remember(ctx, "The user prefers concise answers", &axonio.RememberOptions{
		MemoryType: axonio.MemoryTypeContext,
		Tags:       []string{"preferences"},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Stored memory: %s\n", id)

	hits, err := db.Memory.Search(ctx, "how should I phrase answers?", &axonio.SearchOptions{TopK: 5})
	if err != nil {
		log.Fatal(err)
	}
	for _, h := range hits {
		fmt.Printf("  [%.2f] %s\n", h.Score, h.Content)
	}
}
