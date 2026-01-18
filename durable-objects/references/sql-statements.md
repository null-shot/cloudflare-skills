# SQL Statements and SQLite Features

Complete reference for SQLite statements, PRAGMA commands, extensions, and database-level operations in Durable Objects.

## Supported SQLite Extensions

Durable Objects support a subset of SQLite extensions for enhanced functionality:

| Extension | Purpose | Key Functions |
|-----------|---------|---------------|
| **FTS5** | Full-text search | `CREATE VIRTUAL TABLE ... USING fts5()` |
| **JSON** | JSON functions | `json_extract()`, `json_each()`, etc. |
| **Math** | Math functions | `sqrt()`, `log()`, `sin()`, `cos()`, etc. |

### FTS5 (Full-Text Search)

Create full-text search indexes for fast text searching:

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    // Create FTS5 virtual table
    this.ctx.storage.sql.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        title,
        content,
        author,
        tokenize = 'porter ascii'
      );
    `);
  });
}

// Insert documents
addDocument(title: string, content: string, author: string): void {
  this.ctx.storage.sql.exec(
    "INSERT INTO documents_fts (title, content, author) VALUES (?, ?, ?)",
    title,
    content,
    author
  );
}

// Full-text search
searchDocuments(query: string): any[] {
  return this.ctx.storage.sql.exec<{
    title: string;
    content: string;
    author: string;
  }>(
    "SELECT * FROM documents_fts WHERE documents_fts MATCH ?",
    query
  ).toArray();
}
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
searchDocuments('"getting started"');

// Boolean operators
searchDocuments('guide AND tutorial');
searchDocuments('guide OR tutorial');
searchDocuments('guide NOT advanced');

// Column-specific
searchDocuments('title:guide');

// Proximity search
searchDocuments('getting NEAR/3 started');  // Within 3 tokens
```

**FTS5 with existing table:**

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    // Main table
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // FTS5 index
    this.ctx.storage.sql.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
        title,
        content,
        content=articles,
        content_rowid=id
      );
    `);

    // Triggers to keep FTS index in sync
    this.ctx.storage.sql.exec(`
      CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
        INSERT INTO articles_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
        DELETE FROM articles_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
        UPDATE articles_fts 
        SET title = new.title, content = new.content
        WHERE rowid = old.id;
      END;
    `);
  });
}
```

**Ranking results:**

```typescript
searchArticles(query: string): any[] {
  return this.ctx.storage.sql.exec<{
    id: number;
    title: string;
    content: string;
    rank: number;
  }>(
    `SELECT 
      a.*,
      fts.rank
    FROM articles a
    JOIN articles_fts fts ON a.id = fts.rowid
    WHERE articles_fts MATCH ?
    ORDER BY fts.rank`,
    query
  ).toArray();
}
```

### JSON Extension

Comprehensive JSON support for querying and manipulating JSON data. See [json-functions.md](json-functions.md) for complete documentation.

### Math Functions

Standard mathematical functions:

```typescript
calculateStats(): any {
  return this.ctx.storage.sql.exec<{
    square_root: number;
    power: number;
    absolute: number;
    rounded: number;
    logarithm: number;
    exponential: number;
    sine: number;
    pi_value: number;
  }>(
    `SELECT 
      sqrt(16) as square_root,      -- 4
      pow(2, 3) as power,            -- 8
      abs(-42) as absolute,          -- 42
      round(3.7) as rounded,         -- 4
      log(100) as logarithm,         -- Natural log
      exp(1) as exponential,         -- e^1
      sin(0) as sine,                -- 0
      pi() as pi_value               -- 3.14159...
    `
  ).one();
}
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
findNearbyLocations(userLat: number, userLon: number): any[] {
  return this.ctx.storage.sql.exec<{
    id: number;
    name: string;
    distance_km: number;
  }>(
    `SELECT 
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
    LIMIT 10`,
    userLat,
    userLat,
    userLon
  ).toArray();
}
```

## PRAGMA Statements

PRAGMA statements control SQLite behavior and query metadata.

### Important Note

**PRAGMA statements only apply to the current transaction** in Durable Objects. They don't persist across requests.

### Schema Information

#### `PRAGMA table_list`

List all tables and views:

```typescript
getTables(): any[] {
  return this.ctx.storage.sql.exec(
    "PRAGMA table_list"
  ).toArray();
  
  // Returns: schema, name, type, ncol, wr, strict
  // type: 'table', 'view', 'shadow', 'virtual'
}
```

#### `PRAGMA table_info(table_name)`

Show table schema:

```typescript
getTableSchema(tableName: string): any[] {
  return this.ctx.storage.sql.exec<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: any;
    pk: number;
  }>(
    `PRAGMA table_info(?)`,
    tableName
  ).toArray();
  
  // Returns: cid, name, type, notnull, dflt_value, pk
}
```

#### `PRAGMA table_xinfo(table_name)`

Like `table_info` but includes generated columns:

```typescript
getExtendedTableInfo(tableName: string): any[] {
  return this.ctx.storage.sql.exec(
    `PRAGMA table_xinfo(?)`,
    tableName
  ).toArray();
  
  // Returns: cid, name, type, notnull, dflt_value, pk, hidden
  // hidden: 1 for generated columns, 0 for regular
}
```

#### `PRAGMA index_list(table_name)`

List indexes for a table:

```typescript
getIndexes(tableName: string): any[] {
  return this.ctx.storage.sql.exec<{
    seq: number;
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }>(
    `PRAGMA index_list(?)`,
    tableName
  ).toArray();
  
  // Returns: seq, name, unique, origin, partial
  // origin: 'c' (CREATE INDEX), 'u' (UNIQUE), 'pk' (PRIMARY KEY)
}
```

#### `PRAGMA index_info(index_name)`

Show columns in an index:

```typescript
getIndexColumns(indexName: string): any[] {
  return this.ctx.storage.sql.exec<{
    seqno: number;
    cid: number;
    name: string;
  }>(
    `PRAGMA index_info(?)`,
    indexName
  ).toArray();
  
  // Returns: seqno, cid, name
}
```

### Foreign Keys

#### `PRAGMA foreign_keys`

Check if foreign key enforcement is enabled:

```typescript
checkForeignKeys(): boolean {
  const result = this.ctx.storage.sql.exec<{ foreign_keys: number }>(
    "PRAGMA foreign_keys"
  ).one();
  
  return result.foreign_keys === 1;  // Always 1 in Durable Objects
}
```

#### `PRAGMA defer_foreign_keys = (ON|OFF)`

Defer foreign key checks until end of transaction:

```typescript
migrateWithCircularDependencies(): void {
  this.ctx.storage.transactionSync(() => {
    this.ctx.storage.sql.exec("PRAGMA defer_foreign_keys = ON");
    
    // Make changes that temporarily violate constraints
    this.ctx.storage.sql.exec(
      "ALTER TABLE users ADD COLUMN manager_id INTEGER"
    );
    
    this.ctx.storage.sql.exec(
      "UPDATE users SET manager_id = 1 WHERE id = 2"
    );
    
    // Constraints checked here (end of transaction)
    this.ctx.storage.sql.exec("PRAGMA defer_foreign_keys = OFF");
  });
}
```

See [foreign-keys.md](foreign-keys.md) for complete documentation.

#### `PRAGMA foreign_key_check`

Check for foreign key violations:

```typescript
validateConstraints(): any[] {
  const violations = this.ctx.storage.sql.exec(
    "PRAGMA foreign_key_check"
  ).toArray();
  
  if (violations.length > 0) {
    console.error("Foreign key violations found:", violations);
  }
  
  return violations;
}

// Check specific table
validateTable(tableName: string): any[] {
  return this.ctx.storage.sql.exec(
    `PRAGMA foreign_key_check(?)`,
    tableName
  ).toArray();
}
```

#### `PRAGMA foreign_key_list(table_name)`

List foreign keys for a table:

```typescript
getForeignKeys(tableName: string): any[] {
  return this.ctx.storage.sql.exec<{
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string;
    on_update: string;
    on_delete: string;
    match: string;
  }>(
    `PRAGMA foreign_key_list(?)`,
    tableName
  ).toArray();
  
  // Returns: id, seq, table, from, to, on_update, on_delete, match
}
```

### Data Integrity

#### `PRAGMA quick_check`

Check database integrity:

```typescript
checkIntegrity(): string {
  const result = this.ctx.storage.sql.exec<{ quick_check: string }>(
    "PRAGMA quick_check"
  ).one();
  
  return result.quick_check;  // 'ok' if no issues
}
```

#### `PRAGMA integrity_check`

More thorough integrity check:

```typescript
thoroughIntegrityCheck(): string {
  const result = this.ctx.storage.sql.exec<{ integrity_check: string }>(
    "PRAGMA integrity_check"
  ).one();
  
  return result.integrity_check;  // 'ok' if no issues
}
```

### Query Behavior

#### `PRAGMA case_sensitive_like = (ON|OFF)`

Toggle case sensitivity for LIKE operator:

```typescript
searchCaseSensitive(pattern: string): any[] {
  this.ctx.storage.sql.exec("PRAGMA case_sensitive_like = ON");
  
  // Now 'a' LIKE 'A' returns false
  return this.ctx.storage.sql.exec<{ name: string }>(
    "SELECT * FROM users WHERE name LIKE ?",
    pattern
  ).toArray();
  // Won't match different cases
}
```

**Default:** OFF (case-insensitive)

#### `PRAGMA recursive_triggers = (ON|OFF)`

Allow triggers to activate other triggers:

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    this.ctx.storage.sql.exec("PRAGMA recursive_triggers = ON");
    
    // Now triggers can fire other triggers
  });
}
```

**Default:** OFF

### Optimization

#### `PRAGMA optimize`

Optimize database statistics:

```typescript
optimizeDatabase(): void {
  this.ctx.storage.sql.exec("PRAGMA optimize");
  
  // Runs ANALYZE on tables that need it
  // Improves query planning performance
}
```

**When to use:**
- After creating indexes
- After large data imports
- Periodically (e.g., on alarm handler)

**Best practice:**

```typescript
// In alarm handler
async alarm(): Promise<void> {
  // Daily optimization
  this.ctx.storage.sql.exec("PRAGMA optimize");
  
  // Schedule next optimization
  await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
}
```

### Database Size

Check database size:

```typescript
getDatabaseSize(): number {
  return this.ctx.storage.sql.databaseSize;  // bytes
}

logDatabaseStats(): void {
  const sizeBytes = this.ctx.storage.sql.databaseSize;
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
  
  console.log(`Database size: ${sizeMB} MB`);
}
```

## Query sqlite_master

The `sqlite_master` table contains database schema information:

```typescript
// List all tables and indexes
getSchemaInfo(): any[] {
  return this.ctx.storage.sql.exec<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string;
  }>(
    `SELECT 
      type,
      name,
      tbl_name,
      sql
    FROM sqlite_master
    WHERE type IN ('table', 'index')
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_cf_%'
    ORDER BY type, name`
  ).toArray();
}
```

**Columns:**
- `type` - Object type: 'table', 'index', 'view', 'trigger'
- `name` - Object name
- `tbl_name` - Associated table name
- `sql` - CREATE statement used to create the object
- `rootpage` - Root page in database file

### Find Tables

```typescript
getAllTables(): string[] {
  const results = this.ctx.storage.sql.exec<{ name: string }>(
    `SELECT name 
    FROM sqlite_master 
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_cf_%'
    ORDER BY name`
  ).toArray();
  
  return results.map(r => r.name);
}
```

### Find Indexes

```typescript
getAllIndexes(): any[] {
  return this.ctx.storage.sql.exec<{
    name: string;
    tbl_name: string;
    sql: string;
  }>(
    `SELECT 
      name,
      tbl_name,
      sql
    FROM sqlite_master 
    WHERE type = 'index'
      AND name NOT LIKE 'sqlite_%'`
  ).toArray();
}
```

### Check if Table Exists

```typescript
tableExists(tableName: string): boolean {
  const result = this.ctx.storage.sql.exec<{ name: string }>(
    `SELECT name 
    FROM sqlite_master 
    WHERE type = 'table' 
      AND name = ?`,
    tableName
  ).toArray();
  
  return result.length > 0;
}
```

### Get Table Schema

```typescript
getTableCreateStatement(tableName: string): string | null {
  const result = this.ctx.storage.sql.exec<{ sql: string }>(
    `SELECT sql 
    FROM sqlite_master 
    WHERE type = 'table' 
      AND name = ?`,
    tableName
  ).toArray();
  
  return result.length > 0 ? result[0].sql : null;
}
```

## Search with LIKE

Pattern matching with wildcards:

```typescript
// % matches any sequence of characters
searchCompanies(pattern: string): any[] {
  return this.ctx.storage.sql.exec<{ company_name: string }>(
    "SELECT * FROM customers WHERE company_name LIKE ?",
    `%${pattern}%`  // Matches 'Steve', 'Developer', etc.
  ).toArray();
}

// _ matches single character
searchProducts(pattern: string): any[] {
  return this.ctx.storage.sql.exec(
    "SELECT * FROM products WHERE code LIKE ?",
    pattern  // "A_C" matches 'ABC', 'A1C', etc.
  ).toArray();
}
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
searchUsers('John%');       // 'John', 'Johnny', 'Johnson'

// Ends with
searchUsers('%son');        // 'Johnson', 'Wilson', 'Mason'

// Contains
searchUsers('%john%');      // 'John', 'Johnny', 'Johnson'

// Exact length
searchUsers('___');         // Any 3-character string

// Pattern
searchUsers('A_C%');        // 'ABC', 'A1C123', 'ABCD'
```

**Case-insensitive search:**

```typescript
searchUsersIgnoreCase(name: string): any[] {
  return this.ctx.storage.sql.exec(
    "SELECT * FROM users WHERE LOWER(name) LIKE LOWER(?)",
    `%${name}%`
  ).toArray();
  // Matches 'Alice', 'ALICE', 'alice'
}
```

## EXPLAIN QUERY PLAN

Analyze how SQLite executes queries:

```typescript
analyzeQuery(email: string): void {
  const plan = this.ctx.storage.sql.exec(
    `EXPLAIN QUERY PLAN
    SELECT * FROM users WHERE email = ?`,
    email
  ).toArray();
  
  console.log('Query plan:', plan);
  // Shows: SCAN vs SEARCH, index usage, join strategy
}
```

**Output interpretation:**
- `SCAN` - Full table scan (slow, consider adding index)
- `SEARCH` - Using index (fast)
- `USING INDEX` - Which index is used
- `USING COVERING INDEX` - All columns in index (fastest)

**Example optimization:**

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    // Before: slow query
    // SCAN posts
    
    // Add index
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)"
    );
    
    // After: fast query
    // SEARCH posts USING INDEX idx_posts_user_id (user_id=?)
  });
}
```

## Migrations with PRAGMA user_version

Use `PRAGMA user_version` for schema versioning:

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => this.migrate());
}

private migrate(): void {
  const currentVersion = this.ctx.storage.sql
    .exec<{ user_version: number }>("PRAGMA user_version")
    .one().user_version;

  if (currentVersion < 1) {
    this.ctx.storage.sql.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
  }

  if (currentVersion < 2) {
    this.ctx.storage.sql.exec(`
      ALTER TABLE users ADD COLUMN email TEXT;
      CREATE INDEX idx_users_email ON users(email);
      PRAGMA user_version = 2;
    `);
  }
}
```

## Limitations and Unsupported Features

### Not Supported in Durable Objects

1. **Custom SQLite Extensions** - Only built-in extensions (FTS5, JSON, Math)
2. **ATTACH DATABASE** - Each DO has one isolated database
3. **BEGIN/COMMIT/ROLLBACK in SQL** - Use `transactionSync()` instead
4. **Virtual tables** - Except FTS5
5. **User-defined functions** - Use application code instead
6. **PRAGMA statements persist** - Only apply to current transaction

### Numeric Precision

JavaScript's 52-bit integer precision affects large numbers:

```typescript
// ⚠️ Very large integers may lose precision
const result = this.ctx.storage.sql.exec<{ value: number }>(
  "SELECT ? as value",
  9007199254740993  // Larger than Number.MAX_SAFE_INTEGER
).one();

// May not be exact
console.log(result.value);  // Precision lost

// ✅ Store as TEXT for exact large integers
this.ctx.storage.sql.exec(
  "INSERT INTO big_numbers (value) VALUES (?)",
  "9007199254740993"  // Store as string
);

// Parse with BigInt when needed
const { value } = this.ctx.storage.sql.exec<{ value: string }>(
  "SELECT value FROM big_numbers WHERE id = ?",
  1
).one();

const bigIntValue = BigInt(value);
```

## Best Practices

### Schema Introspection Helper

```typescript
// Helper: Get all tables
getTables(): string[] {
  const results = this.ctx.storage.sql.exec<{ name: string }>(
    `SELECT name FROM sqlite_master 
    WHERE type = 'table' 
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_cf_%'
    ORDER BY name`
  ).toArray();
  
  return results.map(r => r.name);
}

// Helper: Get table columns
getColumns(table: string): any[] {
  return this.ctx.storage.sql.exec(
    `PRAGMA table_info(?)`,
    table
  ).toArray();
}
```

### Regular Optimization via Alarms

```typescript
async alarm(): Promise<void> {
  // Periodic optimization
  this.ctx.storage.sql.exec("PRAGMA optimize");
  
  // Log database size
  const sizeMB = (this.ctx.storage.sql.databaseSize / (1024 * 1024)).toFixed(2);
  console.log(`Database optimized. Size: ${sizeMB} MB`);
  
  // Schedule next optimization (24 hours)
  await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
}
```

### Query Plan Analysis

```typescript
// Development helper
analyzeQueryPerformance(query: string, ...bindings: any[]): void {
  const plan = this.ctx.storage.sql.exec(
    `EXPLAIN QUERY PLAN ${query}`,
    ...bindings
  ).toArray();
  
  console.log('Query Plan:', plan);
  
  // Check for table scans
  const hasFullScan = plan.some(p => 
    p.detail && p.detail.includes('SCAN')
  );
  
  if (hasFullScan) {
    console.warn('Query uses full table scan - consider adding index');
  }
}
```

### Schema Validation

```typescript
// Verify expected schema on startup
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    this.migrate();
    this.validateSchema();
  });
}

private validateSchema(): void {
  const tables = this.getTables();
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
7. **Monitor database size** with `ctx.storage.sql.databaseSize`
8. **Store very large integers** as TEXT to avoid precision loss
9. **Use transactionSync** for atomic multi-statement operations
10. **Optimize periodically** via alarm handlers
