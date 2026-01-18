# Vectorize Index Management

Complete guide to creating, configuring, and managing Vectorize indexes.

## Index Creation

### Using Presets

Presets automatically configure dimensions and distance metrics to match Workers AI embedding models. This is the recommended approach when using Workers AI.

```bash
# BGE Base English - 768 dimensions, cosine similarity
wrangler vectorize create my-index --preset @cf/baai/bge-base-en-v1.5

# BGE Large English - 1024 dimensions, cosine similarity  
wrangler vectorize create my-index --preset @cf/baai/bge-large-en-v1.5

# BGE Small English - 384 dimensions, cosine similarity
wrangler vectorize create my-index --preset @cf/baai/bge-small-en-v1.5
```

**Benefits of presets:**
- Automatically matches model output dimensions
- Selects optimal distance metric for the model
- Simplifies configuration
- Reduces configuration errors

### Manual Configuration

For custom embeddings from external APIs (OpenAI, Cohere, etc.) or custom models:

```bash
# Create index with explicit configuration
wrangler vectorize create custom-index \
  --dimensions 1536 \
  --metric cosine

# OpenAI text-embedding-3-small (1536 dimensions)
wrangler vectorize create openai-index \
  --dimensions 1536 \
  --metric cosine

# OpenAI text-embedding-3-large (3072 dimensions)  
wrangler vectorize create openai-large-index \
  --dimensions 3072 \
  --metric cosine

# Cohere embed-english-v3.0 (1024 dimensions)
wrangler vectorize create cohere-index \
  --dimensions 1024 \
  --metric cosine
```

## Distance Metrics

Choose the appropriate distance metric based on your embedding model and use case.

### Cosine Similarity

**Most common for text embeddings.**

```bash
wrangler vectorize create index --dimensions 768 --metric cosine
```

- **Range**: -1 to 1 (1 = identical, -1 = opposite, 0 = orthogonal)
- **Use when**: Embeddings represent semantic meaning (text, documents)
- **Models**: Most text embedding models (BGE, OpenAI, Cohere)
- **Property**: Invariant to vector magnitude (only direction matters)
- **Formula**: `similarity = (A · B) / (||A|| × ||B||)`

### Euclidean Distance

**Measures absolute distance in vector space.**

```bash
wrangler vectorize create index --dimensions 768 --metric euclidean
```

- **Range**: 0 to ∞ (0 = identical, larger = more different)
- **Use when**: Magnitude and direction both matter
- **Models**: Computer vision embeddings, some custom models
- **Property**: Sensitive to vector magnitude
- **Formula**: `distance = √(Σ(A[i] - B[i])²)`

### Dot Product

**Measures projection alignment.**

```bash
wrangler vectorize create index --dimensions 768 --metric dot-product
```

- **Range**: -∞ to ∞ (higher = more similar)
- **Use when**: Embeddings are pre-normalized
- **Models**: Models that output normalized vectors
- **Property**: Faster than cosine when vectors are normalized
- **Formula**: `similarity = Σ(A[i] × B[i])`

**Note**: For normalized vectors, dot product is equivalent to cosine similarity but faster to compute.

## Choosing Dimensions

The dimension count must match your embedding model's output.

| Model | Dimensions | Preset |
|-------|-----------|--------|
| Workers AI: BGE Base | 768 | `@cf/baai/bge-base-en-v1.5` |
| Workers AI: BGE Large | 1024 | `@cf/baai/bge-large-en-v1.5` |
| Workers AI: BGE Small | 384 | `@cf/baai/bge-small-en-v1.5` |
| OpenAI: text-embedding-3-small | 1536 | Manual |
| OpenAI: text-embedding-3-large | 3072 or 1536* | Manual |
| OpenAI: text-embedding-ada-002 | 1536 | Manual |
| Cohere: embed-english-v3.0 | 1024 | Manual |
| Cohere: embed-multilingual-v3.0 | 1024 | Manual |

*OpenAI's text-embedding-3-large supports dimension reduction

### Dimension Considerations

**Higher dimensions:**
- ✅ Better semantic precision
- ✅ More information captured
- ❌ Higher storage costs
- ❌ Slower query performance
- ❌ More data needed for training

**Lower dimensions:**
- ✅ Faster queries
- ✅ Lower storage costs
- ✅ Better for large-scale systems
- ❌ Less semantic precision
- ❌ More false positives

## Index Management

### List Indexes

```bash
# List all indexes
wrangler vectorize list

# Output shows:
# - Index name
# - Dimensions
# - Distance metric
# - Vector count
```

### Get Index Info

```bash
# Show detailed index information
wrangler vectorize get my-index

# Returns:
# - Configuration (dimensions, metric)
# - Statistics (vector count, storage size)
# - Creation date
```

### Delete Index

```bash
# Delete an index (irreversible!)
wrangler vectorize delete my-index

# Confirmation required
```

**Warning**: Deleting an index removes all vectors permanently. There is no recovery option.

## Binding Configuration

### Single Index

```jsonc
{
  "vectorize": [
    { "binding": "SEARCH_INDEX", "index_name": "my-index" }
  ]
}
```

```typescript
interface Env {
  SEARCH_INDEX: Vectorize;
}
```

### Multiple Indexes

Use multiple indexes for different purposes or tenants:

```jsonc
{
  "vectorize": [
    { "binding": "DOCS_INDEX", "index_name": "documentation" },
    { "binding": "CODE_INDEX", "index_name": "code-snippets" },
    { "binding": "FAQ_INDEX", "index_name": "faqs" }
  ]
}
```

```typescript
interface Env {
  DOCS_INDEX: Vectorize;
  CODE_INDEX: Vectorize;
  FAQ_INDEX: Vectorize;
}

export default {
  async fetch(req: Request, env: Env) {
    // Route to appropriate index based on content type
    const { query, type } = await req.json();
    
    const index = type === "code" ? env.CODE_INDEX :
                  type === "faq" ? env.FAQ_INDEX :
                  env.DOCS_INDEX;
    
    const results = await index.query(queryVector, { topK: 5 });
    return Response.json(results);
  }
};
```

## Local Development

### Using Remote Indexes

Vectorize indexes must use `remote: true` in local development:

```jsonc
{
  "vectorize": [
    {
      "binding": "SEARCH_INDEX",
      "index_name": "my-index",
      "remote": true  // Required for local dev
    }
  ]
}
```

```bash
# Start dev server with remote Vectorize
wrangler dev
```

**Note**: There is no local simulation for Vectorize. All operations hit the real index, even in development.

## Limits and Quotas

### Free Tier

- **Vector operations**: 30 million queried vectors / month
- **Vectorize usage**: 5 million stored vector dimensions
- **Indexes**: Multiple indexes allowed
- **Index size**: Up to 100,000 vectors per index (soft limit)

### Paid Plans

- **Higher limits**: Contact Cloudflare for enterprise quotas
- **More storage**: Millions of vectors per index
- **Priority support**: Faster support response

### Best Practices for Limits

1. **Monitor usage**: Check dashboard for vector operations and storage
2. **Optimize queries**: Use appropriate `topK` values (don't query more than needed)
3. **Batch operations**: Insert/upsert multiple vectors at once
4. **Clean up**: Delete unused vectors to free storage
5. **Index design**: Consider multiple smaller indexes vs one large index

## Migration and Backup

### Export Vectors

Vectorize doesn't have a built-in export command. To backup:

```typescript
// Fetch all vectors (be careful with large indexes!)
async function exportVectors(env: Env) {
  const vectors: any[] = [];
  let cursor: string | undefined;
  
  do {
    // Note: There's no pagination API yet
    // This is a conceptual pattern for future support
    const batch = await env.SEARCH_INDEX.getByIds(allKnownIds);
    vectors.push(...batch);
  } while (cursor);
  
  return vectors;
}
```

### Re-index Strategy

To change index configuration:

1. **Create new index** with desired configuration
2. **Migrate vectors** by fetching from old and inserting to new
3. **Update bindings** in `wrangler.jsonc`
4. **Deploy** Worker with new binding
5. **Delete old index** after verifying migration

```bash
# 1. Create new index
wrangler vectorize create my-index-v2 --preset @cf/baai/bge-base-en-v1.5

# 2. Run migration worker (fetch from old, insert to new)
wrangler dev # Run migration script

# 3. Update wrangler.jsonc binding
# 4. Deploy
wrangler deploy

# 5. Clean up old index
wrangler vectorize delete my-index
```

## Index Naming Conventions

Use clear, descriptive names that indicate purpose:

```bash
# Good names
wrangler vectorize create docs-embeddings-prod
wrangler vectorize create code-search-staging  
wrangler vectorize create customer-support-v2

# Avoid
wrangler vectorize create index1
wrangler vectorize create test
wrangler vectorize create my-index
```

**Conventions:**
- Include purpose: `docs`, `code`, `products`
- Include environment: `prod`, `staging`, `dev`
- Include version: `v1`, `v2` for schema changes
- Use kebab-case: `customer-support` not `customer_support`

## Index Design Patterns

### Single Large Index

**Pros:**
- Simpler management
- Cross-domain search
- Easier to maintain

**Cons:**
- Slower queries at scale
- Mixed content types
- Harder to optimize per-type

**Use when:**
- < 100k vectors
- Similar content types
- Cross-category search needed

### Multiple Specialized Indexes

**Pros:**
- Faster queries
- Type-specific optimization
- Independent scaling
- Easier to debug

**Cons:**
- More complex deployment
- Multiple binding management
- Can't search across types easily

**Use when:**
- > 100k vectors total
- Distinct content types
- Need per-type optimization
- Multi-tenant isolation

### Hybrid Approach

```jsonc
{
  "vectorize": [
    // Main content index
    { "binding": "CONTENT", "index_name": "content-main" },
    
    // Specialized indexes
    { "binding": "USERS", "index_name": "user-profiles" },
    { "binding": "PRODUCTS", "index_name": "product-catalog" }
  ]
}
```

Search multiple indexes and merge results:

```typescript
const [contentResults, productResults] = await Promise.all([
  env.CONTENT.query(vector, { topK: 5 }),
  env.PRODUCTS.query(vector, { topK: 5 })
]);

// Merge and re-sort by score
const merged = [...contentResults.matches, ...productResults.matches]
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `Dimension mismatch` | Vector size doesn't match index | Verify embedding model output dimensions |
| `Index not found` | Wrong index name or not created | Check `wrangler vectorize list` |
| `Binding undefined` | Missing binding in wrangler.jsonc | Add vectorize binding and run `wrangler types` |
| `Permission denied` | Not authenticated | Run `wrangler login` |
| `Quota exceeded` | Hit free tier limits | Check dashboard, upgrade plan, or optimize usage |

### Validation Checklist

Before deploying:

- [ ] Index created with correct dimensions
- [ ] Metric matches embedding model type
- [ ] Binding added to `wrangler.jsonc`
- [ ] `wrangler types` generated TypeScript definitions
- [ ] Local dev tested with `remote: true`
- [ ] Embedding model matches index preset (if using Workers AI)
- [ ] Error handling for insert/query failures

### Debug Commands

```bash
# Verify index exists
wrangler vectorize get my-index

# Check configuration
wrangler check

# Generate types
wrangler types

# Test in dev mode
wrangler dev
```
