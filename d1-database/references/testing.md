# Testing D1 with Vitest

Use `@cloudflare/vitest-pool-workers` to test Workers that use D1 inside the Workers runtime.

## Setup

### Install Dependencies

```bash
npm i -D vitest@~3.2.0 @cloudflare/vitest-pool-workers
```

### vitest.config.ts

```typescript
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

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

### Directory Structure

```
my-worker/
├── src/
│   └── index.ts
├── migrations/
│   ├── 0001_init.sql
│   └── 0002_add_users.sql
├── test/
│   ├── apply-migrations.ts
│   └── database.spec.ts
├── vitest.config.ts
└── wrangler.jsonc
```

## Applying Migrations

Create a helper to apply migrations in tests:

```typescript
// test/apply-migrations.ts
import { env } from "cloudflare:test";
import { readD1Migrations, applyD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export async function setupDatabase() {
  const migrations = await readD1Migrations("./migrations");
  await applyD1Migrations(env.DB, migrations);
}
```

## Unit Tests (Direct D1 Access)

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { setupDatabase } from "./apply-migrations";

describe("D1 operations", () => {
  beforeAll(async () => {
    await setupDatabase();
  });

  it("inserts and queries data", async () => {
    await env.DB.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
      .bind("Alice", "alice@example.com")
      .run();

    const result = await env.DB.prepare("SELECT * FROM users WHERE name = ?")
      .bind("Alice")
      .first();

    expect(result).toEqual({
      id: expect.any(Number),
      name: "Alice",
      email: "alice@example.com",
    });
  });

  it("updates data", async () => {
    await env.DB.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
      .bind("Bob", "bob@example.com")
      .run();

    await env.DB.prepare("UPDATE users SET email = ? WHERE name = ?")
      .bind("robert@example.com", "Bob")
      .run();

    const result = await env.DB.prepare("SELECT email FROM users WHERE name = ?")
      .bind("Bob")
      .first();

    expect(result!.email).toBe("robert@example.com");
  });

  it("deletes data", async () => {
    await env.DB.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
      .bind("Charlie", "charlie@example.com")
      .run();

    await env.DB.prepare("DELETE FROM users WHERE name = ?")
      .bind("Charlie")
      .run();

    const result = await env.DB.prepare("SELECT * FROM users WHERE name = ?")
      .bind("Charlie")
      .first();

    expect(result).toBeNull();
  });
});
```

## Testing with Batch Queries

```typescript
describe("D1 batch operations", () => {
  beforeAll(async () => {
    await setupDatabase();
  });

  it("executes batch statements", async () => {
    const statements = [
      env.DB.prepare("INSERT INTO users (name, email) VALUES (?, ?)").bind("User1", "user1@example.com"),
      env.DB.prepare("INSERT INTO users (name, email) VALUES (?, ?)").bind("User2", "user2@example.com"),
      env.DB.prepare("INSERT INTO users (name, email) VALUES (?, ?)").bind("User3", "user3@example.com"),
    ];

    const results = await env.DB.batch(statements);
    expect(results).toHaveLength(3);
    
    const count = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
    expect(count!.count).toBe(3);
  });
});
```

## Integration Tests (via SELF)

```typescript
import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { setupDatabase } from "./apply-migrations";

describe("Worker with D1", () => {
  beforeAll(async () => {
    await setupDatabase();
  });

  it("creates user via API", async () => {
    const response = await SELF.fetch("http://example.com/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com" }),
    });

    expect(response.status).toBe(201);
    const user = await response.json();
    expect(user).toHaveProperty("id");
    expect(user.name).toBe("Alice");
  });

  it("lists users via API", async () => {
    // Seed data
    await env.DB.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
      .bind("Bob", "bob@example.com")
      .run();

    const response = await SELF.fetch("http://example.com/users");
    expect(response.status).toBe(200);
    
    const { users } = await response.json();
    expect(users).toContainEqual(
      expect.objectContaining({ name: "Bob" })
    );
  });

  it("returns 404 for missing user", async () => {
    const response = await SELF.fetch("http://example.com/users/999");
    expect(response.status).toBe(404);
  });
});
```

## Testing Transactions

```typescript
describe("D1 transactions", () => {
  beforeAll(async () => {
    await setupDatabase();
  });

  it("handles transaction success", async () => {
    // Transactions are implicit in batch()
    const statements = [
      env.DB.prepare("INSERT INTO accounts (name, balance) VALUES (?, ?)").bind("From", 100),
      env.DB.prepare("INSERT INTO accounts (name, balance) VALUES (?, ?)").bind("To", 0),
    ];
    await env.DB.batch(statements);

    // Transfer money atomically
    const transfer = [
      env.DB.prepare("UPDATE accounts SET balance = balance - ? WHERE name = ?").bind(50, "From"),
      env.DB.prepare("UPDATE accounts SET balance = balance + ? WHERE name = ?").bind(50, "To"),
    ];
    await env.DB.batch(transfer);

    const from = await env.DB.prepare("SELECT balance FROM accounts WHERE name = ?").bind("From").first();
    const to = await env.DB.prepare("SELECT balance FROM accounts WHERE name = ?").bind("To").first();

    expect(from!.balance).toBe(50);
    expect(to!.balance).toBe(50);
  });
});
```

## Testing Error Handling

```typescript
describe("D1 error handling", () => {
  beforeAll(async () => {
    await setupDatabase();
  });

  it("handles unique constraint violation", async () => {
    await env.DB.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
      .bind("Unique", "unique@example.com")
      .run();

    await expect(
      env.DB.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
        .bind("Unique", "unique@example.com")
        .run()
    ).rejects.toThrow();
  });

  it("handles invalid SQL", async () => {
    await expect(
      env.DB.prepare("INVALID SQL STATEMENT").run()
    ).rejects.toThrow();
  });
});
```

## Test Isolation

Each test gets isolated D1 state:

```typescript
describe("Isolation", () => {
  beforeAll(async () => {
    await setupDatabase();
  });

  it("first test inserts data", async () => {
    await env.DB.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
      .bind("Isolated", "isolated@example.com")
      .run();
    
    const count = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
    expect(count!.count).toBe(1);
  });

  it("second test has empty table", async () => {
    const count = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
    expect(count!.count).toBe(0);
  });
});
```

## Using Mock D1 (Unit Tests)

For fast unit tests without full D1:

```bash
npm i -D @variablesoftware/mock-d1
```

```typescript
import { MockD1Database } from "@variablesoftware/mock-d1";
import { describe, it, expect } from "vitest";

describe("With mocked D1", () => {
  it("mocks database responses", async () => {
    const mockDb = new MockD1Database();
    
    // Mock queries and test logic
    const result = await mockDb.prepare("SELECT 1").first();
    expect(result).toBeDefined();
  });
});
```

## Running Tests

```bash
npx vitest        # Watch mode
npx vitest run    # Single run
```

## Persisting Local Data

For development (not tests):

```bash
# Persist D1 data across dev sessions
wrangler dev --persist-to=.wrangler/state
```

## Known Issues

- **Migrations must be applied each test** with isolated storage
- **No fake timer support** for D1 operations
- **Watch mode** may trigger reloads from SQLite file changes - ignore `.wrangler/**`

## Best Practices

1. **Apply migrations in `beforeAll`** for each describe block
2. **Use `isolatedStorage: true`** for test independence
3. **Test constraint violations** and error cases
4. **Use batch operations** for transactional behavior
5. **Seed test data** after migrations
6. **Test pagination** for list endpoints
7. **Use parameterized queries** to prevent SQL injection
8. **Keep migrations small** for faster test setup
