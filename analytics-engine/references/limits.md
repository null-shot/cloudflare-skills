# Analytics Engine Limits and Constraints

Comprehensive guide to all limits, constraints, and quotas for Cloudflare Workers Analytics Engine.

*Last updated: January 2026*

## Write Limits

### Data Points per Invocation

| Limit | Value | Notes |
|-------|-------|-------|
| Max data points per Worker invocation | 250 | Each `writeDataPoint()` call counts toward this limit |
| Recommended batch size | 100-250 | Use `writeDataPoints()` for batching |

**Example:**

```typescript
// ❌ Will fail - exceeds 250 limit
for (let i = 0; i < 300; i++) {
  env.EVENTS.writeDataPoint({ ... });
}

// ✅ Correct - batch within limits
const dataPoints = events.slice(0, 250).map(event => ({
  doubles: [event.value],
  blobs: [event.name],
  indexes: [event.userId],
}));

env.EVENTS.writeDataPoints(dataPoints);
```

### Fields per Data Point

| Field Type | Max Count | Notes |
|------------|-----------|-------|
| Blobs (strings) | 20 | Text labels, IDs, categories |
| Doubles (numbers) | 20 | Numeric metrics |
| Indexes | 1 | Single grouping key per data point |

**Note**: The original documentation mentioned "up to 20 indexes" but current implementation (as of 2026) supports only **1 index** field per data point for partitioning and sampling.

### Field Size Limits

| Limit | Value | Changed |
|-------|-------|---------|
| Index size | 96 bytes | - |
| Total blobs size per data point | 16 KB (16,384 bytes) | ✅ Increased from 5 KB (June 20, 2025) |
| Individual blob size | No specific limit | Limited by 16 KB total |

**Blob size calculation:**

```typescript
// Calculate total blob size
const blobs = ["/api/users", "GET", "200", "user-agent-string"];
const totalSize = blobs.reduce((sum, blob) => sum + new TextEncoder().encode(blob).length, 0);

if (totalSize > 16384) {
  console.error(`Blobs exceed 16KB limit: ${totalSize} bytes`);
}
```

**Handling large blobs:**

```typescript
function truncateToFit(blobs: string[], maxBytes = 16384): string[] {
  const encoder = new TextEncoder();
  let totalSize = 0;
  
  return blobs.map(blob => {
    const blobSize = encoder.encode(blob).length;
    const remainingSpace = maxBytes - totalSize;
    
    if (blobSize > remainingSpace) {
      // Truncate to fit
      return blob.slice(0, Math.floor(remainingSpace * 0.9));
    }
    
    totalSize += blobSize;
    return blob;
  });
}
```

## Data Retention

| Limit | Value | Notes |
|-------|-------|-------|
| Retention period | 3 months (90 days) | Automatically purged after 90 days |
| Historical data access | No archive | Data older than 3 months is not available |

**Planning for retention:**

```typescript
// Query data within retention window
const query = `
  SELECT *
  FROM events
  WHERE timestamp > NOW() - INTERVAL '89' DAY
  -- Stay within 90-day retention window
`;
```

**Long-term storage pattern:**

If you need data beyond 3 months, export to R2:

```typescript
// Daily export job (via Cron Trigger)
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    // Query yesterday's data
    const query = `
      SELECT *
      FROM events
      WHERE timestamp >= DATE_TRUNC('day', NOW() - INTERVAL '1' DAY)
        AND timestamp < DATE_TRUNC('day', NOW())
    `;
    
    const data = await queryAnalyticsEngine(env, query);
    
    // Export to R2 for long-term storage
    const key = `analytics/${new Date().toISOString().slice(0, 10)}.json`;
    await env.ANALYTICS_BACKUP.put(key, JSON.stringify(data));
  },
};
```

## Free Tier Limits

| Metric | Free Tier Limit | Notes |
|--------|----------------|-------|
| Data points written | 100,000 per day | Resets daily |
| SQL API queries | 10,000 per day | Resets daily |
| GraphQL API queries | 10,000 per day | Resets daily |

**Current pricing status**: Cloudflare is not yet charging for Analytics Engine usage. These limits are published for planning purposes.

**Monitoring usage:**

```typescript
// Track daily writes
let dailyWrites = 0;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Check limit
    if (dailyWrites >= 100000) {
      console.warn("Daily write limit reached");
      // Handle gracefully - maybe queue for tomorrow
      return new Response("OK", { status: 200 });
    }
    
    env.EVENTS.writeDataPoint({ ... });
    dailyWrites++;
    
    return new Response("OK");
  },
};
```

**Rate limiting pattern:**

```typescript
// Use KV to track daily usage
async function canWrite(env: Env): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `analytics:writes:${today}`;
  
  const count = await env.RATE_LIMIT.get(key);
  const current = parseInt(count || "0", 10);
  
  if (current >= 100000) {
    return false;
  }
  
  await env.RATE_LIMIT.put(key, (current + 1).toString(), {
    expirationTtl: 86400, // 24 hours
  });
  
  return true;
}
```

## Cardinality Limits

| Aspect | Limit | Notes |
|--------|-------|-------|
| Unique index values | Unlimited | High cardinality supported |
| Unique blob values | Unlimited | Per dataset |
| Datasets per account | No published limit | Practical limit likely exists |

**High-cardinality support:**

Analytics Engine is designed for high-cardinality data (millions of unique users, sessions, etc.). However, adaptive sampling may occur at extremely high volumes.

**Sampling behavior:**

```typescript
// Analytics Engine uses adaptive sampling for high-volume indexes
// Example: 1 million events/second for same index value

// Low volume: No sampling
env.EVENTS.writeDataPoint({
  indexes: ["user123"],  // Few writes per second
  ...
});

// High volume: Automatic sampling
// Events are sampled, with _sample_interval field added
// Queries automatically account for sampling
```

## Query Limits

### Query Performance

| Metric | Typical Value | Notes |
|--------|--------------|-------|
| Average query latency | ~100 ms | For most queries |
| P99 query latency | ~300 ms | More complex queries |
| Query timeout | Not published | Uses adaptive sampling to bound execution |

**Adaptive Bit Rate (ABR) sampling:**

Analytics Engine automatically samples data when queries would be too expensive:

```sql
-- Long time range query - automatic sampling
SELECT COUNT(*) AS event_count
FROM events
WHERE timestamp > NOW() - INTERVAL '90' DAY;
-- Returns sampled count with _sample_interval adjustment
```

### Query Result Limits

| Limit | Estimated Value | Notes |
|-------|----------------|-------|
| Max result size | ~10 MB | Approximate limit |
| Recommended LIMIT | 1,000-10,000 rows | For best performance |

**Handling large results:**

```sql
-- ❌ May timeout or truncate
SELECT * FROM events;

-- ✅ Use LIMIT and time filters
SELECT *
FROM events
WHERE timestamp > NOW() - INTERVAL '1' HOUR
LIMIT 10000;

-- ✅ Aggregate instead of raw data
SELECT
  DATE_TRUNC('hour', timestamp) AS hour,
  COUNT(*) AS event_count
FROM events
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY hour;
```

### Query Complexity

No published hard limits, but best practices:

- **Use time filters**: Always filter by timestamp
- **Limit result sets**: Use `LIMIT` clause
- **Aggregate when possible**: GROUP BY reduces result size
- **Index-based filtering**: Filter by index field for best performance

## Sampling and Accuracy

### Write-Time Sampling

| Scenario | Sampling Behavior |
|----------|------------------|
| Normal write rate | No sampling, all data points stored |
| High-volume burst (same index) | Adaptive sampling triggered |
| Sustained high rate (same index) | Continuous sampling |

**Sample interval field:**

When sampling occurs, each record includes a `_sample_interval` field indicating how many original events it represents.

**Query adjustments for sampling:**

```sql
-- ❌ WRONG - Doesn't account for sampling
SELECT COUNT(*) AS event_count FROM events;

-- ✅ CORRECT - Accounts for sampling
SELECT SUM(_sample_interval) AS event_count FROM events;

-- ❌ WRONG - Sum without sampling
SELECT SUM(double1) AS total_revenue FROM events;

-- ✅ CORRECT - Sum with sampling
SELECT SUM(double1 * _sample_interval) AS total_revenue FROM events;

-- Averages work the same way (automatically weighted)
SELECT AVG(double1) AS avg_response_time FROM events;
```

### Accuracy Considerations

| Metric Type | Accuracy | Notes |
|-------------|----------|-------|
| Aggregates (SUM, AVG, COUNT) | High | Sampling-adjusted |
| Rare events | Lower | May be undersampled |
| Unique counts | Approximate | HyperLogLog-based |
| Percentiles | High | For indexed dimensions |

**Design for accuracy:**

```typescript
// ✅ Good for accuracy - use index for important dimensions
env.EVENTS.writeDataPoint({
  doubles: [revenue],
  blobs: [productId],
  indexes: [customerId],  // Customer is most important dimension
});

// Query by customer is highly accurate
// SELECT SUM(double1 * _sample_interval) AS revenue
// FROM events
// WHERE index1 = 'customer123'
```

## Dataset Limits

| Limit | Value | Notes |
|-------|-------|-------|
| Datasets per account | No published limit | Create as needed |
| Dataset name length | No published limit | Use reasonable names |
| Concurrent writes per dataset | No published limit | Designed for high throughput |

**Multiple datasets pattern:**

```typescript
interface Env {
  // Separate datasets by purpose
  API_METRICS: AnalyticsEngineDataset;
  USER_EVENTS: AnalyticsEngineDataset;
  BILLING_EVENTS: AnalyticsEngineDataset;
  ERROR_LOGS: AnalyticsEngineDataset;
}
```

## API Rate Limits

### SQL API

| Limit | Free Tier | Notes |
|-------|-----------|-------|
| Queries per day | 10,000 | Resets daily |
| Concurrent queries | No published limit | Reasonable concurrency supported |

### GraphQL API

| Limit | Free Tier | Notes |
|-------|-----------|-------|
| Queries per day | 10,000 | Resets daily |
| Query complexity | No published limit | Uses adaptive sampling |

## Edge Cases and Behaviors

### Writes During High Load

When a Worker is under heavy load and writing many data points:

```typescript
// Writes are non-blocking and buffered
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // These writes are buffered asynchronously
    env.EVENTS.writeDataPoint({ ... }); // Non-blocking
    env.METRICS.writeDataPoint({ ... }); // Non-blocking
    
    // Worker responds immediately
    return new Response("OK");
  },
};
```

**Buffer behavior:**
- Writes are buffered and batched automatically
- If buffer exceeds limits, writes may be dropped
- No error is returned for dropped writes

### Network Failures

Writes are fire-and-forget. Network failures result in silent data loss:

```typescript
// For critical data, use dual writes
function writeCriticalEvent(env: Env, event: Event) {
  // Write to Analytics Engine (fire-and-forget)
  env.ANALYTICS.writeDataPoint({
    doubles: [event.value],
    blobs: [event.type],
    indexes: [event.userId],
  });
  
  // Also write to D1 for guaranteed durability
  await env.DB.prepare(
    "INSERT INTO critical_events (user_id, type, value) VALUES (?, ?, ?)"
  ).bind(event.userId, event.type, event.value).run();
}
```

### Exceeding Field Limits

What happens when you exceed limits:

```typescript
// Exceeding blob size limit
env.EVENTS.writeDataPoint({
  blobs: [
    "x".repeat(20000), // 20 KB - exceeds 16 KB total limit
  ],
  indexes: ["user123"],
});
// Result: Write may fail silently or be truncated

// Exceeding field count
env.EVENTS.writeDataPoint({
  doubles: Array(25).fill(1), // 25 doubles - exceeds 20 limit
  blobs: ["event"],
  indexes: ["user123"],
});
// Result: Extra fields beyond 20 are dropped
```

**Safe writes:**

```typescript
function safeWriteDataPoint(
  dataset: AnalyticsEngineDataset,
  data: {
    doubles?: number[];
    blobs?: string[];
    indexes?: string[];
  }
) {
  // Enforce limits
  const doubles = (data.doubles || []).slice(0, 20);
  const blobs = (data.blobs || []).slice(0, 20);
  const indexes = (data.indexes || []).slice(0, 1);
  
  // Check blob size
  const blobSize = blobs.reduce(
    (sum, b) => sum + new TextEncoder().encode(b).length,
    0
  );
  
  if (blobSize > 16384) {
    console.warn("Blobs exceed 16KB, truncating...");
    // Truncate blobs to fit
  }
  
  dataset.writeDataPoint({ doubles, blobs, indexes });
}
```

## Best Practices for Working Within Limits

### 1. Design for Single Index

```typescript
// ❌ Can't use multiple indexes per data point
env.EVENTS.writeDataPoint({
  doubles: [value],
  blobs: [event],
  indexes: [userId, tenantId], // Only first index used!
});

// ✅ Combine into single index if needed
const compositeIndex = `${tenantId}:${userId}`;
env.EVENTS.writeDataPoint({
  doubles: [value],
  blobs: [event, userId, tenantId], // Use blobs for additional dimensions
  indexes: [compositeIndex],
});
```

### 2. Batch Writes Efficiently

```typescript
// Batch writes within 250 limit
const BATCH_SIZE = 250;

async function batchWrite(env: Env, events: Event[]) {
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const dataPoints = batch.map(event => ({
      doubles: [event.value],
      blobs: [event.type],
      indexes: [event.userId],
    }));
    
    env.EVENTS.writeDataPoints(dataPoints);
  }
}
```

### 3. Monitor Blob Sizes

```typescript
function checkBlobSize(blobs: string[]): boolean {
  const encoder = new TextEncoder();
  const totalSize = blobs.reduce(
    (sum, blob) => sum + encoder.encode(blob).length,
    0
  );
  
  if (totalSize > 16384) {
    console.error(`Blobs too large: ${totalSize} bytes`);
    return false;
  }
  
  return true;
}
```

### 4. Plan for 3-Month Retention

```typescript
// Export old data before it expires
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    // Export data that's 85 days old (5 days before expiration)
    const query = `
      SELECT *
      FROM events
      WHERE timestamp >= NOW() - INTERVAL '86' DAY
        AND timestamp < NOW() - INTERVAL '85' DAY
    `;
    
    const data = await queryAnalyticsEngine(env, query);
    await archiveToR2(env, data);
  },
};
```

### 5. Handle Free Tier Limits

```typescript
// Graceful degradation when approaching limits
async function trackEvent(env: Env, event: Event) {
  const usage = await getDailyUsage(env);
  
  if (usage.writes >= 95000) {
    // Approaching 100k limit - sample events
    if (Math.random() > 0.1) return; // Sample 10%
  }
  
  env.EVENTS.writeDataPoint({
    doubles: [event.value],
    blobs: [event.type],
    indexes: [event.userId],
  });
}
```

## Summary Table

| Limit Category | Key Limit | Value |
|----------------|-----------|-------|
| **Writes** | Data points per invocation | 250 |
| | Fields per data point | 20 doubles, 20 blobs, 1 index |
| | Total blob size | 16 KB |
| | Index size | 96 bytes |
| **Retention** | Data retention | 3 months |
| **Free Tier** | Writes per day | 100,000 |
| | Queries per day | 10,000 |
| **Cardinality** | Unique values | Unlimited (with adaptive sampling) |
| **Queries** | Typical latency | ~100 ms |
| | P99 latency | ~300 ms |
| | Max result size | ~10 MB (estimated) |

## Version History

| Date | Change |
|------|--------|
| June 20, 2025 | Blob size limit increased from 5 KB to 16 KB |
| January 2026 | Free tier limits published (not yet enforced) |

## Additional Resources

- [Official Limits Documentation](https://developers.cloudflare.com/analytics/analytics-engine/limits/)
- [Pricing Information](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)
- [Sampling Documentation](https://developers.cloudflare.com/analytics/analytics-engine/sampling/)
