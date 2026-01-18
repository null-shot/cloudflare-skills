# wrangler.jsonc Configuration

Deep dive into wrangler.jsonc configuration, bindings, compatibility, and deployment settings.

## Basic Configuration

### Minimal Configuration

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-07"
}
```

### Recommended Configuration

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-07",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  }
}
```

## Configuration Fields

### Core Fields

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| `name` | string | Worker name (used in deployment) | Yes |
| `main` | string | Entry point file path | Yes |
| `compatibility_date` | string | Runtime version (YYYY-MM-DD) | Yes |
| `compatibility_flags` | string[] | Feature flags | No |
| `account_id` | string | Cloudflare account ID | No* |
| `workers_dev` | boolean | Deploy to workers.dev subdomain | No |

*`account_id` can be set via environment variable or `wrangler login`

### Observability Configuration

```jsonc
{
  "observability": {
    "enabled": true,           // Enable logging and tracing
    "head_sampling_rate": 1    // Sample rate: 0-1 (1 = 100%)
  }
}
```

**Sampling rates:**
- `1`: Sample all requests (recommended for development)
- `0.1`: Sample 10% of requests
- `0.01`: Sample 1% of requests (production with high traffic)

### Environment Variables

```jsonc
{
  "vars": {
    "ENVIRONMENT": "production",
    "LOG_LEVEL": "info",
    "API_BASE_URL": "https://api.example.com"
  }
}
```

Access in code:
```typescript
interface Env {
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  API_BASE_URL: string;
}

export default {
  fetch(request: Request, env: Env): Response {
    console.log(`Environment: ${env.ENVIRONMENT}`);
    return new Response("OK");
  }
};
```

### Secrets

**CRITICAL: NEVER put secrets in wrangler.jsonc!** Secrets are encrypted and invisible after creation.

**Local Development (.dev.vars):**

Create a `.dev.vars` file (add to `.gitignore`):

```bash
# .dev.vars (NEVER commit with real values)
DATABASE_URL="postgresql://localhost:5432/dev"
API_KEY="dev-key-123"
STRIPE_SECRET="sk_test_..."
```

**CI/CD Best Practice:**

Commit `.dev.vars` with empty values for type generation:

```bash
# .dev.vars (safe to commit)
# Real values set via: wrangler secret put
DATABASE_URL=""
API_KEY=""
STRIPE_SECRET=""
```

This allows:
- `wrangler types` generates correct Env types
- CI/CD runs type checking without real secrets
- Developers know which secrets are required
- Production secrets set separately via CLI or dashboard

**Production Secrets (CLI):**

```bash
# Set a secret (deploys immediately)
npx wrangler secret put API_KEY
# You'll be prompted for value

# List secrets (values never shown)
npx wrangler secret list

# Delete a secret
npx wrangler secret delete API_KEY

# Gradual deployments
npx wrangler versions secret put API_KEY
npx wrangler versions deploy
```

**Access in code (same as env vars):**

```typescript
interface Env {
  DATABASE_URL: string;
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Secrets accessed like regular env vars
    const db = new Database(env.DATABASE_URL);
    return Response.json({ success: true });
  }
};
```

**Type Generation:**

```bash
# Generate types from .dev.vars and wrangler.jsonc
npx wrangler types
```

This reads `.dev.vars` (if it exists) and generates:

```typescript
interface Env {
  // From .dev.vars
  DATABASE_URL: string;
  API_KEY: string;
  STRIPE_SECRET: string;
  
  // From wrangler.jsonc bindings
  MY_KV: KVNamespace;
  // ...
}
```

See [../references/secrets.md](../references/secrets.md) for complete guide.

## Bindings

### Workers KV

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "MY_KV",
      "id": "abc123",
      "preview_id": "xyz789"  // Optional: separate KV for dev
    }
  ]
}
```

TypeScript:
```typescript
interface Env {
  MY_KV: KVNamespace;
}
```

### R2 Buckets

```jsonc
{
  "r2_buckets": [
    {
      "binding": "MY_BUCKET",
      "bucket_name": "my-bucket",
      "preview_bucket_name": "my-bucket-dev"  // Optional
    }
  ]
}
```

TypeScript:
```typescript
interface Env {
  MY_BUCKET: R2Bucket;
}
```

### D1 Database

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-database",
      "database_id": "abc-123-def",
      "migrations_dir": "./migrations"  // Optional
    }
  ]
}
```

TypeScript:
```typescript
interface Env {
  DB: D1Database;
}
```

### Durable Objects

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "COUNTER",
        "class_name": "Counter",
        "script_name": "counter-worker"  // Optional: if DO is in another worker
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["Counter"]  // Required for DO with SQLite
    }
  ]
}
```

TypeScript:
```typescript
interface Env {
  COUNTER: DurableObjectNamespace;
}

export class Counter {
  constructor(private state: DurableObjectState, private env: Env) {}
  
  async fetch(request: Request): Promise<Response> {
    return new Response("OK");
  }
}
```

### Queues

**Producer:**
```jsonc
{
  "queues": {
    "producers": [
      {
        "binding": "MY_QUEUE",
        "queue": "my-queue"
      }
    ]
  }
}
```

**Consumer:**
```jsonc
{
  "queues": {
    "consumers": [
      {
        "queue": "my-queue",
        "max_batch_size": 10,           // Default: 10
        "max_batch_timeout": 5,         // Seconds, default: 5
        "max_retries": 3,               // Default: 3
        "dead_letter_queue": "my-dlq"  // Optional
      }
    ]
  }
}
```

TypeScript:
```typescript
interface Env {
  MY_QUEUE: Queue;
}
```

### Workers AI

```jsonc
{
  "ai": {
    "binding": "AI"
  }
}
```

TypeScript:
```typescript
interface Env {
  AI: Ai;
}
```

### Vectorize

```jsonc
{
  "vectorize": [
    {
      "binding": "VECTORIZE_INDEX",
      "index_name": "my-index"
    }
  ]
}
```

TypeScript:
```typescript
interface Env {
  VECTORIZE_INDEX: VectorizeIndex;
}
```

### Hyperdrive

```jsonc
{
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "abc123def456"
    }
  ]
}
```

TypeScript:
```typescript
interface Env {
  HYPERDRIVE: Hyperdrive;
}
```

### Analytics Engine

```jsonc
{
  "analytics_engine_datasets": [
    {
      "binding": "ANALYTICS",
      "dataset": "my_dataset"
    }
  ]
}
```

TypeScript:
```typescript
interface Env {
  ANALYTICS: AnalyticsEngineDataset;
}
```

### Browser Rendering

```jsonc
{
  "browser": {
    "binding": "BROWSER"
  }
}
```

TypeScript:
```typescript
interface Env {
  BROWSER: Fetcher;
}
```

### Static Assets

```jsonc
{
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"
  }
}
```

Options for `html_handling`:
- `"auto-trailing-slash"`: /about → /about/ → /about/index.html
- `"force-trailing-slash"`: Always redirect to trailing slash
- `"drop-trailing-slash"`: Remove trailing slashes
- `"none"`: No automatic handling

Options for `not_found_handling`:
- `"single-page-application"`: Return /index.html for 404s
- `"404-page"`: Return /404.html for 404s
- `"none"`: Return standard 404

TypeScript:
```typescript
interface Env {
  ASSETS: Fetcher;
}
```

### Service Bindings

Call another Worker from your Worker with zero latency using RPC:

```jsonc
{
  "services": [
    {
      "binding": "AUTH_SERVICE",      // Name in env
      "service": "auth-worker",        // Target Worker name
      "entrypoint": "AuthService",     // Optional: named entrypoint class
      "environment": "production"      // Optional: target environment
    }
  ]
}
```

**RPC Interface (Recommended):**

Service Worker:
```typescript
import { WorkerEntrypoint } from "cloudflare:workers";

export class AuthService extends WorkerEntrypoint {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }
  
  async verifyToken(token: string): Promise<{ valid: boolean }> {
    return { valid: token === "secret" };
  }
}

export default AuthService;
```

Client Worker:
```typescript
interface Env {
  AUTH_SERVICE: Service<typeof AuthService>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Direct RPC method call
    const result = await env.AUTH_SERVICE.verifyToken("token");
    return Response.json(result);
  }
};
```

**HTTP Interface (Fallback):**

```typescript
interface Env {
  AUTH_SERVICE: Fetcher;  // Note: Fetcher for HTTP interface
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Forward request to auth service
    const authResponse = await env.AUTH_SERVICE.fetch(request);
    return authResponse;
  }
};
```

**Named Entrypoints:**

Expose multiple services from one Worker:

```typescript
// auth-worker
export class PublicAuth extends WorkerEntrypoint { /* ... */ }
export class AdminAuth extends WorkerEntrypoint { /* ... */ }
export default PublicAuth;
```

Bind to specific entrypoint:
```jsonc
{
  "services": [
    { "binding": "PUBLIC_AUTH", "service": "auth-worker", "entrypoint": "PublicAuth" },
    { "binding": "ADMIN_AUTH", "service": "auth-worker", "entrypoint": "AdminAuth" }
  ]
}
```

**Generate Types:**

```bash
# Include service binding types
wrangler types -c client.jsonc -c service.jsonc
```

This generates proper `Service<T>` types with all RPC methods.

## Triggers

### HTTP Triggers (Routes)

```jsonc
{
  "routes": [
    {
      "pattern": "example.com/api/*",
      "zone_name": "example.com"
    }
  ]
}
```

Or use route patterns:
```jsonc
{
  "route": "example.com/api/*"
}
```

### Scheduled Triggers (Cron)

```jsonc
{
  "triggers": {
    "crons": [
      "0 0 * * *",        // Daily at midnight UTC
      "*/15 * * * *",     // Every 15 minutes
      "0 */6 * * *",      // Every 6 hours
      "0 9 * * MON-FRI"   // Weekdays at 9 AM
    ]
  }
}
```

## Compatibility

### Compatibility Date

Set to the date when you develop your Worker. This locks the runtime behavior:

```jsonc
{
  "compatibility_date": "2025-03-07"
}
```

**Why this matters:**
- Cloudflare may change default behaviors over time
- Setting a date ensures your Worker keeps working as expected
- You can opt into new features by updating the date

### Compatibility Flags

Enable specific features or behaviors:

```jsonc
{
  "compatibility_flags": [
    "nodejs_compat",           // Node.js APIs (Buffer, process, etc.)
    "streams_enable_constructors",
    "transformstream_enable_standard_constructor"
  ]
}
```

**Common flags:**

| Flag | Description |
|------|-------------|
| `nodejs_compat` | Enable Node.js compatibility (Buffer, crypto, etc.) |
| `streams_enable_constructors` | Enable standard Streams API constructors |
| `transformstream_enable_standard_constructor` | Standard TransformStream constructor |
| `formdata_parser_supports_files` | Support File objects in FormData |

**Recommendation:** Always include `nodejs_compat` unless you have a specific reason not to.

## Build Configuration

### TypeScript / esbuild

```jsonc
{
  "build": {
    "command": "npm run build"
  }
}
```

Wrangler uses esbuild internally. Custom build commands are rarely needed.

### Custom Entry Point

```jsonc
{
  "main": "dist/worker.js"  // Use compiled output
}
```

## Limits and Quotas

```jsonc
{
  "limits": {
    "cpu_ms": 50  // CPU time limit in milliseconds (default: 50ms for free, 30s for paid)
  }
}
```

**Default limits:**

| Resource | Free Plan | Paid Plan |
|----------|-----------|-----------|
| CPU time | 10ms | 50ms (burst), 30s (max) |
| Memory | 128 MB | 128 MB |
| Script size | 1 MB | 10 MB (after compression) |
| Requests/day | 100,000 | Unlimited |

## Environments

Separate configurations for dev, staging, production:

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  
  "env": {
    "staging": {
      "vars": {
        "ENVIRONMENT": "staging"
      },
      "kv_namespaces": [
        { "binding": "MY_KV", "id": "staging-kv-id" }
      ]
    },
    "production": {
      "vars": {
        "ENVIRONMENT": "production"
      },
      "kv_namespaces": [
        { "binding": "MY_KV", "id": "production-kv-id" }
      ],
      "routes": [
        { "pattern": "example.com/*", "zone_name": "example.com" }
      ]
    }
  }
}
```

Deploy to specific environment:
```bash
wrangler deploy --env staging
wrangler deploy --env production
```

## Deployment Settings

### Workers Dev

```jsonc
{
  "workers_dev": true  // Deploy to <name>.<subdomain>.workers.dev
}
```

Disable for production:
```jsonc
{
  "workers_dev": false,
  "routes": [
    { "pattern": "example.com/*", "zone_name": "example.com" }
  ]
}
```

### Minification

```jsonc
{
  "minify": true  // Minify JavaScript (default: false)
}
```

### Source Maps

```jsonc
{
  "upload_source_maps": true  // Upload source maps for better error traces
}
```

## Complete Example

```jsonc
{
  "name": "production-api",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-07",
  "compatibility_flags": ["nodejs_compat"],
  
  "observability": {
    "enabled": true,
    "head_sampling_rate": 0.1
  },
  
  "vars": {
    "ENVIRONMENT": "production",
    "API_VERSION": "v1"
  },
  
  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "abc123"
    }
  ],
  
  "r2_buckets": [
    {
      "binding": "UPLOADS",
      "bucket_name": "user-uploads"
    }
  ],
  
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "production-db",
      "database_id": "def456",
      "migrations_dir": "./migrations"
    }
  ],
  
  "durable_objects": {
    "bindings": [
      {
        "name": "RATE_LIMITER",
        "class_name": "RateLimiter"
      }
    ]
  },
  
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["RateLimiter"]
    }
  ],
  
  "queues": {
    "producers": [
      {
        "binding": "TASK_QUEUE",
        "queue": "background-tasks"
      }
    ]
  },
  
  "ai": {
    "binding": "AI"
  },
  
  "analytics_engine_datasets": [
    {
      "binding": "ANALYTICS",
      "dataset": "user_events"
    }
  ],
  
  "triggers": {
    "crons": ["0 0 * * *"]
  },
  
  "routes": [
    {
      "pattern": "api.example.com/*",
      "zone_name": "example.com"
    }
  ],
  
  "workers_dev": false,
  "minify": true,
  "upload_source_maps": true
}
```

## Wrangler Commands

### Project Management

```bash
# Initialize new project
wrangler init my-worker

# Deploy to development
wrangler deploy

# Deploy to specific environment
wrangler deploy --env production

# Local development
wrangler dev

# Local development with multiple workers
wrangler dev -c wrangler.jsonc -c ../other-worker/wrangler.jsonc

# Tail logs
wrangler tail

# Tail logs for specific environment
wrangler tail --env production
```

### Type Generation

```bash
# Generate TypeScript types from wrangler.jsonc
wrangler types

# Generate to custom path
wrangler types ./types/env.d.ts

# Include runtime types (Wrangler >= 3.66.0)
wrangler types --experimental-include-runtime

# Generate from multiple configs (for service bindings)
wrangler types -c wrangler.jsonc -c ../service/wrangler.jsonc

# Check if types are up-to-date (CI usage)
wrangler types --check

# Custom interface name
wrangler types --env-interface MyEnv

# Skip vars type narrowing
wrangler types --strict-vars false
```

**What `wrangler types` generates:**
- `Env` interface with all bindings (KV, R2, D1, Services, etc.)
- Runtime API types matching your `compatibility_date` and `compatibility_flags`
- Service binding types with full RPC method signatures
- Outputs to `worker-configuration.d.ts` by default

**When to run:**
- After adding/removing bindings
- After changing compatibility settings
- Before deployment (add to CI/CD)
- When types don't match runtime

**Add to tsconfig.json:**
```jsonc
{
  "compilerOptions": {
    "types": [
      "@cloudflare/workers-types",
      "./worker-configuration"
    ]
  }
}
```

### Resource Management

```bash
# Create KV namespace
wrangler kv namespace create MY_KV

# Create D1 database
wrangler d1 create my-database

# Run D1 migrations
wrangler d1 migrations apply DB

# Create R2 bucket
wrangler r2 bucket create my-bucket

# Create Vectorize index
wrangler vectorize create my-index --dimensions=768 --metric=cosine

# Set secret
wrangler secret put API_KEY

# List secrets
wrangler secret list

# Delete secret
wrangler secret delete API_KEY
```

## Best Practices

1. **Run `wrangler types` regularly**: Auto-generate Env interface from config
2. **Always set compatibility_date**: Ensures consistent runtime behavior
3. **Use nodejs_compat flag**: Access to Node.js APIs (Buffer, crypto, etc.)
4. **Enable observability**: Critical for production debugging (enabled: true, head_sampling_rate: 1)
5. **Use Service Bindings for internal APIs**: Zero-latency RPC between Workers
6. **Use environments**: Separate dev, staging, production configurations
7. **Never commit secrets**: Use `wrangler secret put`, not wrangler.jsonc
8. **Use preview bindings**: Separate resources for local development
9. **Set appropriate sampling rates**: 1 for dev, 0.01-0.1 for production
10. **Version your migrations**: Use sequential tags (v1, v2, etc.)
11. **Only bind what you use**: Unused bindings add unnecessary overhead
12. **Use wrangler.jsonc, not .toml**: JSON allows comments, better IDE support
13. **Add wrangler types to CI**: Ensure types stay in sync with config
14. **Use named entrypoints**: Expose only necessary methods via bindings
