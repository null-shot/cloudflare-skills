# SQL Statements and SQLite Features

Complete reference for SQLite statements, PRAGMA commands, extensions, and database-level operations in D1.

## Supported SQLite Extensions

D1 supports a subset of SQLite extensions for enhanced functionality:

| Extension | Purpose | Key Functions |
|-----------|---------|---------------|
| **FTS5** | Full-text search | `CREATE VIRTUAL TABLE ... USING fts5()` |
| **JSON** | JSON functions | `json_extract()`, `json_each()`, etc. |
| **Math** | Math functions | `sqrt()`, `log()`, `sin()`, `cos()`, etc. |

### FTS5 (Full-Text Search)

Create full-text search indexes for fast text searching:

```typescript
// Create FTS5 virtual table
await env.DB.exec(`
  CREATE VIRTUAL TABLE documents_fts USING fts5(
    title,
    content,
    author,
    tokenize = 'porter ascii'
  );
`);

// Insert documents
await env.DB
  .prepare("INSERT INTO documents_fts (title, content, author) VALUES (?, ?, ?)")
  .bind("Getting Started", "This is a guide to...", "Alice")
  .run();

// Full-text search
const { results } = await env.DB
  .prepare("SELECT * FROM documents_fts WHERE documents_fts MATCH ?")
  .bind("guide")
  .all();
```

**FTS5 Features:**
- Porter stemming (`tokenize = 'porter'`)
- ASCII folding (`ascii`)
- Phrase queries (`"exact phrase"`)
- Boolean operators (`AND`, `OR`, `NOT`)
- Proximity search (`NEAR`)
- Column filters (`title:keyword`)

**Example queries:**

```typescript
// Phrase search
.bind('"getting started"')

// Boolean operators
.bind('guide AND tutorial')
.bind('guide OR tutorial')
.bind('guide NOT advanced')

// Column-specific
.bind('title:guide')

// Proximity search
.bind('getting NEAR/3 started')  // Within 3 tokens
```

**FTS5 with existing table:**

```typescript
// Main table
await env.DB.exec(`
  CREATE TABLE articles (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// FTS5 index
await env.DB.exec(`
  CREATE VIRTUAL TABLE articles_fts USING fts5(
    title,
    content,
    content=articles,
    content_rowid=id
  );
`);

// Triggers to keep FTS index in sync
await env.DB.exec(`
  CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
    INSERT INTO articles_fts(rowid, title, content)
    VALUES (new.id, new.title, new.content);
  END;

  CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
    DELETE FROM articles_fts WHERE rowid = old.id;
  END;

  CREATE TRIGGER articles_au AFTER UPDATE ON articles BEGIN
    UPDATE articles_fts 
    SET title = new.title, content = new.content
    WHERE rowid = old.id;
  END;
`);
```

**Ranking results:**

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      a.*,
      fts.rank
    FROM articles a
    JOIN articles_fts fts ON a.id = fts.rowid
    WHERE articles_fts MATCH ?
    ORDER BY fts.rank
  `)
  .bind('cloudflare workers')
  .all();
```

### JSON Extension

Comprehensive JSON support for querying and manipulating JSON data. See [json-functions.md](json-functions.md) for complete documentation.

### Math Functions

Standard mathematical functions:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      sqrt(16) as square_root,      -- 4
      pow(2, 3) as power,            -- 8
      abs(-42) as absolute,          -- 42
      round(3.7) as rounded,         -- 4
      ceil(3.2) as ceiling,          -- 4
      floor(3.8) as floor_val,       -- 3
      log(100) as logarithm,         -- Natural log
      log10(100) as log_base_10,     -- 2
      exp(1) as exponential,         -- e^1
      sin(0) as sine,                -- 0
      cos(0) as cosine,              -- 1
      tan(0) as tangent,             -- 0
      pi() as pi_value               -- 3.14159...
  `)
  .all();
```

**Available functions:**
- `abs(x)`, `sign(x)`
- `sqrt(x)`, `pow(x, y)`
- `exp(x)`, `log(x)`, `log10(x)`
- `ceil(x)`, `floor(x)`, `round(x)`, `trunc(x)`
- `sin(x)`, `cos(x)`, `tan(x)`
- `asin(x)`, `acos(x)`, `atan(x)`, `atan2(y, x)`
- `degrees(x)`, `radians(x)`
- `pi()`

**Example usage:**

```typescript
// Calculate distance between coordinates
const { results } = await env.DB
  .prepare(`
    SELECT 
      id,
      name,
      -- Haversine formula for distance
      6371 * 2 * asin(sqrt(
        pow(sin(radians(? - lat) / 2), 2) +
        cos(radians(?)) * cos(radians(lat)) *
        pow(sin(radians(? - lon) / 2), 2)
      )) as distance_km
    FROM locations
    ORDER BY distance_km
    LIMIT 10
  `)
  .bind(userLat, userLat, userLon)
  .all();
```

## PRAGMA Statements

PRAGMA statements control SQLite behavior and query metadata.

### Important Note

**PRAGMA statements only apply to the current transaction** in D1. They don't persist across requests.

### Schema Information

#### `PRAGMA table_list`

List all tables and views:

```typescript
const { results } = await env.DB
  .prepare("PRAGMA table_list")
  .all();

// Returns: schema, name, type, ncol, wr, strict
// type: 'table', 'view', 'shadow', 'virtual'
```

#### `PRAGMA table_info(table_name)`

Show table schema:

```typescript
const { results } = await env.DB
  .prepare("PRAGMA table_info('users')")
  .all();

// Returns: cid, name, type, notnull, dflt_value, pk
```

Example output:
```
{
  cid: 0,
  name: "id",
  type: "INTEGER",
  notnull: 0,
  dflt_value: null,
  pk: 1
}
```

#### `PRAGMA table_xinfo(table_name)`

Like `table_info` but includes generated columns:

```typescript
const { results } = await env.DB
  .prepare("PRAGMA table_xinfo('users')")
  .all();

// Returns: cid, name, type, notnull, dflt_value, pk, hidden
// hidden: 1 for generated columns, 0 for regular
```

#### `PRAGMA index_list(table_name)`

List indexes for a table:

```typescript
const { results } = await env.DB
  .prepare("PRAGMA index_list('users')")
  .all();

// Returns: seq, name, unique, origin, partial
// origin: 'c' (CREATE INDEX), 'u' (UNIQUE), 'pk' (PRIMARY KEY)
```

#### `PRAGMA index_info(index_name)`

Show columns in an index:

```typescript
const { results } = await env.DB
  .prepare("PRAGMA index_info('idx_users_email')")
  .all();

// Returns: seqno, cid, name
```

#### `PRAGMA index_xinfo(index_name)`

Like `index_info` but includes hidden columns:

```typescript
const { results } = await env.DB
  .prepare("PRAGMA index_xinfo('idx_users_email')")
  .all();

// Returns: seqno, cid, name, desc, coll, key
```

### Foreign Keys

#### `PRAGMA foreign_keys = (ON|OFF)`

Enable/disable foreign key enforcement:

```typescript
// D1 enforces foreign keys by default (always ON)
// This pragma has no persistent effect in D1

// Check status
const { results } = await env.DB
  .prepare("PRAGMA foreign_keys")
  .all();
// Returns: { foreign_keys: 1 }  (always 1 in D1)
```

#### `PRAGMA defer_foreign_keys = (ON|OFF)`

Defer foreign key checks until end of transaction:

```typescript
// Start transaction with deferred constraints
await env.DB.batch([
  env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
  
  // Make changes that temporarily violate constraints
  env.DB.prepare("ALTER TABLE users ADD COLUMN manager_id INTEGER"),
  env.DB.prepare("UPDATE users SET manager_id = 1 WHERE id = 2"),
  
  // Constraints checked here (end of transaction)
  env.DB.prepare("PRAGMA defer_foreign_keys = OFF")
]);
```

See [foreign-keys.md](foreign-keys.md) for complete documentation.

#### `PRAGMA foreign_key_check`

Check for foreign key violations:

```typescript
const { results } = await env.DB
  .prepare("PRAGMA foreign_key_check")
  .all();

if (results.length > 0) {
  console.error("Foreign key violations found:", results);
}

// Check specific table
const { results: violations } = await env.DB
  .prepare("PRAGMA foreign_key_check('posts')")
  .all();
```

#### `PRAGMA foreign_key_list(table_name)`

List foreign keys for a table:

```typescript
const { results } = await env.DB
  .prepare("PRAGMA foreign_key_list('posts')")
  .all();

// Returns: id, seq, table, from, to, on_update, on_delete, match
```

### Data Integrity

#### `PRAGMA quick_check`

Check database integrity:

```typescript
const { results } = await env.DB
  .prepare("PRAGMA quick_check")
  .all();

// Returns: { quick_check: 'ok' } if no issues
// Returns error descriptions if issues found
```

#### `PRAGMA integrity_check`

More thorough integrity check:

```typescript
const { results } = await env.DB
  .prepare("PRAGMA integrity_check")
  .all();

// Returns: { integrity_check: 'ok' } if no issues
```

### Query Behavior

#### `PRAGMA case_sensitive_like = (ON|OFF)`

Toggle case sensitivity for LIKE operator:

```typescript
await env.DB
  .prepare("PRAGMA case_sensitive_like = ON")
  .run();

// Now 'a' LIKE 'A' returns false
const { results } = await env.DB
  .prepare("SELECT * FROM users WHERE name LIKE ?")
  .bind('Alice')
  .all();
// Won't match 'alice' or 'ALICE'
```

**Default:** OFF (case-insensitive)

#### `PRAGMA reverse_unordered_selects = (ON|OFF)`

Reverse order of SELECT results without ORDER BY:

```typescript
await env.DB
  .prepare("PRAGMA reverse_unordered_selects = ON")
  .run();

const { results } = await env.DB
  .prepare("SELECT * FROM users")  // No ORDER BY
  .all();
// Results in reverse order
```

**Use case:** Testing if code assumes specific order

#### `PRAGMA recursive_triggers = (ON|OFF)`

Allow triggers to activate other triggers:

```typescript
await env.DB
  .prepare("PRAGMA recursive_triggers = ON")
  .run();

// Now triggers can fire other triggers
```

**Default:** OFF

### Schema Modification

#### `PRAGMA legacy_alter_table = (ON|OFF)`

Control ALTER TABLE behavior:

```typescript
await env.DB
  .prepare("PRAGMA legacy_alter_table = ON")
  .run();

// ALTER TABLE RENAME only rewrites first occurrence
// OFF (default): rewrites all references
```

### Optimization

#### `PRAGMA optimize`

Optimize database statistics:

```typescript
// Run after schema changes or periodically
await env.DB
  .prepare("PRAGMA optimize")
  .run();

// Runs ANALYZE on tables that need it
// Improves query planning performance
```

**When to use:**
- After creating indexes
- After large data imports
- Periodically in production (e.g., daily)

**Best practice:**

```typescript
// After migration
async function afterMigration(env: Env) {
  await env.DB.prepare("PRAGMA optimize").run();
}

// Scheduled task
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    // Daily optimization
    await env.DB.prepare("PRAGMA optimize").run();
  }
};
```

### Constraint Checking

#### `PRAGMA ignore_check_constraints = (ON|OFF)`

Temporarily disable CHECK constraint enforcement:

```typescript
await env.DB
  .prepare("PRAGMA ignore_check_constraints = ON")
  .run();

// CHECK constraints ignored for this transaction

await env.DB
  .prepare("PRAGMA ignore_check_constraints = OFF")
  .run();
```

**Use case:** Bulk imports with validation done elsewhere

## Query sqlite_master

The `sqlite_master` table contains database schema information:

```typescript
// List all tables and indexes
const { results } = await env.DB
  .prepare(`
    SELECT 
      type,
      name,
      tbl_name,
      sql
    FROM sqlite_master
    WHERE type IN ('table', 'index')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `)
  .all();
```

**Columns:**
- `type` - Object type: 'table', 'index', 'view', 'trigger'
- `name` - Object name
- `tbl_name` - Associated table name
- `sql` - CREATE statement used to create the object
- `rootpage` - Root page in database file

### Find Tables

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT name 
    FROM sqlite_master 
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_cf_%'
  `)
  .all();
```

### Find Indexes

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      name,
      tbl_name,
      sql
    FROM sqlite_master 
    WHERE type = 'index'
      AND name NOT LIKE 'sqlite_%'
  `)
  .all();
```

### Find Views

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      name,
      sql
    FROM sqlite_master 
    WHERE type = 'view'
  `)
  .all();
```

### Check if Table Exists

```typescript
const exists = await env.DB
  .prepare(`
    SELECT name 
    FROM sqlite_master 
    WHERE type = 'table' 
      AND name = ?
  `)
  .bind('users')
  .first();

if (!exists) {
  // Table doesn't exist
  await env.DB.exec(`CREATE TABLE users (...)`);
}
```

### Get Table Schema

```typescript
const schema = await env.DB
  .prepare(`
    SELECT sql 
    FROM sqlite_master 
    WHERE type = 'table' 
      AND name = ?
  `)
  .bind('users')
  .first<{ sql: string }>();

console.log(schema.sql);
// CREATE TABLE users (id INTEGER PRIMARY KEY, ...)
```

## Search with LIKE

Pattern matching with wildcards:

```typescript
// % matches any sequence of characters
const { results } = await env.DB
  .prepare("SELECT * FROM customers WHERE company_name LIKE ?")
  .bind("%eve%")  // Matches 'Steve', 'Developer', etc.
  .all();

// _ matches single character
const { results: results2 } = await env.DB
  .prepare("SELECT * FROM products WHERE code LIKE ?")
  .bind("A_C")  // Matches 'ABC', 'A1C', etc.
  .all();
```

**Wildcards:**
- `%` - Zero or more characters
- `_` - Exactly one character

**Case sensitivity:**
- Default: Case-insensitive for ASCII
- Use `PRAGMA case_sensitive_like` to change

**Performance:**
- Leading wildcard (`%abc`) can't use indexes
- Trailing wildcard (`abc%`) can use indexes
- Consider FTS5 for complex text search

**Examples:**

```typescript
// Starts with
.bind('John%')       // 'John', 'Johnny', 'Johnson'

// Ends with
.bind('%son')        // 'Johnson', 'Wilson', 'Mason'

// Contains
.bind('%john%')      // 'John', 'Johnny', 'Johnson'

// Exact length
.bind('___')         // Any 3-character string

// Pattern
.bind('A_C%')        // 'ABC', 'A1C123', 'ABCD'
```

**Case-insensitive search:**

```typescript
const { results } = await env.DB
  .prepare("SELECT * FROM users WHERE LOWER(name) LIKE LOWER(?)")
  .bind('%alice%')
  .all();
// Matches 'Alice', 'ALICE', 'alice'
```

## EXPLAIN QUERY PLAN

Analyze how SQLite executes queries:

```typescript
const { results } = await env.DB
  .prepare(`
    EXPLAIN QUERY PLAN
    SELECT * FROM users WHERE email = ?
  `)
  .bind('alice@example.com')
  .all();

console.log(results);
// Shows: SCAN vs SEARCH, index usage, join strategy
```

**Output interpretation:**
- `SCAN` - Full table scan (slow, consider adding index)
- `SEARCH` - Using index (fast)
- `USING INDEX` - Which index is used
- `USING COVERING INDEX` - All columns in index (fastest)

**Example outputs:**

```
// Good - using index
SEARCH users USING INDEX idx_users_email (email=?)

// Bad - full table scan
SCAN users

// Excellent - covering index
SEARCH users USING COVERING INDEX idx_users_email_name (email=?)
```

**Use to:**
1. Verify indexes are used
2. Identify slow queries
3. Optimize JOIN strategies
4. Check covering indexes

**Example optimization:**

```typescript
// Before: slow query
EXPLAIN QUERY PLAN SELECT * FROM posts WHERE user_id = ?
// Output: SCAN posts

// Add index
await env.DB.exec("CREATE INDEX idx_posts_user_id ON posts(user_id)");

// After: fast query
EXPLAIN QUERY PLAN SELECT * FROM posts WHERE user_id = ?
// Output: SEARCH posts USING INDEX idx_posts_user_id (user_id=?)
```

## Limitations and Unsupported Features

### Not Supported in D1

1. **Custom SQLite Extensions** - Only built-in extensions (FTS5, JSON, Math)
2. **ATTACH DATABASE** - Each D1 database is isolated
3. **BEGIN/COMMIT/ROLLBACK** - Transactions managed automatically
4. **Explicit transactions** - Use `.batch()` for atomicity
5. **Virtual tables** - Except FTS5
6. **User-defined functions** - Use application code instead
7. **PRAGMA statements persist** - Only apply to current transaction

### Numeric Precision

JavaScript's 52-bit integer precision affects large numbers:

```typescript
// ⚠️ Very large integers may lose precision
const result = await env.DB
  .prepare("SELECT ? as value")
  .bind(9007199254740993)  // Larger than Number.MAX_SAFE_INTEGER
  .first();

// May not be exact
console.log(result.value);  // Precision lost

// ✅ Store as TEXT for exact large integers
await env.DB
  .prepare("INSERT INTO big_numbers (value) VALUES (?)")
  .bind("9007199254740993")  // Store as string
  .run();

// Parse with BigInt when needed
const { value } = await env.DB
  .prepare("SELECT value FROM big_numbers WHERE id = ?")
  .bind(1)
  .first<{ value: string }>();

const bigIntValue = BigInt(value);
```

## Best Practices

### Schema Introspection

```typescript
// Helper: Get all tables
async function getTables(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(`
      SELECT name FROM sqlite_master 
      WHERE type = 'table' 
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%'
      ORDER BY name
    `)
    .all<{ name: string }>();
  
  return results.map(r => r.name);
}

// Helper: Get table columns
async function getColumns(db: D1Database, table: string) {
  return await db
    .prepare(`PRAGMA table_info(?)`)
    .bind(table)
    .all();
}
```

### Regular Optimization

```typescript
// Scheduled optimization
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    if (event.cron === '0 2 * * *') {  // 2 AM daily
      await env.DB.prepare("PRAGMA optimize").run();
      console.log('Database optimized');
    }
  }
};
```

### Query Plan Checking

```typescript
// Development helper
async function analyzeQuery(db: D1Database, query: string, ...bindings: any[]) {
  const plan = await db
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .bind(...bindings)
    .all();
  
  console.log('Query Plan:', plan.results);
  
  // Execute actual query
  return await db
    .prepare(query)
    .bind(...bindings)
    .all();
}
```

### Schema Validation

```typescript
// Verify expected schema
async function validateSchema(db: D1Database) {
  const tables = await getTables(db);
  const expected = ['users', 'posts', 'comments'];
  
  const missing = expected.filter(t => !tables.includes(t));
  
  if (missing.length > 0) {
    throw new Error(`Missing tables: ${missing.join(', ')}`);
  }
}
```

## Performance Tips

1. **Use PRAGMA optimize** after schema changes
2. **Create indexes** on foreign keys and frequently queried columns
3. **Use EXPLAIN QUERY PLAN** to verify index usage
4. **Avoid leading wildcards** in LIKE queries (`%abc`)
5. **Use FTS5** for complex text search instead of LIKE
6. **Check foreign key constraints** after bulk imports
7. **Monitor query plans** in development
8. **Store very large integers** as TEXT to avoid precision loss
