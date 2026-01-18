# Workers Performance Optimization

Best practices for optimizing Cloudflare Workers performance including cold starts, caching, and efficient patterns.

## Optimize Cold Starts

Minimize initialization time for faster cold starts:

```typescript
// ❌ BAD: Global initialization that runs on every cold start
const heavyObject = performExpensiveSetup();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return Response.json({ data: heavyObject.getData() });
  }
};

// ✅ GOOD: Lazy initialization only when needed
let heavyObject: HeavyType | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!heavyObject) {
      heavyObject = performExpensiveSetup();
    }
    return Response.json({ data: heavyObject.getData() });
  }
};
```

**Cold start optimization tips:**
- Minimize global scope code
- Lazy-load heavy dependencies
- Keep bundle size small (<1 MB compressed)
- Avoid synchronous I/O in global scope
- Use dynamic imports for rarely-used code

## Caching Strategies

### Cache API

Use the Cache API for HTTP responses:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cache = caches.default;
    
    // Try cache first
    let response = await cache.match(request);
    
    if (!response) {
      // Fetch from origin
      response = await fetch(request);
      
      // Cache for 1 hour
      const cacheResponse = response.clone();
      const headers = new Headers(cacheResponse.headers);
      headers.set("Cache-Control", "public, max-age=3600");
      
      await cache.put(
        request,
        new Response(cacheResponse.body, {
          status: cacheResponse.status,
          headers
        })
      );
    }
    
    return response;
  }
};
```

### KV Caching

Cache computed results in KV:

```typescript
async function getCachedData(key: string, env: Env): Promise<any> {
  // Check cache
  const cached = await env.CACHE.get(key, "json");
  if (cached) {
    return cached;
  }
  
  // Compute expensive result
  const data = await computeExpensiveResult();
  
  // Cache for 5 minutes
  await env.CACHE.put(key, JSON.stringify(data), {
    expirationTtl: 300
  });
  
  return data;
}
```

## Minimize Response Time

### Stream Responses

Stream large responses instead of buffering:

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const { readable, writable } = new TransformStream();
    
    // Start streaming immediately
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    
    // Write data asynchronously
    (async () => {
      for (let i = 0; i < 1000; i++) {
        await writer.write(encoder.encode(`Line ${i}\n`));
      }
      await writer.close();
    })();
    
    return new Response(readable, {
      headers: { "Content-Type": "text/plain" }
    });
  }
};
```

### Parallel Requests

Execute independent operations in parallel:

```typescript
// ❌ BAD: Sequential requests
const user = await fetch("https://api.example.com/user");
const posts = await fetch("https://api.example.com/posts");
const comments = await fetch("https://api.example.com/comments");

// ✅ GOOD: Parallel requests
const [user, posts, comments] = await Promise.all([
  fetch("https://api.example.com/user"),
  fetch("https://api.example.com/posts"),
  fetch("https://api.example.com/comments")
]);
```

## Efficient Data Handling

### Avoid Unnecessary Parsing

```typescript
// ❌ BAD: Parse entire body when only checking one field
const body = await request.json();
if (body.action === "ping") {
  return new Response("pong");
}

// ✅ GOOD: Stream parse for early exit
const reader = request.body?.getReader();
// Or use request.json() only when needed
```

### Use Appropriate Data Structures

```typescript
// For lookups: Use Map instead of Array.find()
const userMap = new Map(users.map(u => [u.id, u]));
const user = userMap.get(userId); // O(1) instead of O(n)

// For existence checks: Use Set instead of Array.includes()
const allowedIds = new Set(["id1", "id2", "id3"]);
if (allowedIds.has(requestId)) { /* ... */ }
```

## Background Tasks with waitUntil

Offload non-critical work to background:

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Respond immediately
    const response = Response.json({ status: "ok" });
    
    // Run analytics in background (doesn't block response)
    ctx.waitUntil(
      env.ANALYTICS.writeDataPoint({
        blobs: [request.url, request.method],
        doubles: [Date.now()]
      })
    );
    
    return response;
  }
};
```

**Use waitUntil for:**
- Analytics tracking
- Cache warming
- Logging
- Non-critical database writes
- Cleanup operations

## Optimize Bundle Size

### Tree Shaking

Ensure your bundler can tree-shake unused code:

```typescript
// ❌ BAD: Imports entire library
import _ from "lodash";
const result = _.map(array, fn);

// ✅ GOOD: Import only what you need
import map from "lodash/map";
const result = map(array, fn);

// ✅ BETTER: Use native methods
const result = array.map(fn);
```

### Dynamic Imports

Load code only when needed:

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === "/admin") {
      // Load admin module only when needed
      const { handleAdmin } = await import("./admin");
      return handleAdmin(request);
    }
    
    return new Response("Home");
  }
};
```

## Database Query Optimization

### Batch Queries

Use D1 batch operations:

```typescript
// ❌ BAD: Multiple individual queries
for (const user of users) {
  await env.DB.prepare("INSERT INTO users (name) VALUES (?)").bind(user.name).run();
}

// ✅ GOOD: Single batch operation
const statements = users.map(user =>
  env.DB.prepare("INSERT INTO users (name) VALUES (?)").bind(user.name)
);
await env.DB.batch(statements);
```

### Use Indexes

Create indexes for frequently queried columns:

```sql
-- Migration file
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_posts_user_id ON posts(user_id);
```

### Limit Result Sets

Always use LIMIT for queries that could return many rows:

```typescript
// ❌ BAD: Could return millions of rows
const { results } = await env.DB.prepare("SELECT * FROM logs").all();

// ✅ GOOD: Limit results
const { results } = await env.DB
  .prepare("SELECT * FROM logs ORDER BY created_at DESC LIMIT 100")
  .all();
```

## Memory Management

### Avoid Memory Leaks

```typescript
// ❌ BAD: Global array that grows indefinitely
const requestLog: Request[] = [];

export default {
  async fetch(request: Request): Promise<Response> {
    requestLog.push(request); // Memory leak!
    return new Response("OK");
  }
};

// ✅ GOOD: Use external storage
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Log to KV/D1/Analytics Engine instead
    await env.LOGS.put(
      crypto.randomUUID(),
      JSON.stringify({ url: request.url, time: Date.now() })
    );
    return new Response("OK");
  }
};
```

### Stream Large Data

Don't buffer large responses in memory:

```typescript
// ❌ BAD: Load entire file into memory
const object = await env.BUCKET.get("large-file.zip");
const arrayBuffer = await object.arrayBuffer(); // Could be GBs!
return new Response(arrayBuffer);

// ✅ GOOD: Stream the response
const object = await env.BUCKET.get("large-file.zip");
return new Response(object.body); // Stream directly
```

## CPU Time Optimization

Workers have CPU time limits (10ms free, 30s paid). Optimize CPU-intensive operations:

### Avoid Blocking Operations

```typescript
// ❌ BAD: Synchronous CPU-intensive work
function processLargeArray(data: number[]): number[] {
  return data.map(x => {
    // Complex computation
    for (let i = 0; i < 1000000; i++) {
      x = Math.sqrt(x);
    }
    return x;
  });
}

// ✅ GOOD: Break into chunks or use Durable Objects for long-running work
async function processInChunks(data: number[], env: Env): Promise<void> {
  const chunkSize = 100;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    await env.PROCESSOR_DO.process(chunk);
  }
}
```

### Use Native APIs

Native Web APIs are faster than polyfills:

```typescript
// ✅ Use native crypto
const hash = await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode(data)
);

// ✅ Use native URL parsing
const url = new URL(request.url);
const params = url.searchParams;

// ✅ Use native JSON
const data = JSON.parse(text);
const text = JSON.stringify(data);
```

## Response Compression

Workers automatically compress responses, but you can optimize:

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const acceptEncoding = request.headers.get("Accept-Encoding") || "";
    
    // Large JSON response
    const data = generateLargeData();
    
    // Workers will auto-compress if client supports it
    return Response.json(data, {
      headers: {
        "Content-Type": "application/json",
        // Hint that this should be cached
        "Cache-Control": "public, max-age=3600"
      }
    });
  }
};
```

## Monitoring Performance

### Use Observability

Enable observability in wrangler.jsonc:

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  }
}
```

### Add Timing Headers

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const start = Date.now();
    
    const response = await handleRequest(request, env);
    
    const duration = Date.now() - start;
    const headers = new Headers(response.headers);
    headers.set("X-Response-Time", `${duration}ms`);
    
    return new Response(response.body, {
      status: response.status,
      headers
    });
  }
};
```

## Performance Checklist

- [ ] Minimize global scope initialization
- [ ] Use lazy loading for heavy dependencies
- [ ] Implement caching (Cache API, KV, or both)
- [ ] Execute independent operations in parallel
- [ ] Use `ctx.waitUntil()` for background tasks
- [ ] Stream large responses
- [ ] Batch database operations
- [ ] Add indexes to frequently queried columns
- [ ] Limit query result sets
- [ ] Avoid memory leaks (no global state accumulation)
- [ ] Use native Web APIs over polyfills
- [ ] Keep bundle size under 1 MB
- [ ] Enable observability for monitoring
- [ ] Test cold start performance
- [ ] Profile CPU-intensive operations

## Common Performance Pitfalls

1. **Buffering large responses** - Always stream when possible
2. **Sequential API calls** - Use Promise.all() for parallel execution
3. **No caching strategy** - Cache frequently accessed data
4. **Unbounded queries** - Always use LIMIT in SQL queries
5. **Global state accumulation** - Store data in KV/D1, not memory
6. **Synchronous CPU work** - Break into chunks or use Durable Objects
7. **Large bundle sizes** - Tree-shake and use dynamic imports
8. **Missing indexes** - Add indexes for query performance
9. **Unnecessary parsing** - Parse only when needed
10. **Blocking on non-critical work** - Use waitUntil() for background tasks
