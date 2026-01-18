# Querying Analytics Engine Data

Comprehensive guide to querying Analytics Engine data with SQL and GraphQL APIs.

## SQL API Overview

**Endpoint**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql`

**Authentication**: Bearer token (API token with Analytics read permissions)

**Method**: POST

**Body**: Raw SQL query as plain text

## Basic Query

```bash
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data "SELECT * FROM my_dataset LIMIT 10"
```

## SQL Field Naming

Fields are numbered based on write order:

| Field Type | SQL Names | Count |
|------------|-----------|-------|
| Metrics | `double1`, `double2`, ... `double20` | Up to 20 |
| Labels | `blob1`, `blob2`, ... `blob20` | Up to 20 |
| Grouping | `index1`, `index2`, ... `index20` | Up to 20 |
| Timestamp | `timestamp` | 1 (automatic) |

**Use aliases for readability:**

```sql
SELECT
  timestamp,
  double1 AS response_time_ms,
  double2 AS bytes_transferred,
  blob1 AS endpoint,
  blob2 AS http_method,
  index1 AS user_id
FROM requests
LIMIT 100
```

## Common Query Patterns

### Pattern 1: Recent Events

```sql
SELECT
  timestamp,
  blob1 AS event_type,
  blob2 AS details,
  index1 AS user_id
FROM user_events
WHERE timestamp > NOW() - INTERVAL '1' HOUR
ORDER BY timestamp DESC
LIMIT 1000
```

### Pattern 2: Aggregations

```sql
SELECT
  index1 AS user_id,
  COUNT(*) AS total_requests,
  AVG(double1) AS avg_response_time,
  MAX(double1) AS max_response_time,
  MIN(double1) AS min_response_time,
  SUM(double2) AS total_bytes
FROM requests
WHERE timestamp > NOW() - INTERVAL '24' HOUR
GROUP BY user_id
ORDER BY total_requests DESC
LIMIT 100
```

### Pattern 3: Time Series

```sql
SELECT
  DATE_TRUNC('hour', timestamp) AS hour,
  COUNT(*) AS event_count,
  AVG(double1) AS avg_duration
FROM events
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY hour
ORDER BY hour ASC
```

### Pattern 4: Filtering and Grouping

```sql
SELECT
  blob1 AS endpoint,
  blob2 AS status_code,
  COUNT(*) AS request_count,
  AVG(double1) AS avg_response_time
FROM api_requests
WHERE timestamp > NOW() - INTERVAL '1' DAY
  AND index1 = 'customer123'  -- Specific customer
  AND blob2 IN ('200', '201')  -- Successful requests only
GROUP BY endpoint, status_code
ORDER BY request_count DESC
```

### Pattern 5: Percentiles

```sql
SELECT
  blob1 AS endpoint,
  quantileExact(0.50)(double1) AS p50_response_time,
  quantileExact(0.95)(double1) AS p95_response_time,
  quantileExact(0.99)(double1) AS p99_response_time
FROM requests
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY endpoint
ORDER BY p95_response_time DESC
```

### Pattern 6: Error Rate

```sql
SELECT
  blob1 AS endpoint,
  COUNT(*) AS total_requests,
  SUM(CASE WHEN blob2 >= '400' THEN 1 ELSE 0 END) AS error_count,
  (SUM(CASE WHEN blob2 >= '400' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) AS error_rate_percent
FROM api_requests
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY endpoint
HAVING error_rate_percent > 1  -- Only endpoints with >1% error rate
ORDER BY error_rate_percent DESC
```

### Pattern 7: Cohort Analysis

```sql
SELECT
  DATE_TRUNC('day', timestamp) AS signup_date,
  COUNT(DISTINCT index1) AS users_signed_up
FROM user_events
WHERE blob1 = 'user_signup'
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY signup_date
ORDER BY signup_date ASC
```

### Pattern 8: Funnel Analysis

```sql
SELECT
  index1 AS user_id,
  SUM(CASE WHEN blob1 = 'page_view' THEN 1 ELSE 0 END) AS page_views,
  SUM(CASE WHEN blob1 = 'add_to_cart' THEN 1 ELSE 0 END) AS add_to_cart,
  SUM(CASE WHEN blob1 = 'checkout' THEN 1 ELSE 0 END) AS checkouts,
  SUM(CASE WHEN blob1 = 'purchase' THEN 1 ELSE 0 END) AS purchases
FROM user_events
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY user_id
HAVING page_views > 0
```

## Time Functions

| Function | Description | Example |
|----------|-------------|---------|
| `NOW()` | Current timestamp | `WHERE timestamp > NOW() - INTERVAL '1' HOUR` |
| `DATE_TRUNC(unit, timestamp)` | Truncate to unit | `DATE_TRUNC('hour', timestamp)` |
| `INTERVAL 'N' UNIT` | Time interval | `INTERVAL '7' DAY`, `INTERVAL '3' HOUR` |

**Supported units**: `SECOND`, `MINUTE`, `HOUR`, `DAY`, `WEEK`, `MONTH`, `YEAR`

```sql
-- Last hour
WHERE timestamp > NOW() - INTERVAL '1' HOUR

-- Last 24 hours
WHERE timestamp > NOW() - INTERVAL '1' DAY

-- Last 7 days
WHERE timestamp > NOW() - INTERVAL '7' DAY

-- Specific date range
WHERE timestamp >= '2025-01-01' AND timestamp < '2025-02-01'

-- Group by hour
SELECT DATE_TRUNC('hour', timestamp) AS hour, COUNT(*) AS count
FROM events
GROUP BY hour

-- Group by day
SELECT DATE_TRUNC('day', timestamp) AS day, COUNT(*) AS count
FROM events
GROUP BY day
```

## Aggregate Functions

| Function | Description | Example |
|----------|-------------|---------|
| `COUNT(*)` | Count rows | `COUNT(*) AS total_events` |
| `COUNT(DISTINCT field)` | Count unique values | `COUNT(DISTINCT index1) AS unique_users` |
| `SUM(field)` | Sum values | `SUM(double1) AS total_revenue` |
| `AVG(field)` | Average | `AVG(double1) AS avg_duration` |
| `MIN(field)` | Minimum | `MIN(double1) AS min_value` |
| `MAX(field)` | Maximum | `MAX(double1) AS max_value` |
| `quantileExact(prob)(field)` | Percentile | `quantileExact(0.95)(double1) AS p95` |

## Listing Datasets

Show all datasets in your account:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --data "SHOW TABLES"
```

Response:

```json
{
  "data": [
    { "name": "user_events" },
    { "name": "api_requests" },
    { "name": "billing_events" }
  ]
}
```

## Schema Inspection

Get field information for a dataset:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql" \
  --header "Authorization: Bearer YOUR_API_TOKEN" \
  --data "DESCRIBE user_events"
```

## Query Response Format

Successful queries return JSON:

```json
{
  "data": [
    {
      "timestamp": "2025-01-17T10:30:00Z",
      "double1": 150.5,
      "blob1": "/api/users",
      "index1": "user123"
    },
    {
      "timestamp": "2025-01-17T10:31:00Z",
      "double1": 220.3,
      "blob1": "/api/posts",
      "index1": "user456"
    }
  ],
  "meta": {
    "name": "user_events",
    "sent": 2,
    "duration": 0.123
  }
}
```

Error response:

```json
{
  "errors": [
    {
      "code": 1001,
      "message": "Syntax error in SQL query"
    }
  ]
}
```

## Query Optimization

### Tip 1: Use Time Filters

Always filter by timestamp to limit data scanned:

```sql
-- ❌ BAD - Scans entire dataset
SELECT COUNT(*) FROM events

-- ✅ GOOD - Limits to recent data
SELECT COUNT(*) FROM events
WHERE timestamp > NOW() - INTERVAL '1' DAY
```

### Tip 2: Filter by Indexes

Indexes are optimized for filtering:

```sql
-- ✅ OPTIMIZED - Uses index
SELECT * FROM events
WHERE index1 = 'customer123'
  AND timestamp > NOW() - INTERVAL '1' DAY
```

### Tip 3: Limit Results

Use `LIMIT` to avoid large responses:

```sql
SELECT * FROM events
WHERE timestamp > NOW() - INTERVAL '1' HOUR
ORDER BY timestamp DESC
LIMIT 1000
```

### Tip 4: Aggregate Early

Aggregate data before further processing:

```sql
-- ✅ GOOD - Aggregate first
SELECT
  index1 AS user_id,
  COUNT(*) AS event_count
FROM events
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY user_id
HAVING event_count > 100
```

### Tip 5: Use Indexes for GROUP BY

Group by index fields for better performance:

```sql
-- ✅ OPTIMIZED
SELECT index1 AS customer_id, COUNT(*) AS count
FROM events
GROUP BY index1

-- ⚠️ SLOWER
SELECT blob1 AS category, COUNT(*) AS count
FROM events
GROUP BY blob1
```

## Using SQL API from Workers

Query Analytics Engine from a Worker using the SQL API:

```typescript
interface Env {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const query = `
      SELECT
        index1 AS user_id,
        COUNT(*) AS event_count
      FROM user_events
      WHERE timestamp > NOW() - INTERVAL '1' HOUR
      GROUP BY user_id
      ORDER BY event_count DESC
      LIMIT 10
    `;

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: query,
      }
    );

    if (!response.ok) {
      throw new Error(`Query failed: ${await response.text()}`);
    }

    const result = await response.json();
    return Response.json(result.data);
  },
};
```

**Security note**: Store API tokens in secrets, not in code:

```bash
wrangler secret put CLOUDFLARE_API_TOKEN
```

## GraphQL API

Analytics Engine also supports GraphQL for more complex queries.

**Endpoint**: `https://api.cloudflare.com/client/v4/graphql`

**Example query:**

```graphql
query {
  viewer {
    accounts(filter: { accountTag: "YOUR_ACCOUNT_ID" }) {
      analyticsEngineDatasets(filter: { name: "user_events" }) {
        data(
          filter: {
            timestamp_geq: "2025-01-17T00:00:00Z"
            timestamp_lt: "2025-01-18T00:00:00Z"
          }
          limit: 100
        ) {
          timestamp
          double1
          blob1
          index1
        }
      }
    }
  }
}
```

GraphQL is more verbose but provides type safety and nested queries.

## Dashboard Queries

### Real-Time Error Monitoring

```sql
SELECT
  DATE_TRUNC('minute', timestamp) AS minute,
  blob1 AS endpoint,
  COUNT(*) AS error_count
FROM errors
WHERE timestamp > NOW() - INTERVAL '15' MINUTE
  AND index2 = 'production'  -- Environment
GROUP BY minute, endpoint
ORDER BY minute DESC, error_count DESC
```

### Revenue Dashboard

```sql
SELECT
  DATE_TRUNC('day', timestamp) AS day,
  index2 AS merchant_id,
  SUM(double1) / 100 AS total_revenue_usd,
  COUNT(DISTINCT index1) AS unique_customers,
  COUNT(*) AS transaction_count
FROM revenue_events
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day, merchant_id
ORDER BY day DESC, total_revenue_usd DESC
```

### API Usage by Customer

```sql
SELECT
  index1 AS customer_id,
  blob1 AS endpoint,
  COUNT(*) AS request_count,
  SUM(double2) AS total_bytes_transferred,
  AVG(double1) AS avg_response_time_ms,
  quantileExact(0.95)(double1) AS p95_response_time_ms
FROM api_requests
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY customer_id, endpoint
ORDER BY request_count DESC
LIMIT 50
```

### Feature Adoption

```sql
SELECT
  blob1 AS feature_name,
  COUNT(DISTINCT index1) AS unique_users,
  COUNT(*) AS total_usage,
  MIN(timestamp) AS first_used,
  MAX(timestamp) AS last_used
FROM feature_events
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY feature_name
ORDER BY unique_users DESC
```

## Query Limits

| Limit | Value |
|-------|-------|
| Query timeout | 30 seconds |
| Max result size | ~10 MB |
| Max query complexity | Varies (use LIMIT) |
| Data retention | 3 months |

## Common Errors

### Error: Query timeout

**Cause**: Query taking too long (>30s)

**Solution**: Add time filters, reduce date range, use LIMIT

```sql
-- Before
SELECT * FROM events

-- After
SELECT * FROM events
WHERE timestamp > NOW() - INTERVAL '1' DAY
LIMIT 10000
```

### Error: Syntax error

**Cause**: Invalid SQL syntax

**Solution**: Check SQL syntax, use proper field names (double1, blob1, index1)

```sql
-- ❌ WRONG
SELECT response_time FROM events

-- ✅ CORRECT
SELECT double1 AS response_time FROM events
```

### Error: Unknown field

**Cause**: Referencing a field that doesn't exist

**Solution**: Use numbered fields (double1-20, blob1-20, index1-20)

```sql
-- ❌ WRONG
SELECT double21 FROM events

-- ✅ CORRECT
SELECT double1 FROM events
```

## Testing Queries Locally

Use a tool like `jq` to format JSON responses:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql" \
  --header "Authorization: Bearer $CF_API_TOKEN" \
  --data "SELECT * FROM events LIMIT 5" \
  | jq '.data'
```

Or create a script:

```bash
#!/bin/bash
# query.sh - Query Analytics Engine

ACCOUNT_ID="your-account-id"
API_TOKEN="your-api-token"
QUERY="$1"

curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  --header "Authorization: Bearer $API_TOKEN" \
  --data "$QUERY" \
  | jq '.'
```

Usage:

```bash
./query.sh "SELECT * FROM events WHERE timestamp > NOW() - INTERVAL '1' HOUR LIMIT 10"
```

## Best Practices

1. **Always use time filters**: Limit queries to relevant time ranges
2. **Use aliases**: Make queries readable with `AS` aliases
3. **Aggregate efficiently**: GROUP BY with indexes for best performance
4. **Limit results**: Use `LIMIT` to avoid large responses
5. **Cache results**: Cache query results in KV or R2 for frequently accessed data
6. **Monitor query costs**: Long-running queries consume resources
7. **Use indexes for filtering**: Filter by index fields when possible
8. **Test queries incrementally**: Start with small time ranges, expand as needed
