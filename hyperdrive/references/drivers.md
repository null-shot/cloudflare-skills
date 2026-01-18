# Database Drivers and ORMs with Hyperdrive

Detailed integration patterns for popular database drivers and ORMs.

## Supported Drivers

Hyperdrive works with any driver that accepts a standard PostgreSQL or MySQL connection string:

| Driver | Language | PostgreSQL | MySQL | Recommended |
|--------|----------|------------|-------|-------------|
| Postgres.js | TypeScript/JavaScript | ✅ | ❌ | ⭐ Yes |
| node-postgres (pg) | JavaScript | ✅ | ❌ | ✅ Good |
| mysql2 | JavaScript | ❌ | ✅ | ⭐ Yes |
| @planetscale/database | TypeScript | ❌ | ✅ | ✅ Good |
| Drizzle ORM | TypeScript | ✅ | ✅ | ⭐ Yes |
| Prisma | TypeScript | ✅ | ✅ | ⚠️ Requires config |
| Kysely | TypeScript | ✅ | ✅ | ✅ Good |

## Postgres.js (Recommended)

**Version required:** 3.4.5 or later

### Installation

```bash
npm install postgres
```

### Basic Usage

```typescript
import postgres from "postgres";

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const sql = postgres(env.HYPERDRIVE.connectionString);
    
    // Tagged template for parameterized queries
    const users = await sql`SELECT * FROM users WHERE id = ${userId}`;
    
    return Response.json(users);
  }
} satisfies ExportedHandler<Env>;
```

### Advanced Patterns

**Typed queries:**

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

const users = await sql<User[]>`
  SELECT id, name, email 
  FROM users 
  WHERE active = true
`;
```

**Transactions:**

```typescript
const result = await sql.begin(async sql => {
  await sql`INSERT INTO users (name) VALUES ('Alice')`;
  await sql`INSERT INTO accounts (user_id) VALUES (1)`;
  return sql`SELECT * FROM users WHERE name = 'Alice'`;
});
```

**Dynamic queries:**

```typescript
const filters = [
  sql`active = true`,
  userId && sql`user_id = ${userId}`,
  search && sql`name ILIKE ${'%' + search + '%'}`
].filter(Boolean);

const users = await sql`
  SELECT * FROM users 
  WHERE ${sql(filters, ' AND ')}
`;
```

**Why Postgres.js is recommended:**
- Native prepared statements
- Automatic type coercion
- Best performance with Hyperdrive
- Clean tagged template syntax
- Transaction support

## node-postgres (pg)

### Installation

```bash
npm install pg
```

### Basic Usage

```typescript
import { Client } from "pg";

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const client = new Client({
      connectionString: env.HYPERDRIVE.connectionString
    });
    
    await client.connect();
    
    try {
      const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
      return Response.json(result.rows);
    } finally {
      // Important: Don't call client.end() with Hyperdrive
      // But you should call it if you're using Client directly
      // With Hyperdrive, connection pooling is handled for you
    }
  }
} satisfies ExportedHandler<Env>;
```

### Using Pool (Recommended)

```typescript
import { Pool } from "pg";

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const pool = new Pool({
      connectionString: env.HYPERDRIVE.connectionString
    });
    
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      ['user@example.com']
    );
    
    return Response.json(result.rows);
  }
} satisfies ExportedHandler<Env>;
```

### Prepared Statements

```typescript
const result = await client.query({
  text: 'SELECT * FROM users WHERE id = $1 AND active = $2',
  values: [userId, true],
  name: 'fetch-user-by-id' // Caches the prepared statement
});
```

## MySQL Drivers

### mysql2

**Installation:**

```bash
npm install mysql2
```

**Usage:**

```typescript
import mysql from "mysql2/promise";

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const connection = await mysql.createConnection(
      env.HYPERDRIVE.connectionString
    );
    
    const [rows] = await connection.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    
    return Response.json(rows);
  }
} satisfies ExportedHandler<Env>;
```

### @planetscale/database

**Installation:**

```bash
npm install @planetscale/database
```

**Usage:**

```typescript
import { connect } from "@planetscale/database";

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const conn = connect({ url: env.HYPERDRIVE.connectionString });
    
    const results = await conn.execute(
      'SELECT * FROM users WHERE email = ?',
      ['user@example.com']
    );
    
    return Response.json(results.rows);
  }
} satisfies ExportedHandler<Env>;
```

**Using with edge config:**

```typescript
const config = {
  url: env.HYPERDRIVE.connectionString,
  fetch: (url, init) => {
    delete init['cache']; // Remove cache headers for Hyperdrive
    return fetch(url, init);
  }
};

const conn = connect(config);
```

## Drizzle ORM

Drizzle works seamlessly with Hyperdrive using the underlying drivers.

### PostgreSQL with Drizzle

**Installation:**

```bash
npm install drizzle-orm postgres
npm install -D drizzle-kit
```

**Schema definition:**

```typescript
// schema.ts
import { pgTable, serial, text, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow()
});
```

**Usage with Hyperdrive:**

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users } from './schema';
import { eq } from 'drizzle-orm';

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const client = postgres(env.HYPERDRIVE.connectionString);
    const db = drizzle(client);
    
    // Query with type safety
    const allUsers = await db.select().from(users);
    
    // Filtered query
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    // Insert
    await db.insert(users).values({
      name: 'Alice',
      email: 'alice@example.com'
    });
    
    return Response.json(allUsers);
  }
} satisfies ExportedHandler<Env>;
```

### MySQL with Drizzle

**Installation:**

```bash
npm install drizzle-orm mysql2
```

**Usage:**

```typescript
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const connection = await mysql.createConnection(
      env.HYPERDRIVE.connectionString
    );
    const db = drizzle(connection);
    
    const users = await db.select().from(usersTable);
    return Response.json(users);
  }
};
```

## Prisma

Prisma requires special configuration with Hyperdrive to prevent connection pool exhaustion.

### Installation

```bash
npm install @prisma/client
npm install -D prisma
```

### Schema Definition

```prisma
// schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
}
```

### Critical: Connection Limit Configuration

**Always append `?connection_limit=1`** to prevent Prisma from exhausting the connection pool:

```typescript
import { PrismaClient } from '@prisma/client';

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // ⚠️ CRITICAL: Add connection_limit=1
    const prisma = new PrismaClient({
      datasourceUrl: env.HYPERDRIVE.connectionString + '?connection_limit=1'
    });
    
    try {
      const users = await prisma.user.findMany();
      return Response.json(users);
    } finally {
      await prisma.$disconnect();
    }
  }
} satisfies ExportedHandler<Env>;
```

### Optimized Pattern: Reuse Client

Create a single Prisma client per request context:

```typescript
import { PrismaClient } from '@prisma/client';

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

function getPrismaClient(env: Env): PrismaClient {
  return new PrismaClient({
    datasourceUrl: env.HYPERDRIVE.connectionString + '?connection_limit=1'
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const prisma = getPrismaClient(env);
    
    // Register cleanup
    ctx.waitUntil(prisma.$disconnect());
    
    const users = await prisma.user.findMany({
      where: { active: true }
    });
    
    return Response.json(users);
  }
} satisfies ExportedHandler<Env>;
```

### Why connection_limit=1?

Prisma creates a connection pool per client instance. Without limiting connections:
- Each Worker invocation creates new Prisma client
- Each client tries to create multiple connections
- Origin database quickly hits connection limit
- **Adding `?connection_limit=1` forces Prisma to use Hyperdrive's pooling**

## Kysely

Type-safe SQL query builder with excellent TypeScript support.

### Installation

```bash
npm install kysely postgres
```

### Usage

```typescript
import { Kysely, PostgresDialect } from 'kysely';
import postgres from 'postgres';

interface Database {
  users: {
    id: number;
    name: string;
    email: string;
    active: boolean;
  };
}

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: postgres(env.HYPERDRIVE.connectionString)
      })
    });
    
    const users = await db
      .selectFrom('users')
      .selectAll()
      .where('active', '=', true)
      .execute();
    
    return Response.json(users);
  }
} satisfies ExportedHandler<Env>;
```

## Best Practices

### 1. Don't Close Connections

**❌ Wrong:**
```typescript
const sql = postgres(env.HYPERDRIVE.connectionString);
await sql`SELECT * FROM users`;
await sql.end(); // DON'T do this
```

**✅ Correct:**
```typescript
const sql = postgres(env.HYPERDRIVE.connectionString);
await sql`SELECT * FROM users`;
// Let Hyperdrive manage the connection
```

### 2. Use Parameterized Queries

**❌ SQL Injection Risk:**
```typescript
// NEVER do this
const users = await sql`SELECT * FROM users WHERE name = '${userInput}'`;
```

**✅ Safe:**
```typescript
// Always use parameters
const users = await sql`SELECT * FROM users WHERE name = ${userInput}`;
```

### 3. Handle Errors Properly

```typescript
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const sql = postgres(env.HYPERDRIVE.connectionString);
    
    try {
      const users = await sql`SELECT * FROM users`;
      return Response.json(users);
    } catch (error) {
      console.error('Database error:', error);
      
      // Don't expose internal errors to clients
      return Response.json(
        { error: 'Failed to fetch users' },
        { status: 500 }
      );
    }
  }
};
```

### 4. Leverage Hyperdrive Caching

Hyperdrive automatically caches SELECT queries. Design queries to benefit:

```typescript
// This query is cached automatically
const activeUsers = await sql`
  SELECT id, name, email 
  FROM users 
  WHERE active = true
  ORDER BY created_at DESC
`;

// Write operations bypass cache
await sql`UPDATE users SET last_login = NOW() WHERE id = ${userId}`;

// Subsequent reads get updated data (cache invalidated)
const user = await sql`SELECT * FROM users WHERE id = ${userId}`;
```

### 5. Use Appropriate Data Types

```typescript
// Postgres.js automatically converts types
interface User {
  id: number;           // INTEGER
  name: string;         // TEXT
  active: boolean;      // BOOLEAN
  balance: number;      // NUMERIC → number
  metadata: object;     // JSONB → object
  createdAt: Date;      // TIMESTAMP → Date
}

const users = await sql<User[]>`SELECT * FROM users`;
// TypeScript knows users[0].createdAt is a Date
```

## Troubleshooting

### Postgres.js: "Connection terminated unexpectedly"

**Cause:** Database connection was closed improperly or database restarted.

**Solution:**
```typescript
// Postgres.js reconnects automatically - no action needed
// If persistent, check database server logs
```

### node-postgres: "Client has already been connected"

**Cause:** Called `client.connect()` multiple times.

**Solution:**
```typescript
// Use Pool instead of Client
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: env.HYPERDRIVE.connectionString
});

// Pool handles connections automatically
const result = await pool.query('SELECT * FROM users');
```

### Prisma: "Can't reach database server"

**Cause:** Likely missing `connection_limit=1` or incorrect connection string.

**Solution:**
```typescript
// Always add connection_limit=1
const prisma = new PrismaClient({
  datasourceUrl: env.HYPERDRIVE.connectionString + '?connection_limit=1'
});
```

### Drizzle: Type errors with schema

**Cause:** Schema definition doesn't match database schema.

**Solution:**
```bash
# Generate schema from database
npx drizzle-kit introspect:pg

# Or push schema to database
npx drizzle-kit push:pg
```

### MySQL: "Too many connections"

**Cause:** Connection pool exhaustion.

**Solution:**
```typescript
// Create connection pool with limits
const pool = mysql.createPool({
  uri: env.HYPERDRIVE.connectionString,
  connectionLimit: 1 // Let Hyperdrive handle pooling
});
```

## Performance Optimization

### Connection Reuse

**Good:**
```typescript
// Reuse client instance across queries
const sql = postgres(env.HYPERDRIVE.connectionString);

const users = await sql`SELECT * FROM users`;
const posts = await sql`SELECT * FROM posts`;
const comments = await sql`SELECT * FROM comments`;
```

**Also Good (but not necessary with Hyperdrive):**
```typescript
// Hyperdrive pools connections automatically
const client1 = postgres(env.HYPERDRIVE.connectionString);
const client2 = postgres(env.HYPERDRIVE.connectionString);

// Both use the same underlying connection pool
```

### Batch Queries

```typescript
// Instead of multiple round trips
const users = await Promise.all([
  sql`SELECT * FROM users WHERE id = ${id1}`,
  sql`SELECT * FROM users WHERE id = ${id2}`,
  sql`SELECT * FROM users WHERE id = ${id3}`
]);

// Use a single query
const users = await sql`
  SELECT * FROM users 
  WHERE id IN (${sql([id1, id2, id3])})
`;
```

### Prepared Statements

Postgres.js uses prepared statements automatically:

```typescript
// First call: prepare + execute
const user1 = await sql`SELECT * FROM users WHERE id = ${1}`;

// Subsequent calls: reuse prepared statement
const user2 = await sql`SELECT * FROM users WHERE id = ${2}`;
const user3 = await sql`SELECT * FROM users WHERE id = ${3}`;
```

## Testing Locally

### Using a Local Database

```typescript
export interface Env {
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // Use Hyperdrive in production, DATABASE_URL locally
    const connectionString = env.HYPERDRIVE
      ? env.HYPERDRIVE.connectionString
      : env.DATABASE_URL;
    
    if (!connectionString) {
      return Response.json(
        { error: 'No database connection configured' },
        { status: 500 }
      );
    }
    
    const sql = postgres(connectionString);
    const users = await sql`SELECT * FROM users`;
    
    return Response.json(users);
  }
} satisfies ExportedHandler<Env>;
```

**.dev.vars:**
```
DATABASE_URL=postgres://postgres:password@localhost:5432/mydb
```

### Using --remote Flag

Test with actual Hyperdrive:

```bash
npx wrangler dev --remote
```

This connects through Hyperdrive even in development mode.
