# SQLite Storage API Reference

Complete reference for SQLite-backed Durable Objects storage API.

## Overview

SQLite-backed Durable Objects provide transactional, strongly consistent storage with:
- **SQL API** - Full SQLite database with tables, indexes, and queries
- **PITR API** - Point-in-time recovery for the last 30 days
- **Synchronous KV API** - Fast key-value operations via `ctx.storage.kv`
- **Asynchronous KV API** - Legacy async KV methods (still supported)
- **Alarms API** - Scheduled execution per Durable Object

> **Note**: Legacy KV-backed Durable Objects still exist for backwards compatibility but are **not recommended** for new projects. All new Durable Objects should use SQLite storage configured with `new_sqlite_classes` in migrations.

## Configuration

### Enable SQLite Storage

```jsonc
// wrangler.jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "MY_DO", "class_name": "MyDurableObject" }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["MyDurableObject"]  // ← Required for SQLite
    }
  ]
}
```

**Critical**: Use `new_sqlite_classes` (NOT `new_classes`) to enable SQLite storage.

## SQL API

Access via `ctx.storage.sql` or `this.ctx.storage.sql`.

### exec()

Execute SQL queries with parameter binding.

```typescript
exec(query: string, ...bindings: any[]): SqlStorageCursor
```

#### Parameters

- **query** - SQL statement(s). Use `?` for parameter placeholders. Multiple statements separated by `;` are allowed.
- **bindings** - Values to bind to `?` placeholders (applied to last statement if multiple)

#### Returns

`SqlStorageCursor` - Iterator over query results

#### Examples

**Create table and insert:**

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  ctx.blockConcurrencyWhile(async () => {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);
  });
}
```

**Parameterized insert:**

```typescript
async createUser(username: string, email: string): Promise<number> {
  const result = this.ctx.storage.sql.exec<{ id: number }>(
    "INSERT INTO users (username, email, created_at) VALUES (?, ?, ?) RETURNING id",
    username,
    email,
    Date.now()
  );
  return result.one().id;
}
```

**Parameterized query:**

```typescript
async getUserByEmail(email: string) {
  const result = this.ctx.storage.sql.exec<User>(
    "SELECT * FROM users WHERE email = ?",
    email
  );
  return result.one(); // Throws if not exactly one row
}
```

**Multiple statements:**

```typescript
// Only last statement's cursor is returned
// Bindings apply to last statement
this.ctx.storage.sql.exec(`
  DELETE FROM temp_data;
  INSERT INTO logs (message) VALUES ('Cleanup complete');
  SELECT COUNT(*) as count FROM logs;
`);
```

### SqlStorageCursor

Iterator over query results returned by `exec()`.

#### Methods

**next()**

```typescript
next(): { done: boolean; value?: any }
```

Returns next row as object with column names as keys.

```typescript
const cursor = this.ctx.storage.sql.exec("SELECT * FROM users ORDER BY id");
const first = cursor.next();
if (!first.done) {
  console.log(first.value); // { id: 1, username: "alice", ... }
}
```

**toArray()**

```typescript
toArray(): any[]
```

Consumes remaining cursor and returns array of row objects.

```typescript
const users = this.ctx.storage.sql.exec<User>(
  "SELECT * FROM users WHERE created_at > ?",
  timestamp
).toArray();
// Returns: [{ id: 1, username: "alice", ... }, { id: 2, username: "bob", ... }]
```

**one()**

```typescript
one(): any
```

Returns single row if query has exactly one result. **Throws exception** if zero or multiple rows.

```typescript
// ✅ Good: Known to return exactly one row
const count = this.ctx.storage.sql.exec<{ count: number }>(
  "SELECT COUNT(*) as count FROM users"
).one().count;

// ❌ Bad: May throw if user doesn't exist or multiple users found
const user = this.ctx.storage.sql.exec<User>(
  "SELECT * FROM users WHERE email = ?",
  email
).one(); // Throws if not exactly 1 row!

// ✅ Good: Handle zero rows
const cursor = this.ctx.storage.sql.exec<User>(
  "SELECT * FROM users WHERE email = ?",
  email
);
const result = cursor.next();
const user = result.done ? null : result.value;
```

**raw()**

```typescript
raw(): Iterator<any[]>
```

Returns iterator with rows as arrays (no column names).

```typescript
const cursor = this.ctx.storage.sql.exec("SELECT id, username FROM users");
const rawIter = cursor.raw();

const first = rawIter.next();
console.log(first.value); // [1, "alice"]

const remaining = rawIter.toArray();
console.log(remaining); // [[2, "bob"], [3, "charlie"]]

// Get column names
console.log(cursor.columnNames); // ["id", "username"]
```

**Mixing cursor and raw():**

```typescript
const cursor = this.ctx.storage.sql.exec("SELECT * FROM users ORDER BY id");
const first = cursor.raw().next().value; // [1, "alice", "alice@example.com", 1234567890]
const rest = cursor.toArray(); // [{ id: 2, ... }, { id: 3, ... }]
```

#### Properties

**columnNames: string[]**

Column names in order they appear in rows.

```typescript
const cursor = this.ctx.storage.sql.exec("SELECT id, username FROM users");
console.log(cursor.columnNames); // ["id", "username"]
```

**rowsRead: number**

Number of rows read so far. Increases as you iterate. Used for billing.

```typescript
const cursor = this.ctx.storage.sql.exec("SELECT * FROM users");
cursor.next();
console.log(cursor.rowsRead); // 1
cursor.toArray();
console.log(cursor.rowsRead); // 3 (if 3 total rows)
```

**rowsWritten: number**

Number of rows written by this query. Used for billing.

```typescript
this.ctx.storage.sql.exec(
  "INSERT INTO users (username) VALUES (?), (?), (?)",
  "alice", "bob", "charlie"
);
console.log(cursor.rowsWritten); // 3
```

> **Note**: Index updates count as additional row writes. Each row update that modifies an index counts as one additional row written.

### Supported SQLite Features

**Extensions:**

- **FTS5** - Full-text search including `fts5vocab`
- **JSON** - JSON functions and operators (`json()`, `json_extract()`, etc.)
- **Math functions** - Standard math operations

**NOT Supported:**

- Custom SQLite extensions
- Virtual tables (except FTS5)
- `ATTACH DATABASE` (each DO has one database)

### Transactions

> **Important**: Do NOT use `BEGIN TRANSACTION`, `COMMIT`, `ROLLBACK`, or `SAVEPOINT` in SQL queries.

Use the storage API transaction methods instead:

```typescript
// Synchronous transaction (recommended for SQL)
this.ctx.storage.transactionSync(() => {
  this.ctx.storage.sql.exec("UPDATE accounts SET balance = balance - ? WHERE id = ?", 100, 1);
  this.ctx.storage.sql.exec("UPDATE accounts SET balance = balance + ? WHERE id = ?", 100, 2);
});

// Async transaction (for mixing SQL with KV or external I/O)
await this.ctx.storage.transaction(async (txn) => {
  txn.sql.exec("INSERT INTO logs (message) VALUES (?)", "Starting process");
  await fetch("https://api.example.com/notify");
  txn.sql.exec("INSERT INTO logs (message) VALUES (?)", "Process complete");
});
```

### Write Coalescing

Multiple writes without `await` between them are automatically batched atomically:

```typescript
// ✅ All three writes commit atomically (all or nothing)
this.ctx.storage.sql.exec("UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, fromId);
this.ctx.storage.sql.exec("UPDATE accounts SET balance = balance + ? WHERE id = ?", amount, toId);
this.ctx.storage.sql.exec("INSERT INTO transfers (from_id, to_id, amount) VALUES (?, ?, ?)", fromId, toId, amount);

// ❌ BAD: await breaks atomicity
await this.ctx.storage.put("key1", val1);
await this.ctx.storage.put("key2", val2); // Separate transaction!
```

### databaseSize

Get current SQLite database size in bytes:

```typescript
const size = this.ctx.storage.sql.databaseSize;
console.log(`Database size: ${size} bytes`);
```

## PITR (Point-in-Time Recovery) API

Restore a Durable Object's SQLite database to any point in the last 30 days.

> **Note**: PITR is not supported in local development (`wrangler dev`).

### Bookmarks

PITR uses "bookmarks" - alphanumeric strings representing points in time:

```
0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b
```

Bookmarks are lexically comparable: earlier time < later time.

### getCurrentBookmark()

```typescript
await ctx.storage.getCurrentBookmark(): Promise<string>
```

Returns bookmark for current point in time.

```typescript
const bookmark = await this.ctx.storage.getCurrentBookmark();
console.log(`Current bookmark: ${bookmark}`);
```

### getBookmarkForTime()

```typescript
await ctx.storage.getBookmarkForTime(timestamp: number | Date): Promise<string>
```

Returns bookmark for approximately the given time (must be within last 30 days).

```typescript
// Restore to 2 days ago
const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
const bookmark = await this.ctx.storage.getBookmarkForTime(twoDaysAgo);
```

### onNextSessionRestoreBookmark()

```typescript
await ctx.storage.onNextSessionRestoreBookmark(bookmark: string): Promise<string>
```

Configures the DO to restore to the given bookmark on next restart. Call `ctx.abort()` after this to trigger restart.

Returns a bookmark representing the point immediately before recovery (for undo).

```typescript
async restoreToTime(daysAgo: number): Promise<string> {
  const timestamp = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
  const bookmark = await this.ctx.storage.getBookmarkForTime(timestamp);
  
  // Save undo bookmark
  const undoBookmark = await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
  
  // Trigger restart to perform recovery
  this.ctx.abort();
  
  return undoBookmark;
}
```

**Undo a recovery:**

```typescript
// Restore to the bookmark returned by the previous recovery
await this.ctx.storage.onNextSessionRestoreBookmark(undoBookmark);
this.ctx.abort();
```

## Synchronous KV API

Fast key-value operations without Promises (available in SQLite-backed DOs only).

Access via `ctx.storage.kv`.

> **Note**: Data is stored in hidden SQLite table `__cf_kv`. You'll see this table when listing tables but cannot access it via SQL.

### get()

```typescript
ctx.storage.kv.get(key: string): any | undefined
```

Retrieves value for key. Returns `undefined` if key doesn't exist.

```typescript
const count = this.ctx.storage.kv.get("counter") ?? 0;
```

### put()

```typescript
ctx.storage.kv.put(key: string, value: any): void
```

Stores value for key. Value must be supported by [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).

```typescript
this.ctx.storage.kv.put("counter", count + 1);
this.ctx.storage.kv.put("user", { id: 123, name: "Alice" });
```

### delete()

```typescript
ctx.storage.kv.delete(key: string): boolean
```

Deletes key. Returns `true` if key existed, `false` if not.

```typescript
const existed = this.ctx.storage.kv.delete("temp-key");
```

### list()

```typescript
ctx.storage.kv.list(options?: ListOptions): Iterable<[string, any]>
```

Returns all keys and values in ascending order.

```typescript
// Get all keys/values
for (const [key, value] of this.ctx.storage.kv.list()) {
  console.log(key, value);
}

// With options
const items = this.ctx.storage.kv.list({
  prefix: "user:",
  limit: 10
});
```

#### List Options

| Option | Type | Description |
|--------|------|-------------|
| `start` | string | Key to start from (inclusive) |
| `startAfter` | string | Key to start after (exclusive, cannot use with `start`) |
| `end` | string | Key to end at (exclusive) |
| `prefix` | string | Only return keys with this prefix |
| `reverse` | boolean | Return in descending order |
| `limit` | number | Maximum number of entries to return |

## Asynchronous KV API

Legacy async KV API (still supported for compatibility).

### get()

```typescript
await ctx.storage.get(key: string): Promise<any>
await ctx.storage.get(keys: string[]): Promise<Map<string, any>>
```

Retrieve single key or multiple keys (max 128).

```typescript
// Single key
const value = await this.ctx.storage.get("key");

// Multiple keys
const values = await this.ctx.storage.get(["key1", "key2", "key3"]);
console.log(values.get("key1"));
```

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `allowConcurrency` | boolean | Allow concurrent events during I/O (default: false) |
| `noCache` | boolean | Don't cache in memory (hint only) |

### put()

```typescript
await ctx.storage.put(key: string, value: any, options?: PutOptions): Promise<void>
await ctx.storage.put(entries: Record<string, any>, options?: PutOptions): Promise<void>
```

Store single or multiple key-value pairs (max 128 pairs).

```typescript
// Single key
await this.ctx.storage.put("key", value);

// Multiple keys
await this.ctx.storage.put({
  "key1": "value1",
  "key2": "value2",
  "key3": "value3"
});
```

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `allowUnconfirmed` | boolean | Don't wait for disk flush before sending network messages |
| `noCache` | boolean | Discard from memory after write |

**Automatic write coalescing**: Multiple `put()` calls without `await` between them are batched atomically.

### delete()

```typescript
await ctx.storage.delete(key: string): Promise<boolean>
await ctx.storage.delete(keys: string[]): Promise<number>
```

Delete single key or multiple keys (max 128).

```typescript
// Single key
const existed = await this.ctx.storage.delete("key");

// Multiple keys
const deleteCount = await this.ctx.storage.delete(["key1", "key2", "key3"]);
```

### list()

```typescript
await ctx.storage.list(options?: ListOptions): Promise<Map<string, any>>
```

Returns Map of keys and values. Same options as synchronous `list()`.

### deleteAll()

```typescript
await ctx.storage.deleteAll(): Promise<void>
```

Deletes **entire SQLite database** including all SQL tables and KV data. Does not delete alarms (use `deleteAlarm()` separately).

> **Warning**: This is destructive and irreversible (unless you use PITR to restore).

```typescript
async reset(): Promise<void> {
  await this.ctx.storage.deleteAll();
  // Re-initialize schema
  this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ...`);
}
```

## Alarms API

Schedule work to run at a future time. One alarm per Durable Object.

### setAlarm()

```typescript
await ctx.storage.setAlarm(scheduledTime: Date | number, options?: AlarmOptions): Promise<void>
```

Schedule alarm. Replaces any existing alarm.

```typescript
// Schedule for 1 minute from now
await this.ctx.storage.setAlarm(Date.now() + 60_000);

// Using Date object
await this.ctx.storage.setAlarm(new Date("2026-01-20T10:00:00Z"));

// Immediate execution (if time is in past)
await this.ctx.storage.setAlarm(Date.now());
```

Alarms execute within a few milliseconds of scheduled time but can be delayed up to a minute during maintenance/failover.

### getAlarm()

```typescript
await ctx.storage.getAlarm(): Promise<number | null>
```

Get scheduled alarm time in milliseconds since epoch. Returns `null` if no alarm set.

```typescript
const alarmTime = await this.ctx.storage.getAlarm();
if (alarmTime) {
  console.log(`Alarm scheduled for ${new Date(alarmTime)}`);
}
```

### deleteAlarm()

```typescript
await ctx.storage.deleteAlarm(): Promise<void>
```

Cancel scheduled alarm. Does not cancel alarm handler if currently executing.

```typescript
await this.ctx.storage.deleteAlarm();
```

### alarm() Handler

Implement `alarm()` method to handle alarm execution:

```typescript
async alarm(): Promise<void> {
  // Process scheduled work
  const tasks = this.ctx.storage.sql.exec<Task>(
    "SELECT * FROM tasks WHERE due_at <= ?",
    Date.now()
  ).toArray();
  
  for (const task of tasks) {
    await this.processTask(task);
  }
  
  // Reschedule if needed
  const nextTask = this.ctx.storage.sql.exec<{ due_at: number }>(
    "SELECT MIN(due_at) as due_at FROM tasks WHERE due_at > ?",
    Date.now()
  ).one();
  
  if (nextTask?.due_at) {
    await this.ctx.storage.setAlarm(nextTask.due_at);
  }
}
```

**Retries**: Alarms automatically retry on failure. Use idempotent handlers.

## Transaction API

### transactionSync()

```typescript
ctx.storage.transactionSync(callback: () => any): any
```

Synchronous transaction for SQL operations. **Only available in SQLite-backed DOs.**

```typescript
this.ctx.storage.transactionSync(() => {
  // All operations commit atomically or rollback on exception
  this.ctx.storage.sql.exec("UPDATE accounts SET balance = balance - ? WHERE id = ?", 100, 1);
  this.ctx.storage.sql.exec("UPDATE accounts SET balance = balance + ? WHERE id = ?", 100, 2);
  
  // Throw to rollback
  if (someCondition) {
    throw new Error("Transaction rolled back");
  }
});
```

### transaction()

```typescript
await ctx.storage.transaction(async (txn) => { ... }): Promise<any>
```

Async transaction. Less commonly needed due to automatic write coalescing.

```typescript
await this.ctx.storage.transaction(async (txn) => {
  await txn.put("key1", value1);
  await txn.put("key2", value2);
  // Call txn.rollback() to abort
});
```

### sync()

```typescript
await ctx.storage.sync(): Promise<void>
```

Wait for pending writes to flush to disk.

```typescript
this.ctx.storage.sql.exec("INSERT INTO logs (message) VALUES (?)", "test");
await this.ctx.storage.sync(); // Wait for write to complete
```

## Limits

| Resource | Limit |
|----------|-------|
| Database size | No hard limit (billing applies after Jan 7, 2026) |
| Key size (KV) | 2048 bytes |
| Value size (KV) | 128 KB |
| Keys per `list()` | All (be mindful of memory limit) |
| Keys per batch `get()`/`delete()` | 128 |
| Key-value pairs per batch `put()` | 128 |
| SQL query complexity | No arbitrary limit (reasonable queries) |

**Memory limit**: 128 MB per Durable Object instance.

## Concurrency & Consistency

### Input Gates

Storage operations automatically block other requests from starting. This prevents race conditions.

```typescript
async increment(): Promise<number> {
  // ✅ Safe: No race condition even without explicit locking
  const val = this.ctx.storage.kv.get("count") ?? 0;
  this.ctx.storage.kv.put("count", val + 1);
  return val + 1;
}
```

### Output Gates

Responses wait for writes to complete before being sent.

### Allowing Concurrency

Use `allowConcurrency: true` to opt out (advanced use cases only):

```typescript
const value = await this.ctx.storage.get("key", { allowConcurrency: true });
```

## Storage Billing

SQLite storage billing begins **January 7, 2026** (or later). Only storage used on/after this date will be billed.

Billing factors:
- Database size (bytes stored)
- Rows read
- Rows written (including index updates)

Monitor with:

```typescript
const size = this.ctx.storage.sql.databaseSize;
const cursor = this.ctx.storage.sql.exec("SELECT ...");
console.log(`Rows read: ${cursor.rowsRead}, written: ${cursor.rowsWritten}`);
```

## Best Practices

1. **Always use SQLite for new projects** - Configure `new_sqlite_classes` in migrations
2. **Use SQL for structured data** - Tables, indexes, relations
3. **Use synchronous KV for simple key-value** - Faster than async KV
4. **Index carefully** - Each row update to indexed column counts as extra write
5. **Avoid `one()` unless certain** - Use `next()` to handle zero rows gracefully
6. **Use write coalescing** - Don't `await` between related writes
7. **Use `transactionSync()` for SQL transactions** - Don't use `BEGIN TRANSACTION` in SQL
8. **Monitor database size** - Use `sql.databaseSize` property
9. **Use PITR for backups** - Can restore to any point in last 30 days
10. **Handle alarms idempotently** - They retry on failure

## Migration from KV-backed DOs

If you have existing KV-backed Durable Objects, a migration path will be available in the future. For now:

- New Durable Object classes should use SQLite (`new_sqlite_classes`)
- Existing KV-backed DOs continue to work unchanged
- Reference KV-backed storage docs only if maintaining legacy DOs
