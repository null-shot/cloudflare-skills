# Foreign Keys Reference

Complete guide to defining and enforcing foreign key constraints in D1 databases.

## Overview

Foreign key constraints allow you to enforce relationships across tables. They ensure:
- **Referential integrity** - No orphaned records
- **Cascading operations** - Automatic updates/deletes
- **Data consistency** - Prevent invalid relationships

D1 enforces foreign key constraints by default (equivalent to `PRAGMA foreign_keys = ON` in SQLite).

## Basic Foreign Key Syntax

```sql
CREATE TABLE parent_table (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE child_table (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL,
  data TEXT,
  FOREIGN KEY (parent_id) REFERENCES parent_table(id)
);
```

## Defining Foreign Keys

### Inline Column Constraint

```typescript
await env.DB.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL
  );

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    content TEXT
  );
`);
```

### Table-Level Constraint

```typescript
await env.DB.exec(`
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`);
```

### Named Constraints

```typescript
await env.DB.exec(`
  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    
    CONSTRAINT fk_order
      FOREIGN KEY (order_id) REFERENCES orders(id)
      ON DELETE CASCADE,
    
    CONSTRAINT fk_product
      FOREIGN KEY (product_id) REFERENCES products(id)
      ON DELETE RESTRICT
  );
`);
```

## Foreign Key Actions

Define what happens when parent rows are updated or deleted.

### ON DELETE Actions

#### CASCADE

Automatically delete child rows when parent is deleted:

```typescript
await env.DB.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL
  );

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    
    FOREIGN KEY (user_id) REFERENCES users(id)
      ON DELETE CASCADE
  );
`);

// Delete user - all their posts are automatically deleted
await env.DB
  .prepare("DELETE FROM users WHERE id = ?")
  .bind(123)
  .run();
// All posts with user_id = 123 are automatically deleted
```

**Use CASCADE when:**
- Child data is meaningless without parent
- You want automatic cleanup
- Examples: user → sessions, order → order_items

**⚠️ Caution with CASCADE:**
```typescript
// Deleting a user cascades to posts
// Deleting posts might cascade to comments
// Deleting comments might cascade to likes
// This can delete a LOT of data unexpectedly!

await env.DB.exec(`
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    post_id INTEGER,
    content TEXT,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );

  CREATE TABLE likes (
    id INTEGER PRIMARY KEY,
    comment_id INTEGER,
    user_id INTEGER,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
  );
`);

// Deleting one user can cascade through posts → comments → likes
// Always consider the full cascade chain!
```

#### RESTRICT

Prevent deletion if child rows exist:

```typescript
await env.DB.exec(`
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    
    FOREIGN KEY (category_id) REFERENCES categories(id)
      ON DELETE RESTRICT
  );
`);

// This will fail if products exist in this category
try {
  await env.DB
    .prepare("DELETE FROM categories WHERE id = ?")
    .bind(5)
    .run();
} catch (error) {
  // Error: FOREIGN KEY constraint failed
  console.error("Cannot delete category with products");
}
```

**Use RESTRICT when:**
- Parent deletion should be explicit
- You want to prevent accidental data loss
- Examples: category → products, department → employees

**RESTRICT vs NO ACTION:**
- `RESTRICT` - Errors immediately
- `NO ACTION` - Errors at end of transaction (default)

#### SET NULL

Set child foreign key to NULL when parent is deleted:

```typescript
await env.DB.exec(`
  CREATE TABLE authors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    author_id INTEGER,  -- Nullable
    
    FOREIGN KEY (author_id) REFERENCES authors(id)
      ON DELETE SET NULL
  );
`);

// Delete author - books remain but author_id becomes NULL
await env.DB
  .prepare("DELETE FROM authors WHERE id = ?")
  .bind(42)
  .run();
// Books with author_id = 42 now have author_id = NULL
```

**Use SET NULL when:**
- Child can exist without parent
- You want to preserve child data
- Examples: book → author (optional), post → category (optional)

**⚠️ Important:** Column must be nullable (`NULL` allowed)

#### SET DEFAULT

Set child foreign key to default value when parent is deleted:

```typescript
await env.DB.exec(`
  CREATE TABLE departments (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  -- Create a default "unassigned" department
  INSERT INTO departments (id, name) VALUES (1, 'Unassigned');

  CREATE TABLE employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    department_id INTEGER DEFAULT 1,  -- Default to unassigned
    
    FOREIGN KEY (department_id) REFERENCES departments(id)
      ON DELETE SET DEFAULT
  );
`);

// Delete department - employees move to default department
await env.DB
  .prepare("DELETE FROM departments WHERE id = ?")
  .bind(5)
  .run();
// Employees in department 5 now have department_id = 1
```

**Use SET DEFAULT when:**
- You have a fallback parent
- You want to preserve child data
- Examples: employee → department (with "unassigned")

**⚠️ Important:** Default value must reference valid parent row

#### NO ACTION

Default behavior - error at end of transaction if constraint violated:

```typescript
await env.DB.exec(`
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    
    FOREIGN KEY (customer_id) REFERENCES customers(id)
      ON DELETE NO ACTION
  );
`);

// Equivalent to omitting ON DELETE clause
// Errors if orders exist for this customer
```

### ON UPDATE Actions

Same actions available for parent key updates:

```typescript
await env.DB.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL
  );

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    
    FOREIGN KEY (user_id) REFERENCES users(id)
      ON UPDATE CASCADE  -- Update posts when user_id changes
      ON DELETE CASCADE  -- Delete posts when user deleted
  );
`);
```

**Common patterns:**
- `ON UPDATE CASCADE` - Propagate parent key changes
- `ON UPDATE RESTRICT` - Prevent parent key changes
- Usually use same action for UPDATE and DELETE

## Deferring Foreign Key Constraints

By default, foreign key constraints are checked immediately. You can defer checking until end of transaction.

### When to Defer

Useful during:
- Database migrations
- Circular dependencies
- Temporary constraint violations

### How to Defer

```typescript
// Defer constraints for current transaction
await env.DB
  .prepare("PRAGMA defer_foreign_keys = ON")
  .run();

// Make changes that temporarily violate constraints
await env.DB
  .prepare("ALTER TABLE users ADD COLUMN manager_id INTEGER")
  .run();

await env.DB
  .prepare("UPDATE users SET manager_id = 1 WHERE id = 2")
  .run();

// Add constraint
await env.DB
  .prepare(`
    ALTER TABLE users 
    ADD CONSTRAINT fk_manager 
    FOREIGN KEY (manager_id) REFERENCES users(id)
  `)
  .run();

// Constraints checked at transaction end
await env.DB
  .prepare("PRAGMA defer_foreign_keys = OFF")
  .run();
```

### Important Notes

- `defer_foreign_keys` only applies to current transaction
- Constraints must be satisfied by transaction end
- `ON DELETE CASCADE` still executes immediately
- Setting to OFF checks constraints immediately

### Migration Example

```typescript
// Migration with circular dependencies
await env.DB.batch([
  env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
  
  env.DB.prepare(`
    CREATE TABLE departments (
      id INTEGER PRIMARY KEY,
      name TEXT,
      manager_id INTEGER,
      FOREIGN KEY (manager_id) REFERENCES employees(id)
    )
  `),
  
  env.DB.prepare(`
    CREATE TABLE employees (
      id INTEGER PRIMARY KEY,
      name TEXT,
      department_id INTEGER,
      FOREIGN KEY (department_id) REFERENCES departments(id)
    )
  `),
  
  // Insert data with circular references
  env.DB.prepare("INSERT INTO departments (id, name, manager_id) VALUES (1, 'Engineering', 1)"),
  env.DB.prepare("INSERT INTO employees (id, name, department_id) VALUES (1, 'Alice', 1)"),
  
  env.DB.prepare("PRAGMA defer_foreign_keys = OFF")
]);
```

## Composite Foreign Keys

Reference multiple columns:

```typescript
await env.DB.exec(`
  CREATE TABLE countries (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE regions (
    country_code TEXT,
    region_code TEXT,
    name TEXT NOT NULL,
    PRIMARY KEY (country_code, region_code),
    FOREIGN KEY (country_code) REFERENCES countries(code)
  );

  CREATE TABLE cities (
    id INTEGER PRIMARY KEY,
    country_code TEXT NOT NULL,
    region_code TEXT NOT NULL,
    name TEXT NOT NULL,
    
    FOREIGN KEY (country_code, region_code)
      REFERENCES regions(country_code, region_code)
      ON DELETE CASCADE
  );
`);
```

## Self-Referencing Foreign Keys

Table references itself:

```typescript
await env.DB.exec(`
  CREATE TABLE employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    manager_id INTEGER,
    
    FOREIGN KEY (manager_id) REFERENCES employees(id)
      ON DELETE SET NULL
  );
`);

// Insert employees with manager relationships
await env.DB.batch([
  env.DB.prepare("INSERT INTO employees (id, name, manager_id) VALUES (1, 'CEO', NULL)"),
  env.DB.prepare("INSERT INTO employees (id, name, manager_id) VALUES (2, 'VP', 1)"),
  env.DB.prepare("INSERT INTO employees (id, name, manager_id) VALUES (3, 'Manager', 2)")
]);
```

**Common self-referencing patterns:**
- Organizational hierarchies
- Category trees
- Comment threads
- File/folder structures

## Checking Foreign Keys

### Check All Foreign Keys

```typescript
const { results } = await env.DB
  .prepare("PRAGMA foreign_key_check")
  .all();

if (results.length > 0) {
  console.error("Foreign key violations:", results);
}
```

**Returns:**
- Empty if no violations
- Rows describing violations if found

### Check Specific Table

```typescript
const { results } = await env.DB
  .prepare("PRAGMA foreign_key_check(posts)")
  .all();
```

### List Foreign Keys for Table

```typescript
const { results } = await env.DB
  .prepare("PRAGMA foreign_key_list(posts)")
  .all();

// Returns: id, seq, table, from, to, on_update, on_delete, match
```

Example output:
```
{
  id: 0,
  seq: 0,
  table: "users",
  from: "user_id",
  to: "id",
  on_update: "NO ACTION",
  on_delete: "CASCADE",
  match: "NONE"
}
```

## Practical Examples

### E-commerce Schema

```typescript
await env.DB.exec(`
  -- Core tables
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    stock INTEGER DEFAULT 0
  );

  -- Orders with CASCADE delete
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (customer_id) REFERENCES customers(id)
      ON DELETE CASCADE  -- Delete orders when customer deleted
  );

  -- Order items with CASCADE delete
  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price_at_purchase REAL NOT NULL,
    
    FOREIGN KEY (order_id) REFERENCES orders(id)
      ON DELETE CASCADE,  -- Delete items when order deleted
    FOREIGN KEY (product_id) REFERENCES products(id)
      ON DELETE RESTRICT  -- Prevent product deletion if in orders
  );
`);
```

### Blog Schema

```typescript
await env.DB.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL
  );

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    
    FOREIGN KEY (author_id) REFERENCES users(id)
      ON DELETE CASCADE
  );

  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    parent_comment_id INTEGER,  -- For threaded comments
    
    FOREIGN KEY (post_id) REFERENCES posts(id)
      ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id)
      ON DELETE CASCADE,
    FOREIGN KEY (parent_comment_id) REFERENCES comments(id)
      ON DELETE CASCADE  -- Delete replies when parent deleted
  );
`);
```

### Multi-tenant Schema

```typescript
await env.DB.exec(`
  CREATE TABLE tenants (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT UNIQUE NOT NULL
  );

  CREATE TABLE tenant_users (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      ON DELETE CASCADE,  -- Delete users when tenant deleted
    
    UNIQUE(tenant_id, email)  -- Email unique per tenant
  );

  CREATE TABLE tenant_data (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    data TEXT,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES tenant_users(id)
      ON DELETE CASCADE
  );
`);
```

## Error Handling

### Constraint Violation

```typescript
try {
  await env.DB
    .prepare("INSERT INTO posts (user_id, title) VALUES (?, ?)")
    .bind(999, "Post Title")  // user_id 999 doesn't exist
    .run();
} catch (error) {
  if (error.message.includes("FOREIGN KEY constraint failed")) {
    return Response.json(
      { error: "Invalid user ID" },
      { status: 400 }
    );
  }
  throw error;
}
```

### Delete with Dependencies

```typescript
// Check if deletion will fail
const hasOrders = await env.DB
  .prepare("SELECT COUNT(*) as count FROM orders WHERE customer_id = ?")
  .bind(customerId)
  .first<{ count: number }>();

if (hasOrders && hasOrders.count > 0) {
  return Response.json(
    { error: "Cannot delete customer with existing orders" },
    { status: 409 }
  );
}

// Safe to delete
await env.DB
  .prepare("DELETE FROM customers WHERE id = ?")
  .bind(customerId)
  .run();
```

### Cascade Impact Analysis

```typescript
// Before cascading delete, check what will be deleted
const impact = await env.DB.batch([
  env.DB.prepare("SELECT COUNT(*) as count FROM posts WHERE user_id = ?").bind(userId),
  env.DB.prepare("SELECT COUNT(*) as count FROM comments WHERE author_id = ?").bind(userId),
  env.DB.prepare("SELECT COUNT(*) as count FROM likes WHERE user_id = ?").bind(userId)
]);

console.log(`Deleting user will remove:
  - ${impact[0].results[0].count} posts
  - ${impact[1].results[0].count} comments  
  - ${impact[2].results[0].count} likes
`);

// Proceed with deletion
await env.DB
  .prepare("DELETE FROM users WHERE id = ?")
  .bind(userId)
  .run();
```

## Performance Considerations

### Indexes on Foreign Keys

Always create indexes on foreign key columns:

```typescript
await env.DB.exec(`
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Index for faster lookups and cascade operations
  CREATE INDEX idx_posts_user_id ON posts(user_id);
`);
```

**Why:**
- Faster constraint validation
- Faster CASCADE operations
- Faster JOIN queries

### Cascade Performance

```typescript
// Cascading deletes can be slow for large datasets
// Consider batch deletion with monitoring

const batchSize = 1000;
let deleted = 0;

while (true) {
  const result = await env.DB
    .prepare(`
      DELETE FROM posts 
      WHERE id IN (
        SELECT id FROM posts 
        WHERE user_id = ? 
        LIMIT ?
      )
    `)
    .bind(userId, batchSize)
    .run();
  
  deleted += result.meta.changes;
  
  if (result.meta.changes < batchSize) {
    break;  // All deleted
  }
}

console.log(`Deleted ${deleted} posts`);
```

## Best Practices

1. **Always create indexes** on foreign key columns
2. **Use CASCADE carefully** - understand the full cascade chain
3. **Prefer RESTRICT** when deletions should be explicit
4. **Use SET NULL** for optional relationships
5. **Check constraints** with `PRAGMA foreign_key_check` after migrations
6. **Document cascade behavior** in schema comments
7. **Test constraint violations** in development
8. **Use named constraints** for clarity in errors
9. **Consider soft deletes** instead of CASCADE for audit trails
10. **Monitor cascade impact** before deleting parent rows

## Common Pitfalls

### Forgetting Indexes

```typescript
// ❌ Bad - No index on foreign key
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

// ✅ Good - Index on foreign key
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_posts_user_id ON posts(user_id);
```

### Circular CASCADE

```typescript
// ❌ Dangerous - Circular cascade can delete everything
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  best_friend_id INTEGER,
  FOREIGN KEY (best_friend_id) REFERENCES users(id) ON DELETE CASCADE
);

// Deleting one user cascades to delete their best friend,
// which cascades to delete that user's best friend, etc.
```

### Nullable vs NOT NULL

```typescript
// ❌ Bad - NOT NULL with SET NULL
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,  -- Can't be NULL!
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

// ✅ Good - Nullable with SET NULL
CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,  -- Can be NULL
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

### Missing Parent Record for SET DEFAULT

```typescript
// ❌ Bad - Default references non-existent row
CREATE TABLE employees (
  department_id INTEGER DEFAULT 999,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET DEFAULT
);
-- If department 999 doesn't exist, constraint fails!

// ✅ Good - Ensure default exists
INSERT INTO departments (id, name) VALUES (999, 'Unassigned');
CREATE TABLE employees (
  department_id INTEGER DEFAULT 999,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET DEFAULT
);
```
