# Vectorize Limits and Quotas

Comprehensive guide to Cloudflare Vectorize limits, quotas, and performance characteristics.

## Account and Index Limits

| Feature | Workers Paid Plan | Workers Free Plan |
|---------|-------------------|-------------------|
| **Indexes per account** | 50,000 | 100 |
| **Vectors per index (maximum)** | 5,000,000 | 5,000,000 |
| **Namespaces per index** | 50,000 | 1,000 |

### Notes

- **Free plan**: While the maximum vectors per index is the same, other limits (storage, queries) are more restrictive
- **Paid plan**: Higher limits available through support for enterprise use cases
- Most limits can be increased via [Cloudflare's Limit Increase Request Form](https://developers.cloudflare.com/vectorize/platform/limits/)

## Vector Specifications

| Feature | Limit | Notes |
|---------|-------|-------|
| **Maximum dimensions per vector** | 1,536 | Float32 (32-bit precision) |
| **Vector ID length** | 64 bytes | UTF-8 encoded |
| **Vector precision** | Float32 | Float64 automatically converted |

### Dimension Limits by Model

Most embedding models output vectors within the 1,536 dimension limit:

| Model | Dimensions | Fits in Vectorize? |
|-------|------------|-------------------|
| Workers AI: BGE Base | 768 | ✅ Yes |
| Workers AI: BGE Large | 1,024 | ✅ Yes |
| Workers AI: BGE Small | 384 | ✅ Yes |
| OpenAI: text-embedding-3-small | 1,536 | ✅ Yes (max) |
| OpenAI: text-embedding-3-large | 3,072 or 1,536 | ⚠️ Use 1,536 mode |
| OpenAI: text-embedding-ada-002 | 1,536 | ✅ Yes (max) |
| Cohere: embed-english-v3.0 | 1,024 | ✅ Yes |
| Cohere: embed-multilingual-v3.0 | 1,024 | ✅ Yes |

**Important**: OpenAI's text-embedding-3-large supports dimension reduction. Use the 1,536-dimension variant for Vectorize compatibility.

## Metadata Limits

| Feature | Limit | Notes |
|---------|-------|-------|
| **Total metadata per vector** | 10 KiB | Across all metadata fields |
| **Metadata indexes per index** | 10 | Properties that can be filtered |
| **Metadata index value size** | 64 bytes | For string properties (truncated) |
| **Supported types** | `string`, `number`, `boolean` | Other types stored but not filterable |
| **Number precision** | Float64 | For numeric metadata |

### Metadata Index Details

```typescript
// Example: metadata within limits
await env.SEARCH_INDEX.insert([{
  id: "doc-1",
  values: embedding,
  metadata: {
    // Indexed properties (requires metadata index creation)
    tenantId: "tenant-123",        // string, 64 bytes max for filtering
    category: "documentation",      // string
    priority: 5,                    // number, float64 precision
    published: true,                // boolean
    
    // Non-indexed properties (any size up to 10 KiB total)
    fullText: "Long content...",    // Can exceed 64 bytes
    tags: ["tag1", "tag2"],         // Arrays stored but not filterable
    nested: { key: "value" }        // Objects stored but not filterable
  }
}]);
```

**Key Points:**

- Only the first **64 bytes** of string metadata values are indexed for filtering
- Strings truncated on UTF-8 character boundaries
- Metadata beyond 10 KiB per vector is rejected
- Arrays and objects can be stored but cannot be filtered directly
- Vectors inserted before a metadata index is created won't be filterable on that property

## Namespace Limits

| Feature | Limit |
|---------|-------|
| **Namespaces per index (Free)** | 1,000 |
| **Namespaces per index (Paid)** | 50,000 |
| **Namespace name length** | 64 bytes |
| **Namespaces per vector** | 1 (each vector belongs to one namespace) |

### Namespace Usage

```typescript
// Insert with namespace
await env.SEARCH_INDEX.insert([{
  id: "doc-1",
  values: embedding,
  namespace: "customer-acme",  // 64 bytes max
  metadata: { text: "content" }
}]);

// Query specific namespace
const results = await env.SEARCH_INDEX.query(queryVector, {
  namespace: "customer-acme",
  topK: 10
});
```

**Best Practice**: Use namespaces for coarse-grained filtering (tenants, departments) and metadata indexes for fine-grained filtering (categories, dates).

## Query Limits

| Feature | Limit | Notes |
|---------|-------|-------|
| **topK with values or metadata** | 20 | When `returnValues: true` or `returnMetadata: 'all'` |
| **topK without values/metadata** | 100 | When `returnValues: false` and `returnMetadata: 'none'` |
| **Filter JSON size** | 2,048 bytes | Compact form |
| **Filter key length** | 512 characters | Maximum per key |

### Query Examples

```typescript
// Maximum results without metadata/values
const maxResults = await env.SEARCH_INDEX.query(queryVector, {
  topK: 100,              // Maximum allowed
  returnValues: false,
  returnMetadata: 'none'
});

// With metadata or values - limited to 20
const withMetadata = await env.SEARCH_INDEX.query(queryVector, {
  topK: 20,               // Maximum when returning metadata
  returnMetadata: 'all',
  returnValues: false
});

// Exceeds limit - will error
const tooMany = await env.SEARCH_INDEX.query(queryVector, {
  topK: 50,               // ❌ Error: exceeds limit with metadata
  returnMetadata: 'all'
});
```

### returnMetadata Options

| Option | Behavior | topK Limit | Use Case |
|--------|----------|------------|----------|
| `'none'` | No metadata returned | 100 | ID-only lookups, maximum results |
| `'indexed'` | Only indexed fields returned | 20 | Filtered search with display |
| `'all'` | All metadata returned | 20 | Full content display, debugging |

**Note**: `'indexed'` returns only metadata properties that have metadata indexes, and strings may be truncated to 64 bytes.

## Batch Operation Limits

| Operation | Limit (Workers) | Limit (HTTP API) | Notes |
|-----------|-----------------|------------------|-------|
| **Insert batch size** | 1,000 vectors | 5,000 vectors | Per single API call |
| **Upsert batch size** | 1,000 vectors | 5,000 vectors | Per single API call |
| **Delete by IDs batch** | 1,000 IDs | 5,000 IDs | Per single API call |
| **WAL processing** | 200,000 vectors or 1,000 blocks | Same | Whichever limit reached first |

### Batch Operation Examples

```typescript
// Efficient batch insert - within Worker limit
const vectors = documents.slice(0, 1000).map(doc => ({
  id: doc.id,
  values: doc.embedding,
  metadata: { text: doc.text }
}));

await env.SEARCH_INDEX.insert(vectors);

// For larger batches, chunk them
async function insertLargeBatch(vectors: VectorRecord[], env: Env) {
  const BATCH_SIZE = 1000; // Worker limit
  
  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const batch = vectors.slice(i, i + BATCH_SIZE);
    await env.SEARCH_INDEX.insert(batch);
    
    // Optional: add small delay to avoid rate limiting
    if (i + BATCH_SIZE < vectors.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
```

### Write-Ahead-Log (WAL) Processing

Vectorize uses a write-ahead-log system for processing inserts/updates:

- **Batch limit**: Up to 200,000 vectors OR 1,000 update blocks per job
- **Processing**: Vectors written to WAL are eventually consistent (usually within seconds)
- **Visibility**: Vectors may not be immediately queryable after insert
- **Best practice**: Use larger batches (closer to 1,000 for Workers) to reduce number of jobs

```typescript
// Small frequent batches - creates many WAL jobs (slower)
for (const vector of allVectors) {
  await env.SEARCH_INDEX.insert([vector]); // ❌ Inefficient
}

// Large batches - fewer WAL jobs (faster)
const batches = chunk(allVectors, 1000);
for (const batch of batches) {
  await env.SEARCH_INDEX.insert(batch); // ✅ Efficient
}
```

## Naming Constraints

| Feature | Limit | Rules |
|---------|-------|-------|
| **Index name** | 64 bytes | Alphanumeric, hyphens, underscores |
| **Namespace name** | 64 bytes | UTF-8 encoded |
| **Filter keys** | 512 characters | Cannot start with `$`, no `.` or `"` unless nesting |

### Naming Best Practices

```bash
# Good index names
wrangler vectorize create prod-docs-search
wrangler vectorize create staging-customer-embeddings
wrangler vectorize create v2-product-catalog

# Avoid
wrangler vectorize create index1           # ❌ Not descriptive
wrangler vectorize create my_index         # ⚠️ Use hyphens not underscores
wrangler vectorize create this-is-a-very-long-name-that-exceeds-sixty-four-bytes  # ❌ Too long
```

## Metadata Filter Constraints

| Feature | Limit | Notes |
|---------|-------|-------|
| **Filter JSON size** | 2,048 bytes | Compact/minified form |
| **Filter key length** | 512 characters | Per individual key |
| **Supported operators** | 8 | `$eq`, `$ne`, `$in`, `$nin`, `$lt`, `$lte`, `$gt`, `$gte` |
| **Range query combinations** | Limited | Can combine `$gte` with `$lt`, not `$in` with ranges |

### Filter Operator Rules

```typescript
// Valid filter examples
const filter1 = { category: "docs" };                           // ✅ Simple equality
const filter2 = { priority: { $gte: 5, $lt: 10 } };           // ✅ Range query
const filter3 = { status: { $in: ["active", "pending"] } };    // ✅ In array
const filter4 = { published: true, priority: { $gt: 3 } };     // ✅ Multiple filters

// Invalid filters
const invalid1 = { priority: { $in: [1, 2], $gt: 0 } };       // ❌ Can't mix $in with range
const invalid2 = { "": "value" };                              // ❌ Empty key
const invalid3 = { "$invalid": "value" };                      // ❌ Key starts with $
const invalid4 = { "key.with.dots": "value" };                 // ❌ Dots not allowed
```

### Filter Size Management

```typescript
// Check filter size before querying
function validateFilterSize(filter: Record<string, any>): boolean {
  const jsonStr = JSON.stringify(filter);
  const bytes = new TextEncoder().encode(jsonStr).length;
  
  if (bytes > 2048) {
    console.error(`Filter too large: ${bytes} bytes (max 2048)`);
    return false;
  }
  
  return true;
}

// Use for complex filters
const complexFilter = {
  tenantId: "tenant-123",
  category: { $in: ["docs", "tutorials", "guides"] },
  priority: { $gte: 5 },
  published: true
};

if (validateFilterSize(complexFilter)) {
  const results = await env.SEARCH_INDEX.query(queryVector, {
    topK: 10,
    filter: complexFilter,
    returnMetadata: 'all'
  });
}
```

## Usage Quotas and Pricing

### Free Tier (Workers Free Plan)

| Metric | Included | Overage |
|--------|----------|---------|
| **Queried vector dimensions / month** | 30 million | Not available |
| **Stored vector dimensions / month** | 5 million | Not available |

**Calculation examples:**

```typescript
// Example 1: 768-dimension embeddings (BGE Base)
// Query quota: 30,000,000 / 768 = ~39,000 queries/month
// Storage quota: 5,000,000 / 768 = ~6,500 vectors

// Example 2: 1,536-dimension embeddings (OpenAI)
// Query quota: 30,000,000 / 1,536 = ~19,500 queries/month
// Storage quota: 5,000,000 / 1,536 = ~3,250 vectors
```

### Paid Tier (Workers Paid Plan)

| Metric | Included | Overage Rate |
|--------|----------|--------------|
| **Queried vector dimensions / month** | 50 million | $0.01 per 1 million |
| **Stored vector dimensions / month** | 10 million | $0.05 per 100 million |

**Calculation examples:**

```typescript
// Example: 1 million 768-dim vectors, 100k queries/month
// Storage: 1,000,000 × 768 = 768M dimensions
//   - First 10M included
//   - Overage: 758M / 100M × $0.05 = $0.379/month
// Queries: 100,000 × 768 = 76.8M dimensions
//   - First 50M included  
//   - Overage: 26.8M / 1M × $0.01 = $0.268/month
// Total: ~$0.65/month

// Example: 100k 1,536-dim vectors, 10k queries/month
// Storage: 100,000 × 1,536 = 153.6M dimensions
//   - First 10M included
//   - Overage: 143.6M / 100M × $0.05 = $0.072/month
// Queries: 10,000 × 1,536 = 15.36M dimensions
//   - All within free tier (< 50M)
// Total: ~$0.07/month
```

### Monitoring Usage

```typescript
// Track dimensions in your application
let totalQueryDimensions = 0;
let totalStoredDimensions = 0;

async function trackQuery(vectorDims: number) {
  totalQueryDimensions += vectorDims;
  
  if (totalQueryDimensions > 30_000_000) { // Free tier limit
    console.warn("Approaching free tier query limit");
  }
}

async function trackInsert(count: number, dims: number) {
  totalStoredDimensions += count * dims;
  
  if (totalStoredDimensions > 5_000_000) { // Free tier limit
    console.warn("Approaching free tier storage limit");
  }
}
```

## Performance Characteristics

### Query Latency Benchmarks

Based on Cloudflare's published benchmarks (January 2026):

| Index Size | Dimensions | topK | P50 | P75 | P90 | P95 |
|------------|------------|------|-----|-----|-----|-----|
| 1M vectors | 1,536 | 10 | 31ms | 40ms | 55ms | 70ms |
| 5M vectors | 768 | 10 | 81ms | 92ms | 105ms | 123ms |
| 100K vectors | 768 | 10 | 15ms | 20ms | 25ms | 30ms |

**Approximate queries** (skip refinement):
- P50: ~15ms
- Precision: ~79% (compared to exact)
- Use case: When speed is more important than perfect accuracy

### Factors Affecting Performance

1. **Index size**: Larger indexes = slower queries (logarithmic relationship)
2. **Dimensions**: Higher dimensions = more computation
3. **topK**: Higher values = longer processing
4. **Metadata filtering**: Complex filters add overhead
5. **returnMetadata/returnValues**: More data returned = slower transfer
6. **Cold vs warm**: First query after inactivity much slower
7. **Namespace filtering**: Efficient, done before vector search

### Optimization Strategies

```typescript
// 1. Use appropriate topK
const quick = await env.SEARCH_INDEX.query(vector, {
  topK: 5              // ✅ Fast, focused results
});

const comprehensive = await env.SEARCH_INDEX.query(vector, {
  topK: 100            // ⚠️ Slower, but more options for reranking
});

// 2. Minimize returned data
const efficient = await env.SEARCH_INDEX.query(vector, {
  topK: 10,
  returnValues: false,      // ✅ Don't return vectors
  returnMetadata: 'indexed' // ✅ Only indexed fields
});

// 3. Use namespace filtering
const scoped = await env.SEARCH_INDEX.query(vector, {
  namespace: "tenant-123",  // ✅ Narrows search space early
  topK: 10
});

// 4. Cache frequent queries
const queryCache = new Map<string, any>();
function getCachedQuery(key: string) {
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.ts < 300000) { // 5 min
    return cached.results;
  }
  return null;
}
```

## Rate Limits and Concurrency

While Cloudflare doesn't publish specific rate limits, observe these guidelines:

### Recommended Practices

```typescript
// 1. Batch operations instead of individual calls
// Bad: 1000 individual inserts
for (const vector of vectors) {
  await env.SEARCH_INDEX.insert([vector]); // ❌ Slow, creates many requests
}

// Good: Batch inserts
const batches = chunk(vectors, 1000);
for (const batch of batches) {
  await env.SEARCH_INDEX.insert(batch); // ✅ Fast, fewer requests
}

// 2. Add delays between large batch operations
for (const batch of largeBatches) {
  await env.SEARCH_INDEX.insert(batch);
  await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
}

// 3. Handle rate limit errors
async function insertWithRetry(
  vectors: VectorRecord[],
  env: Env,
  maxRetries = 3
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await env.SEARCH_INDEX.insert(vectors);
      return;
    } catch (error: any) {
      if (error.message?.includes("rate limit") && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}
```

### Concurrency Considerations

- **Benchmark target**: ~300 concurrent requests
- **Beyond 300**: Performance may degrade
- **Best practice**: Queue requests in application layer
- **Use Workers**: Co-located compute for lower latency

## Index Size Recommendations

| Use Case | Vectors | Dimensions | Index Strategy |
|----------|---------|------------|----------------|
| Small project | < 10K | 768 | Single index |
| Medium project | 10K - 100K | 768-1024 | Single index or namespace-based |
| Large project | 100K - 1M | 768-1536 | Multiple indexes by category |
| Enterprise | 1M - 5M | 768-1536 | Sharded across multiple indexes |
| Multi-tenant | Variable | 768-1536 | Namespace isolation or separate indexes |

### Sharding Strategy

```typescript
// Shard by content type
interface Env {
  DOCS_INDEX: Vectorize;      // Technical documentation
  CODE_INDEX: Vectorize;      // Code snippets
  SUPPORT_INDEX: Vectorize;   // Support articles
}

// Shard by tenant (for very large deployments)
function getIndexForTenant(tenantId: string, env: Env): Vectorize {
  const shard = hashTenantId(tenantId) % 10; // 10 shard indexes
  return env[`VECTORIZE_SHARD_${shard}`];
}

// Query across shards
async function multiShardQuery(vector: number[], env: Env) {
  const results = await Promise.all([
    env.DOCS_INDEX.query(vector, { topK: 5 }),
    env.CODE_INDEX.query(vector, { topK: 5 }),
    env.SUPPORT_INDEX.query(vector, { topK: 5 })
  ]);
  
  // Merge and re-sort
  return results
    .flatMap(r => r.matches)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}
```

## Troubleshooting Limit Errors

### Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `Dimension mismatch` | Vector size doesn't match index | Verify embedding model output dimensions |
| `Batch size exceeds limit` | > 1,000 vectors (Workers) or > 5,000 (HTTP) | Split into smaller batches |
| `topK exceeds limit` | topK > 20 with metadata/values | Reduce topK or remove metadata/values |
| `Metadata size exceeds limit` | > 10 KiB metadata per vector | Reduce metadata or store elsewhere |
| `Filter too large` | Filter JSON > 2,048 bytes | Simplify filter or split queries |
| `Quota exceeded` | Hit monthly dimension limit | Upgrade plan or optimize usage |
| `Index not found` | Wrong name or not created | Check `wrangler vectorize list` |

### Debugging Checklist

```typescript
// Validate before insert
function validateVector(vector: VectorRecord, expectedDims: number) {
  // Check dimensions
  if (vector.values.length !== expectedDims) {
    throw new Error(
      `Expected ${expectedDims} dims, got ${vector.values.length}`
    );
  }
  
  // Check ID length
  const idBytes = new TextEncoder().encode(vector.id).length;
  if (idBytes > 64) {
    throw new Error(`ID too long: ${idBytes} bytes (max 64)`);
  }
  
  // Check metadata size
  if (vector.metadata) {
    const metadataBytes = new TextEncoder()
      .encode(JSON.stringify(vector.metadata))
      .length;
    if (metadataBytes > 10240) { // 10 KiB
      throw new Error(`Metadata too large: ${metadataBytes} bytes (max 10240)`);
    }
  }
  
  // Check namespace length
  if (vector.namespace) {
    const nsBytes = new TextEncoder().encode(vector.namespace).length;
    if (nsBytes > 64) {
      throw new Error(`Namespace too long: ${nsBytes} bytes (max 64)`);
    }
  }
}
```

## Best Practices Summary

1. **Use presets** for Workers AI models to auto-configure dimensions
2. **Batch operations** to minimize requests and WAL jobs
3. **Leverage namespaces** for efficient tenant/category isolation
4. **Index only necessary metadata** to avoid performance degradation
5. **Choose appropriate topK** based on use case (5-10 for RAG, more for reranking)
6. **Monitor usage** to stay within quotas
7. **Shard large indexes** across multiple Vectorize indexes when approaching 5M vectors
8. **Use appropriate returnMetadata** level to minimize data transfer
9. **Validate inputs** before insert to catch errors early
10. **Handle errors gracefully** with retries and fallbacks

## References

- [Official Vectorize Limits Documentation](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Vectorize Pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
- [Metadata Filtering Documentation](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/)
- [Best Practices for Insert Operations](https://developers.cloudflare.com/vectorize/best-practices/insert-vectors/)
- [Cloudflare Blog: Building Vectorize](https://blog.cloudflare.com/building-vectorize-a-distributed-vector-database-on-cloudflare-developer-platform/)
