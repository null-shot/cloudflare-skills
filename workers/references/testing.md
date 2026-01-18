# Testing Workers with Vitest

Use `@cloudflare/vitest-pool-workers` to test Workers inside the Workers runtime for full production fidelity.

## Setup

### Install Dependencies

```bash
npm i -D vitest@~3.2.0 @cloudflare/vitest-pool-workers
```

### vitest.config.ts

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

### TypeScript Config (test/tsconfig.json)

```jsonc
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "moduleResolution": "bundler",
    "types": ["@cloudflare/vitest-pool-workers"]
  },
  "include": ["./**/*.ts", "../src/worker-configuration.d.ts"]
}
```

### Environment Types (env.d.ts)

```typescript
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
```

## Unit Tests

Test individual functions directly:

```typescript
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("Worker fetch handler", () => {
  it("returns Hello World", async () => {
    const request = new Request("http://example.com/");
    const ctx = createExecutionContext();
    
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello World!");
  });
});
```

## Integration Tests (via SELF)

Test the full Worker using HTTP requests:

```typescript
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("Worker HTTP integration", () => {
  it("handles GET requests", async () => {
    const response = await SELF.fetch("http://example.com/api/data");
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("success", true);
  });

  it("handles POST requests", async () => {
    const response = await SELF.fetch("http://example.com/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    
    expect(response.status).toBe(200);
  });

  it("returns 404 for unknown routes", async () => {
    const response = await SELF.fetch("http://example.com/unknown");
    expect(response.status).toBe(404);
  });
});
```

## Testing with Bindings

Access KV, R2, D1, etc. via `env`:

```typescript
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

describe("Worker with KV", () => {
  beforeAll(async () => {
    // Seed test data
    await env.MY_KV.put("test-key", "test-value");
  });

  it("reads from KV", async () => {
    const response = await SELF.fetch("http://example.com/kv/test-key");
    expect(await response.text()).toBe("test-value");
  });

  it("writes to KV", async () => {
    await SELF.fetch("http://example.com/kv/new-key", {
      method: "PUT",
      body: "new-value",
    });
    
    const value = await env.MY_KV.get("new-key");
    expect(value).toBe("new-value");
  });
});
```

## Mocking Outbound Requests

Use `fetchMock` to mock external API calls:

```typescript
import { env, SELF, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";

describe("External API calls", () => {
  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.assertNoPendingInterceptors();
  });

  it("mocks external API", async () => {
    fetchMock
      .get("https://api.example.com")
      .intercept({ path: "/users/123" })
      .reply(200, { id: 123, name: "Test User" });

    const response = await SELF.fetch("http://example.com/proxy/users/123");
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.name).toBe("Test User");
  });
});
```

## Testing Scheduled Handlers

```typescript
import { env, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("Scheduled handler", () => {
  it("runs cron job", async () => {
    const controller = createScheduledController({
      scheduledTime: new Date("2026-01-01T00:00:00Z"),
      cron: "0 0 * * *",
    });
    const ctx = createExecutionContext();

    await worker.scheduled(controller, env, ctx);
    await waitOnExecutionContext(ctx);

    // Verify side effects (e.g., KV writes)
    const result = await env.MY_KV.get("last-run");
    expect(result).toBe("2026-01-01T00:00:00.000Z");
  });
});
```

## Test Isolation

Each test gets isolated storage by default:

```typescript
describe("Isolation", () => {
  it("first test writes data", async () => {
    await env.MY_KV.put("isolated-key", "value-1");
    expect(await env.MY_KV.get("isolated-key")).toBe("value-1");
  });

  it("second test has fresh state", async () => {
    // Previous test's data is gone
    expect(await env.MY_KV.get("isolated-key")).toBeNull();
  });
});
```

## Testing with Miniflare Options

Override bindings for tests:

```typescript
// vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          kvNamespaces: ["TEST_KV"],
          r2Buckets: ["TEST_BUCKET"],
        },
      },
    },
  },
});
```

## Running Tests

```bash
npx vitest        # Watch mode
npx vitest run    # Single run
```

package.json:
```json
{
  "scripts": {
    "test": "vitest"
  }
}
```

## Known Issues

- **Fake timers don't work** with KV, R2, Cache simulators
- **Dynamic imports** don't work inside `SELF.fetch()` handlers
- **Some Node.js compatibility** issues with `nodejs_compat` flag on newer compatibility dates
- **Durable Object alarms** may persist between tests without proper isolation

## Best Practices

1. **Use `await using`** for automatic cleanup of introspectors
2. **Seed test data in `beforeAll`** or `beforeEach`
3. **Use `fetchMock`** for external HTTP calls
4. **Enable `isolatedStorage: true`** for proper test isolation
5. **Run `wrangler types`** before tests to ensure type safety
6. **Test error paths** not just happy paths
7. **Mock external dependencies** for fast, reliable tests
