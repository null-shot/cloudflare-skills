# Foreign Keys Reference

Complete guide to defining and enforcing foreign key constraints in Durable Objects SQLite storage.

## Overview

Foreign key constraints allow you to enforce relationships across tables within a Durable Object. They ensure:
- **Referential integrity** - No orphaned records
- **Cascading operations** - Automatic updates/deletes
- **Data consistency** - Prevent invalid relationships

**Important:** Foreign keys are enforced by default in Durable Objects (equivalent to `PRAGMA foreign_keys = ON` in SQLite).

## Basic Foreign Key Syntax

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS parent_table (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS child_table (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL,
        data TEXT,
        FOREIGN KEY (parent_id) REFERENCES parent_table(id)
      );
    `);
  });
}
```

## Defining Foreign Keys

### Inline Column Constraint

```typescript
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    content TEXT
  );
`);
```

### Table-Level Constraint

```typescript
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS orders (
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
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS order_items (
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
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        
        FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE
      );
    `);
  });
}

// Delete user - all their posts are automatically deleted
deleteUser(userId: number): void {
  this.ctx.storage.sql.exec(
    "DELETE FROM users WHERE id = ?",
    userId
  );
  // All posts with user_id are automatically deleted
}
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

this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    post_id INTEGER,
    content TEXT,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS likes (
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
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    
    FOREIGN KEY (category_id) REFERENCES categories(id)
      ON DELETE RESTRICT
  );
`);

// This will throw if products exist in this category
deleteCategory(categoryId: number): void {
  try {
    this.ctx.storage.sql.exec(
      "DELETE FROM categories WHERE id = ?",
      categoryId
    );
  } catch (error) {
    // Error: FOREIGN KEY constraint failed
    throw new Error("Cannot delete category with products");
  }
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
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS authors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    author_id INTEGER,  -- Nullable
    
    FOREIGN KEY (author_id) REFERENCES authors(id)
      ON DELETE SET NULL
  );
`);

// Delete author - books remain but author_id becomes NULL
deleteAuthor(authorId: number): void {
  this.ctx.storage.sql.exec(
    "DELETE FROM authors WHERE id = ?",
    authorId
  );
  // Books with this author_id now have author_id = NULL
}
```

**Use SET NULL when:**
- Child can exist without parent
- You want to preserve child data
- Examples: book → author (optional), post → category (optional)

**⚠️ Important:** Column must be nullable (`NULL` allowed)

#### SET DEFAULT

Set child foreign key to default value when parent is deleted:

```typescript
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  -- Create a default "unassigned" department
  INSERT INTO departments (id, name) VALUES (1, 'Unassigned');

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    department_id INTEGER DEFAULT 1,  -- Default to unassigned
    
    FOREIGN KEY (department_id) REFERENCES departments(id)
      ON DELETE SET DEFAULT
  );
`);

// Delete department - employees move to default department
deleteDepartment(deptId: number): void {
  this.ctx.storage.sql.exec(
    "DELETE FROM departments WHERE id = ?",
    deptId
  );
  // Employees in this dept now have department_id = 1
}
```

**Use SET DEFAULT when:**
- You have a fallback parent
- You want to preserve child data
- Examples: employee → department (with "unassigned")

**⚠️ Important:** Default value must reference valid parent row

#### NO ACTION

Default behavior - error at end of transaction if constraint violated:

```typescript
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS orders (
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
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
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
- Schema migrations
- Circular dependencies
- Temporary constraint violations

### How to Defer

```typescript
// Defer constraints for current transaction
this.ctx.storage.transactionSync(() => {
  this.ctx.storage.sql.exec("PRAGMA defer_foreign_keys = ON");
  
  // Make changes that temporarily violate constraints
  this.ctx.storage.sql.exec(
    "ALTER TABLE users ADD COLUMN manager_id INTEGER"
  );
  
  this.ctx.storage.sql.exec(
    "UPDATE users SET manager_id = 1 WHERE id = 2"
  );
  
  // Add constraint
  this.ctx.storage.sql.exec(`
    ALTER TABLE users 
    ADD CONSTRAINT fk_manager 
    FOREIGN KEY (manager_id) REFERENCES users(id)
  `);
  
  // Constraints checked at transaction end
  this.ctx.storage.sql.exec("PRAGMA defer_foreign_keys = OFF");
});
```

### Important Notes

- `defer_foreign_keys` only applies to current transaction
- Constraints must be satisfied by transaction end
- `ON DELETE CASCADE` still executes immediately
- Setting to OFF checks constraints immediately

### Migration Example with Circular Dependencies

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("PRAGMA defer_foreign_keys = ON");
      
      // Create tables with circular references
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS departments (
          id INTEGER PRIMARY KEY,
          name TEXT,
          manager_id INTEGER,
          FOREIGN KEY (manager_id) REFERENCES employees(id)
        )
      `);
      
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS employees (
          id INTEGER PRIMARY KEY,
          name TEXT,
          department_id INTEGER,
          FOREIGN KEY (department_id) REFERENCES departments(id)
        )
      `);
      
      // Insert data with circular references
      this.ctx.storage.sql.exec(
        "INSERT INTO departments (id, name, manager_id) VALUES (1, 'Engineering', 1)"
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO employees (id, name, department_id) VALUES (1, 'Alice', 1)"
      );
      
      this.ctx.storage.sql.exec("PRAGMA defer_foreign_keys = OFF");
    });
  });
}
```

## Composite Foreign Keys

Reference multiple columns:

```typescript
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS countries (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS regions (
    country_code TEXT,
    region_code TEXT,
    name TEXT NOT NULL,
    PRIMARY KEY (country_code, region_code),
    FOREIGN KEY (country_code) REFERENCES countries(code)
  );

  CREATE TABLE IF NOT EXISTS cities (
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
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    manager_id INTEGER,
    
    FOREIGN KEY (manager_id) REFERENCES employees(id)
      ON DELETE SET NULL
  );
`);

// Insert employees with manager relationships
initializeHierarchy(): void {
  this.ctx.storage.transactionSync(() => {
    this.ctx.storage.sql.exec(
      "INSERT INTO employees (id, name, manager_id) VALUES (1, 'CEO', NULL)"
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO employees (id, name, manager_id) VALUES (2, 'VP', 1)"
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO employees (id, name, manager_id) VALUES (3, 'Manager', 2)"
    );
  });
}
```

**Common self-referencing patterns:**
- Organizational hierarchies
- Category trees
- Comment threads
- File/folder structures

## Checking Foreign Keys

### Check All Foreign Keys

```typescript
checkConstraints(): any[] {
  const violations = this.ctx.storage.sql.exec(
    "PRAGMA foreign_key_check"
  ).toArray();
  
  if (violations.length > 0) {
    console.error("Foreign key violations:", violations);
  }
  
  return violations;
}
```

**Returns:**
- Empty if no violations
- Rows describing violations if found

### Check Specific Table

```typescript
const violations = this.ctx.storage.sql.exec(
  "PRAGMA foreign_key_check(posts)"
).toArray();
```

### List Foreign Keys for Table

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
}

// Returns: id, seq, table, from, to, on_update, on_delete, match
```

## Practical Examples

### Chat Room Schema

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        joined_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        
        FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE  -- Delete messages when user leaves
      );

      CREATE TABLE IF NOT EXISTS reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        emoji TEXT NOT NULL,
        
        FOREIGN KEY (message_id) REFERENCES messages(id)
          ON DELETE CASCADE,  -- Delete reactions when message deleted
        FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE,  -- Delete reactions when user leaves
        
        UNIQUE(message_id, user_id, emoji)  -- One reaction per user per emoji
      );
    `);
  });
}
```

### Game State Schema

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        score INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS game_sessions (
        id INTEGER PRIMARY KEY,
        player_id INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        
        FOREIGN KEY (player_id) REFERENCES players(id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT,
        
        FOREIGN KEY (session_id) REFERENCES game_sessions(id)
          ON DELETE CASCADE
      );
    `);
  });
}
```

### Multi-tenant Data

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  
  ctx.blockConcurrencyWhile(async () => {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tenant_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        email TEXT NOT NULL,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
          ON DELETE CASCADE,  -- Delete users when tenant deleted
        
        UNIQUE(tenant_id, email)  -- Email unique per tenant
      );

      CREATE TABLE IF NOT EXISTS tenant_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        data TEXT,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
          ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES tenant_users(id)
          ON DELETE CASCADE
      );
    `);
  });
}
```

## Error Handling

### Constraint Violation

```typescript
addPost(userId: number, title: string): void {
  try {
    this.ctx.storage.sql.exec(
      "INSERT INTO posts (user_id, title) VALUES (?, ?)",
      userId,
      title
    );
  } catch (error) {
    if (error.message.includes("FOREIGN KEY constraint failed")) {
      throw new Error("Invalid user ID");
    }
    throw error;
  }
}
```

### Delete with Dependencies

```typescript
deleteCustomer(customerId: number): void {
  // Check if deletion will fail
  const hasOrders = this.ctx.storage.sql.exec<{ count: number }>(
    "SELECT COUNT(*) as count FROM orders WHERE customer_id = ?",
    customerId
  ).one();

  if (hasOrders && hasOrders.count > 0) {
    throw new Error("Cannot delete customer with existing orders");
  }

  // Safe to delete
  this.ctx.storage.sql.exec(
    "DELETE FROM customers WHERE id = ?",
    customerId
  );
}
```

### Cascade Impact Analysis

```typescript
analyzeDeletion(userId: number): any {
  const posts = this.ctx.storage.sql.exec<{ count: number }>(
    "SELECT COUNT(*) as count FROM posts WHERE user_id = ?",
    userId
  ).one();
  
  const comments = this.ctx.storage.sql.exec<{ count: number }>(
    "SELECT COUNT(*) as count FROM comments WHERE author_id = ?",
    userId
  ).one();
  
  const likes = this.ctx.storage.sql.exec<{ count: number }>(
    "SELECT COUNT(*) as count FROM likes WHERE user_id = ?",
    userId
  ).one();

  return {
    posts: posts.count,
    comments: comments.count,
    likes: likes.count
  };
}
```

## Performance Considerations

### Indexes on Foreign Keys

Always create indexes on foreign key columns:

```typescript
this.ctx.storage.sql.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Index for faster lookups and cascade operations
  CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
`);
```

**Why:**
- Faster constraint validation
- Faster CASCADE operations
- Faster JOIN queries

## Best Practices

1. **Always create indexes** on foreign key columns
2. **Use CASCADE carefully** - understand the full cascade chain
3. **Prefer RESTRICT** when deletions should be explicit
4. **Use SET NULL** for optional relationships
5. **Check constraints** with `PRAGMA foreign_key_check` after migrations
6. **Document cascade behavior** in code comments
7. **Test constraint violations** during development
8. **Use named constraints** for clarity in errors
9. **Consider soft deletes** instead of CASCADE for audit trails
10. **Use transactionSync** for complex operations

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
