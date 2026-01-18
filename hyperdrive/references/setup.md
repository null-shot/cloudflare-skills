# Hyperdrive Setup Guide

Complete guide to creating and configuring Hyperdrive for database connectivity.

## Creating a Hyperdrive Configuration

### PostgreSQL

```bash
# Basic PostgreSQL config
npx wrangler hyperdrive create my-postgres \
  --connection-string="postgres://user:password@hostname:5432/database"

# With custom caching
npx wrangler hyperdrive create my-postgres \
  --connection-string="postgres://user:password@hostname:5432/database" \
  --max-age=60 \
  --caching-disabled=false

# Output:
# Created Hyperdrive config: my-postgres
# ID: abc123def456
# Connection String: postgres://user:password@hostname:5432/database
```

### MySQL

```bash
# Basic MySQL config
npx wrangler hyperdrive create my-mysql \
  --connection-string="mysql://user:password@hostname:3306/database"

# With SSL enforcement
npx wrangler hyperdrive create my-mysql \
  --connection-string="mysql://user:password@hostname:3306/database?ssl=true"
```

## Connection String Format

### PostgreSQL Connection Strings

```
postgres://[user]:[password]@[host]:[port]/[database]?[params]
```

**Common parameters:**
- `sslmode=require` - Enforce SSL/TLS
- `application_name=myapp` - Identify your app in pg_stat_activity
- `connect_timeout=10` - Connection timeout in seconds

**Examples:**

```bash
# Standard connection
postgres://postgres:mypassword@db.example.com:5432/mydb

# With SSL
postgres://postgres:mypassword@db.example.com:5432/mydb?sslmode=require

# With multiple params
postgres://postgres:mypassword@db.example.com:5432/mydb?sslmode=require&connect_timeout=10
```

### MySQL Connection Strings

```
mysql://[user]:[password]@[host]:[port]/[database]?[params]
```

**Common parameters:**
- `ssl=true` - Enable SSL
- `charset=utf8mb4` - Character set
- `timezone=UTC` - Timezone setting

**Examples:**

```bash
# Standard connection
mysql://root:mypassword@db.example.com:3306/mydb

# With SSL and charset
mysql://root:mypassword@db.example.com:3306/mydb?ssl=true&charset=utf8mb4
```

## Managing Hyperdrive Configs

### List all configurations

```bash
npx wrangler hyperdrive list
```

### Get configuration details

```bash
npx wrangler hyperdrive get <CONFIG_ID>

# Output shows:
# - Connection string (with password redacted)
# - Caching settings
# - Created/updated timestamps
```

### Update a configuration

```bash
# Update password only
npx wrangler hyperdrive update <CONFIG_ID> \
  --origin-password=new_password

# Update connection string
npx wrangler hyperdrive update <CONFIG_ID> \
  --connection-string="postgres://user:new_password@new_host:5432/db"

# Update caching settings
npx wrangler hyperdrive update <CONFIG_ID> \
  --max-age=120 \
  --caching-disabled=false
```

### Delete a configuration

```bash
npx wrangler hyperdrive delete <CONFIG_ID>

# Confirmation prompt appears before deletion
```

## Wrangler Configuration

Add the Hyperdrive binding to `wrangler.jsonc`:

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-15",
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "abc123def456"
    }
  ]
}
```

**Multiple databases:**

```jsonc
{
  "hyperdrive": [
    {
      "binding": "POSTGRES_DB",
      "id": "abc123def456"
    },
    {
      "binding": "MYSQL_DB",
      "id": "xyz789ghi012"
    }
  ]
}
```

## Security Best Practices

### Connection String Security

**❌ Never commit connection strings to git:**

```bash
# BAD - visible in git history
npx wrangler hyperdrive create my-db \
  --connection-string="postgres://user:SECRET_PASSWORD@host:5432/db"
```

**✅ Use environment variables:**

```bash
# GOOD - use env vars
export DB_CONNECTION_STRING="postgres://user:password@host:5432/db"
npx wrangler hyperdrive create my-db \
  --connection-string="$DB_CONNECTION_STRING"
```

### Database User Permissions

Create a dedicated database user for Hyperdrive with minimal permissions:

**PostgreSQL:**

```sql
-- Create read-only user
CREATE USER hyperdrive_user WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE mydb TO hyperdrive_user;
GRANT USAGE ON SCHEMA public TO hyperdrive_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hyperdrive_user;

-- For read-write access
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hyperdrive_user;

-- Auto-grant on new tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hyperdrive_user;
```

**MySQL:**

```sql
-- Create read-only user
CREATE USER 'hyperdrive_user'@'%' IDENTIFIED BY 'secure_password';
GRANT SELECT ON mydb.* TO 'hyperdrive_user'@'%';

-- For read-write access
GRANT SELECT, INSERT, UPDATE, DELETE ON mydb.* TO 'hyperdrive_user'@'%';

FLUSH PRIVILEGES;
```

### Network Security

**Allow Cloudflare IPs:**

Hyperdrive connects from Cloudflare's network. Configure your firewall/security groups to allow connections from Cloudflare IP ranges:

- See: https://www.cloudflare.com/ips/
- Use CIDR notation in security groups
- Update periodically as Cloudflare adds IPs

**Common cloud provider setup:**

**AWS RDS Security Group:**
```
Inbound Rules:
- PostgreSQL (5432) from Cloudflare IP ranges
- MySQL (3306) from Cloudflare IP ranges
```

**Google Cloud SQL:**
```bash
gcloud sql instances patch my-instance \
  --authorized-networks=<CLOUDFLARE_IP_RANGES>
```

**Azure Database:**
```
Firewall Rules:
Add Cloudflare IP ranges to allowed IPs
```

### SSL/TLS Configuration

**Always use SSL in production:**

```bash
# PostgreSQL with SSL
npx wrangler hyperdrive create my-db \
  --connection-string="postgres://user:password@host:5432/db?sslmode=require"

# MySQL with SSL
npx wrangler hyperdrive create my-db \
  --connection-string="mysql://user:password@host:3306/db?ssl=true"
```

**SSL modes for PostgreSQL:**
- `disable` - No SSL (only for local dev)
- `allow` - Try SSL, fall back to non-SSL
- `prefer` - Try SSL first (default)
- `require` - **Require SSL (recommended for production)**
- `verify-ca` - Require SSL and verify CA
- `verify-full` - Require SSL and verify hostname

## Caching Configuration

Hyperdrive automatically caches read queries (SELECT statements) at the edge.

### Cache Settings

```bash
# Enable caching with 60-second TTL (default)
npx wrangler hyperdrive create my-db \
  --connection-string="postgres://..." \
  --caching-disabled=false \
  --max-age=60

# Disable caching (for write-heavy workloads)
npx wrangler hyperdrive create my-db \
  --connection-string="postgres://..." \
  --caching-disabled=true
```

### How Caching Works

**Cached automatically:**
- `SELECT` queries with identical SQL and parameters
- Cached per Cloudflare region
- Invalidated on writes to the same table

**Never cached:**
- `INSERT`, `UPDATE`, `DELETE` statements
- Queries with non-deterministic functions (NOW(), RANDOM())
- Queries within transactions

**Cache TTL:**
- Default: 60 seconds
- Configurable: 1-3600 seconds
- Consider your data freshness requirements

### Cache Invalidation

Hyperdrive automatically invalidates cache entries when:
- A write operation affects the queried table
- The TTL expires
- The connection string changes

**Manual cache control:**
You cannot manually invalidate the cache. Design your queries with appropriate TTL values.

## Local Development

### Option 1: Use --remote flag

Connect through actual Hyperdrive for testing:

```bash
npx wrangler dev --remote
```

### Option 2: Local database connection

Use `.dev.vars` for local development database:

```
# .dev.vars (NOT committed to git)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mydb
DB_USER=postgres
DB_PASSWORD=local_password
```

```typescript
// src/index.ts
import postgres from "postgres";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // Use Hyperdrive in production, direct connection in dev
    const connectionString = env.HYPERDRIVE 
      ? env.HYPERDRIVE.connectionString
      : `postgres://${env.DB_USER}:${env.DB_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`;
    
    const sql = postgres(connectionString);
    // ... rest of your code
  }
};
```

### Option 3: Docker Compose for local PostgreSQL

```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: local_password
      POSTGRES_DB: mydb
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

```bash
# Start local database
docker-compose up -d

# Use in .dev.vars
DB_HOST=localhost
DB_PORT=5432
```

## Monitoring and Observability

Enable observability in `wrangler.jsonc`:

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 0.01
  },
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "abc123def456"
    }
  ]
}
```

**Metrics tracked:**
- Query latency
- Connection pool usage
- Cache hit rates
- Error rates

View metrics in the Cloudflare dashboard under Workers > Your Worker > Metrics.

## Troubleshooting

### Connection refused

**Symptom:** `ECONNREFUSED` or connection timeout errors

**Solutions:**
1. Verify database is publicly accessible or allows Cloudflare IPs
2. Check security groups/firewall rules
3. Ensure correct host and port in connection string
4. Test connection from another machine: `psql "postgres://user:password@host:5432/db"`

### Authentication failed

**Symptom:** `password authentication failed` or `access denied`

**Solutions:**
1. Verify username and password are correct
2. Check database user permissions (`GRANT` statements)
3. Ensure user can connect from any host (`'user'@'%'` in MySQL)
4. Test credentials locally: `psql -h host -U user -d database`

### SSL/TLS errors

**Symptom:** `SSL is required` or `SSL handshake failed`

**Solutions:**
1. Add `?sslmode=require` to PostgreSQL connection string
2. Add `?ssl=true` to MySQL connection string
3. Verify database server has SSL enabled
4. Check if certificate is valid and not self-signed

### Configuration not found

**Symptom:** `Hyperdrive configuration not found`

**Solutions:**
1. Verify the `id` in `wrangler.jsonc` matches output from `wrangler hyperdrive list`
2. Ensure you're deploying to the correct account
3. Check you haven't deleted the configuration

### High latency

**Symptom:** Queries are slower than expected

**Solutions:**
1. Enable caching if workload is read-heavy
2. Increase cache TTL for infrequently changing data
3. Optimize database queries (add indexes)
4. Consider read replicas for geographic distribution
5. Use connection pooling properly (don't call `sql.end()`)

## Migration from Direct Connections

### Before (Direct Connection)

```typescript
// Slow: creates new connection per request
import postgres from "postgres";

const sql = postgres("postgres://user:password@db.example.com:5432/mydb");

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const results = await sql`SELECT * FROM users`;
    return Response.json(results);
  }
};
```

### After (With Hyperdrive)

```typescript
// Fast: connection pooling + edge caching
import postgres from "postgres";

export interface Env {
  HYPERDRIVE: Hyperdrive;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const sql = postgres(env.HYPERDRIVE.connectionString);
    const results = await sql`SELECT * FROM users`;
    return Response.json(results);
  }
} satisfies ExportedHandler<Env>;
```

**Migration steps:**
1. Create Hyperdrive configuration: `npx wrangler hyperdrive create ...`
2. Add binding to `wrangler.jsonc`
3. Replace hardcoded connection string with `env.HYPERDRIVE.connectionString`
4. Remove any `sql.end()` calls
5. Test with `npx wrangler dev --remote`
6. Deploy: `npx wrangler deploy`

**Performance improvements:**
- 10-100x faster connection establishment
- Query caching at the edge for reads
- Reduced load on origin database
