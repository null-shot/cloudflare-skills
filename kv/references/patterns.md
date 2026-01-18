# Workers KV Advanced Patterns

## Cache Invalidation Strategies

### Time-based Invalidation (TTL)

```typescript
// Simple TTL - expires after fixed time
await env.CACHE.put("api:users", data, {
  expirationTtl: 3600 // 1 hour
})
```

### Version-based Invalidation

```typescript
// Include version in key
const version = "v2"
const key = `data:${version}:users`

await env.CACHE.put(key, data, {
  metadata: { version, updated: Date.now() }
})

// Invalidate by incrementing version
// Old keys naturally expire via TTL
```

### Manual Invalidation

```typescript
// Store cache keys for later invalidation
const cacheKey = `cache:user:${userId}`
await env.CACHE.put(cacheKey, data, { expirationTtl: 3600 })

// Track cache keys in a list
await env.CACHE.put(`cache-keys:user:${userId}`, cacheKey)

// Invalidate all caches for user
const keys = await env.CACHE.get(`cache-keys:user:${userId}`)
if (keys) {
  for (const key of JSON.parse(keys)) {
    await env.CACHE.delete(key)
  }
}
```

### Stale-While-Revalidate

```typescript
interface CacheEntry {
  data: any;
  timestamp: number;
  stale: boolean;
}

async function getWithSWR(
  env: Env, 
  key: string, 
  fetchFn: () => Promise<any>,
  maxAge: number = 60,
  staleAge: number = 300
) {
  const cached = await env.CACHE.get<CacheEntry>(key, "json")
  const now = Date.now()

  if (cached) {
    const age = (now - cached.timestamp) / 1000

    if (age < maxAge) {
      // Fresh, return immediately
      return cached.data
    }

    if (age < staleAge) {
      // Stale but usable, revalidate in background
      ctx.waitUntil(revalidate())
      return cached.data
    }
  }

  // Missing or too stale, fetch now
  return await revalidate()

  async function revalidate() {
    const fresh = await fetchFn()
    await env.CACHE.put(key, JSON.stringify({
      data: fresh,
      timestamp: now,
      stale: false
    }), { expirationTtl: staleAge })
    return fresh
  }
}
```

## A/B Testing

### Simple Feature Flag

```typescript
interface FeatureFlags {
  newUI: boolean;
  betaFeatures: boolean;
}

async function getFeatureFlags(env: Env, userId: string): Promise<FeatureFlags> {
  // Check user override first
  const override = await env.CONFIG.get<FeatureFlags>(`flags:${userId}`, "json")
  if (override) return override

  // Fall back to global config
  const global = await env.CONFIG.get<FeatureFlags>("flags:default", "json")
  return global || { newUI: false, betaFeatures: false }
}
```

### Percentage-based Rollout

```typescript
async function getExperimentVariant(
  env: Env,
  experimentName: string,
  userId: string
): Promise<"control" | "variant_a" | "variant_b"> {
  // Check if user already assigned
  const key = `experiment:${experimentName}:${userId}`
  const existing = await env.CONFIG.get(key)
  if (existing) return existing as any

  // Get rollout config
  const config = await env.CONFIG.get<{
    control: number;
    variant_a: number;
    variant_b: number;
  }>(`experiment:${experimentName}:config`, "json")

  if (!config) return "control"

  // Hash user ID for stable assignment
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userId)
  )
  const hashInt = new DataView(hash).getUint32(0)
  const percentage = (hashInt % 100) / 100

  // Assign based on percentage
  let variant: "control" | "variant_a" | "variant_b"
  if (percentage < config.variant_a) {
    variant = "variant_a"
  } else if (percentage < config.variant_a + config.variant_b) {
    variant = "variant_b"
  } else {
    variant = "control"
  }

  // Store assignment
  await env.CONFIG.put(key, variant, {
    expirationTtl: 86400 * 30 // 30 days
  })

  return variant
}

// Usage
const variant = await getExperimentVariant(env, "new-checkout", userId)
if (variant === "variant_a") {
  // Show new checkout flow
}
```

## Distributed Counters (Best Effort)

**Note:** For accurate counting, use Durable Objects. KV is eventually consistent.

```typescript
// Approximate counter with sharding
async function incrementCounter(env: Env, name: string) {
  // Shard across 10 keys to reduce write conflicts
  const shard = Math.floor(Math.random() * 10)
  const key = `counter:${name}:${shard}`

  const current = await env.COUNTERS.get(key)
  const value = current ? parseInt(current) + 1 : 1

  await env.COUNTERS.put(key, String(value))
}

async function getCounter(env: Env, name: string): Promise<number> {
  let total = 0

  for (let shard = 0; shard < 10; shard++) {
    const key = `counter:${name}:${shard}`
    const value = await env.COUNTERS.get(key)
    if (value) total += parseInt(value)
  }

  return total
}
```

## Distributed Locks (Unreliable - Use Durable Objects)

**Warning:** KV's eventual consistency makes locks unreliable. This pattern shows the concept but should NOT be used for critical operations.

```typescript
// DO NOT USE IN PRODUCTION - for demonstration only
async function acquireLock(
  env: Env,
  resource: string,
  ttl: number = 30
): Promise<string | null> {
  const lockId = crypto.randomUUID()
  const key = `lock:${resource}`

  // Try to acquire lock
  const existing = await env.LOCKS.get(key)
  if (existing) return null // Already locked

  // Set lock
  await env.LOCKS.put(key, lockId, { expirationTtl: ttl })

  // Verify we got the lock (eventual consistency can cause race)
  await new Promise(resolve => setTimeout(resolve, 100))
  const check = await env.LOCKS.get(key)

  if (check === lockId) {
    return lockId // Success
  }

  return null // Lost race
}

async function releaseLock(env: Env, resource: string, lockId: string) {
  const key = `lock:${resource}`
  const current = await env.LOCKS.get(key)

  if (current === lockId) {
    await env.LOCKS.delete(key)
  }
}

// Better: Use Durable Objects for reliable locks
```

## User Preferences

```typescript
interface UserPreferences {
  theme: "light" | "dark";
  language: string;
  notifications: boolean;
  timezone: string;
}

async function getUserPreferences(
  env: Env,
  userId: string
): Promise<UserPreferences> {
  const prefs = await env.USER_DATA.get<UserPreferences>(
    `prefs:${userId}`,
    "json"
  )

  return prefs || {
    theme: "light",
    language: "en",
    notifications: true,
    timezone: "UTC"
  }
}

async function updateUserPreferences(
  env: Env,
  userId: string,
  updates: Partial<UserPreferences>
) {
  const current = await getUserPreferences(env, userId)
  const updated = { ...current, ...updates }

  await env.USER_DATA.put(
    `prefs:${userId}`,
    JSON.stringify(updated),
    {
      metadata: { updatedAt: Date.now() }
    }
  )
}
```

## API Response Caching with Headers

```typescript
async function getCachedResponse(
  env: Env,
  request: Request
): Promise<Response> {
  const cacheKey = `cache:${request.url}`

  // Check cache
  const cached = await env.CACHE.get(cacheKey)
  if (cached) {
    return new Response(cached, {
      headers: {
        "Content-Type": "application/json",
        "X-Cache": "HIT"
      }
    })
  }

  // Fetch from origin
  const response = await fetch(request)
  const data = await response.text()

  // Cache based on response headers
  const cacheControl = response.headers.get("Cache-Control")
  let ttl = 300 // default 5 minutes

  if (cacheControl) {
    const maxAge = cacheControl.match(/max-age=(\d+)/)
    if (maxAge) ttl = parseInt(maxAge[1])
  }

  // Only cache successful responses
  if (response.ok) {
    await env.CACHE.put(cacheKey, data, { expirationTtl: ttl })
  }

  return new Response(data, {
    headers: response.headers,
    status: response.status
  })
}
```

## Multi-Region Data Replication

```typescript
// Write to multiple KV namespaces for faster local reads
async function writeMultiRegion(
  env: Env,
  key: string,
  value: string
) {
  // Write to all regional KV namespaces in parallel
  await Promise.all([
    env.KV_US.put(key, value),
    env.KV_EU.put(key, value),
    env.KV_ASIA.put(key, value)
  ])
}

async function readNearestRegion(
  env: Env,
  key: string,
  region: string
): Promise<string | null> {
  // Read from regional KV based on request location
  const kv = region === "EU" ? env.KV_EU :
             region === "ASIA" ? env.KV_ASIA :
             env.KV_US

  return await kv.get(key)
}
```

## Best Practices Summary

1. **Use TTL aggressively**: Prevent stale data accumulation
2. **Don't depend on consistency**: KV is eventually consistent
3. **Shard hot keys**: Distribute writes across multiple keys
4. **Use metadata for filtering**: Avoid reading values unnecessarily
5. **Batch reads with list()**: More efficient than individual gets
6. **Use Durable Objects for coordination**: KV is not suitable for locks or transactions
7. **Monitor costs**: Optimize write patterns, reads are cheaper
8. **Version your data**: Makes schema migrations easier
9. **Handle errors gracefully**: KV operations can fail, plan fallbacks
10. **Test with preview namespaces**: Use separate namespace for development
