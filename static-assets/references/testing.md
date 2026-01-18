# Testing Static Assets

Use `@cloudflare/vitest-pool-workers` to test Workers that serve static assets.

## Setup

### Install Dependencies

```bash
npm i -D vitest@~3.2.0 @cloudflare/vitest-pool-workers
```

### vitest.config.ts

```typescript
import path from "node:path";
import {
  buildPagesASSETSBinding,
  defineWorkersConfig,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          serviceBindings: {
            // Bind ASSETS to your public directory
            ASSETS: await buildPagesASSETSBinding(
              path.join(__dirname, "public")
            ),
          },
        },
      },
    },
  },
});
```

### wrangler.jsonc

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  }
}
```

### Directory Structure

```
my-worker/
├── public/
│   ├── index.html
│   ├── styles/
│   │   └── main.css
│   └── scripts/
│       └── app.js
├── src/
│   └── index.ts
├── test/
│   └── assets.spec.ts
├── vitest.config.ts
└── wrangler.jsonc
```

## Integration Tests (via SELF)

```typescript
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("Static assets", () => {
  it("serves index.html at root", async () => {
    const response = await SELF.fetch("http://example.com/");
    
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    
    const html = await response.text();
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("serves CSS files", async () => {
    const response = await SELF.fetch("http://example.com/styles/main.css");
    
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
  });

  it("serves JavaScript files", async () => {
    const response = await SELF.fetch("http://example.com/scripts/app.js");
    
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
  });

  it("returns 404 for missing files", async () => {
    const response = await SELF.fetch("http://example.com/nonexistent.txt");
    
    expect(response.status).toBe(404);
  });
});
```

## Testing SPA Fallback

For single-page applications with `not_found_handling: "single-page-application"`:

```typescript
describe("SPA fallback", () => {
  it("serves index.html for unknown routes", async () => {
    const response = await SELF.fetch("http://example.com/app/dashboard");
    
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("serves index.html for deep routes", async () => {
    const response = await SELF.fetch("http://example.com/users/123/profile");
    
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("still serves real assets", async () => {
    const response = await SELF.fetch("http://example.com/styles/main.css");
    
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
  });
});
```

## Testing API Routes with Assets

When using `run_worker_first: true`:

```typescript
describe("API routes with static assets", () => {
  it("routes /api/* to Worker", async () => {
    const response = await SELF.fetch("http://example.com/api/users");
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("users");
  });

  it("serves static assets for non-API routes", async () => {
    const response = await SELF.fetch("http://example.com/index.html");
    
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
```

## Testing ASSETS Binding Directly

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("ASSETS binding", () => {
  it("fetches assets via binding", async () => {
    const request = new Request("http://assets/styles/main.css");
    const response = await env.ASSETS.fetch(request);
    
    expect(response.status).toBe(200);
    const css = await response.text();
    expect(css).toContain("body");
  });
});
```

## Testing Cache Headers

```typescript
describe("Cache headers", () => {
  it("sets cache headers for static assets", async () => {
    const response = await SELF.fetch("http://example.com/styles/main.css");
    
    const cacheControl = response.headers.get("cache-control");
    expect(cacheControl).toContain("max-age");
  });

  it("sets correct content-type for images", async () => {
    const response = await SELF.fetch("http://example.com/images/logo.png");
    
    expect(response.headers.get("content-type")).toBe("image/png");
  });
});
```

## Testing with Custom Worker Logic

```typescript
// src/index.ts
interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // API routes handled by Worker
    if (url.pathname.startsWith("/api/")) {
      return handleAPI(request);
    }
    
    // Static assets
    const response = await env.ASSETS.fetch(request);
    
    // Add custom headers
    const headers = new Headers(response.headers);
    headers.set("X-Custom-Header", "value");
    
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
};
```

```typescript
// test/custom-headers.spec.ts
describe("Custom headers", () => {
  it("adds custom header to asset responses", async () => {
    const response = await SELF.fetch("http://example.com/index.html");
    
    expect(response.headers.get("X-Custom-Header")).toBe("value");
  });
});
```

## Testing Error Pages

```typescript
describe("Error pages", () => {
  it("serves custom 404 page", async () => {
    const response = await SELF.fetch("http://example.com/nonexistent");
    
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("Page not found");
  });
});
```

## Test Isolation

Each test runs with isolated asset state:

```typescript
describe("Isolation", () => {
  it("first test accesses assets", async () => {
    const response = await SELF.fetch("http://example.com/index.html");
    expect(response.status).toBe(200);
  });

  it("second test also accesses assets", async () => {
    const response = await SELF.fetch("http://example.com/index.html");
    expect(response.status).toBe(200);
  });
});
```

## Running Tests

```bash
npx vitest        # Watch mode
npx vitest run    # Single run
```

## Known Issues

- **Fake timers don't work** with cache behavior
- **Dynamic imports** may have issues in handlers
- **Large asset directories** may slow down test setup

## Best Practices

1. **Use `buildPagesASSETSBinding`** for proper asset simulation
2. **Test SPA fallback behavior** if using single-page apps
3. **Test API/asset routing** when mixing dynamic and static
4. **Verify content-types** for different file types
5. **Test cache headers** if customizing caching
6. **Test 404 behavior** for missing assets
7. **Keep test assets small** for faster tests
