# Testing Vectorize

Vectorize **cannot be simulated locally**. Use **remote bindings** or **mocking** for testing.

## Local Development Limitation

From Cloudflare docs:

> "There is no current local simulation for Vectorize."

Vectorize operations (insert, query, delete) require connection to a real Vectorize index.

## Testing Strategies

### 1. Use Remote Bindings (Recommended for Integration Tests)

Connect to a real Vectorize index in tests:

```typescript
// vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        // Enable remote bindings for Vectorize
        experimental_remoteBindings: true,
      },
    },
  },
});
```

### wrangler.jsonc

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "vectorize": [
    {
      "binding": "VECTORIZE_INDEX",
      "index_name": "test-index"
    }
  ]
}
```

### 2. Mock Vectorize for Unit Tests

```typescript
import { vi } from "vitest";

function createMockVectorize() {
  return {
    query: vi.fn().mockResolvedValue({
      matches: [
        { id: "vec-1", score: 0.95, metadata: { title: "Result 1" } },
        { id: "vec-2", score: 0.87, metadata: { title: "Result 2" } },
      ],
      count: 2,
    }),
    insert: vi.fn().mockResolvedValue({ mutationId: "mut-123" }),
    upsert: vi.fn().mockResolvedValue({ mutationId: "mut-456" }),
    deleteByIds: vi.fn().mockResolvedValue({ mutationId: "mut-789" }),
    getByIds: vi.fn().mockResolvedValue([]),
  };
}
```

## Unit Tests with Mocks

```typescript
import { describe, it, expect, vi } from "vitest";

describe("Vectorize operations", () => {
  const mockIndex = createMockVectorize();

  it("queries similar vectors", async () => {
    const results = await mockIndex.query([0.1, 0.2, 0.3], {
      topK: 5,
      returnMetadata: true,
    });

    expect(results.matches).toHaveLength(2);
    expect(results.matches[0].score).toBeGreaterThan(0.9);
  });

  it("inserts vectors", async () => {
    const result = await mockIndex.insert([
      { id: "vec-new", values: [0.1, 0.2, 0.3], metadata: { title: "New" } },
    ]);

    expect(result.mutationId).toBeDefined();
    expect(mockIndex.insert).toHaveBeenCalled();
  });

  it("deletes vectors by ID", async () => {
    const result = await mockIndex.deleteByIds(["vec-1", "vec-2"]);

    expect(result.mutationId).toBeDefined();
  });
});
```

## Integration Tests with Remote Bindings

```typescript
import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("Vectorize integration", () => {
  const testVectorId = `test-${Date.now()}`;

  beforeAll(async () => {
    // Insert test vector
    await env.VECTORIZE_INDEX.insert([
      {
        id: testVectorId,
        values: new Array(384).fill(0.1), // Match your index dimensions
        metadata: { title: "Test Document", category: "test" },
      },
    ]);
    
    // Wait for mutation to complete (Vectorize is async)
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    // Cleanup
    await env.VECTORIZE_INDEX.deleteByIds([testVectorId]);
  });

  it("queries vectors via API", async () => {
    const response = await SELF.fetch("http://example.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "test query",
        topK: 5,
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.results).toBeDefined();
  });
});
```

## Testing Vector Search Logic

```typescript
describe("Search result processing", () => {
  const mockResults = {
    matches: [
      { id: "doc-1", score: 0.95, metadata: { title: "Best Match", category: "A" } },
      { id: "doc-2", score: 0.85, metadata: { title: "Good Match", category: "B" } },
      { id: "doc-3", score: 0.75, metadata: { title: "Ok Match", category: "A" } },
    ],
    count: 3,
  };

  it("filters by minimum score", () => {
    const filtered = filterResults(mockResults.matches, { minScore: 0.8 });
    expect(filtered).toHaveLength(2);
  });

  it("filters by category", () => {
    const filtered = filterResults(mockResults.matches, { category: "A" });
    expect(filtered).toHaveLength(2);
  });

  it("limits results", () => {
    const limited = filterResults(mockResults.matches, { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0].id).toBe("doc-1");
  });
});
```

## Testing Embedding Generation

```typescript
describe("Embedding generation", () => {
  it("generates embeddings for text", async () => {
    const mockAI = {
      run: vi.fn().mockResolvedValue({
        data: [[0.1, 0.2, 0.3, /* ... 384 dimensions */]],
      }),
    };

    const embedding = await generateEmbedding(mockAI, "Sample text");
    
    expect(embedding).toHaveLength(384);
    expect(mockAI.run).toHaveBeenCalledWith(
      "@cf/baai/bge-base-en-v1.5",
      { text: ["Sample text"] }
    );
  });
});
```

## Testing with Worker AI + Vectorize

```typescript
describe("RAG pipeline", () => {
  const mockAI = {
    run: vi.fn(),
  };
  const mockVectorize = createMockVectorize();

  it("performs RAG search", async () => {
    // Mock embedding
    mockAI.run.mockResolvedValueOnce({
      data: [new Array(384).fill(0.1)],
    });

    // Mock vector search
    mockVectorize.query.mockResolvedValueOnce({
      matches: [
        { id: "doc-1", score: 0.9, metadata: { content: "Relevant content" } },
      ],
      count: 1,
    });

    const results = await ragSearch(
      { AI: mockAI, VECTORIZE: mockVectorize },
      "What is the answer?"
    );

    expect(results).toHaveLength(1);
    expect(results[0].metadata.content).toBe("Relevant content");
  });
});
```

## Testing Metadata Filters

```typescript
describe("Metadata filtering", () => {
  it("queries with metadata filter", async () => {
    const mockIndex = createMockVectorize();

    await mockIndex.query([0.1, 0.2, 0.3], {
      topK: 10,
      filter: { category: "tech", published: true },
    });

    expect(mockIndex.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { category: "tech", published: true },
      })
    );
  });
});
```

## Running Tests

```bash
npx vitest        # Watch mode
npx vitest run    # Single run
```

## Staging Index for Tests

Create a dedicated test index:

```bash
# Create test index
wrangler vectorize create test-index --dimensions 384 --metric cosine

# Use in tests
wrangler.test.jsonc with index_name: "test-index"
```

## Known Limitations

- **No local simulation** - Must use remote bindings for real operations
- **Async mutations** - Inserts/deletes are async, may need delays
- **Cost** - Remote tests incur Vectorize usage
- **Test isolation** - Clean up test vectors after tests

## Best Practices

1. **Use mocks for unit tests** - Fast and free
2. **Use remote bindings for integration** - Real behavior
3. **Create separate test index** - Avoid polluting production
4. **Clean up test data** - Delete test vectors after tests
5. **Account for async mutations** - Add delays after insert/delete
6. **Test embedding + search together** - Full pipeline testing
7. **Mock AI for embedding tests** - Faster unit tests
8. **Test metadata filtering** - Common use case
