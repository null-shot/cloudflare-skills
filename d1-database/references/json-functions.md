# JSON Functions Reference

Complete guide to working with JSON data in D1 databases using SQLite's JSON extension.

## Overview

D1 has built-in support for querying and parsing JSON data stored within a database. This enables you to:
- Query paths within stored JSON objects
- Insert and replace values within objects or arrays
- Expand JSON arrays into multiple rows
- Create generated columns from JSON data
- Reduce round-trips to the database

## Storing JSON Data

JSON data is stored as `TEXT` columns in D1:

```typescript
// Create table with JSON column
await env.DB.exec(`
  CREATE TABLE settings (
    user_id INTEGER PRIMARY KEY,
    preferences TEXT,  -- JSON data stored as TEXT
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Insert JSON data
await env.DB
  .prepare("INSERT INTO settings (user_id, preferences) VALUES (?, ?)")
  .bind(123, JSON.stringify({
    theme: "dark",
    notifications: true,
    language: "en",
    categories: ["tech", "news"]
  }))
  .run();
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
const { results } = await env.DB
  .prepare(`SELECT json(?) as formatted`)
  .bind('{"hello": ["world" ,"there"] }')
  .all();

// Returns: {"hello":["world","there"]}
```

Use to validate JSON before storing:

```typescript
try {
  await env.DB
    .prepare("INSERT INTO data (content) VALUES (json(?))")
    .bind(userInput)
    .run();
} catch (error) {
  // Handle malformed JSON error
  return Response.json({ error: "Invalid JSON" }, { status: 400 });
}
```

### `json_valid(json)`

Check if a string is valid JSON:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      json_valid('{"valid": true}') as is_valid,
      json_valid('{invalid json}') as is_invalid
  `)
  .all();

// Returns: { is_valid: 1, is_invalid: 0 }
```

Use in WHERE clauses to filter:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT * FROM data
    WHERE json_valid(content) = 1
  `)
  .all();
```

## Extracting Values

### `json_extract(json, path)`

Extract values using path syntax:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      json_extract(preferences, '$.theme') as theme,
      json_extract(preferences, '$.notifications') as notifications,
      json_extract(preferences, '$.categories[0]') as first_category
    FROM settings
    WHERE user_id = ?
  `)
  .bind(123)
  .all();

// Returns: { theme: "dark", notifications: 1, first_category: "tech" }
```

**Path syntax:**
- `$` - Root object/array
- `$.key` - Object property
- `$.key.nested` - Nested property
- `$[0]` - Array index (0-based)
- `$.array[2]` - Array element in object

Extract multiple values:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      user_id,
      json_extract(preferences, '$.theme') as theme,
      json_extract(preferences, '$.language') as language
    FROM settings
    WHERE json_extract(preferences, '$.notifications') = 1
  `)
  .all();
```

### `->` Operator (JSON Extraction)

Extract value as JSON representation:

```typescript
// Using -> operator
const { results } = await env.DB
  .prepare(`
    SELECT 
      preferences->'$.theme' as theme,
      preferences->'$.categories' as categories
    FROM settings
  `)
  .all();

// theme: "dark" (as JSON string)
// categories: ["tech","news"] (as JSON array)
```

### `->>` Operator (SQL Type Extraction)

Extract value as SQL type:

```typescript
// Using ->> operator
const { results } = await env.DB
  .prepare(`
    SELECT 
      preferences->>'$.theme' as theme,
      preferences->>'$.categories[0]' as first_category
    FROM settings
  `)
  .all();

// theme: dark (as TEXT, no quotes)
// first_category: tech (as TEXT, no quotes)
```

**Comparison:**

```typescript
// -> returns JSON representation (useful for objects/arrays)
preferences->'$.config'     // {"key":"value"}
preferences->'$.tags'       // ["a","b","c"]

// ->> returns SQL value (useful for scalars)
preferences->>'$.username'  // alice
preferences->>'$.count'     // 42
```

## JSON Array Functions

### `json_array(value1, value2, ...)`

Create JSON array from values:

```typescript
const { results } = await env.DB
  .prepare(`SELECT json_array(1, 2, 3, 'four') as arr`)
  .all();

// Returns: { arr: [1,2,3,"four"] }
```

Build arrays dynamically:

```typescript
await env.DB
  .prepare(`
    INSERT INTO logs (event_type, data)
    VALUES ('page_view', json_array(?, ?, ?))
  `)
  .bind(userId, page, timestamp)
  .run();
```

### `json_array_length(json)` / `json_array_length(json, path)`

Get array length:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      user_id,
      json_array_length(preferences, '$.categories') as category_count
    FROM settings
    WHERE json_array_length(preferences, '$.categories') >= 3
  `)
  .all();
```

Count elements directly:

```typescript
const count = await env.DB
  .prepare(`SELECT json_array_length(?) as count`)
  .bind(JSON.stringify(["a", "b", "c"]))
  .first<{ count: number }>();

// count.count = 3
```

## JSON Object Functions

### `json_object(label1, value1, ...)`

Create JSON object from key-value pairs:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT json_object(
      'temp', 45,
      'wind_speed_mph', 13,
      'location', 'NYC'
    ) as weather
  `)
  .all();

// Returns: { weather: {"temp":45,"wind_speed_mph":13,"location":"NYC"} }
```

Build objects from columns:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      user_id,
      json_object(
        'name', name,
        'email', email,
        'created', created_at
      ) as user_data
    FROM users
  `)
  .all();
```

### `json_group_array(value)`

Aggregate rows into JSON array:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      user_id,
      json_group_array(post_title) as titles
    FROM posts
    GROUP BY user_id
  `)
  .all();

// Returns: { user_id: 1, titles: ["Post 1","Post 2","Post 3"] }
```

Build complex aggregations:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      category,
      json_group_array(
        json_object('id', id, 'title', title, 'views', views)
      ) as posts
    FROM posts
    GROUP BY category
  `)
  .all();

// Returns: { category: "tech", posts: [{"id":1,"title":"...","views":100},...] }
```

## Modifying JSON Data

### `json_set(json, path, value)`

Set value at path (creates or overwrites):

```typescript
// Update nested value
await env.DB
  .prepare(`
    UPDATE settings
    SET preferences = json_set(preferences, '$.theme', 'light')
    WHERE user_id = ?
  `)
  .bind(123)
  .run();

// Set multiple values
await env.DB
  .prepare(`
    UPDATE settings
    SET preferences = json_set(
      json_set(preferences, '$.theme', 'light'),
      '$.font_size', 14
    )
    WHERE user_id = ?
  `)
  .bind(123)
  .run();
```

### `json_insert(json, path, value)`

Insert value (only if path doesn't exist):

```typescript
// Add new timestamp to array
await env.DB
  .prepare(`
    UPDATE users
    SET login_history = json_insert(
      login_history,
      '$.history[#]',  -- [#] appends to array
      ?
    )
    WHERE user_id = ?
  `)
  .bind('2024-01-17T10:30:00Z', userId)
  .run();
```

**Path syntax for arrays:**
- `$[#]` - Append to array
- `$[0]` - Insert at index (shifts existing)
- `$.array[#]` - Append to nested array

### `json_replace(json, path, value)`

Replace value (only if path exists):

```typescript
// Only update if key exists
await env.DB
  .prepare(`
    UPDATE settings
    SET preferences = json_replace(preferences, '$.theme', ?)
    WHERE user_id = ?
  `)
  .bind(newTheme, userId)
  .run();
```

### `json_remove(json, path, ...)`

Remove keys/elements:

```typescript
// Remove single key
await env.DB
  .prepare(`
    UPDATE settings
    SET preferences = json_remove(preferences, '$.deprecated_setting')
    WHERE user_id = ?
  `)
  .bind(userId)
  .run();

// Remove multiple keys
await env.DB
  .prepare(`
    UPDATE settings
    SET preferences = json_remove(
      preferences,
      '$.old_key1',
      '$.old_key2',
      '$.old_key3'
    )
  `)
  .run();

// Remove array element
await env.DB
  .prepare(`
    UPDATE data
    SET items = json_remove(items, '$[0]')  -- Remove first element
  `)
  .run();
```

### `json_patch(target, patch)`

Apply JSON Merge Patch (RFC 7386):

```typescript
// Patch merges into target
await env.DB
  .prepare(`
    UPDATE settings
    SET preferences = json_patch(
      preferences,
      ?
    )
    WHERE user_id = ?
  `)
  .bind(
    JSON.stringify({ theme: "light", new_setting: true }),
    userId
  )
  .run();

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
const { results } = await env.DB
  .prepare(`
    UPDATE users
    SET last_audited = ?
    WHERE id IN (SELECT value FROM json_each(?))
  `)
  .bind(
    '2024-01-17T10:00:00Z',
    JSON.stringify([101, 102, 103])
  )
  .run();
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

Example with all columns:

```typescript
const { results } = await env.DB
  .prepare(`SELECT * FROM json_each(?)`)
  .bind(JSON.stringify([10, 20, 30]))
  .all();

// Returns:
// { key: 0, value: 10, type: "integer", fullkey: "$[0]", path: "$", ... }
// { key: 1, value: 20, type: "integer", fullkey: "$[1]", path: "$", ... }
// { key: 2, value: 30, type: "integer", fullkey: "$[2]", path: "$", ... }
```

Expand nested arrays:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      key,
      value,
      type
    FROM json_each(?, '$.categories')
  `)
  .bind(JSON.stringify({ categories: ["tech", "news", "sports"] }))
  .all();
```

### `json_tree(json)` / `json_tree(json, path)`

Recursively expand entire JSON structure:

```typescript
const { results } = await env.DB
  .prepare(`SELECT * FROM json_tree(?)`)
  .bind(JSON.stringify({
    user: "alice",
    settings: {
      theme: "dark",
      tags: ["a", "b"]
    }
  }))
  .all();

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
const { results } = await env.DB
  .prepare(`
    SELECT 
      json_type(?) as root_type,
      json_type(?, '$.config') as config_type,
      json_type(?, '$.count') as count_type,
      json_type(?, '$.tags') as tags_type
  `)
  .bind(
    '{"config":{"key":"val"},"count":42,"tags":["a","b"]}',
    '{"config":{"key":"val"},"count":42,"tags":["a","b"]}',
    '{"config":{"key":"val"},"count":42,"tags":["a","b"]}',
    '{"config":{"key":"val"},"count":42,"tags":["a","b"]}'
  )
  .all();

// Returns: 
// { root_type: "object", config_type: "object", count_type: "integer", tags_type: "array" }
```

**Return values:**
- `null`, `true`, `false`, `integer`, `real`, `text`, `array`, `object`

Use in queries:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT * FROM data
    WHERE json_type(content, '$.value') = 'array'
  `)
  .all();
```

### `json_quote(value)`

Convert SQL value to JSON representation:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT 
      json_quote('hello') as str,
      json_quote(42) as num,
      json_quote('[1,2,3]') as arr
  `)
  .all();

// Returns:
// { str: "hello", num: 42, arr: "[1,2,3]" }
```

## Generated Columns

Create columns automatically extracted from JSON:

```typescript
await env.DB.exec(`
  CREATE TABLE sensor_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_data TEXT,  -- JSON: {"measurement":{"temp":77.4,"location":"US-NY"}}
    
    -- Generated columns (automatically populated)
    temperature AS (json_extract(raw_data, '$.measurement.temp')) STORED,
    location AS (json_extract(raw_data, '$.measurement.location')) STORED
  )
`);

// Create index on generated column
await env.DB.exec(`
  CREATE INDEX idx_sensor_location ON sensor_data(location)
`);
```

Query generated columns like normal columns:

```typescript
const { results } = await env.DB
  .prepare(`
    SELECT id, temperature, location
    FROM sensor_data
    WHERE location = 'US-NY'
      AND temperature > 75
    ORDER BY temperature DESC
  `)
  .all();
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
const { results } = await env.DB
  .prepare(`
    SELECT user_id, preferences
    FROM settings
    WHERE EXISTS (
      SELECT 1
      FROM json_each(preferences, '$.categories')
      WHERE value = ?
    )
  `)
  .bind('tech')
  .all();
```

### Update Array Elements

```typescript
// Add item to array if not exists
await env.DB
  .prepare(`
    UPDATE settings
    SET preferences = CASE
      WHEN json_extract(preferences, '$.categories') LIKE ?
      THEN preferences  -- Already exists, no change
      ELSE json_set(preferences, '$.categories[#]', ?)  -- Append
    END
    WHERE user_id = ?
  `)
  .bind('%"tech"%', 'tech', userId)
  .run();
```

### Aggregate JSON Data

```typescript
// Build nested JSON structure
const { results } = await env.DB
  .prepare(`
    SELECT 
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
    GROUP BY category
  `)
  .all();
```

### Conditional JSON Updates

```typescript
// Update different paths based on condition
await env.DB
  .prepare(`
    UPDATE settings
    SET preferences = CASE
      WHEN json_type(preferences, '$.theme') IS NULL
        THEN json_set(preferences, '$.theme', 'dark')  -- Add if missing
      ELSE json_replace(preferences, '$.theme', 'dark')  -- Update if exists
    END
  `)
  .run();
```

## Error Handling

### Malformed JSON Errors

```typescript
try {
  await env.DB
    .prepare(`SELECT json_extract(?, '$.key')`)
    .bind('not valid JSON')
    .first();
} catch (error) {
  // Error: malformed JSON
  console.error('Invalid JSON:', error.message);
}
```

### Validate Before Querying

```typescript
const input = request.json();

// Validate JSON structure first
if (!input || typeof input !== 'object') {
  return Response.json({ error: "Invalid input" }, { status: 400 });
}

// Safe to use with json functions
await env.DB
  .prepare(`INSERT INTO data (content) VALUES (?)`)
  .bind(JSON.stringify(input))
  .run();
```

### Graceful Defaults

```typescript
// Return default if path doesn't exist
const { results } = await env.DB
  .prepare(`
    SELECT 
      COALESCE(json_extract(preferences, '$.theme'), 'light') as theme,
      COALESCE(json_extract(preferences, '$.font_size'), 12) as font_size
    FROM settings
  `)
  .all();
```

## Performance Tips

1. **Index generated columns** for frequently queried JSON fields
2. **Use json_extract once** and store in variable/CTE
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
8. **Document JSON schema** in table comments or documentation
