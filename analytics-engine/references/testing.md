# Testing Analytics Engine

Analytics Engine bindings **cannot be simulated locally**. Use mocking strategies for testing.

## Local Development Limitation

From Cloudflare docs:

> "You cannot use an Analytics Engine binding locally."

The `writeDataPoint()` API is not available in Miniflare or local Wrangler dev.

## Testing Strategies

### 1. Mock the Binding

Create a mock that tracks calls:

```typescript
// src/analytics.ts
export function writeAnalytics(
  env: { ANALYTICS?: AnalyticsEngineDataset },
  data: AnalyticsEngineDataPoint
): void {
  if (env.ANALYTICS?.writeDataPoint) {
    env.ANALYTICS.writeDataPoint(data);
  }
  // Silently skip if binding not available (local dev)
}
```

### 2. Use Dependency Injection

```typescript
// src/index.ts
interface Env {
  ANALYTICS: AnalyticsEngineDataset;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const analytics = env.ANALYTICS || createMockAnalytics();
    
    analytics.writeDataPoint({
      indexes: [],
      blobs: [new URL(request.url).pathname],
      doubles: [1],
    });
    
    return new Response("OK");
  },
};

function createMockAnalytics(): AnalyticsEngineDataset {
  return {
    writeDataPoint: () => {}, // No-op for local
  };
}
```

## Unit Tests with Mocks

```typescript
import { describe, it, expect, vi } from "vitest";
import { writeAnalytics } from "../src/analytics";

describe("Analytics", () => {
  it("calls writeDataPoint when binding exists", () => {
    const mockEnv = {
      ANALYTICS: { writeDataPoint: vi.fn() },
    };

    writeAnalytics(mockEnv, {
      indexes: ["user-123"],
      blobs: ["/api/data"],
      doubles: [1],
    });

    expect(mockEnv.ANALYTICS.writeDataPoint).toHaveBeenCalledWith({
      indexes: ["user-123"],
      blobs: ["/api/data"],
      doubles: [1],
    });
  });

  it("handles missing binding gracefully", () => {
    const mockEnv = {};

    // Should not throw
    expect(() => {
      writeAnalytics(mockEnv, {
        indexes: [],
        blobs: [],
        doubles: [],
      });
    }).not.toThrow();
  });
});
```

## Integration Tests

Test the Worker without verifying analytics:

```typescript
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("Worker with Analytics", () => {
  it("handles requests (analytics not verified)", async () => {
    const response = await SELF.fetch("http://example.com/api/data");
    
    // Test the response, not the analytics write
    expect(response.status).toBe(200);
  });
});
```

## Testing Data Point Structure

Validate your data point structure:

```typescript
interface PageViewDataPoint {
  indexes: [string]; // user_id
  blobs: [string, string, string]; // path, country, device
  doubles: [number]; // response_time_ms
}

function createPageViewDataPoint(
  userId: string,
  path: string,
  country: string,
  device: string,
  responseTimeMs: number
): AnalyticsEngineDataPoint {
  return {
    indexes: [userId],
    blobs: [path, country, device],
    doubles: [responseTimeMs],
  };
}

describe("Data point structure", () => {
  it("creates valid page view data point", () => {
    const dataPoint = createPageViewDataPoint(
      "user-123",
      "/home",
      "US",
      "mobile",
      150
    );

    expect(dataPoint.indexes).toHaveLength(1);
    expect(dataPoint.blobs).toHaveLength(3);
    expect(dataPoint.doubles).toHaveLength(1);
    expect(dataPoint.doubles[0]).toBe(150);
  });
});
```

## Vitest Configuration

```typescript
// vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        // Analytics Engine not available - will be undefined
      },
    },
  },
});
```

## Environment Detection

Detect if running in production vs local:

```typescript
function isAnalyticsAvailable(env: Env): boolean {
  return typeof env.ANALYTICS?.writeDataPoint === "function";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (isAnalyticsAvailable(env)) {
      env.ANALYTICS.writeDataPoint({
        indexes: [],
        blobs: [request.url],
        doubles: [],
      });
    } else {
      console.log("[DEV] Analytics write skipped:", request.url);
    }
    
    return new Response("OK");
  },
};
```

## Testing Query Logic

If you have code that queries Analytics Engine SQL API:

```typescript
import { vi } from "vitest";

describe("Analytics queries", () => {
  it("builds correct SQL query", () => {
    const query = buildAnalyticsQuery({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      metric: "page_views",
    });

    expect(query).toContain("SELECT");
    expect(query).toContain("FROM my_dataset");
    expect(query).toContain("WHERE timestamp >= '2026-01-01'");
  });
});
```

## Running Tests

```bash
npx vitest        # Watch mode
npx vitest run    # Single run
```

## Production Testing

For real Analytics Engine testing:

1. Deploy to a staging environment
2. Send test requests
3. Query Analytics Engine SQL API to verify data
4. Use separate dataset for testing

```bash
# Query Analytics Engine
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql" \
  -H "Authorization: Bearer {api_token}" \
  -d "SELECT * FROM my_dataset LIMIT 10"
```

## Best Practices

1. **Always handle missing binding** gracefully for local dev
2. **Use dependency injection** to swap real/mock implementations
3. **Test data point structure** separately from write logic
4. **Mock writeDataPoint** to verify it's called correctly
5. **Test in staging** with real Analytics Engine for integration
6. **Log in local dev** to see what would be written
7. **Validate blobs/doubles/indexes** structure in unit tests
