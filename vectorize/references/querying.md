# Vectorize Query Patterns

Comprehensive guide to querying vectors, optimizing searches, and understanding similarity scoring.

## Basic Query Operations

### Simple Vector Query

```typescript
const results = await env.SEARCH_INDEX.query(queryVector, {
  topK: 10
});

// Result structure
interface QueryResult {
  matches: Array<{
    id: string;
    score: number;
    values?: number[];
    metadata?: Record<string, any>;
  }>;
  count: number;
}
```

### Query with Metadata

```typescript
const results = await env.SEARCH_INDEX.query(queryVector, {
  topK: 5,
  returnMetadata: true,  // Include metadata in results
  returnValues: false     // Don't return vector values (saves bandwidth)
});

// Access metadata
for (const match of results.matches) {
  console.log(`${match.id}: ${match.metadata?.title}`);
}
```

### Query with Vector Values

```typescript
// Return the actual vectors for further processing
const results = await env.SEARCH_INDEX.query(queryVector, {
  topK: 5,
  returnValues: true,
  returnMetadata: true
});

// Use returned vectors
for (const match of results.matches) {
  console.log(`Vector: [${match.values?.slice(0, 5).join(", ")}...]`);
}
```

## Query Options

### topK Parameter

Controls how many results to return.

```typescript
// Return top 5 most similar vectors
await env.SEARCH_INDEX.query(vector, { topK: 5 });

// Return top 20 for reranking
await env.SEARCH_INDEX.query(vector, { topK: 20 });
```

**Recommendations:**
- **RAG systems**: 3-5 results (balance context size vs relevance)
- **Search UI**: 10-20 results (enough for display)
- **Reranking**: 50-100 results (filter with secondary logic)
- **Bulk processing**: 100+ results (be mindful of performance)

**Trade-offs:**
- Higher `topK`: More results, higher latency, more tokens (RAG)
- Lower `topK`: Faster queries, less context, better precision

### returnMetadata Parameter

```typescript
// Without metadata (faster, smaller response)
const minimal = await env.SEARCH_INDEX.query(vector, {
  topK: 10,
  returnMetadata: false
});
// Returns: id, score only

// With metadata (useful for display/filtering)
const detailed = await env.SEARCH_INDEX.query(vector, {
  topK: 10,
  returnMetadata: true
});
// Returns: id, score, metadata
```

**Use metadata when:**
- Displaying results to users
- Filtering results post-query
- Accessing original content references
- Building hybrid search

**Skip metadata when:**
- Only need IDs for lookup in another system
- Minimizing response size/latency
- IDs contain all needed information

### returnValues Parameter

```typescript
// Return vector embeddings
const withVectors = await env.SEARCH_INDEX.query(vector, {
  topK: 5,
  returnValues: true
});

// Use cases for returned vectors:
// 1. Calculate custom similarity metrics
// 2. Re-rank with different algorithm  
// 3. Average vectors for clustering
// 4. Export for analysis
```

**Note**: Returning values significantly increases response size. Only use when necessary.

## Similarity Scoring

### Understanding Scores

Score interpretation varies by distance metric:

#### Cosine Similarity

```typescript
const results = await env.SEARCH_INDEX.query(vector, {
  topK: 10,
  returnMetadata: true
});

// Cosine scores range from -1 to 1
for (const match of results.matches) {
  if (match.score > 0.9) {
    console.log("Highly similar:", match.id);
  } else if (match.score > 0.7) {
    console.log("Moderately similar:", match.id);
  } else if (match.score > 0.5) {
    console.log("Somewhat similar:", match.id);
  } else {
    console.log("Low similarity:", match.id);
  }
}
```

**Cosine thresholds (text embeddings):**
- `0.95-1.0`: Near duplicates, paraphrases
- `0.85-0.95`: Highly related content
- `0.70-0.85`: Related concepts
- `0.50-0.70`: Loosely related
- `< 0.50`: Weak or no relation

#### Euclidean Distance

```typescript
// Euclidean scores: 0 = identical, higher = more distant
// Lower scores are better!
const results = await env.SEARCH_INDEX.query(vector, {
  topK: 10,
  returnMetadata: true
});

// Sort ascending (smallest distance first)
results.matches.sort((a, b) => a.score - b.score);

// Threshold depends on dimensionality and model
const similarMatches = results.matches.filter(m => m.score < 10);
```

**Note**: Euclidean thresholds vary widely by dimensionality. Calibrate with your specific embeddings.

#### Dot Product

```typescript
// Dot product: Higher = more similar
// Range depends on vector magnitudes
const results = await env.SEARCH_INDEX.query(vector, {
  topK: 10,
  returnMetadata: true
});

// For normalized vectors, equivalent to cosine
// Threshold: > 0 means same general direction
const relevant = results.matches.filter(m => m.score > 0);
```

### Score Calibration

```typescript
// Function to calibrate thresholds for your data
async function findOptimalThreshold(
  testQueries: Array<{ vector: number[]; expectedIds: string[] }>,
  env: Env
) {
  const scores: number[] = [];
  
  for (const test of testQueries) {
    const results = await env.SEARCH_INDEX.query(test.vector, { topK: 100 });
    
    for (const match of results.matches) {
      if (test.expectedIds.includes(match.id)) {
        scores.push(match.score);
      }
    }
  }
  
  // Find 95th percentile score of known good matches
  scores.sort((a, b) => b - a);
  const threshold = scores[Math.floor(scores.length * 0.05)];
  
  return threshold;
}
```

## Query Optimization

### Query Vector Generation

```typescript
// Cache query embeddings for repeated searches
const queryCache = new Map<string, number[]>();

async function getQueryEmbedding(text: string, env: Env): Promise<number[]> {
  // Check cache first
  if (queryCache.has(text)) {
    return queryCache.get(text)!;
  }
  
  // Generate embedding
  const { data } = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [text]
  });
  
  const embedding = data[0];
  queryCache.set(text, embedding);
  
  return embedding;
}
```

### Parallel Queries

```typescript
// Query multiple indexes simultaneously
const [docsResults, codeResults, faqResults] = await Promise.all([
  env.DOCS_INDEX.query(queryVector, { topK: 5 }),
  env.CODE_INDEX.query(queryVector, { topK: 5 }),
  env.FAQ_INDEX.query(queryVector, { topK: 5 })
]);

// Merge results with source labels
const merged = [
  ...docsResults.matches.map(m => ({ ...m, source: "docs" })),
  ...codeResults.matches.map(m => ({ ...m, source: "code" })),
  ...faqResults.matches.map(m => ({ ...m, source: "faq" }))
].sort((a, b) => b.score - a.score);
```

### Batching Strategy

```typescript
// Process multiple queries in sequence (not parallel API yet)
async function batchQueries(
  queries: number[][],
  env: Env
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];
  
  // Vectorize queries sequentially for now
  for (const query of queries) {
    const result = await env.SEARCH_INDEX.query(query, { topK: 10 });
    results.push(result);
  }
  
  return results;
}
```

**Note**: Vectorize doesn't currently support true batch query API. Process queries sequentially.

## Advanced Query Patterns

### Hybrid Search (Vector + Keyword)

Combine semantic search with keyword filtering:

```typescript
async function hybridSearch(
  query: string,
  keywords: string[],
  env: Env
) {
  // 1. Generate query embedding
  const { data } = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [query]
  });
  
  // 2. Vector search (cast wider net)
  const results = await env.SEARCH_INDEX.query(data[0], {
    topK: 50,  // Get more results for filtering
    returnMetadata: true
  });
  
  // 3. Filter by keywords
  const keywordMatches = results.matches.filter(match => {
    const text = (match.metadata?.text || "").toLowerCase();
    return keywords.some(kw => text.includes(kw.toLowerCase()));
  });
  
  // 4. Return top results after filtering
  return keywordMatches.slice(0, 10);
}
```

### Multi-Query Fusion

Combine results from multiple query variations:

```typescript
async function fusedSearch(
  queries: string[],  // Multiple phrasings of same question
  env: Env
) {
  // Generate embeddings for all variations
  const { data: embeddings } = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: queries
  });
  
  // Query with each variation
  const allResults = await Promise.all(
    embeddings.map(emb => 
      env.SEARCH_INDEX.query(emb, { topK: 20, returnMetadata: true })
    )
  );
  
  // Aggregate scores by ID (reciprocal rank fusion)
  const scoreMap = new Map<string, number>();
  
  for (const results of allResults) {
    results.matches.forEach((match, rank) => {
      const currentScore = scoreMap.get(match.id) || 0;
      scoreMap.set(match.id, currentScore + 1 / (rank + 60));
    });
  }
  
  // Sort by fused score
  const fused = Array.from(scoreMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  return fused;
}
```

### Contextual Reranking

Use LLM to rerank vector search results:

```typescript
async function rerank(
  query: string,
  vectorResults: Array<{ id: string; text: string }>,
  env: Env
) {
  // Ask LLM to rank by relevance
  const prompt = `Query: ${query}\n\nRank these results by relevance (1-10):\n\n` +
    vectorResults.map((r, i) => `${i + 1}. ${r.text}`).join("\n\n");
  
  const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [{ role: "user", content: prompt }]
  });
  
  // Parse LLM rankings and resort
  // (Implementation depends on LLM output format)
  return vectorResults; // Reordered by LLM
}
```

### Threshold Filtering

```typescript
// Only return results above similarity threshold
async function thresholdSearch(
  queryVector: number[],
  minScore: number,
  env: Env
) {
  // Query with larger topK to find enough high-quality results
  const results = await env.SEARCH_INDEX.query(queryVector, {
    topK: 50,
    returnMetadata: true
  });
  
  // Filter by threshold
  const filtered = results.matches.filter(m => m.score >= minScore);
  
  // If not enough high-quality results, fall back
  if (filtered.length < 3) {
    console.warn("Low quality results - consider relaxing threshold");
  }
  
  return filtered;
}
```

## Metadata Filtering

### Namespace Filtering

```typescript
// Insert with namespace metadata
await env.SEARCH_INDEX.insert([
  {
    id: "doc-1",
    values: embedding,
    metadata: { namespace: "public", category: "docs" }
  },
  {
    id: "doc-2",
    values: embedding,
    metadata: { namespace: "internal", category: "docs" }
  }
]);

// Query and filter by namespace
const results = await env.SEARCH_INDEX.query(queryVector, {
  topK: 20,
  returnMetadata: true
});

// Post-filter by namespace (no native filter support yet)
const publicResults = results.matches.filter(
  m => m.metadata?.namespace === "public"
);
```

### Multi-Tenant Isolation

```typescript
// Store tenant ID in metadata
await env.SEARCH_INDEX.insert([{
  id: `tenant-${tenantId}-${docId}`,
  values: embedding,
  metadata: { tenantId, text: content }
}]);

// Query with tenant filtering
async function tenantSearch(
  queryVector: number[],
  tenantId: string,
  env: Env
) {
  const results = await env.SEARCH_INDEX.query(queryVector, {
    topK: 50,  // Query more to account for filtering
    returnMetadata: true
  });
  
  // Filter to tenant's data only
  return results.matches.filter(m => m.metadata?.tenantId === tenantId);
}
```

### Time-Based Filtering

```typescript
// Store timestamps in metadata
await env.SEARCH_INDEX.insert([{
  id: "doc-1",
  values: embedding,
  metadata: {
    text: content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}]);

// Query recent documents only
async function recentSearch(
  queryVector: number[],
  daysBack: number,
  env: Env
) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  
  const results = await env.SEARCH_INDEX.query(queryVector, {
    topK: 50,
    returnMetadata: true
  });
  
  return results.matches.filter(m => {
    const date = new Date(m.metadata?.createdAt || 0);
    return date >= cutoff;
  });
}
```

## Get Operations

### Get by IDs

```typescript
// Retrieve specific vectors by their IDs
const vectors = await env.SEARCH_INDEX.getByIds([
  "doc-1",
  "doc-2",
  "doc-3"
]);

// Returns array of vectors with id, values, metadata
for (const vector of vectors) {
  console.log(`${vector.id}: ${vector.metadata?.title}`);
}
```

### Batch Get with Error Handling

```typescript
async function safeGetByIds(
  ids: string[],
  env: Env
): Promise<Array<{ id: string; metadata?: any; values?: number[] }>> {
  try {
    const vectors = await env.SEARCH_INDEX.getByIds(ids);
    return vectors;
  } catch (error) {
    console.error("Failed to get vectors:", error);
    return [];
  }
}
```

### Get and Cache

```typescript
// Cache retrieved vectors in KV for fast access
async function getCachedVectors(
  ids: string[],
  env: Env & { KV: KVNamespace }
) {
  const cached: any[] = [];
  const needFetch: string[] = [];
  
  // Check cache first
  for (const id of ids) {
    const cached = await env.KV.get(`vector:${id}`, "json");
    if (cached) {
      cached.push(cached);
    } else {
      needFetch.push(id);
    }
  }
  
  // Fetch missing from Vectorize
  if (needFetch.length > 0) {
    const fetched = await env.SEARCH_INDEX.getByIds(needFetch);
    
    // Cache for next time
    await Promise.all(
      fetched.map(v => 
        env.KV.put(`vector:${v.id}`, JSON.stringify(v), {
          expirationTtl: 3600  // 1 hour cache
        })
      )
    );
    
    cached.push(...fetched);
  }
  
  return cached;
}
```

## Performance Optimization

### Response Time Factors

1. **topK size**: Higher topK = longer query time
2. **Index size**: More vectors = slower queries (generally)
3. **returnValues**: Including vectors increases response size
4. **returnMetadata**: Metadata size affects transfer time
5. **Network latency**: Edge location matters

### Optimization Strategies

```typescript
// 1. Only return what you need
const minimal = await env.SEARCH_INDEX.query(vector, {
  topK: 5,              // Just enough results
  returnMetadata: true, // Only if displaying
  returnValues: false   // Usually not needed
});

// 2. Parallel independent queries
const [search1, search2] = await Promise.all([
  env.INDEX1.query(vector, { topK: 5 }),
  env.INDEX2.query(vector, { topK: 5 })
]);

// 3. Cache query embeddings
const embeddingCache = new Map<string, number[]>();
function getCachedEmbedding(text: string) {
  return embeddingCache.get(text);
}

// 4. Use appropriate index size
// Split very large indexes into smaller specialized ones
```

### Caching Strategies

```typescript
// Cache full query results (for identical queries)
interface CachedQuery {
  embedding: number[];
  results: any;
  timestamp: number;
}

const queryCache = new Map<string, CachedQuery>();

async function cachedSearch(
  queryText: string,
  env: Env,
  cacheMs: number = 300000  // 5 minutes
) {
  const cached = queryCache.get(queryText);
  
  // Return cached if fresh
  if (cached && Date.now() - cached.timestamp < cacheMs) {
    return cached.results;
  }
  
  // Generate embedding and query
  const { data } = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [queryText]
  });
  
  const results = await env.SEARCH_INDEX.query(data[0], {
    topK: 10,
    returnMetadata: true
  });
  
  // Cache for next time
  queryCache.set(queryText, {
    embedding: data[0],
    results,
    timestamp: Date.now()
  });
  
  return results;
}
```

## Error Handling

### Robust Query Pattern

```typescript
async function safeVectorSearch(
  queryVector: number[],
  env: Env
): Promise<QueryResult | null> {
  try {
    const results = await env.SEARCH_INDEX.query(queryVector, {
      topK: 10,
      returnMetadata: true
    });
    
    return results;
  } catch (error: any) {
    console.error("Vector search failed:", error);
    
    // Handle specific errors
    if (error.message?.includes("dimension")) {
      console.error("Dimension mismatch - check embedding model");
    } else if (error.message?.includes("not found")) {
      console.error("Index not found - check binding configuration");
    }
    
    return null;
  }
}
```

### Fallback Pattern

```typescript
// Try vector search, fall back to keyword if fails
async function searchWithFallback(
  query: string,
  env: Env
) {
  try {
    // Attempt vector search
    const { data } = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [query]
    });
    
    const results = await env.SEARCH_INDEX.query(data[0], {
      topK: 10,
      returnMetadata: true
    });
    
    return { method: "vector", results: results.matches };
  } catch (error) {
    console.warn("Vector search failed, falling back to keyword");
    
    // Fallback: simple keyword matching from metadata
    // (In practice, you'd query a different system like KV or D1)
    return { method: "keyword", results: [] };
  }
}
```

## Testing and Debugging

### Log Query Results

```typescript
async function debugQuery(
  queryVector: number[],
  env: Env
) {
  console.log("Query vector (first 5 dims):", queryVector.slice(0, 5));
  
  const results = await env.SEARCH_INDEX.query(queryVector, {
    topK: 10,
    returnMetadata: true
  });
  
  console.log(`Found ${results.count} matches`);
  
  for (const match of results.matches) {
    console.log(`
      ID: ${match.id}
      Score: ${match.score}
      Metadata: ${JSON.stringify(match.metadata, null, 2)}
    `);
  }
  
  return results;
}
```

### Validate Query Parameters

```typescript
function validateQueryParams(
  vector: number[],
  options: { topK?: number; returnMetadata?: boolean }
) {
  // Check vector is not empty
  if (!vector || vector.length === 0) {
    throw new Error("Query vector cannot be empty");
  }
  
  // Check dimensions match (e.g., 768 for BGE base)
  const expectedDims = 768;
  if (vector.length !== expectedDims) {
    throw new Error(
      `Expected ${expectedDims} dimensions, got ${vector.length}`
    );
  }
  
  // Validate topK range
  if (options.topK && (options.topK < 1 || options.topK > 100)) {
    console.warn("topK should be between 1-100");
  }
}
```
