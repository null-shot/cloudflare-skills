# Service Bindings and Namespace Reference

Complete guide to Durable Object bindings, namespaces, and inter-service communication.

## Overview

**Durable Object bindings** connect your Worker to Durable Object classes, allowing you to create and interact with stateful instances. **Service bindings** allow Workers to call other Workers or services directly, with zero network overhead.

## Durable Object Namespace

A `DurableObjectNamespace` represents a set of Durable Objects backed by the same class. Each class has one namespace, which can contain unlimited instances.

### Accessing the Namespace

Access via the `env` parameter in your Worker:

```typescript
export interface Env {
  MY_DO: DurableObjectNamespace<MyDurableObject>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // env.MY_DO is the namespace
    const stub = env.MY_DO.getByName("instance-1");
    return stub.fetch(request);
  }
};
```

## Creating Durable Object IDs

Durable Object IDs identify specific instances. Creating an ID does **not** create the instance—the instance is created lazily when first accessed.

### getByName() - Recommended

Get a stub directly by name (most common pattern):

```typescript
const stub = env.MY_DO.getByName("room-123");
```

**Benefits:**
- Single call (no separate ID creation)
- Deterministic: same name → same instance
- Perfect for natural identifiers (user IDs, room names, etc.)

**Use for:**
- Chat rooms by ID
- User sessions by user ID
- Game matches by match ID
- Per-tenant instances by tenant ID

```typescript
// Examples
const userSession = env.SESSIONS.getByName(`user:${userId}`);
const chatRoom = env.ROOMS.getByName(`room:${roomId}`);
const gameMatch = env.GAMES.getByName(`match:${matchId}`);
```

### idFromName()

Create an ID from a name (older pattern, usually prefer `getByName()`):

```typescript
const id = env.MY_DO.idFromName("room-123");
const stub = env.MY_DO.get(id);
```

**When to use:**
- When you need the ID itself (e.g., to store or compare)
- When passing IDs between systems
- Legacy code compatibility

**Latency note**: First access of a named DO may take a few hundred milliseconds for global synchronization. Subsequent accesses are cached globally.

### newUniqueId()

Create a new random unique ID:

```typescript
const id = env.MY_DO.newUniqueId();
const stub = env.MY_DO.get(id);

// Store ID for future reference
const idString = id.toString();
await env.KV.put(`session:${sessionId}`, idString);
```

**Benefits:**
- Faster first access (no global synchronization check)
- Truly unique IDs

**Drawbacks:**
- Must store ID string externally (KV, D1, cookies, etc.)
- Not deterministic

**Use for:**
- New temporary sessions
- One-time use instances
- When you need guaranteed uniqueness

```typescript
// Example: Generate session ID
const sessionId = env.SESSIONS.newUniqueId();
const sessionIdString = sessionId.toString();

// Store in cookie
const response = new Response("Session created");
response.headers.set("Set-Cookie", `session=${sessionIdString}; HttpOnly`);
```

### idFromString()

Recreate an ID from a previously stored ID string:

```typescript
const idString = await env.KV.get(`session:${sessionId}`);
if (idString) {
  const id = env.MY_DO.idFromString(idString);
  const stub = env.MY_DO.get(id);
}
```

**Throws exception** if:
- ID string is invalid
- ID was not created from this namespace

```typescript
try {
  const id = env.MY_DO.idFromString(userProvidedId);
} catch (error) {
  return new Response("Invalid session ID", { status: 400 });
}
```

### get()

Create a stub from a Durable Object ID:

```typescript
const id = env.MY_DO.idFromName("room-123");
const stub = env.MY_DO.get(id);
```

**Returns immediately** (doesn't wait for connection). Allows sending requests without network round trip.

## Location Hints

Influence where Durable Objects are created for latency-sensitive applications.

### Using Location Hints

```typescript
const id = env.GAME.idFromName(gameId, { locationHint: "wnam" });
const stub = env.GAME.get(id);

// Or with getByName
const stub = env.GAME.get(
  env.GAME.idFromName(gameId, { locationHint: "wnam" })
);
```

**Available hints:**
- `wnam` - Western North America
- `enam` - Eastern North America
- `sam` - South America
- `weur` - Western Europe
- `eeur` - Eastern Europe
- `apac` - Asia-Pacific
- `oc` - Oceania
- `afr` - Africa
- `me` - Middle East

**Use cases:**
- Multi-region games where users cluster by region
- Compliance requirements for data residency
- Optimizing latency for known user locations

**Note**: Location hint is a preference, not a guarantee. The system may place the DO elsewhere for operational reasons.

## Jurisdiction

Restrict Durable Objects to specific regulatory jurisdictions.

```typescript
const euNamespace = env.MY_DO.jurisdiction("eu");
const euStub = euNamespace.getByName("user-123");
```

Creates a subnamespace where all IDs are restricted to the specified jurisdiction.

**Available jurisdictions:**
- `eu` - European Union

More jurisdictions continuously evaluated. Share requests in [Durable Objects Discord](https://discord.gg/cloudflaredev).

**Use cases:**
- GDPR compliance (keeping EU user data in EU)
- Data sovereignty requirements
- Regulatory compliance

```typescript
// Example: Per-jurisdiction routing
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get("user");
    const region = getUserRegion(request); // Determine from headers
    
    let stub;
    if (region === "eu") {
      const euNamespace = env.USERS.jurisdiction("eu");
      stub = euNamespace.getByName(userId);
    } else {
      stub = env.USERS.getByName(userId);
    }
    
    return stub.fetch(request);
  }
};
```

## Durable Object Stubs

A `DurableObjectStub` is a client object for invoking methods on a Durable Object instance.

### RPC Method Calls (Recommended)

Call public methods directly on the stub:

```typescript
export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
}

export class ChatRoom extends DurableObject<Env> {
  async sendMessage(userId: string, content: string): Promise<Message> {
    // Store in SQLite
    const result = this.ctx.storage.sql.exec<{ id: number }>(
      "INSERT INTO messages (user_id, content, created_at) VALUES (?, ?, ?) RETURNING id",
      userId, content, Date.now()
    );
    
    const message = { id: result.one().id, userId, content };
    
    // Broadcast to WebSockets
    this.broadcast(message);
    
    return message;
  }
  
  async getMessages(limit: number = 50): Promise<Message[]> {
    return this.ctx.storage.sql.exec<Message>(
      "SELECT * FROM messages ORDER BY created_at DESC LIMIT ?",
      limit
    ).toArray();
  }
}

// Worker calling the DO
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const stub = env.CHAT_ROOM.getByName("room-123");
    
    // Call RPC methods directly with type safety
    const message = await stub.sendMessage("user-456", "Hello!");
    const messages = await stub.getMessages(20);
    
    return Response.json({ message, messages });
  }
};
```

**Benefits:**
- Type-safe method calls
- Clean API design
- No HTTP request/response overhead
- Automatic serialization

**Supported types:**
- All types supported by [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- Primitives: string, number, boolean, null, undefined
- Objects, Arrays, Maps, Sets
- Date, RegExp, ArrayBuffer
- **NOT supported**: Functions, Symbols, DOM nodes

### fetch() Method (Legacy)

Call the `fetch()` handler on the Durable Object:

```typescript
const stub = env.MY_DO.getByName("instance-1");
const response = await stub.fetch(request);
```

Or create a new request:

```typescript
const response = await stub.fetch("https://fake-host/api/action", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data: "value" })
});
```

**Note**: The URL doesn't matter (fake-host is fine). The DO only sees the Request object.

**When to use fetch():**
- Legacy Durable Objects without RPC methods
- Need HTTP semantics (status codes, headers)
- Compatibility with existing HTTP-based code

**Prefer RPC methods** for new code (cleaner, faster, type-safe).

## Configuration

### Basic Binding

```jsonc
// wrangler.jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "MY_DO",
        "class_name": "MyDurableObject"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["MyDurableObject"]
    }
  ]
}
```

- **name**: Variable name on `env` object
- **class_name**: Name of Durable Object class
- **migrations**: Required to initialize storage backend

### Binding to External Durable Object

Bind to a Durable Object class defined in another Worker:

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "EXTERNAL_DO",
        "class_name": "MyDurableObject",
        "script_name": "other-worker"
      }
    ]
  }
}
```

**Use cases:**
- Shared services across multiple Workers
- Team separation (different teams own different Workers)
- Microservice architecture

**Requirements:**
- Both Workers must be in the same Cloudflare account
- The external Worker must be deployed first
- The external Worker must export the Durable Object class

## Worker-to-Worker Service Bindings

Service bindings allow Workers to call other Workers with **zero network overhead**.

### Configuration

Worker A calls Worker B:

```jsonc
// Worker A wrangler.jsonc
{
  "name": "worker-a",
  "main": "./src/workerA.js",
  "services": [
    {
      "binding": "WORKER_B",
      "service": "worker-b"
    }
  ]
}
```

```jsonc
// Worker B wrangler.jsonc
{
  "name": "worker-b",
  "main": "./src/workerB.js"
}
```

### RPC Service Binding (Recommended)

Worker B exposes RPC methods:

```typescript
// Worker B
import { WorkerEntrypoint } from "cloudflare:workers";

export default class WorkerB extends WorkerEntrypoint {
  async fetch() {
    return new Response(null, { status: 404 });
  }
  
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }
  
  async getUser(id: string): Promise<User> {
    // Fetch from D1, R2, etc.
    return { id, name: "Alice" };
  }
}
```

Worker A calls Worker B:

```typescript
// Worker A
export interface Env {
  WORKER_B: Service; // Or specific type
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const result = await env.WORKER_B.add(1, 2);
    const user = await env.WORKER_B.getUser("user-123");
    
    return Response.json({ result, user });
  }
};
```

### HTTP Service Binding

Call `fetch()` on the bound service:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Forward request to Worker B
    const response = await env.WORKER_B.fetch(request);
    return response;
  }
};
```

Or create a new request:

```typescript
const response = await env.WORKER_B.fetch("https://fake-host/api/users", {
  method: "GET",
  headers: { "Authorization": `Bearer ${token}` }
});
```

## Combining Durable Objects and Service Bindings

Common pattern: Shared Durable Object service accessed by multiple Workers.

### Architecture

```
Worker A (Public API) ──→ Shared DO Service ──→ Durable Objects
Worker B (Admin API)  ──┘
```

### Implementation

**Shared DO Service:**

```jsonc
// do-service/wrangler.jsonc
{
  "name": "do-service",
  "main": "./src/index.js",
  "durable_objects": {
    "bindings": [
      { "name": "CHAT_ROOM", "class_name": "ChatRoom" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["ChatRoom"] }
  ]
}
```

```typescript
// do-service/src/index.ts
import { WorkerEntrypoint } from "cloudflare:workers";

export class ChatRoom extends DurableObject<Env> {
  async sendMessage(userId: string, content: string) {
    // Implementation
  }
}

export default class DoService extends WorkerEntrypoint {
  async fetch() {
    return new Response(null, { status: 404 });
  }
  
  async sendMessage(roomId: string, userId: string, content: string) {
    const stub = this.env.CHAT_ROOM.getByName(roomId);
    return stub.sendMessage(userId, content);
  }
}
```

**Worker A (Public API):**

```jsonc
// worker-a/wrangler.jsonc
{
  "name": "worker-a",
  "main": "./src/index.js",
  "services": [
    { "binding": "DO_SERVICE", "service": "do-service" }
  ]
}
```

```typescript
// worker-a/src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { roomId, userId, content } = await request.json();
    const message = await env.DO_SERVICE.sendMessage(roomId, userId, content);
    return Response.json(message);
  }
};
```

**Worker B (Admin API):** Same pattern, different endpoints.

## Best Practices

### DO Namespace Patterns

1. **Use `getByName()` for natural IDs**

```typescript
// ✅ Good
const stub = env.ROOMS.getByName(`room:${roomId}`);

// ❌ Unnecessary
const id = env.ROOMS.idFromName(`room:${roomId}`);
const stub = env.ROOMS.get(id);
```

2. **Use `newUniqueId()` for ephemeral instances**

```typescript
// ✅ Good for temporary sessions
const sessionId = env.SESSIONS.newUniqueId();
const stub = env.SESSIONS.get(sessionId);
```

3. **Namespace your IDs to avoid collisions**

```typescript
// ✅ Good: Clear namespacing
const userDO = env.STATE.getByName(`user:${userId}`);
const roomDO = env.STATE.getByName(`room:${roomId}`);

// ❌ Bad: Could collide if IDs are similar
const userDO = env.STATE.getByName(userId);
const roomDO = env.STATE.getByName(roomId);
```

### Service Binding Patterns

1. **Deploy target Worker first**

```bash
# Deploy Worker B (target)
cd worker-b && npx wrangler deploy

# Then deploy Worker A (caller)
cd ../worker-a && npx wrangler deploy
```

2. **Version your RPC methods carefully**

```typescript
// ✅ Good: Backwards compatible change
export default class extends WorkerEntrypoint {
  async getUser(id: string, includeDetails = false) {
    // Old callers still work
  }
}

// ❌ Bad: Breaking change
export default class extends WorkerEntrypoint {
  async getUser(id: string, options: GetUserOptions) {
    // Old callers break!
  }
}
```

3. **Isolate internal services from public internet**

```typescript
// Internal service: No fetch() handler, only RPC methods
export default class InternalAuth extends WorkerEntrypoint {
  async fetch() {
    // Not accessible via public URL
    return new Response("Not found", { status: 404 });
  }
  
  async validateToken(token: string) {
    // Only accessible via service binding
    return { valid: true, userId: "123" };
  }
}
```

### Error Handling

```typescript
// DO Stub calls
try {
  const stub = env.MY_DO.getByName(roomId);
  const result = await stub.doSomething();
} catch (error) {
  // Handle DO errors
  console.error("DO error:", error);
  return new Response("Internal server error", { status: 500 });
}

// Service binding calls
try {
  const result = await env.OTHER_SERVICE.method();
} catch (error) {
  // Handle service errors
  return new Response("Service unavailable", { status: 503 });
}
```

## Limits

### Durable Object Limits

- **No limit** on number of instances per namespace
- **128 MB** memory per instance
- **32 subrequest limit** - Each DO method call from Worker counts as 1

### Service Binding Limits

- **32 Worker invocations** per request maximum
- Each service binding call counts toward this limit
- Does **not** count toward simultaneous connection limits
- Each request counts toward subrequest limit

## Local Development

### Durable Objects

```bash
npx wrangler dev
```

DOs work automatically in local dev.

### Service Bindings

Run multiple `wrangler dev` sessions:

```bash
# Terminal 1: Worker B (target)
cd worker-b && npx wrangler dev

# Terminal 2: Worker A (caller)
cd worker-a && npx wrangler dev
```

Wrangler shows connection status:

```
Your worker has access to the following bindings:
- Services:
  - WORKER_B: worker-b [connected]
```

**Or use experimental multi-worker dev:**

```bash
npx wrangler dev -c wrangler.jsonc -c ../worker-b/wrangler.jsonc
```

## Smart Placement

[Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement/) automatically places Workers in optimal locations.

Works with service bindings to split Workers into services:

```
┌─────────────────────┐
│ Worker A (frontend) │ ← Smart Placement
└──────────┬──────────┘
           │ Service Binding (zero latency)
           ▼
┌─────────────────────┐
│ Worker B (backend)  │ ← Smart Placement
└─────────────────────┘
```

Enable in wrangler.jsonc:

```jsonc
{
  "placement": {
    "mode": "smart"
  }
}
```

## TypeScript Types

### Env Interface

```typescript
export interface Env {
  // Durable Object namespace
  MY_DO: DurableObjectNamespace<MyDurableObject>;
  
  // Service binding (typed)
  AUTH_SERVICE: Service<AuthService>;
  
  // Other bindings
  KV: KVNamespace;
  DB: D1Database;
}
```

### Typed Service Bindings

```typescript
// Service definition
export interface AuthService {
  validateToken(token: string): Promise<{ valid: boolean; userId?: string }>;
  createSession(userId: string): Promise<{ sessionId: string }>;
}

// Caller
export interface Env {
  AUTH: Service<AuthService>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const token = request.headers.get("Authorization");
    const result = await env.AUTH.validateToken(token); // Type-safe!
    return Response.json(result);
  }
};
```

## Summary

| Pattern | Use Case | Configuration |
|---------|----------|---------------|
| `getByName()` | Natural IDs (users, rooms) | `env.DO.getByName("id")` |
| `newUniqueId()` | Temporary instances | `env.DO.get(env.DO.newUniqueId())` |
| `jurisdiction()` | GDPR, data residency | `env.DO.jurisdiction("eu").getByName("id")` |
| RPC methods | Clean APIs, type safety | Call methods directly on stub |
| `fetch()` | HTTP semantics, legacy | `stub.fetch(request)` |
| Service bindings | Worker-to-Worker | Configure `services` in wrangler |
| External DOs | Shared DO across Workers | Add `script_name` to binding |
