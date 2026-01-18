# Durable Objects Rules & Best Practices

> **Note**: This guide focuses on **SQLite-backed Durable Objects** (recommended for all new projects). Configure with `new_sqlite_classes` in wrangler migrations. Legacy KV-backed Durable Objects exist for backwards compatibility but are not recommended for new projects.

## Design & Sharding

### Model Around Coordination Atoms

Create one DO per logical unit needing coordination: chat room, game session, document, user, tenant.

```typescript
// ✅ Good: One DO per chat room
const stub = env.CHAT_ROOM.getByName(roomId);

// ❌ Bad: Single global DO
const stub = env.CHAT_ROOM.getByName("global"); // Bottleneck!
```

### Parent-Child Relationships

For hierarchical data, create separate child DOs. Parent tracks references, children handle own state.

```typescript
// Parent: GameServer tracks match references
// Children: GameMatch handles individual match state
async createMatch(name: string): Promise<string> {
  const matchId = crypto.randomUUID();
  this.ctx.storage.sql.exec(
    "INSERT INTO matches (id, name) VALUES (?, ?)",
    matchId, name
  );
  const child = this.env.GAME_MATCH.getByName(matchId);
  await child.init(matchId, name);
  return matchId;
}
```

### Location Hints

Influence DO creation location for latency-sensitive apps:

```typescript
const id = env.GAME.idFromName(gameId, { locationHint: "wnam" });
```

Available hints: `wnam`, `enam`, `sam`, `weur`, `eeur`, `apac`, `oc`, `afr`, `me`.

## Storage

### SQLite Storage (Recommended for All New Projects)

**Always use SQLite-backed storage for new Durable Objects.** Configure in wrangler:

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "MY_DO", "class_name": "MyDO" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["MyDO"] }  // ← Required for SQLite
  ]
}
```

**Critical**: Use `new_sqlite_classes` (NOT `new_classes`). This enables the SQLite storage backend.

SQL API is synchronous and fast:
```typescript
// Write
this.ctx.storage.sql.exec(
  "INSERT INTO items (name, value) VALUES (?, ?)",
  name, value
);

// Read
const rows = this.ctx.storage.sql.exec<{ id: number; name: string }>(
  "SELECT * FROM items WHERE name = ?", name
).toArray();

// Single row
const row = this.ctx.storage.sql.exec<{ count: number }>(
  "SELECT COUNT(*) as count FROM items"
).one();
```

### Migrations

Use `PRAGMA user_version` for schema versioning:

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  ctx.blockConcurrencyWhile(async () => this.migrate());
}

private async migrate() {
  const version = this.ctx.storage.sql
    .exec<{ user_version: number }>("PRAGMA user_version")
    .one().user_version;

  if (version < 1) {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, data TEXT);
      CREATE INDEX IF NOT EXISTS idx_items_data ON items(data);
      PRAGMA user_version = 1;
    `);
  }
  if (version < 2) {
    this.ctx.storage.sql.exec(`
      ALTER TABLE items ADD COLUMN created_at INTEGER;
      PRAGMA user_version = 2;
    `);
  }
}
```

### State Types

| Type | Speed | Persistence | Use Case |
|------|-------|-------------|----------|
| Class properties | Fastest | Lost on eviction | Caching, active connections |
| SQLite storage | Fast | Durable | Primary data |
| External (R2, D1) | Variable | Durable, cross-DO | Large files, shared data |

**Rule**: Always persist critical state to SQLite first, then update in-memory cache.

## Concurrency

Durable Objects use a **single-threaded actor model** with automatic concurrency control through input/output gates.

### Single-Threaded Execution Model

Each Durable Object instance processes requests **one at a time**:

```
Request Queue → DO Instance (single thread) → Response
   ↓                    ↓
Request 1 → [Processing] → Response 1
Request 2 → [Queued]
Request 3 → [Queued]

After Request 1 completes:
Request 2 → [Processing] → Response 2
Request 3 → [Queued]
```

**Key characteristics:**
- JavaScript execution is strictly serialized
- Requests are automatically queued when DO is busy
- No two pieces of code run in parallel on same DO
- **Soft limit: ~1,000 requests/second per instance**

### Input Gates

**Input gates automatically prevent race conditions** by blocking new events during storage operations.

**Rule**: While storage operations execute, no new events (requests, fetch responses) are delivered except storage completion events.

```typescript
async getUniqueNumber(): Promise<number> {
  // ✅ Safe: Input gate blocks other requests during these operations
  const val = this.ctx.storage.kv.get("counter") ?? 0;
  this.ctx.storage.kv.put("counter", val + 1);
  return val;
}

// Without input gates, concurrent requests could interleave:
// Request 1: get("counter") → 5
// Request 2: get("counter") → 5  // ❌ Race condition!
// Request 1: put("counter", 6)
// Request 2: put("counter", 6)   // ❌ Lost update!

// With input gates:
// Request 1: get("counter") → 5
// Request 1: put("counter", 6)
// Request 1: return 5
// Request 2: [NOW runs] get("counter") → 6  // ✅ Correct!
```

**What input gates protect against:**
- Interleaving of storage operations from different requests
- Race conditions in read-modify-write patterns
- Concurrent initialization

**What input gates do NOT protect:**

```typescript
// ❌ External I/O allows interleaving
async processItem(id: string): Promise<void> {
  const item = this.ctx.storage.kv.get(`item:${id}`);
  
  // Input gate OPENS during external fetch (not storage)
  // Other requests can start while this waits
  await fetch("https://api.example.com/process", { 
    method: "POST",
    body: JSON.stringify(item)
  });
  
  // Race condition possible: another request may have modified item
  this.ctx.storage.kv.put(`item:${id}`, { ...item, processed: true });
}

// ✅ Fix: Use optimistic locking or reload after external I/O
async processItem(id: string): Promise<void> {
  const item = this.ctx.storage.kv.get(`item:${id}`);
  const version = item.version;
  
  await fetch("https://api.example.com/process", {
    method: "POST",
    body: JSON.stringify(item)
  });
  
  // Reload and check version
  const current = this.ctx.storage.kv.get(`item:${id}`);
  if (current.version !== version) {
    throw new Error("Item was modified concurrently");
  }
  
  this.ctx.storage.kv.put(`item:${id}`, { 
    ...current, 
    processed: true,
    version: version + 1
  });
}
```

**Multiple operations in same event:**

```typescript
// ⚠️ Input gates don't help here - both start before any await
const promise1 = this.getUniqueNumber();
const promise2 = this.getUniqueNumber();
const [val1, val2] = await Promise.all([promise1, promise2]);
// val1 === val2 (duplicate!) because both started concurrently

// ✅ Fix: Await first before starting second
const val1 = await this.getUniqueNumber();
const val2 = await this.getUniqueNumber();
// val1 !== val2 (unique values)
```

### Output Gates

**Output gates ensure durability** by holding responses until storage writes complete.

**Rule**: When storage writes are in progress, outgoing network messages (responses, fetch calls) are held back until writes complete. If writes fail, messages are discarded and DO restarts.

```typescript
async addUser(name: string, email: string): Promise<Response> {
  // Write without awaiting
  this.ctx.storage.sql.exec(
    "INSERT INTO users (name, email) VALUES (?, ?)",
    name, email
  );
  
  // Construct response immediately
  const response = Response.json({ success: true });
  
  // Output gate holds this response until write confirms
  // Client doesn't receive response until data is durable
  return response;
}
```

**Benefits:**
- Can return responses without awaiting writes (faster code execution)
- Durability guaranteed before client observes success
- On write failure, response never sent (correct behavior)

**What output gates hold:**
- HTTP responses back to clients
- Outgoing `fetch()` calls to external services
- WebSocket messages
- Any observable side effects

**Example with external notification:**

```typescript
async createOrder(order: Order): Promise<Response> {
  // Write to storage (not awaited)
  this.ctx.storage.sql.exec(
    "INSERT INTO orders (id, data) VALUES (?, ?)",
    order.id, JSON.stringify(order)
  );
  
  // Send notification (also held by output gate)
  fetch("https://notifications.example.com/send", {
    method: "POST",
    body: JSON.stringify({ orderId: order.id })
  });
  
  // Return response (held by output gate)
  return Response.json({ orderId: order.id });
  
  // All three operations (storage, notification, response) held
  // until storage write confirms. If storage fails:
  // - Notification never sent
  // - Response never delivered
  // - DO restarts from clean state
}
```

### Automatic In-Memory Caching

The storage layer includes automatic caching (several MB per DO):

```typescript
// First call: reads from disk
const val1 = this.ctx.storage.kv.get("counter"); // ~1-2ms

// Subsequent calls: instant (cached)
const val2 = this.ctx.storage.kv.get("counter"); // <0.01ms

// Writes: instant to cache, async to disk
this.ctx.storage.kv.put("counter", 42); // <0.01ms (cached)
// Output gate waits for disk confirmation before sending responses
```

**Cache behavior:**
- `get()` returns instantly if key in cache
- `put()` writes to cache immediately
- Cache holds several MB per DO
- Least-recently-used eviction
- Transparent to application code

### Automatic Write Coalescing (Increment)

Multiple writes without `await` between them are batched atomically:

```typescript
async increment(): Promise<number> {
  // Safe: input gates block interleaving during storage ops
  const val = (await this.ctx.storage.get<number>("count")) ?? 0;
  await this.ctx.storage.put("count", val + 1);
  return val + 1;
}
```

### Write Coalescing

### Write Coalescing

Multiple writes without `await` between them are automatically batched atomically:

```typescript
// ✅ Good: All three writes commit atomically
this.ctx.storage.sql.exec("UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, fromId);
this.ctx.storage.sql.exec("UPDATE accounts SET balance = balance + ? WHERE id = ?", amount, toId);
this.ctx.storage.sql.exec("INSERT INTO transfers (from_id, to_id, amount) VALUES (?, ?, ?)", fromId, toId, amount);

// ❌ Bad: await breaks coalescing
await this.ctx.storage.put("key1", val1);
await this.ctx.storage.put("key2", val2); // Separate transaction!
```

### Race Conditions with External I/O

`fetch()` and other non-storage I/O allows interleaving:

```typescript
// ⚠️ Race condition possible
async processItem(id: string) {
  const item = await this.ctx.storage.get<Item>(`item:${id}`);
  if (item?.status === "pending") {
    await fetch("https://api.example.com/process"); // Other requests can run here!
    await this.ctx.storage.put(`item:${id}`, { status: "completed" });
  }
}
```

**Solution**: Use optimistic locking (version numbers) or `transaction()`.

### Request Queue Limits

When too many requests arrive at one DO, they queue internally with bounded limits:

**Soft limit: ~1,000 requests/second per DO instance**

**Overload conditions** (any of):
- Too many requests queued (count)
- Too much data queued (bytes)
- Requests queued too long (time)

**Error handling:**

```typescript
// Worker calling DO
try {
  const stub = env.MY_DO.getByName("room-123");
  const result = await stub.doSomething();
} catch (error) {
  if (error.overloaded) {
    // DO is overloaded - back off
    console.error("Durable Object overloaded");
    return new Response("Service temporarily busy", { 
      status: 429,
      headers: { "Retry-After": "5" }
    });
  }
  throw error;
}
```

**Prevention strategies:**
1. **Shard workload** - Use multiple DOs (per user/room/resource)
2. **Minimize per-request work** - Keep operations fast
3. **Avoid blocking patterns** - Don't use `blockConcurrencyWhile()` on every request
4. **Implement backoff** - Exponential backoff on 429 errors

### blockConcurrencyWhile()

Blocks ALL concurrency (complete input gate closure). Use sparingly - only for initialization:

```typescript
// ✅ Good: One-time init
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  ctx.blockConcurrencyWhile(async () => this.migrate());
}

// ❌ Bad: On every request (kills throughput)
async handleRequest() {
  await this.ctx.blockConcurrencyWhile(async () => {
    // ~5ms = max 200 req/sec
  });
}
```

**Never** hold across external I/O (fetch, R2, KV).

### Bypassing Gates (Advanced)

For advanced use cases, gates can be bypassed:

```typescript
// Allow concurrency during this get
const value = await this.ctx.storage.get("key", { 
  allowConcurrency: true 
});

// Don't wait for write confirmation before sending response
await this.ctx.storage.put("key", value, { 
  allowUnconfirmed: true 
});

// Don't cache this key
const temp = await this.ctx.storage.get("temp", { 
  noCache: true 
});
```

**When to bypass:**
- `allowConcurrency: true` - When concurrent access is safe (read-only, idempotent)
- `allowUnconfirmed: true` - When minimizing latency is more important than guaranteed durability
- `noCache: true` - When key is accessed once and caching wastes memory

**Warning**: Only use these options if you fully understand the implications. Default gates provide correctness for 99% of use cases.

## RPC Methods

Use RPC (compatibility date >= 2024-04-03) instead of fetch() handler:

```typescript
export class ChatRoom extends DurableObject<Env> {
  async sendMessage(userId: string, content: string): Promise<Message> {
    // Public methods are RPC endpoints
    const result = this.ctx.storage.sql.exec<{ id: number }>(
      "INSERT INTO messages (user_id, content) VALUES (?, ?) RETURNING id",
      userId, content
    );
    return { id: result.one().id, userId, content };
  }
}

// Caller
const stub = env.CHAT_ROOM.getByName(roomId);
const msg = await stub.sendMessage("user-123", "Hello!"); // Typed!
```

### Explicit init() Method

DOs don't know their own ID. Pass identity explicitly:

```typescript
async init(entityId: string, metadata: Metadata): Promise<void> {
  await this.ctx.storage.put("entityId", entityId);
  await this.ctx.storage.put("metadata", metadata);
}
```

## Alarms

One alarm per DO. `setAlarm()` replaces existing.

```typescript
// Schedule
await this.ctx.storage.setAlarm(Date.now() + 60_000);

// Handler
async alarm(): Promise<void> {
  const tasks = this.ctx.storage.sql.exec<Task>(
    "SELECT * FROM tasks WHERE due_at <= ?", Date.now()
  ).toArray();
  
  for (const task of tasks) {
    await this.processTask(task);
  }
  
  // Reschedule if more work
  const next = this.ctx.storage.sql.exec<{ due_at: number }>(
    "SELECT MIN(due_at) as due_at FROM tasks WHERE due_at > ?", Date.now()
  ).one();
  if (next?.due_at) {
    await this.ctx.storage.setAlarm(next.due_at);
  }
}

// Get/Delete
const alarm = await this.ctx.storage.getAlarm();
await this.ctx.storage.deleteAlarm();
```

**Retry**: Alarms auto-retry on failure. Use idempotent handlers.

## WebSockets (Hibernation API)

### Core Pattern

The Hibernatable WebSocket API allows Durable Objects to be evicted from memory during periods of inactivity while keeping WebSocket connections open. When a message arrives, the runtime recreates the DO and delivers the message.

```typescript
async fetch(request: Request): Promise<Response> {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);
  
  // ✅ CORRECT: Use this.ctx.acceptWebSocket(server)
  // This enables hibernation - DO can be evicted while connection stays open
  this.ctx.acceptWebSocket(server);
  
  return new Response(null, { status: 101, webSocket: client });
}

// ❌ NEVER use server.accept() - this prevents hibernation
// ❌ NEVER use server.addEventListener() - use handler methods instead
```

### Handler Methods

Implement these methods to handle WebSocket events:

```typescript
async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
  // Parse and handle message
  const data = JSON.parse(message as string);
  
  // Send response
  ws.send(JSON.stringify({ type: "ack", data }));
  
  // Access all connections for broadcasting
  const connections = this.ctx.getWebSockets().length;
  console.log(`Active connections: ${connections}`);
}

async webSocketClose(
  ws: WebSocket, 
  code: number, 
  reason: string, 
  wasClean: boolean
): Promise<void> {
  // Clean up resources associated with this connection
  // Update storage if needed
  ws.close(code, "Durable Object is closing WebSocket");
}

async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
  // Log error and close connection
  console.error("WebSocket error:", error);
  ws.close(1011, "WebSocket error");
}
```

### Broadcasting to All Connections

```typescript
// Get all active WebSocket connections
const sockets = this.ctx.getWebSockets();

// Broadcast message to all
sockets.forEach(ws => ws.send(JSON.stringify(payload)));

// Or with error handling
sockets.forEach(ws => {
  try {
    ws.send(JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to send to WebSocket:", error);
  }
});
```

### Combining WebSockets with Storage

```typescript
async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
  const data = JSON.parse(message as string);
  
  // Persist message to SQLite
  this.ctx.storage.sql.exec(
    "INSERT INTO messages (content, timestamp) VALUES (?, ?)",
    data.content, Date.now()
  );
  
  // Broadcast to all connected clients
  const sockets = this.ctx.getWebSockets();
  const broadcast = JSON.stringify({ type: "new_message", content: data.content });
  sockets.forEach(ws => ws.send(broadcast));
}
```

### Key Points

- **Always use `this.ctx.acceptWebSocket(server)`** - NOT `server.accept()`
- **Do NOT use `addEventListener`** - Use the handler methods (`webSocketMessage`, etc.)
- **Hibernation is automatic** - Don't reference "hibernation" in code or bindings
- **Connection management** - Use `this.ctx.getWebSockets()` to access all connections
- **State persistence** - Use SQLite storage for durable state, not just in-memory

## Error Handling

```typescript
async safeOperation(): Promise<Result> {
  try {
    return await this.riskyOperation();
  } catch (error) {
    console.error("Operation failed:", error);
    // Log to external service if needed
    throw error; // Re-throw to signal failure to caller
  }
}
```

**Note**: Uncaught exceptions may terminate the DO instance. In-memory state is lost, but SQLite storage persists.
