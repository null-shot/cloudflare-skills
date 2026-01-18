# JSON Functions Reference

Complete guide to working with JSON data in Durable Objects SQLite storage.

## Overview

Durable Objects support SQLite's JSON extension for querying and parsing JSON data. This enables you to:
- Query paths within stored JSON objects
- Insert and replace values within objects or arrays
- Expand JSON arrays into multiple rows
- Create generated columns from JSON data
- Work with complex nested structures

## Storing JSON Data

JSON data is stored as `TEXT` columns:

```typescript
export class MyDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          user_id INTEGER PRIMARY KEY,
          preferences TEXT,  -- JSON data stored as TEXT
          created_at INTEGER NOT NULL
        )
      `);
    });
  }

  async savePreferences(userId: number, prefs: any): Promise<void> {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO settings (user_id, preferences, created_at) VALUES (?, ?, ?)",
      userId,
      JSON.stringify(prefs),
      Date.now()
    );
  }
}
```

## JSON Type Conversion

JSON types map to SQLite types:

| JSON Type | SQLite Type | Example |
|-----------|-------------|---------|
| `null` | `NULL` | `null` → `NULL` |
| Number (integer) | `INTEGER` | `42` → `42` |
| Number (decimal) | `REAL` | `3.14` → `3.14` |
| String | `TEXT` | `"hello"` → `'hello'` |
| Boolean | `INTEGER` | `true` → `1`, `false` → `0` |
| Object | `TEXT` | `{"key":"val"}` → `'{"key":"val"}'` |
| Array | `TEXT` | `[1,2,3]` → `'[1,2,3]'` |

## Core JSON Functions

### `json(json)`

Validates and minifies JSON:

```typescript
// Validate and store JSON
this.ctx.storage.sql.exec(
  "INSERT INTO data (content) VALUES (json(?))",
  userInput
);
// Throws if userInput is invalid JSON
```

### `json_valid(json)`

Check if a string is valid JSON:

```typescript
const rows = this.ctx.storage.sql.exec<{ is_valid: number }>(
  "SELECT json_valid(?) as is_valid",
  inputString
).toArray();

if (rows[0].is_valid === 0) {
  throw new Error("Invalid JSON");
}
```

## Extracting Values

### `json_extract(json, path)`

Extract values using path syntax:

```typescript
const result = this.ctx.storage.sql.exec<{
  theme: string;
  notifications: number;
  first_category: string;
}>(
  `SELECT 
    json_extract(preferences, '$.theme') as theme,
    json_extract(preferences, '$.notifications') as notifications,
    json_extract(preferences, '$.categories[0]') as first_category
  FROM settings
  WHERE user_id = ?`,
  userId
).one();

// Returns: { theme: "dark", notifications: 1, first_category: "tech" }
```

**Path syntax:**
- `$` - Root object/array
- `$.key` - Object property
- `$.key.nested` - Nested property
- `$[0]` - Array index (0-based)
- `$.array[2]` - Array element in object

### `->` Operator (JSON Extraction)

Extract value as JSON representation:

```typescript
const rows = this.ctx.storage.sql.exec<{
  theme: string;
  categories: string;
}>(
  `SELECT 
    preferences->'$.theme' as theme,
    preferences->'$.categories' as categories
  FROM settings`
).toArray();

// theme: "dark" (as JSON string)
// categories: ["tech","news"] (as JSON array)
```

### `->>` Operator (SQL Type Extraction)

Extract value as SQL type:

```typescript
const rows = this.ctx.storage.sql.exec<{
  theme: string;
  first_category: string;
}>(
  `SELECT 
    preferences->>'$.theme' as theme,
    preferences->>'$.categories[0]' as first_category
  FROM settings`
).toArray();

// theme: dark (as TEXT, no quotes)
// first_category: tech (as TEXT, no quotes)
```

## JSON Array Functions

### `json_array(value1, value2, ...)`

Create JSON array from values:

```typescript
this.ctx.storage.sql.exec(
  "INSERT INTO logs (event_type, data) VALUES ('page_view', json_array(?, ?, ?))",
  userId,
  page,
  timestamp
);
```

### `json_array_length(json)` / `json_array_length(json, path)`

Get array length:

```typescript
const rows = this.ctx.storage.sql.exec<{
  user_id: number;
  category_count: number;
}>(
  `SELECT 
    user_id,
    json_array_length(preferences, '$.categories') as category_count
  FROM settings
  WHERE json_array_length(preferences, '$.categories') >= 3`
).toArray();
```

## JSON Object Functions

### `json_object(label1, value1, ...)`

Create JSON object from key-value pairs:

```typescript
const rows = this.ctx.storage.sql.exec<{ weather: string }>(
  `SELECT json_object(
    'temp', 45,
    'wind_speed_mph', 13,
    'location', 'NYC'
  ) as weather`
).toArray();

// Returns: { weather: {"temp":45,"wind_speed_mph":13,"location":"NYC"} }
```

Build objects from columns:

```typescript
const rows = this.ctx.storage.sql.exec<{
  user_id: number;
  user_data: string;
}>(
  `SELECT 
    user_id,
    json_object(
      'name', name,
      'email', email,
      'created', created_at
    ) as user_data
  FROM users`
).toArray();
```

### `json_group_array(value)`

Aggregate rows into JSON array:

```typescript
const rows = this.ctx.storage.sql.exec<{
  user_id: number;
  titles: string;
}>(
  `SELECT 
    user_id,
    json_group_array(post_title) as titles
  FROM posts
  GROUP BY user_id`
).toArray();

// Returns: { user_id: 1, titles: ["Post 1","Post 2","Post 3"] }
```

Build complex aggregations:

```typescript
const rows = this.ctx.storage.sql.exec<{
  category: string;
  posts: string;
}>(
  `SELECT 
    category,
    json_group_array(
      json_object('id', id, 'title', title, 'views', views)
    ) as posts
  FROM posts
  GROUP BY category`
).toArray();

// Returns: { category: "tech", posts: [{"id":1,"title":"...","views":100},...] }
```

## Modifying JSON Data

### `json_set(json, path, value)`

Set value at path (creates or overwrites):

```typescript
// Update nested value
this.ctx.storage.sql.exec(
  `UPDATE settings
  SET preferences = json_set(preferences, '$.theme', ?)
  WHERE user_id = ?`,
  'light',
  userId
);

// Set multiple values
this.ctx.storage.sql.exec(
  `UPDATE settings
  SET preferences = json_set(
    json_set(preferences, '$.theme', ?),
    '$.font_size', ?
  )
  WHERE user_id = ?`,
  'light',
  14,
  userId
);
```

### `json_insert(json, path, value)`

Insert value (only if path doesn't exist):

```typescript
// Add new timestamp to array
this.ctx.storage.sql.exec(
  `UPDATE users
  SET login_history = json_insert(
    login_history,
    '$.history[#]',  -- [#] appends to array
    ?
  )
  WHERE user_id = ?`,
  new Date().toISOString(),
  userId
);
```

**Path syntax for arrays:**
- `$[#]` - Append to array
- `$[0]` - Insert at index (shifts existing)
- `$.array[#]` - Append to nested array

### `json_replace(json, path, value)`

Replace value (only if path exists):

```typescript
// Only update if key exists
this.ctx.storage.sql.exec(
  `UPDATE settings
  SET preferences = json_replace(preferences, '$.theme', ?)
  WHERE user_id = ?`,
  newTheme,
  userId
);
```

### `json_remove(json, path, ...)`

Remove keys/elements:

```typescript
// Remove single key
this.ctx.storage.sql.exec(
  `UPDATE settings
  SET preferences = json_remove(preferences, '$.deprecated_setting')
  WHERE user_id = ?`,
  userId
);

// Remove multiple keys
this.ctx.storage.sql.exec(
  `UPDATE settings
  SET preferences = json_remove(
    preferences,
    '$.old_key1',
    '$.old_key2',
    '$.old_key3'
  )`
);

// Remove array element
this.ctx.storage.sql.exec(
  "UPDATE data SET items = json_remove(items, '$[0]')"  // Remove first
);
```

### `json_patch(target, patch)`

Apply JSON Merge Patch (RFC 7386):

```typescript
// Patch merges into target
this.ctx.storage.sql.exec(
  `UPDATE settings
  SET preferences = json_patch(preferences, ?)
  WHERE user_id = ?`,
  JSON.stringify({ theme: "light", new_setting: true }),
  userId
);

// Merge patch behavior:
// - Adds new keys
// - Overwrites existing keys
// - Removes keys with null value
```

## Expanding JSON Arrays

### `json_each(json)` / `json_each(json, path)`

Expand array/object into rows:

```typescript
// Expand array for IN query
this.ctx.storage.sql.exec(
  `UPDATE users
  SET last_audited = ?
  WHERE id IN (SELECT value FROM json_each(?))`,
  Date.now(),
  JSON.stringify([101, 102, 103])
);
```

**Columns returned by json_each:**
- `key` - Array index or object key
- `value` - Element value
- `type` - Type: null, true, false, integer, real, text, array, object
- `atom` - Atomic value (scalar types only)
- `id` - Unique ID for element
- `parent` - Parent ID
- `fullkey` - Full path (e.g., `$[2]`)
- `path` - Path to parent

Example:

```typescript
const rows = this.ctx.storage.sql.exec(
  "SELECT * FROM json_each(?)",
  JSON.stringify([10, 20, 30])
).toArray();

// Returns:
// { key: 0, value: 10, type: "integer", fullkey: "$[0]", ... }
// { key: 1, value: 20, type: "integer", fullkey: "$[1]", ... }
// { key: 2, value: 30, type: "integer", fullkey: "$[2]", ... }
```

Expand nested arrays:

```typescript
const rows = this.ctx.storage.sql.exec<{
  key: string;
  value: string;
  type: string;
}>(
  "SELECT key, value, type FROM json_each(?, '$.categories')",
  JSON.stringify({ categories: ["tech", "news", "sports"] })
).toArray();
```

### `json_tree(json)` / `json_tree(json, path)`

Recursively expand entire JSON structure:

```typescript
const rows = this.ctx.storage.sql.exec(
  "SELECT * FROM json_tree(?)",
  JSON.stringify({
    user: "alice",
    settings: {
      theme: "dark",
      tags: ["a", "b"]
    }
  })
).toArray();

// Returns multiple rows, one for each element including nested
// Traverses the entire tree structure
```

**Difference from json_each:**
- `json_each` - Only top level
- `json_tree` - Full recursive traversal

## Type Functions

### `json_type(json)` / `json_type(json, path)`

Get JSON type:

```typescript
const row = this.ctx.storage.sql.exec<{
  root_type: string;
  config_type: string;
  count_type: string;
  tags_type: string;
}>(
  `SELECT 
    json_type(?) as root_type,
    json_type(?, '$.config') as config_type,
    json_type(?, '$.count') as count_type,
    json_type(?, '$.tags') as tags_type`,
  '{"config":{"key":"val"},"count":42,"tags":["a","b"]}',
  '{"config":{"key":"val"},"count":42,"tags":["a","b"]}',
  '{"config":{"key":"val"},"count":42,"tags":["a","b"]}',
  '{"config":{"key":"val"},"count":42,"tags":["a","b"]}'
).one();

// Returns: 
// { root_type: "object", config_type: "object", count_type: "integer", tags_type: "array" }
```

**Return values:**
- `null`, `true`, `false`, `integer`, `real`, `text`, `array`, `object`

### `json_quote(value)`

Convert SQL value to JSON representation:

```typescript
const rows = this.ctx.storage.sql.exec<{
  str: string;
  num: number;
  arr: string;
}>(
  `SELECT 
    json_quote('hello') as str,
    json_quote(42) as num,
    json_quote('[1,2,3]') as arr`
).toArray();

// Returns: { str: "hello", num: 42, arr: "[1,2,3]" }
```

## Generated Columns

Create columns automatically extracted from JSON:

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS sensor_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_data TEXT,  -- JSON: {"measurement":{"temp":77.4,"location":"US-NY"}}
        
        -- Generated columns (automatically populated)
        temperature AS (json_extract(raw_data, '$.measurement.temp')) STORED,
        location AS (json_extract(raw_data, '$.measurement.location')) STORED
      );
      
      CREATE INDEX IF NOT EXISTS idx_sensor_location ON sensor_data(location);
    `);
  });
}

// Query generated columns like normal columns
getSensorData(location: string): any[] {
  return this.ctx.storage.sql.exec<{
    id: number;
    temperature: number;
    location: string;
  }>(
    `SELECT id, temperature, location
    FROM sensor_data
    WHERE location = ?
      AND temperature > 75
    ORDER BY temperature DESC`,
    location
  ).toArray();
}
```

**Benefits:**
- Index generated columns for fast queries
- Avoid extracting JSON in every query
- Type checking and validation
- Computed values stay in sync

## Practical Examples

### Search in JSON Arrays

```typescript
// Find users with specific tag
getUsersWithTag(tag: string): any[] {
  return this.ctx.storage.sql.exec(
    `SELECT user_id, preferences
    FROM settings
    WHERE EXISTS (
      SELECT 1
      FROM json_each(preferences, '$.categories')
      WHERE value = ?
    )`,
    tag
  ).toArray();
}
```

### Update Array Elements

```typescript
// Add item to array if not exists
addCategory(userId: number, category: string): void {
  this.ctx.storage.sql.exec(
    `UPDATE settings
    SET preferences = CASE
      WHEN json_extract(preferences, '$.categories') LIKE ?
      THEN preferences  -- Already exists, no change
      ELSE json_set(preferences, '$.categories[#]', ?)  -- Append
    END
    WHERE user_id = ?`,
    `%"${category}"%`,
    category,
    userId
  );
}
```

### Aggregate JSON Data

```typescript
// Build nested JSON structure
getPostsByCategory(): any[] {
  return this.ctx.storage.sql.exec<{
    category: string;
    data: string;
  }>(
    `SELECT 
      category,
      json_object(
        'total', COUNT(*),
        'posts', json_group_array(
          json_object(
            'id', id,
            'title', title,
            'author', author
          )
        )
      ) as data
    FROM posts
    GROUP BY category`
  ).toArray();
}
```

### Conditional JSON Updates

```typescript
// Update different paths based on condition
updateTheme(theme: string): void {
  this.ctx.storage.sql.exec(
    `UPDATE settings
    SET preferences = CASE
      WHEN json_type(preferences, '$.theme') IS NULL
        THEN json_set(preferences, '$.theme', ?)  -- Add if missing
      ELSE json_replace(preferences, '$.theme', ?)  -- Update if exists
    END`,
    theme,
    theme
  );
}
```

## Error Handling

### Malformed JSON Errors

```typescript
try {
  this.ctx.storage.sql.exec(
    "SELECT json_extract(?, '$.key')",
    'not valid JSON'
  );
} catch (error) {
  // Error: malformed JSON
  console.error('Invalid JSON:', error);
}
```

### Validate Before Querying

```typescript
async saveData(userId: number, data: any): Promise<void> {
  // Validate JSON structure first
  if (!data || typeof data !== 'object') {
    throw new Error("Invalid input");
  }

  // Safe to use with json functions
  this.ctx.storage.sql.exec(
    "INSERT INTO data (user_id, content) VALUES (?, ?)",
    userId,
    JSON.stringify(data)
  );
}
```

### Graceful Defaults

```typescript
// Return default if path doesn't exist
getUserPreferences(userId: number) {
  return this.ctx.storage.sql.exec<{
    theme: string;
    font_size: number;
  }>(
    `SELECT 
      COALESCE(json_extract(preferences, '$.theme'), 'light') as theme,
      COALESCE(json_extract(preferences, '$.font_size'), 12) as font_size
    FROM settings
    WHERE user_id = ?`,
    userId
  ).one();
}
```

## Performance Tips

1. **Index generated columns** for frequently queried JSON fields
2. **Use json_extract once** and store in CTE or subquery
3. **Avoid json_each for large arrays** in WHERE clauses
4. **Validate JSON on insert** to avoid runtime errors
5. **Consider denormalization** for frequently accessed nested data
6. **Use -> vs ->>** appropriately: -> for JSON, ->> for SQL types
7. **Batch json_set calls** to update multiple fields at once

## Best Practices

1. **Always validate user JSON** before storing
2. **Use parameter binding** with JSON values
3. **Create generated columns** for frequently queried fields
4. **Index generated columns** for better performance
5. **Use COALESCE** for default values on missing paths
6. **Prefer json_set** over json_insert/json_replace when behavior doesn't matter
7. **Store JSON as minified** using `json()` function
8. **Document JSON schema** in code comments

## Transactional JSON Updates

Use `transactionSync` for atomic JSON updates:

```typescript
updateMultipleSettings(userId: number, updates: any): void {
  this.ctx.storage.transactionSync(() => {
    // All updates atomic
    this.ctx.storage.sql.exec(
      "UPDATE settings SET preferences = json_set(preferences, '$.theme', ?) WHERE user_id = ?",
      updates.theme,
      userId
    );
    this.ctx.storage.sql.exec(
      "UPDATE settings SET preferences = json_set(preferences, '$.fontSize', ?) WHERE user_id = ?",
      updates.fontSize,
      userId
    );
  });
}
```
