# Writing Datapoints to Analytics Engine

Comprehensive guide to writing event data with Analytics Engine.

## Basic Write Operation

```typescript
interface Env {
  EVENTS: AnalyticsEngineDataset;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    env.EVENTS.writeDataPoint({
      doubles: [100, 200],
      blobs: ["page_view", "/home"],
      indexes: ["user123"],
    });

    return new Response("OK");
  },
};
```

## Field Types Explained

### Doubles (Numeric Metrics)

Use for any numeric data you want to aggregate:

```typescript
env.METRICS.writeDataPoint({
  doubles: [
    responseTime,        // double1: milliseconds
    bytesTransferred,    // double2: bytes
    errorCount,          // double3: count
    cacheHitRate,        // double4: percentage (0-100)
  ],
  blobs: ["api_request"],
  indexes: [userId],
});
```

**SQL aggregations:**
```sql
SELECT
  AVG(double1) AS avg_response_time,
  SUM(double2) AS total_bytes,
  SUM(double3) AS total_errors,
  AVG(double4) AS avg_cache_hit_rate
FROM METRICS
WHERE timestamp > NOW() - INTERVAL '1' HOUR
```

### Blobs (Text Labels)

Use for categorical data, IDs, names, or any text you want to filter by:

```typescript
env.EVENTS.writeDataPoint({
  doubles: [1],
  blobs: [
    "user_signup",       // blob1: event type
    "google",            // blob2: referrer
    "premium",           // blob3: plan type
    "US",                // blob4: country
  ],
  indexes: [userId],
});
```

**SQL filtering:**
```sql
SELECT
  blob1 AS event_type,
  COUNT(*) AS event_count
FROM EVENTS
WHERE blob2 = 'google'
  AND blob3 = 'premium'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY blob1
```

**Blob size limit**: 5,120 bytes per blob. Truncate long strings:

```typescript
env.EVENTS.writeDataPoint({
  blobs: [
    errorMessage.slice(0, 256),  // Truncate to prevent exceeding limit
    url.slice(0, 512),
  ],
  indexes: [userId],
});
```

### Indexes (Grouping Keys)

**IMPORTANT**: Analytics Engine supports only **1 index per data point** (not multiple indexes as originally documented).

The index is the most important field—it defines your primary grouping dimension:

```typescript
env.METRICS.writeDataPoint({
  doubles: [revenue],
  blobs: [productId, merchantId, regionCode], // Additional dimensions as blobs
  indexes: [customerId],  // Primary grouping dimension
});
```

**SQL grouping:**
```sql
SELECT
  index1 AS customer_id,
  blob2 AS merchant_id,
  SUM(double1) AS total_revenue
FROM METRICS
WHERE blob3 = 'US-WEST'
GROUP BY customer_id, merchant_id
```

**Index design patterns:**

1. **Single dimension**: Choose your most important grouping (userId, customerId, tenantId)
2. **Composite index**: Combine multiple values into one string: `${tenantId}:${userId}`
3. **Use blobs for secondary dimensions**: Store additional grouping fields as blobs
4. **Index optimization**: Queries filtering by index are most efficient

## Field Limits

| Field Type | Max Count | Max Size per Field | Total Limit |
|------------|-----------|-------------------|-------------|
| doubles | 20 | 8 bytes (number) | 160 bytes |
| blobs | 20 | No individual limit | 16,384 bytes (16 KB) |
| indexes | 1 | 96 bytes | 96 bytes |

## Non-Blocking Writes

**Critical**: `writeDataPoint()` is non-blocking. Never await it.

```typescript
// ❌ WRONG - Adds unnecessary latency
await env.EVENTS.writeDataPoint({ ... });
await env.METRICS.writeDataPoint({ ... });
return new Response("OK");

// ✅ CORRECT - Fire and forget
env.EVENTS.writeDataPoint({ ... });
env.METRICS.writeDataPoint({ ... });
return new Response("OK");
```

Writes are buffered and batched automatically. Your Worker responds immediately.

## Write Patterns

### Pattern 1: Request Tracking

```typescript
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const start = Date.now();
    const url = new URL(req.url);
    const userId = req.headers.get("x-user-id");
    const requestId = crypto.randomUUID();

    try {
      const response = await handleRequest(req);
      const duration = Date.now() - start;

      env.REQUESTS.writeDataPoint({
        doubles: [
          duration,
          response.headers.get("content-length") || 0,
          1, // success count
          0, // error count
        ],
        blobs: [
          url.pathname,
          req.method,
          response.status.toString(),
          requestId,
          url.hostname, // Store as blob instead
        ],
        indexes: [userId || "anonymous"],
      });

      return response;
    } catch (error) {
      const duration = Date.now() - start;

      env.REQUESTS.writeDataPoint({
        doubles: [duration, 0, 0, 1],
        blobs: [
          url.pathname,
          req.method,
          "500",
          requestId,
          url.hostname,
        ],
        indexes: [userId || "anonymous"],
      });

      throw error;
    }
  },
};
```

### Pattern 2: Feature Usage Tracking

```typescript
function trackFeatureUsage(
  env: Env,
  userId: string,
  feature: string,
  metadata: Record<string, any>
) {
  env.FEATURES.writeDataPoint({
    doubles: [1], // usage count
    blobs: [
      feature,
      JSON.stringify(metadata),
      new Date().toISOString().slice(0, 10), // date
    ],
    indexes: [userId, feature],
  });
}

// Usage
trackFeatureUsage(env, "user123", "export_pdf", {
  fileSize: 1024000,
  format: "A4",
});
```

### Pattern 3: A/B Test Metrics

```typescript
function trackExperiment(
  env: Env,
  userId: string,
  experimentId: string,
  variant: string,
  converted: boolean
) {
  env.EXPERIMENTS.writeDataPoint({
    doubles: [
      1, // impression count
      converted ? 1 : 0, // conversion count
    ],
    blobs: [experimentId, variant],
    indexes: [userId], // Group by user
  });
}

// Query conversion rate by variant:
// SELECT
//   blob2 AS variant,
//   SUM(double2 * _sample_interval) / SUM(double1 * _sample_interval) AS conversion_rate
// FROM EXPERIMENTS
// WHERE blob1 = 'homepage_cta_test'
// GROUP BY variant
```

### Pattern 4: Error Tracking with Context

```typescript
function trackError(
  env: Env,
  error: Error,
  context: {
    userId?: string;
    endpoint: string;
    requestId: string;
  }
) {
  env.ERRORS.writeDataPoint({
    doubles: [1], // error count
    blobs: [
      error.name,
      error.message.slice(0, 256),
      error.stack?.slice(0, 1000) || "",
      context.endpoint,
      context.requestId,
    ],
    indexes: [context.userId || "anonymous"], // Group by user
  });
}
```

### Pattern 5: Billing Events

```typescript
function trackUsage(
  env: Env,
  customerId: string,
  resource: string,
  units: number,
  costCents: number
) {
  env.BILLING.writeDataPoint({
    doubles: [
      units,      // double1: quantity
      costCents,  // double2: cost in cents
    ],
    blobs: [
      resource,                               // blob1: resource type
      new Date().toISOString().slice(0, 10), // blob2: date
    ],
    indexes: [customerId],  // index1: group by customer (primary dimension)
  });
}

// Query monthly invoice:
// SELECT
//   index1 AS customer_id,
//   blob1 AS resource,
//   SUM(double1 * _sample_interval) AS total_units,
//   SUM(double2 * _sample_interval) AS total_cost_cents
// FROM BILLING
// WHERE timestamp >= '2025-01-01' AND timestamp < '2025-02-01'
//   AND index1 = 'customer123'
// GROUP BY customer_id, resource
```

## Consistent Field Ordering

**Important**: Maintain consistent field order across all writes to the same dataset.

```typescript
// ❌ BAD - Inconsistent field ordering
env.EVENTS.writeDataPoint({
  doubles: [duration],
  blobs: [endpoint],
  indexes: [userId],
});

env.EVENTS.writeDataPoint({
  doubles: [statusCode, duration], // Different order!
  blobs: [method, endpoint],       // Different order!
  indexes: [userId],
});

// ✅ GOOD - Consistent field ordering
function writeRequestEvent(
  env: Env,
  userId: string,
  sessionId: string,
  duration: number,
  statusCode: number,
  method: string,
  endpoint: string
) {
  env.EVENTS.writeDataPoint({
    doubles: [duration, statusCode],        // Always same order
    blobs: [method, endpoint, sessionId],   // Always same order
    indexes: [userId],                      // Single index
  });
}
```

Use helper functions to enforce consistency.

## Handling Optional Fields

Use empty arrays or default values for missing data:

```typescript
env.EVENTS.writeDataPoint({
  doubles: [duration || 0],
  blobs: [
    endpoint,
    userId || "anonymous",  // Default for missing userId
    sessionId || "",        // Empty string for missing sessionId
  ],
  indexes: [userId || "anonymous"],
});
```

In SQL, filter NULL values:

```sql
SELECT *
FROM EVENTS
WHERE blob2 IS NOT NULL  -- Filter out missing userId
  AND blob2 != 'anonymous'
```

## Timestamp Handling

Analytics Engine automatically adds a `timestamp` field to every datapoint. You don't need to include it in your writes.

```typescript
// ❌ Not needed - timestamp added automatically
env.EVENTS.writeDataPoint({
  doubles: [Date.now()],  // Redundant
  blobs: [new Date().toISOString()],  // Redundant
  indexes: [userId],
});

// ✅ Correct - timestamp handled automatically
env.EVENTS.writeDataPoint({
  doubles: [duration],
  blobs: [endpoint],
  indexes: [userId],
});
```

Query timestamps with SQL:

```sql
SELECT
  timestamp,
  blob1 AS endpoint,
  index1 AS user_id
FROM EVENTS
WHERE timestamp > NOW() - INTERVAL '1' HOUR
ORDER BY timestamp DESC
```

## Error Handling

Writes are fire-and-forget. If a write fails, it's silently dropped. For critical data, use additional storage:

```typescript
// For critical events, write to both Analytics Engine and D1/KV
env.EVENTS.writeDataPoint({
  doubles: [revenue],
  blobs: [orderId],
  indexes: [customerId],
});

// Also persist to D1 for guaranteed durability
await env.DB.prepare(
  "INSERT INTO orders (customer_id, order_id, revenue) VALUES (?, ?, ?)"
).bind(customerId, orderId, revenue).run();
```

## Performance Considerations

1. **Batching**: Writes are automatically batched. Don't manually batch.
2. **Cardinality**: High-cardinality indexes (millions of unique values) can impact query performance
3. **Field count**: Use only the fields you need. Fewer fields = faster writes
4. **Blob size**: Keep blobs small. Truncate long strings

## Testing Locally

Analytics Engine writes are no-ops in local development:

```typescript
// Add a development mode flag
const isDev = env.ENVIRONMENT === "development";

if (!isDev) {
  env.EVENTS.writeDataPoint({
    doubles: [duration],
    blobs: [endpoint],
    indexes: [userId],
  });
} else {
  console.log("Analytics write (dev):", { duration, endpoint, userId });
}
```

Or use a mock binding in `wrangler.jsonc` for local testing.

## Common Mistakes

### Mistake 1: Awaiting Writes

```typescript
// ❌ WRONG
await env.EVENTS.writeDataPoint({ ... });

// ✅ CORRECT
env.EVENTS.writeDataPoint({ ... });
```

### Mistake 2: Inconsistent Field Order

```typescript
// ❌ WRONG - Can't reliably query
env.EVENTS.writeDataPoint({ doubles: [a], blobs: [b], indexes: [c] });
env.EVENTS.writeDataPoint({ doubles: [x, y], blobs: [z], indexes: [w] });

// ✅ CORRECT - Use helper functions
writeEvent(env, { metric1: a, metric2: 0, label: b, userId: c });
writeEvent(env, { metric1: x, metric2: y, label: z, userId: w });
```

### Mistake 3: Exceeding Blob Size

```typescript
// ❌ WRONG - May exceed 5,120 bytes
env.EVENTS.writeDataPoint({
  blobs: [error.stack], // Stack trace might be huge
  indexes: [userId],
});

// ✅ CORRECT - Truncate long strings
env.EVENTS.writeDataPoint({
  blobs: [error.stack?.slice(0, 1000) || ""],
  indexes: [userId],
});
```

### Mistake 4: Using Indexes as Blobs

```typescript
// ❌ WRONG - Should use index for primary grouping dimension
env.EVENTS.writeDataPoint({
  doubles: [revenue],
  blobs: [customerId, productId],  // customerId should be the index!
  indexes: ["default"],
});

// ✅ CORRECT - Use index for primary grouping dimension
env.EVENTS.writeDataPoint({
  doubles: [revenue],
  blobs: [productId],
  indexes: [customerId],  // Most efficient for queries filtering by customer
});
```
