# Migrations Guide

Comprehensive guide to D1 database migrations, schema design, and migration strategies.

## Migration Basics

### Creating Migrations

```bash
# Create migration with descriptive name
wrangler d1 migrations create my-database add_user_roles

# Output: Created migrations/0001_add_user_roles.sql
```

Migration files are numbered sequentially and stored in the `migrations/` directory (or custom path set in `wrangler.jsonc`).

### Migration File Format

Migrations are standard SQL files:

```sql
-- migrations/0001_create_users_table.sql
-- Create users table with basic fields

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for email lookups
CREATE INDEX idx_users_email ON users(email);

-- Trigger to update updated_at automatically
CREATE TRIGGER users_updated_at 
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
```

### Applying Migrations

```bash
# Test locally first
wrangler d1 migrations apply my-database --local

# Check pending migrations
wrangler d1 migrations list my-database --remote

# Apply to production
wrangler d1 migrations apply my-database --remote

# Apply specific range
wrangler d1 migrations apply my-database --remote --from 0001 --to 0005
```

## Schema Design Patterns

### Primary Keys

#### Auto-incrementing Integer (Recommended)

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);
```

**Pros:**
- Efficient for joins
- Sequential IDs
- Small storage footprint

**Cons:**
- Predictable IDs (may expose data)
- Not globally unique

#### UUID/ULID as Text

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,  -- Store UUID as text
  user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Generate UUID in Worker code
import { v4 as uuidv4 } from 'uuid';

const sessionId = uuidv4();
await env.DB
  .prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)")
  .bind(sessionId, userId)
  .run();
```

**Pros:**
- Globally unique
- Non-sequential (secure)
- Can be generated client-side

**Cons:**
- Larger storage (36 bytes vs 8 bytes)
- String comparison slower than integer

### Foreign Keys

Always use foreign keys to maintain referential integrity:

```sql
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign key with cascade delete
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Foreign key options:
-- ON DELETE CASCADE    - Delete posts when user is deleted
-- ON DELETE SET NULL   - Set user_id to NULL when user is deleted
-- ON DELETE RESTRICT   - Prevent user deletion if posts exist
-- ON DELETE NO ACTION  - Default behavior (error on violation)
```

**Enable foreign keys in queries** (SQLite doesn't enforce by default):

```typescript
// Enable at the connection level
await env.DB.prepare("PRAGMA foreign_keys = ON").run();

// Now foreign key constraints are enforced
```

### Indexes

Create indexes for columns used in WHERE, JOIN, ORDER BY, and GROUP BY:

```sql
-- Single column index
CREATE INDEX idx_posts_user_id ON posts(user_id);

-- Composite index (order matters!)
CREATE INDEX idx_posts_user_published ON posts(user_id, published);

-- Unique index
CREATE UNIQUE INDEX idx_users_email ON users(email);

-- Partial index (only index specific rows)
CREATE INDEX idx_published_posts ON posts(created_at) WHERE published = 1;

-- Expression index
CREATE INDEX idx_users_lower_email ON users(LOWER(email));
```

**Index Design Tips:**

1. **Most selective column first** in composite indexes
2. **Cover queries** - include all columns in SELECT
3. **Avoid over-indexing** - each index slows writes
4. **Use partial indexes** for filtered queries
5. **Monitor with EXPLAIN** to verify index usage

### Data Types

SQLite has flexible typing, but follow these conventions:

| Type | Use For | Example |
|------|---------|---------|
| INTEGER | IDs, counts, flags | `user_id INTEGER` |
| TEXT | Strings, JSON, UUIDs | `email TEXT` |
| REAL | Floating point numbers | `price REAL` |
| BLOB | Binary data | `avatar BLOB` |
| DATETIME | Timestamps as ISO 8601 | `created_at DATETIME` |
| BOOLEAN | Use INTEGER (0/1) | `published INTEGER DEFAULT 0` |

### Timestamps

Use consistent timestamp pattern:

```sql
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Auto-update trigger
CREATE TRIGGER posts_updated_at 
AFTER UPDATE ON posts
FOR EACH ROW
BEGIN
  UPDATE posts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
```

### Soft Deletes

Keep records for audit trails:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  deleted_at DATETIME NULL
);

CREATE INDEX idx_users_active ON users(email) WHERE deleted_at IS NULL;

-- Soft delete
UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?;

-- Query only active users
SELECT * FROM users WHERE deleted_at IS NULL;
```

### JSON Columns

Store flexible data as JSON:

```sql
CREATE TABLE user_settings (
  user_id INTEGER PRIMARY KEY,
  preferences TEXT NOT NULL,  -- JSON string
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Query JSON properties
SELECT 
  user_id,
  json_extract(preferences, '$.theme') as theme
FROM user_settings
WHERE json_extract(preferences, '$.notifications') = 1;
```

## Migration Strategies

### Adding Columns

```sql
-- migrations/0002_add_user_bio.sql
ALTER TABLE users ADD COLUMN bio TEXT;

-- With default value
ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0 NOT NULL;
```

**⚠️ Limitations:**
- Cannot add NOT NULL column without DEFAULT
- Cannot modify existing columns (need workaround)

### Renaming Tables

```sql
-- migrations/0003_rename_posts_to_articles.sql
ALTER TABLE posts RENAME TO articles;
```

### Renaming Columns (SQLite 3.25+)

```sql
-- migrations/0004_rename_user_column.sql
ALTER TABLE users RENAME COLUMN username TO email;
```

### Adding Indexes

```sql
-- migrations/0005_add_post_indexes.sql
CREATE INDEX idx_posts_created_at ON posts(created_at);
CREATE INDEX idx_posts_user_published ON posts(user_id, published);
```

Always add indexes in separate migrations for safety.

### Modifying Columns (Workaround)

SQLite doesn't support ALTER COLUMN, so use table recreation:

```sql
-- migrations/0006_modify_user_email.sql

-- 1. Create new table with desired schema
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  bio TEXT,
  verified INTEGER DEFAULT 0 NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Copy data
INSERT INTO users_new (id, email, name, bio, verified, created_at, updated_at)
SELECT id, email, name, bio, verified, created_at, updated_at
FROM users;

-- 3. Drop old table
DROP TABLE users;

-- 4. Rename new table
ALTER TABLE users_new RENAME TO users;

-- 5. Recreate indexes
CREATE INDEX idx_users_email ON users(email);

-- 6. Recreate triggers
CREATE TRIGGER users_updated_at 
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
```

**⚠️ Important:** This approach temporarily disables foreign key constraints during the operation.

### Dropping Columns

```sql
-- migrations/0007_drop_user_bio.sql

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  -- bio column removed
  verified INTEGER DEFAULT 0 NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, email, name, verified, created_at)
SELECT id, email, name, verified, created_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Recreate indexes/triggers as needed
```

### Creating Many-to-Many Relationships

```sql
-- migrations/0008_add_post_tags.sql

-- Tags table
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL
);

-- Junction table
CREATE TABLE post_tags (
  post_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, tag_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Indexes for junction table
CREATE INDEX idx_post_tags_post ON post_tags(post_id);
CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);
```

## Data Migrations

Migrations that modify data, not just schema:

```sql
-- migrations/0009_populate_user_slugs.sql

-- Add slug column
ALTER TABLE users ADD COLUMN slug TEXT;

-- Populate slugs from existing usernames
-- Note: Complex transformations should be done in application code
UPDATE users 
SET slug = LOWER(REPLACE(name, ' ', '-'));

-- Make slug required after populating
-- (requires table recreation for NOT NULL constraint)
```

**Best practice:** For complex data migrations:

1. Add column as nullable
2. Populate via Worker code (more control)
3. Make required in subsequent migration

```typescript
// data-migration.ts - Run once via worker
const { results: users } = await env.DB
  .prepare("SELECT id, name FROM users WHERE slug IS NULL")
  .all<{ id: number; name: string }>();

for (const user of users) {
  const slug = user.name.toLowerCase().replace(/\s+/g, '-');
  await env.DB
    .prepare("UPDATE users SET slug = ? WHERE id = ?")
    .bind(slug, user.id)
    .run();
}
```

## Seed Data

Create seed migrations for initial data:

```sql
-- migrations/0010_seed_categories.sql

INSERT INTO categories (name, slug, description) VALUES
  ('Technology', 'technology', 'Tech news and tutorials'),
  ('Design', 'design', 'Design articles and resources'),
  ('Business', 'business', 'Business and entrepreneurship');

-- Create admin user (for development)
INSERT INTO users (email, name, verified) VALUES
  ('admin@example.com', 'Admin User', 1);
```

**⚠️ Caution:** Seed migrations run every time, so use INSERT OR IGNORE for idempotency:

```sql
INSERT OR IGNORE INTO categories (name, slug) VALUES
  ('Technology', 'technology');
```

## Migration Best Practices

### 1. One Migration per Logical Change

❌ **Bad:**
```sql
-- migrations/0001_everything.sql
CREATE TABLE users (...);
CREATE TABLE posts (...);
CREATE TABLE comments (...);
-- Too much in one migration
```

✅ **Good:**
```sql
-- migrations/0001_create_users.sql
-- migrations/0002_create_posts.sql
-- migrations/0003_create_comments.sql
```

### 2. Test Locally First

```bash
# Always test locally before remote
wrangler d1 migrations apply my-db --local

# Test with actual queries
wrangler d1 execute my-db --local --command "SELECT * FROM users"

# Then apply to remote
wrangler d1 migrations apply my-db --remote
```

### 3. Never Edit Applied Migrations

Once a migration is applied (especially to production), never modify it. Create a new migration instead.

❌ **Bad:**
```sql
-- Editing 0001_create_users.sql after it's been applied
```

✅ **Good:**
```sql
-- Create new migration: 0005_fix_users_table.sql
```

### 4. Make Migrations Idempotent (When Possible)

```sql
-- Use IF NOT EXISTS
CREATE TABLE IF NOT EXISTS users (...);

-- Use INSERT OR IGNORE for seed data
INSERT OR IGNORE INTO roles (name) VALUES ('admin');
```

### 5. Add NOT NULL Constraints Carefully

```sql
-- Bad: Cannot add NOT NULL without default
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL;  -- ERROR

-- Good: Add with default, or make nullable
ALTER TABLE users ADD COLUMN bio TEXT DEFAULT '';
-- OR
ALTER TABLE users ADD COLUMN bio TEXT;
```

### 6. Include Rollback Notes

```sql
-- migrations/0011_add_user_roles.sql
-- Rollback: Manually drop `role_id` column and `roles` table

CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id);
```

### 7. Use Descriptive Migration Names

❌ **Bad:**
```
0001_update.sql
0002_fix.sql
0003_change.sql
```

✅ **Good:**
```
0001_create_users_table.sql
0002_add_user_email_index.sql
0003_add_posts_table.sql
```

## Migration Workflows

### Development Workflow

```bash
# 1. Create migration
wrangler d1 migrations create my-db add_feature

# 2. Edit migration file
# 3. Apply locally
wrangler d1 migrations apply my-db --local

# 4. Test queries
wrangler dev

# 5. Commit migration file to version control
git add migrations/
git commit -m "Add feature migration"
```

### Staging/Production Workflow

```bash
# 1. Pull latest migrations
git pull origin main

# 2. Review pending migrations
wrangler d1 migrations list my-db --remote

# 3. Apply migrations
wrangler d1 migrations apply my-db --remote

# 4. Verify with query
wrangler d1 execute my-db --remote --command "SHOW TABLES"
```

### CI/CD Integration

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Apply D1 Migrations
        run: |
          npx wrangler d1 migrations apply my-database --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      
      - name: Deploy Worker
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

## Troubleshooting

### Migration Failed Halfway

D1 migrations run in transactions, so they should roll back on failure. If a migration partially applied:

```bash
# Check migration status
wrangler d1 migrations list my-db --remote

# Manually fix via SQL
wrangler d1 execute my-db --remote --command "DROP TABLE IF EXISTS broken_table"

# Re-run migration
wrangler d1 migrations apply my-db --remote
```

### Foreign Key Violations

```sql
-- Enable foreign keys to debug
PRAGMA foreign_keys = ON;

-- Check for orphaned records
SELECT p.* FROM posts p
LEFT JOIN users u ON p.user_id = u.id
WHERE u.id IS NULL;
```

### Migration Out of Sync

If local and remote migrations diverge:

```bash
# Export remote database
wrangler d1 export my-db --remote --output backup.sql

# Reset local database
rm -rf .wrangler/state/v3/d1

# Apply all migrations locally
wrangler d1 migrations apply my-db --local
```

### Performance After Migration

```sql
-- Analyze tables after schema changes
ANALYZE;

-- Check index usage
EXPLAIN QUERY PLAN SELECT * FROM users WHERE email = 'test@example.com';
```

## Advanced Patterns

### Versioned Schema

```sql
-- migrations/0001_schema_version.sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_version (version) VALUES (1);
```

### Feature Flags via Migrations

```sql
-- migrations/0012_add_feature_flags.sql
CREATE TABLE feature_flags (
  name TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO feature_flags (name, enabled) VALUES
  ('new_ui', 0),
  ('beta_features', 0);
```

### Audit Tables

```sql
-- migrations/0013_add_audit_log.sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
  old_values TEXT, -- JSON
  new_values TEXT, -- JSON
  user_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_table_record ON audit_log(table_name, record_id);
```
