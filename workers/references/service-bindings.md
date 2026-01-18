# Service Bindings Deep Dive

Service Bindings enable zero-cost, zero-latency communication between Workers using RPC (Remote Procedure Call) instead of HTTP.

## Architecture Overview

```
┌─────────────┐                    ┌─────────────┐
│  Worker A   │  Service Binding   │  Worker B   │
│  (Client)   │ ─────────────────> │  (Service)  │
│             │   RPC Method Call  │             │
│             │   Same Thread!     │             │
└─────────────┘                    └─────────────┘
```

**Key Benefits:**
- **Zero latency**: Both Workers run on same thread of same server
- **No HTTP overhead**: Direct method calls, not HTTP requests/responses
- **Zero additional cost**: Split functionality without increasing bills
- **Type-safe**: Full TypeScript support with auto-generated types
- **Internal-only**: Services can be unreachable from public internet
- **Independent deployment**: Each Worker deploys separately

## Configuration

### Basic Setup

**Service Worker (Worker B):**

```jsonc
{
  "name": "my-service",
  "main": "src/service.ts",
  "compatibility_date": "2025-03-07"
}
```

**Client Worker (Worker A):**

```jsonc
{
  "name": "my-client",
  "main": "src/client.ts",
  "compatibility_date": "2025-03-07",
  "services": [
    {
      "binding": "MY_SERVICE",    // Name in env
      "service": "my-service",     // Target Worker name
      "entrypoint": "MyService"    // Optional: named entrypoint
    }
  ]
}
```

### Deployment Order

1. **First deployment**: Deploy service (Worker B) first, then client (Worker A)
2. **Updates to existing code**:
   - Deploy backward-compatible changes to service first (e.g., add new method)
   - Deploy client changes second (e.g., call new method)
   - Finally, remove unused code from service

## RPC Interface

### WorkerEntrypoint Basics

```typescript
import { WorkerEntrypoint } from "cloudflare:workers";

export class MyService extends WorkerEntrypoint {
  // Required: fetch handler (can return 404 if not used)
  async fetch(request: Request): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
  
  // Public RPC methods
  async publicMethod(arg: string): Promise<string> {
    return `Hello, ${arg}`;
  }
  
  // Private methods (not callable via RPC)
  #privateMethod(): void {
    // Only callable within this Worker
  }
}

export default MyService;
```

**Rules:**
- Must extend `WorkerEntrypoint` from `cloudflare:workers`
- Must have a `fetch()` handler (even if it just returns 404)
- All non-private methods become callable via RPC
- Use `#` or `private` to make methods internal-only

### Calling RPC Methods

```typescript
interface Env {
  MY_SERVICE: Service<typeof MyService>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // All RPC calls must be awaited
    const result = await env.MY_SERVICE.publicMethod("World");
    return new Response(result);
  }
};
```

**Important:**
- All RPC calls are asynchronous, even if implemented synchronously
- Must always `await` RPC calls
- RPC calls don't return real `Promise`s, but custom "thenables"

## Supported Types

### Structured Cloneable Types

Nearly all Structured Cloneable types work:
- Primitives: `string`, `number`, `boolean`, `null`, `undefined`
- Objects and arrays
- `Date`, `RegExp`, `ArrayBuffer`, `TypedArrays`
- `Map`, `Set`

### Special Types

| Type | Behavior |
|------|----------|
| `Function` | Replaced by stub that calls back to sender |
| `RpcTarget` class | Replaced by stub with callable methods |
| `ReadableStream` | Streamed with flow control |
| `WritableStream` | Streamed with flow control |
| `Request` | Convenient HTTP message representation |
| `Response` | Convenient HTTP message representation |
| RPC stubs | Can be forwarded to third Worker |

**Not Supported:**
- Application-defined classes that don't extend `RpcTarget`
- Objects with custom prototypes (except `RpcTarget`)
- Native objects like DOM nodes

## Returning Functions

Functions returned from RPC maintain their closure and execute in the original Worker:

```typescript
// Service
export class CounterService extends WorkerEntrypoint {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
  
  async newCounter(): Promise<(increment?: number) => number> {
    let value = 0;
    
    // This function executes in CounterService, not the caller
    return (increment = 0) => {
      value += increment;
      return value;
    };
  }
}

// Client
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    using counter = await env.COUNTER_SERVICE.newCounter();
    
    await counter(5);   // returns 5
    await counter(3);   // returns 8
    await counter(-2);  // returns 6
    
    return Response.json({ count: await counter() });
  }
};
```

**Use Cases:**
- Stateful counters
- Session management
- Iterators over remote data
- Callback patterns

## Returning Classes (RpcTarget)

Extend `RpcTarget` to return class instances over RPC:

```typescript
import { WorkerEntrypoint, RpcTarget } from "cloudflare:workers";

// Must extend RpcTarget
class Database extends RpcTarget {
  #data = new Map<string, string>();
  
  set(key: string, value: string): void {
    this.#data.set(key, value);
  }
  
  get(key: string): string | undefined {
    return this.#data.get(key);
  }
  
  // Properties work too
  get size(): number {
    return this.#data.size;
  }
}

export class DatabaseService extends WorkerEntrypoint {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
  
  async connect(): Promise<Database> {
    return new Database();
  }
}

// Client
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    using db = await env.DB_SERVICE.connect();
    
    // Each method call is an RPC
    await db.set("name", "Alice");
    const name = await db.get("name");
    const size = await db.size;  // Property access
    
    return Response.json({ name, size });
  }
};
```

**Why RpcTarget over plain objects:**
- More efficient: Single stub instead of multiple function stubs
- Properties can be fetched on-demand
- Clearer API design
- Better TypeScript support

## Promise Pipelining

Reduce round-trips by omitting intermediate `await`:

```typescript
// ❌ THREE round trips
using db = await env.DB_SERVICE.connect();
await db.set("key", "value");
const result = await db.get("key");

// ✅ TWO round trips (pipeline set and get)
using dbPromise = env.DB_SERVICE.connect();
await dbPromise.set("key", "value");
const result = await dbPromise.get("key");

// ✅ ONE round trip (pipeline all three)
const result = await env.DB_SERVICE.connect().set("key", "value").then(db => db.get("key"));
```

**How it works:**
- RPC methods return custom "thenables", not real `Promise`s
- You can call methods on promises before awaiting them
- Calls are batched and sent together
- Works with properties too: `await promise.foo.bar.baz()`

**When to use:**
- Chained method calls
- Accessing nested properties
- Operations that don't depend on intermediate results

## Named Entrypoints

Expose multiple services from one Worker with different permissions:

```typescript
import { WorkerEntrypoint } from "cloudflare:workers";

// Public API - limited functionality
export class PublicAPI extends WorkerEntrypoint {
  async fetch(): Promise<Response> {
    return new Response("Public API");
  }
  
  async getPublicData(): Promise<string[]> {
    return ["data1", "data2"];
  }
}

// Admin API - privileged operations
export class AdminAPI extends WorkerEntrypoint {
  async fetch(): Promise<Response> {
    return new Response("Admin API");
  }
  
  async deleteUser(userId: string): Promise<void> {
    // Only accessible via AdminAPI binding
  }
  
  async getInternalMetrics(): Promise<Record<string, number>> {
    return { requests: 1000, errors: 5 };
  }
}

// Default export (required)
export default PublicAPI;
```

**Bind to specific entrypoints:**

```jsonc
{
  "services": [
    {
      "binding": "PUBLIC_API",
      "service": "api-service",
      "entrypoint": "PublicAPI"
    },
    {
      "binding": "ADMIN_API",
      "service": "api-service",
      "entrypoint": "AdminAPI"
    }
  ]
}
```

**Benefits:**
- Security: Only Workers with explicit bindings can access methods
- Clear separation of concerns
- Different Workers can use different entrypoints
- Single deployment for multiple APIs

## Streaming with ReadableStream

Stream large data without buffering:

```typescript
// Service
export class DataService extends WorkerEntrypoint {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
  
  async streamLargeFile(): Promise<ReadableStream> {
    return new ReadableStream({
      async start(controller) {
        for (let i = 0; i < 1000; i++) {
          const chunk = new TextEncoder().encode(`Line ${i}\n`);
          controller.enqueue(chunk);
        }
        controller.close();
      }
    });
  }
}

// Client
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const stream = await env.DATA_SERVICE.streamLargeFile();
    
    // Return stream directly
    return new Response(stream, {
      headers: { "Content-Type": "text/plain" }
    });
  }
};
```

**Features:**
- Automatic flow control (backpressure)
- No 32 MiB RPC limit (bytes are streamed)
- Only byte-oriented streams supported (`type: "bytes"`)
- Ownership transferred to recipient

## Forwarding RPC Stubs

Pass stubs between Workers to connect services:

```typescript
// Worker A (introducer)
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Get stub from Worker B
    using counter = await env.COUNTER_SERVICE.newCounter();
    
    // Forward to Worker C
    await env.PROCESSOR_SERVICE.processCounter(counter);
    
    return new Response("OK");
  }
};

// Worker C (receives stub)
export class ProcessorService extends WorkerEntrypoint {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
  
  async processCounter(counter: any): Promise<void> {
    // Calls to counter proxy through Worker A back to Worker B
    await counter(10);
    await counter(5);
  }
}
```

**Use Cases:**
- Service orchestration
- Dynamic service discovery
- Dependency injection
- Connecting Workers without direct bindings

**Limitation:** Proxying only lasts for current execution context, cannot be persisted

## TypeScript Support

### Auto-Generate Types

```bash
# Generate types for client Worker
wrangler types -c wrangler.jsonc -c ../service/wrangler.jsonc
```

This generates `Env` with proper `Service<T>` types:

```typescript
interface Env {
  MY_SERVICE: Service<import("../service/src/index").MyService>;
}
```

### Manual Types

```typescript
import type { MyService } from "../service/src/index";

interface Env {
  MY_SERVICE: Service<typeof MyService>;
}
```

### RpcTarget Typing

```typescript
import { RpcTarget } from "cloudflare:workers";

class Counter extends RpcTarget {
  #value = 0;
  
  increment(n: number): number {
    this.#value += n;
    return this.#value;
  }
}

// Client sees Counter methods as async
const counter: Counter = await env.SERVICE.getCounter();
const result: number = await counter.increment(5);
```

## HTTP Interface (Fallback)

For simple cases, call `fetch` directly without extending `WorkerEntrypoint`:

```typescript
// Service
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return Response.json({ message: "Hello" });
  }
};

// Client
interface Env {
  MY_SERVICE: Fetcher;  // Note: Fetcher, not Service<T>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const serviceRequest = new Request("http://internal/api");
    const response = await env.MY_SERVICE.fetch(serviceRequest);
    return response;
  }
};
```

**When to use HTTP interface:**
- Simple request forwarding
- No need for custom RPC methods
- Already have HTTP-based service
- Migrating from external API to internal service

**When to use RPC interface:**
- Custom methods and logic
- Need type safety
- Multiple operations per request
- Stateful interactions

## Resource Management

Use `using` declaration for automatic cleanup:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Automatically disposed when scope exits
    using counter = await env.SERVICE.newCounter();
    
    await counter(5);
    await counter(3);
    
    return Response.json({ count: await counter() });
    // counter disposed here
  }
};
```

**Explicit Resource Management:**
- `using` calls `[Symbol.dispose]()` automatically
- Works with RPC stubs
- Introduced in ES2024 (TypeScript 5.2+)
- Alternative: manual cleanup with try/finally

## Local Development

Run multiple Workers locally:

```bash
# Terminal 1: Service
cd service-worker
wrangler dev

# Terminal 2: Client (will connect to service)
cd client-worker
wrangler dev
```

Wrangler shows connection status:
```
Your worker has access to the following bindings:
- Services:
  - MY_SERVICE: my-service [connected]
  - OTHER_SERVICE: other-service [not connected]
```

**Single command (experimental):**
```bash
wrangler dev -c wrangler.jsonc -c ../service/wrangler.jsonc
```

The first config is primary (exposed on `localhost:8787`), others are secondary (accessible only via bindings).

## Limits and Considerations

| Limit | Value | Notes |
|-------|-------|-------|
| Max RPC payload | 32 MiB | Use streams for larger data |
| Max Worker invocations | 32 per request | Each binding call counts |
| Subrequest limit | Applies | Each Service Binding call counts |
| Simultaneous connections | Not counted | Unlike HTTP subrequests |
| Smart Placement | Ignored for RPC | Both Workers run locally |

### CPU Time

Each Worker invocation gets its own CPU time:
- Worker A: 50ms CPU limit
- Worker B (via binding): 50ms CPU limit
- Total: Can use more than 50ms across both

### Memory

Each Worker runs in separate isolate:
- Separate 128 MB memory limits
- Cannot share memory directly
- Must serialize data over RPC

## Performance Best Practices

1. **Use RPC, not HTTP**: Eliminates serialization overhead
2. **Promise pipelining**: Batch calls to reduce round-trips
3. **Return RpcTarget classes**: More efficient than multiple function stubs
4. **Stream large data**: Don't buffer in memory
5. **Cache service results**: Store frequently-accessed data in caller
6. **Minimize RPC calls**: Design APIs to reduce back-and-forth
7. **Use named entrypoints**: Only expose necessary methods

## Common Patterns

### Authentication Service

```typescript
// auth-service
export class AuthService extends WorkerEntrypoint {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
  
  async verifyToken(token: string): Promise<{ valid: boolean; userId?: string }> {
    // Check JWT, KV, etc.
  }
  
  async getUserRoles(userId: string): Promise<string[]> {
    // Fetch from D1 or KV
  }
}

// api-gateway
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = await env.AUTH.verifyToken(
      request.headers.get("authorization") ?? ""
    );
    
    if (!auth.valid) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    // Continue with authorized request
  }
};
```

### Rate Limiting Service

```typescript
// rate-limiter
export class RateLimiter extends WorkerEntrypoint {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
  
  async checkLimit(key: string, limit: number): Promise<{ allowed: boolean; remaining: number }> {
    // Use Durable Object for accurate rate limiting
  }
}

// api
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const result = await env.RATE_LIMITER.checkLimit(ip, 100);
    
    if (!result.allowed) {
      return Response.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "X-RateLimit-Remaining": "0" } }
      );
    }
    
    return Response.json({ success: true });
  }
};
```

### Multi-Service Orchestration

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Parallel RPC calls
    const [user, products, recommendations] = await Promise.all([
      env.USER_SERVICE.getUser(userId),
      env.PRODUCT_SERVICE.getProducts(),
      env.RECOMMENDATION_SERVICE.getRecommendations(userId)
    ]);
    
    return Response.json({ user, products, recommendations });
  }
};
```

## Troubleshooting

### "Worker not found" during deployment

**Cause:** Client deployed before service exists

**Solution:** Deploy service first, then client

### "Method not found" errors

**Cause:** 
- Method is private (`#` or `private`)
- Method doesn't exist on target class
- Type mismatch in binding

**Solution:**
- Ensure method is public
- Check spelling and signature
- Regenerate types with `wrangler types`

### High latency with multiple calls

**Cause:** Not using promise pipelining

**Solution:** Omit intermediate `await` to batch calls

### Types not matching runtime

**Cause:** `wrangler types` not run after config changes

**Solution:** 
```bash
wrangler types -c client.jsonc -c service.jsonc
```

### "Cannot serialize class instance" error

**Cause:** Trying to pass class that doesn't extend `RpcTarget`

**Solution:** Extend `RpcTarget` or serialize to plain object

## Migration from HTTP to Service Bindings

**Before (HTTP):**
```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await fetch("https://my-service.workers.dev/api", {
      method: "POST",
      body: JSON.stringify({ data: "value" })
    });
    
    const result = await response.json();
    return Response.json(result);
  }
};
```

**After (Service Binding with RPC):**
```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const result = await env.MY_SERVICE.processData("value");
    return Response.json(result);
  }
};
```

**Benefits:**
- 10-100x faster (no HTTP serialization)
- Type-safe (compiler catches errors)
- No parsing overhead
- Zero additional cost

## Summary

Service Bindings with RPC are the **recommended way** to build multi-Worker applications:

✅ Use for:
- Internal microservices
- Authentication/authorization
- Shared business logic
- Multi-tenant architectures
- Service-oriented architectures

❌ Avoid for:
- Public-facing APIs (use regular Workers)
- External service communication (use `fetch`)
- Simple, single-Worker applications

**Remember:** Service Bindings are a zero-cost abstraction. Use them freely to organize code without worrying about performance or billing impact.
