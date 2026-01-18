# Workers KV Limits and Consistency

## Storage Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| Key size | 512 bytes | UTF-8 encoded |
| Value size | 25 MB | Per key |
| Metadata size | 1,024 bytes | JSON-serialized |
| Namespace keys | Unlimited | Subject to account limits |
| Namespaces per account | 100 | Increase via support |
| Keys per list operation | 1,000 | Use cursor for pagination |

### Key Naming

```typescript
// Valid keys (up to 512 bytes)
"user:123"
"cache:api:/v1/users?page=1"
"session:abc123def456"

// Too long - will error
const tooLong = "x".repeat(513)
await env.KV.put(tooLong, "value") // Error
```

### Value Size

```typescript
// Check value size before writing
const value = JSON.stringify(largeObject)
const bytes = new TextEncoder().encode(value).length

if (bytes > 25 * 1024 * 1024) {
  // Use R2 instead
  await env.BUCKET.put("large-object", value)
} else {
  await env.KV.put("key", value)
}
```

## Rate Limits

### Free Plan

| Operation | Limit |
|-----------|-------|
| Read operations | 100,000/day |
| Write operations | 1,000/day |
| Delete operations | 1,000/day |
| List operations | 1,000/day |

### Paid Plans

| Operation | Limit |
|-----------|-------|
| Read operations | Unlimited (billed per million) |
| Write operations | Unlimited (billed per million) |
| Delete operations | Unlimited (billed per million) |
| List operations | Unlimited (billed per operation) |

### Request Throttling

```typescript
// KV can throttle excessive writes to same key
// Spread writes across multiple keys (sharding)

// Bad: Hot key
for (let i = 0; i < 1000; i++) {
  await env.KV.put("counter", String(i))
}

// Better: Shard across multiple keys
for (let i = 0; i < 1000; i++) {
  const shard = i % 10
  await env.KV.put(`counter:${shard}`, String(i))
}
```

## Consistency Model

### Eventual Consistency

KV is **eventually consistent**:
- Writes propagate globally within seconds (typically <60s)
- No guarantee of immediate consistency
- Reads may return stale data or null after write

```typescript
// Write
await env.KV.put("key", "new-value")

// Read immediately - might return old value or null
const value = await env.KV.get("key") // ⚠️ Potentially stale

// For strong consistency, use Durable Objects
```

### Write Conflicts

```typescript
// Two simultaneous writes to same key
// Last write wins (undefined which one)

// Worker 1
await env.KV.put("counter", "1")

// Worker 2 (at same time)
await env.KV.put("counter", "2")

// Final value: "1" or "2" (non-deterministic)
```

### Read-Your-Writes

```typescript
// NOT GUARANTEED: May not see your own write immediately
await env.KV.put("session:abc", userData)

// This read might return null
const data = await env.KV.get("session:abc")

// Workaround: Cache locally for same request
const cache = new Map()

await env.KV.put("key", "value")
cache.set("key", "value")

const value = cache.get("key") ?? await env.KV.get("key")
```

## Performance Characteristics

### Latency

| Operation | Typical Latency | Notes |
|-----------|----------------|-------|
| Read (cache hit) | <1ms | Data in same region |
| Read (cache miss) | 10-100ms | Fetch from global network |
| Write | 1-10ms | Async propagation to edge |
| List | 10-100ms | Depends on key count |
| Delete | 1-10ms | Async propagation to edge |

### Caching Behavior

```typescript
// KV automatically caches reads at the edge
// First read: ~50ms (fetch from storage)
const value1 = await env.KV.get("popular-key")

// Subsequent reads: <1ms (served from cache)
const value2 = await env.KV.get("popular-key")

// Cache duration: ~60 seconds at edge
// After TTL, next read fetches from storage again
```

### Cold Start Impact

```typescript
// First KV operation after cold start: +10-50ms
// Includes binding initialization

// Subsequent operations in same request: normal latency
await env.KV.get("key1") // +10-50ms
await env.KV.get("key2") // Normal
await env.KV.get("key3") // Normal
```

## Pricing (as of 2026)

### Storage

- **$0.50 per GB-month**
- Billed hourly based on stored data

### Operations

| Operation | Cost (per million) |
|-----------|-------------------|
| Reads | $0.50 |
| Writes | $5.00 |
| Deletes | $5.00 |
| Lists | $5.00 |

### Cost Optimization

```typescript
// Expensive: Individual writes
for (const user of users) {
  await env.KV.put(`user:${user.id}`, JSON.stringify(user))
}
// Cost: 1000 writes = $0.005

// Cheaper: Batch into single key
await env.KV.put("users:batch", JSON.stringify(users))
// Cost: 1 write = $0.000005

// Trade-off: Must read entire batch to get one user
```

## Comparison with Other Storage

| Feature | KV | Durable Objects | D1 | R2 |
|---------|----|-----------------|----|-----|
| Consistency | Eventual | Strong | Strong | Strong |
| Latency | <10ms | <10ms | ~50ms | ~50ms |
| Max value size | 25 MB | Unlimited (SQL) | Row-based | 5 TB |
| Query support | Key-only | SQL | SQL | Key-only |
| Use case | Cache, config | State, locks | Relational | Files, objects |
| Write cost | $5/million | Included | $0.75/million | $4.50/million |

## When NOT to Use KV

### Strong Consistency Required

```typescript
// Bad: Using KV for inventory count
async function purchaseItem(env: Env, itemId: string) {
  const count = await env.KV.get(`inventory:${itemId}`)
  if (parseInt(count) > 0) {
    await env.KV.put(`inventory:${itemId}`, String(parseInt(count) - 1))
    // ⚠️ Race condition! Two requests can read same count
  }
}

// Good: Use Durable Object for atomic operations
```

### Transactional Operations

```typescript
// Bad: Multi-key transaction in KV
async function transfer(env: Env, from: string, to: string, amount: number) {
  const fromBalance = await env.KV.get(`balance:${from}`)
  const toBalance = await env.KV.get(`balance:${to}`)
  
  await env.KV.put(`balance:${from}`, String(parseInt(fromBalance) - amount))
  await env.KV.put(`balance:${to}`, String(parseInt(toBalance) + amount))
  // ⚠️ Not atomic! Can fail partway through
}

// Good: Use D1 transaction or Durable Object
```

### Real-time Coordination

```typescript
// Bad: Using KV for presence system
await env.KV.put(`online:${userId}`, "true", { expirationTtl: 60 })

// Check who's online
const users = await env.KV.list({ prefix: "online:" })
// ⚠️ Stale data, eventual consistency issues

// Good: Use Durable Object for real-time state
```

### Relational Queries

```typescript
// Bad: Filtering/joining in KV
const allUsers = await env.KV.list({ prefix: "user:" })
const activeUsers = []
for (const key of allUsers.keys) {
  const user = await env.KV.get(key.name, "json")
  if (user.active && user.role === "admin") {
    activeUsers.push(user)
  }
}
// ⚠️ Slow, expensive, not scalable

// Good: Use D1 with SQL queries
```

## Monitoring and Debugging

### Check KV Usage

```bash
# View namespaces
wrangler kv namespace list

# Count keys in namespace
wrangler kv key list --namespace-id=<ID> | wc -l

# Get specific key
wrangler kv key get "my-key" --namespace-id=<ID>

# Delete key
wrangler kv key delete "my-key" --namespace-id=<ID>
```

### Analytics

```typescript
// Track KV operation latency
async function getWithMetrics(env: Env, key: string) {
  const start = Date.now()
  const value = await env.KV.get(key)
  const latency = Date.now() - start

  // Log to Analytics Engine
  env.ANALYTICS.writeDataPoint({
    blobs: [key],
    doubles: [latency],
    indexes: ["kv_get_latency"]
  })

  return value
}
```

### Error Handling

```typescript
// KV operations can fail - handle gracefully
try {
  const value = await env.KV.get("key")
  if (value === null) {
    // Key not found or expired
    return defaultValue
  }
  return value
} catch (error) {
  console.error("KV error:", error)
  // Fallback to origin or error response
  return await fetchFromOrigin()
}
```

## Best Practices Summary

1. **Respect limits**: 25 MB value, 512 byte key, 1 KB metadata
2. **Plan for eventual consistency**: Don't assume immediate read-your-writes
3. **Use TTL for all temporary data**: Prevent unbounded growth
4. **Shard hot keys**: Distribute writes to avoid throttling
5. **Monitor costs**: Writes are 10x more expensive than reads
6. **Choose right storage**: KV for cache, DO for coordination, D1 for queries, R2 for files
7. **Handle errors**: KV operations can fail, have fallbacks
8. **Test consistency behavior**: Use preview namespace to verify timing
9. **Use metadata wisely**: Store timestamps, versions without reading values
10. **Consider alternatives**: Durable Objects for strong consistency, D1 for relational data
