# Testing KV with Vitest

Use `@cloudflare/vitest-pool-workers` to test Workers that use KV inside the Workers runtime.

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
        miniflare: {
          kvNamespaces: ["MY_KV"], // Test-only namespaces
        },
      },
    },
  },
});
```

## Unit Tests (Direct KV Access)

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

describe("KV operations", () => {
  it("writes and reads string values", async () => {
    await env.MY_KV.put("key", "value");
    const result = await env.MY_KV.get("key");
    expect(result).toBe("value");
  });

  it("reads JSON values", async () => {
    await env.MY_KV.put("user:123", JSON.stringify({ name: "Alice" }));
    const user = await env.MY_KV.get("user:123", "json");
    expect(user).toEqual({ name: "Alice" });
  });

  it("returns null for missing keys", async () => {
    const result = await env.MY_KV.get("nonexistent");
    expect(result).toBeNull();
  });

  it("deletes keys", async () => {
    await env.MY_KV.put("to-delete", "value");
    await env.MY_KV.delete("to-delete");
    expect(await env.MY_KV.get("to-delete")).toBeNull();
  });
});
```

## Testing with Metadata

```typescript
describe("KV metadata", () => {
  it("stores and retrieves metadata", async () => {
    await env.MY_KV.put("item", "data", {
      metadata: { created: Date.now(), version: 1 },
    });

    const { value, metadata } = await env.MY_KV.getWithMetadata("item");
    expect(value).toBe("data");
    expect(metadata).toHaveProperty("version", 1);
  });
});
```

## Testing List Operations

```typescript
describe("KV list", () => {
  beforeAll(async () => {
    await env.MY_KV.put("user:1", "Alice");
    await env.MY_KV.put("user:2", "Bob");
    await env.MY_KV.put("user:3", "Charlie");
    await env.MY_KV.put("config:app", "settings");
  });

  it("lists keys with prefix", async () => {
    const { keys } = await env.MY_KV.list({ prefix: "user:" });
    expect(keys).toHaveLength(3);
    expect(keys.map((k) => k.name)).toEqual(["user:1", "user:2", "user:3"]);
  });

  it("limits results", async () => {
    const { keys, list_complete, cursor } = await env.MY_KV.list({
      prefix: "user:",
      limit: 2,
    });
    expect(keys).toHaveLength(2);
    expect(list_complete).toBe(false);
    expect(cursor).toBeDefined();
  });
});
```

## Integration Tests (via SELF)

```typescript
import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

describe("Worker with KV", () => {
  beforeAll(async () => {
    await env.AUTH_TOKENS.put("valid-token", JSON.stringify({ userId: 123 }));
  });

  it("authenticates with valid token", async () => {
    const response = await SELF.fetch("http://example.com/", {
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.authenticated).toBe(true);
  });

  it("rejects invalid token", async () => {
    const response = await SELF.fetch("http://example.com/", {
      headers: { Authorization: "Bearer invalid-token" },
    });

    expect(response.status).toBe(403);
  });
});
```

## Testing Rate Limiting

```typescript
describe("Rate limiting with KV", () => {
  it("allows requests under limit", async () => {
    const ip = "192.168.1.1";
    
    for (let i = 0; i < 5; i++) {
      const response = await SELF.fetch("http://example.com/api", {
        headers: { "CF-Connecting-IP": ip },
      });
      expect(response.status).toBe(200);
    }
  });

  it("blocks requests over limit", async () => {
    const ip = "192.168.1.2";
    
    // Set count just below limit
    await env.RATE_LIMIT.put(`rate:${ip}`, "99", { expirationTtl: 60 });
    
    // First request should succeed
    let response = await SELF.fetch("http://example.com/api", {
      headers: { "CF-Connecting-IP": ip },
    });
    expect(response.status).toBe(200);
    
    // Next request should be rate limited
    response = await SELF.fetch("http://example.com/api", {
      headers: { "CF-Connecting-IP": ip },
    });
    expect(response.status).toBe(429);
  });
});
```

## Testing Session Management

```typescript
describe("Session management", () => {
  it("creates session on login", async () => {
    const response = await SELF.fetch("http://example.com/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", password: "secret" }),
    });

    expect(response.status).toBe(200);
    const { token } = await response.json();
    
    // Verify session was stored
    const session = await env.SESSIONS.get(token, "json");
    expect(session).toHaveProperty("email", "user@example.com");
  });

  it("validates session token", async () => {
    const token = "test-session-token";
    await env.SESSIONS.put(token, JSON.stringify({ userId: 123 }), {
      expirationTtl: 3600,
    });

    const response = await SELF.fetch("http://example.com/profile", {
      headers: { Cookie: `session=${token}` },
    });

    expect(response.status).toBe(200);
  });
});
```

## Test Isolation

Each test gets isolated KV state:

```typescript
describe("Isolation", () => {
  it("first test writes data", async () => {
    await env.MY_KV.put("test-key", "test-value");
    expect(await env.MY_KV.get("test-key")).toBe("test-value");
  });

  it("second test has fresh state", async () => {
    // Previous test's data is gone
    expect(await env.MY_KV.get("test-key")).toBeNull();
  });
});
```

## Testing TTL Behavior

**Note**: Fake timers don't work with KV expiration. Test TTL indirectly:

```typescript
describe("TTL behavior", () => {
  it("sets expiration on put", async () => {
    await env.MY_KV.put("temp-key", "value", { expirationTtl: 60 });
    
    // Key exists immediately after put
    const value = await env.MY_KV.get("temp-key");
    expect(value).toBe("value");
    
    // Can't test actual expiration - fake timers don't work
    // Test the code logic that sets TTL instead
  });
});
```

## Remote Bindings (Real KV)

For integration with real KV (use staging, not production):

```typescript
// vitest.config.ts
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        experimental_remoteBindings: true, // Use real KV
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

## Known Issues

- **Fake timers don't affect KV expiration** - Can't simulate key expiry
- **Eventually consistent behavior** not simulated locally - Local tests are synchronous
- **Size limits** not enforced in local testing

## Best Practices

1. **Use isolated storage** for test independence
2. **Seed data in `beforeAll`** for consistent test state
3. **Test error cases** like missing keys returning null
4. **Test metadata operations** if using them
5. **Test list pagination** if listing many keys
6. **Mock TTL logic** instead of testing actual expiration
7. **Use remote bindings sparingly** - slower but more realistic
