# Testing Hyperdrive

Hyperdrive connects Workers to PostgreSQL databases. Testing requires either a **local database** or **remote bindings**.

## Local Development Modes

### `wrangler dev` (Local Mode)

- Uses `localConnectionString` to connect **directly** to your database
- **No Hyperdrive caching/pooling** - direct connection
- Fast for development, simulates DB access

### `wrangler dev --remote`

- Uses real Hyperdrive configuration
- **Includes caching and connection pooling**
- Connects to your deployed Hyperdrive binding

## Setup

### Install Dependencies

```bash
npm i -D vitest@~3.2.0 @cloudflare/vitest-pool-workers
npm i postgres  # or pg for node-postgres
```

### wrangler.jsonc

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "your-hyperdrive-id",
      "localConnectionString": "postgres://user:password@localhost:5432/testdb"
    }
  ]
}
```

### vitest.config.ts

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

## Local Database Setup

### Using Docker

```bash
# Start PostgreSQL container
docker run -d \
  --name test-postgres \
  -e POSTGRES_USER=testuser \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  postgres:16

# Run migrations
psql postgres://testuser:testpass@localhost:5432/testdb -f migrations/001_init.sql
```

### Environment Variable

```bash
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://testuser:testpass@localhost:5432/testdb"
```

## Unit Tests with Local Database

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

describe("Database operations", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    // Connect using Hyperdrive connection string
    sql = postgres(env.HYPERDRIVE.connectionString);
    
    // Setup test table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL
      )
    `;
  });

  afterAll(async () => {
    // Cleanup
    await sql`DROP TABLE IF EXISTS users`;
    await sql.end();
  });

  it("inserts and queries data", async () => {
    await sql`INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')`;
    
    const users = await sql`SELECT * FROM users WHERE name = 'Alice'`;
    
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("alice@example.com");
  });

  it("handles unique constraint violations", async () => {
    await sql`INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')`;
    
    await expect(
      sql`INSERT INTO users (name, email) VALUES ('Bob2', 'bob@example.com')`
    ).rejects.toThrow();
  });
});
```

## Integration Tests (via SELF)

```typescript
import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";

describe("Worker with Hyperdrive", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(env.HYPERDRIVE.connectionString);
    await sql`DELETE FROM users`;
    await sql`INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')`;
  });

  it("lists users via API", async () => {
    const response = await SELF.fetch("http://example.com/users");
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.users).toContainEqual(
      expect.objectContaining({ name: "Test" })
    );
  });

  it("creates user via API", async () => {
    const response = await SELF.fetch("http://example.com/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", email: "new@example.com" }),
    });

    expect(response.status).toBe(201);
    
    // Verify in database
    const users = await sql`SELECT * FROM users WHERE email = 'new@example.com'`;
    expect(users).toHaveLength(1);
  });
});
```

## Testing with postgres.js

```typescript
// src/db.ts
import postgres from "postgres";

export function createClient(connectionString: string) {
  return postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
  });
}

// src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sql = createClient(env.HYPERDRIVE.connectionString);
    
    try {
      const users = await sql`SELECT * FROM users LIMIT 10`;
      return Response.json({ users });
    } finally {
      await sql.end();
    }
  },
};
```

## Testing with node-postgres (pg)

```typescript
import { Client } from "pg";

describe("With node-postgres", () => {
  it("queries database", async () => {
    const client = new Client({
      connectionString: env.HYPERDRIVE.connectionString,
    });
    
    await client.connect();
    
    try {
      const result = await client.query("SELECT NOW()");
      expect(result.rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});
```

## Testing Transactions

```typescript
describe("Transactions", () => {
  it("handles transaction rollback", async () => {
    const sql = postgres(env.HYPERDRIVE.connectionString);
    
    try {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO users (name, email) VALUES ('TxUser', 'tx@example.com')`;
        throw new Error("Intentional rollback");
      });
    } catch {
      // Expected
    }
    
    // User should not exist
    const users = await sql`SELECT * FROM users WHERE email = 'tx@example.com'`;
    expect(users).toHaveLength(0);
    
    await sql.end();
  });
});
```

## Mocking for Unit Tests

For pure unit tests without database:

```typescript
import { vi } from "vitest";

const mockSql = vi.fn();
mockSql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
  const query = strings.join("?");
  
  if (query.includes("SELECT * FROM users")) {
    return Promise.resolve([{ id: 1, name: "Mock User" }]);
  }
  
  return Promise.resolve([]);
});

describe("With mocked SQL", () => {
  it("handles query results", async () => {
    const users = await mockSql`SELECT * FROM users`;
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Mock User");
  });
});
```

## Running Tests

```bash
# Start local database first
docker-compose up -d postgres

# Run tests
npx vitest run
```

## CI/CD Configuration

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: testuser
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: testdb
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
        env:
          CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: postgres://testuser:testpass@localhost:5432/testdb
```

## Known Limitations

- **Local mode bypasses Hyperdrive** - No caching/pooling in tests
- **`--remote` required** for true Hyperdrive behavior
- **TLS configuration** may differ between local and production

## Best Practices

1. **Use local PostgreSQL** for fast test cycles
2. **Run migrations** before tests
3. **Clean up test data** between tests
4. **Test transactions** and error handling
5. **Use environment variables** for connection strings
6. **Test with `--remote`** occasionally for integration
7. **Match PostgreSQL versions** between local and production
8. **Use connection pooling** appropriately in tests
