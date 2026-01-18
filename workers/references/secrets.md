# Secrets Management

Complete guide to managing secrets in Cloudflare Workers, including `.dev.vars`, type generation, and Secret Store integration.

## Secrets vs Environment Variables

| Feature | Environment Variables (`vars`) | Secrets |
|---------|-------------------------------|---------|
| **Storage** | Plaintext in wrangler.jsonc | Encrypted, never visible after creation |
| **Visibility** | Visible in dashboard and Wrangler | Hidden in dashboard and Wrangler |
| **Use case** | Non-sensitive config (URLs, flags) | Sensitive data (API keys, tokens, passwords) |
| **Local dev** | Defined in wrangler.jsonc | Defined in `.dev.vars` or `.env` |
| **Access** | Same: `env.VARIABLE_NAME` | Same: `env.SECRET_NAME` |
| **Type generation** | From wrangler.jsonc | From `.dev.vars` (if exists) |

**Critical Rule:** NEVER put sensitive values in wrangler.jsonc. Always use secrets.

## Local Development with .dev.vars

### Basic Setup

Create a `.dev.vars` file in your project root (same directory as wrangler.jsonc):

```bash
# .dev.vars
DATABASE_URL="postgresql://localhost:5432/dev"
API_KEY="dev-key-12345"
STRIPE_SECRET="sk_test_..."
```

**Format:**
- Use dotenv syntax: `KEY="value"`
- Quotes are optional but recommended
- No spaces around `=`
- One secret per line

### Add to .gitignore

```bash
# .gitignore
.dev.vars*
.env*
node_modules/
```

**Never commit secrets to git!**

### Environment-Specific Secrets

Create environment-specific files:

```
.dev.vars              # Default (development)
.dev.vars.staging      # Staging environment
.dev.vars.production   # Production environment
```

When running `wrangler dev --env staging`, it loads `.dev.vars.staging` instead of `.dev.vars`.

**Important:** With `.dev.vars.staging`, the base `.dev.vars` is NOT loaded. All secrets must be defined in the environment-specific file.

### .env vs .dev.vars

You can use `.env` files instead of `.dev.vars`:

```
.env                    # Least specific
.env.production         # More specific
.env.local              # Even more specific
.env.production.local   # Most specific
```

**Differences:**
- `.dev.vars`: Only one file loaded (environment-specific OR base, not both)
- `.env`: Multiple files merged with precedence (most specific wins)
- `.env.local` files: Not committed to git (for local overrides)

**Recommendation:** Use `.dev.vars` for Workers projects (simpler, more explicit).

## Type Generation with wrangler types

### How wrangler types Generates Secret Types

When you run `wrangler types`, it reads `.dev.vars` (or `.env`) to generate TypeScript types:

**`.dev.vars`:**
```bash
DATABASE_URL="postgresql://localhost:5432/dev"
API_KEY="secret123"
STRIPE_SECRET="sk_test_abc"
```

**Generated `worker-configuration.d.ts`:**
```typescript
interface Env {
  DATABASE_URL: string;
  API_KEY: string;
  STRIPE_SECRET: string;
  // ... other bindings from wrangler.jsonc
}
```

### CI/CD Best Practice: Empty .dev.vars

In CI/CD environments, you don't have actual secret values, but you need the types. Create a `.dev.vars` with empty values:

**`.dev.vars` (committed to git):**
```bash
# Secrets (values set in CI/CD or Cloudflare dashboard)
DATABASE_URL=""
API_KEY=""
STRIPE_SECRET=""
```

**Why this works:**
1. `wrangler types` reads `.dev.vars` to generate types
2. Empty values still create the correct TypeScript types
3. CI/CD doesn't need real secrets for type checking
4. Production secrets are set via `wrangler secret put` or dashboard

**CI/CD workflow:**
```bash
# In your CI pipeline
npm install
npx wrangler types  # Generates types from .dev.vars
npm run build       # TypeScript compilation succeeds
npm test            # Tests run with type safety

# Actual secrets are set in Cloudflare (not in CI)
```

### Strict Typing for Secret Values

By default, `wrangler types` types secrets as `string`. For stricter typing:

**`.dev.vars` with specific values:**
```bash
ENVIRONMENT="development"
LOG_LEVEL="debug"
FEATURE_FLAG_NEW_UI="true"
```

**Generated types (with `--strict-vars`):**
```typescript
interface Env {
  ENVIRONMENT: "development";  // Literal type
  LOG_LEVEL: "debug";          // Literal type
  FEATURE_FLAG_NEW_UI: "true"; // Literal type
}
```

For variables that vary across environments, use `--strict-vars false`:

```bash
npx wrangler types --strict-vars false
```

This generates `string` types instead of literal types.

## Production Secrets

### Setting Secrets via Wrangler

Secrets are set per-Worker and encrypted:

```bash
# Add or update a secret (deploys immediately)
npx wrangler secret put DATABASE_URL

# You'll be prompted for the value
Enter a secret value: › ********

# Or pipe from stdin
echo "postgresql://prod:5432/db" | npx wrangler secret put DATABASE_URL

# Delete a secret (deploys immediately)
npx wrangler secret delete DATABASE_URL

# List secret names (values are never shown)
npx wrangler secret list
```

**With gradual deployments:**

```bash
# Create new version without deploying
npx wrangler versions secret put DATABASE_URL

# Deploy the version later
npx wrangler versions deploy
```

### Setting Secrets via Dashboard

1. Go to **Workers & Pages** > Your Worker > **Settings**
2. Under **Variables and Secrets**, click **Add**
3. Select type **Secret**
4. Enter **Variable name** and **Value**
5. Click **Deploy**

**Important:** Once saved, the secret value is never visible again (even to you).

### Secrets in Multiple Environments

If using `wrangler.jsonc` environments:

```jsonc
{
  "name": "my-worker",
  "env": {
    "staging": {
      "name": "my-worker-staging"
    },
    "production": {
      "name": "my-worker-production"
    }
  }
}
```

Set secrets per environment:

```bash
# Staging secrets
npx wrangler secret put API_KEY --env staging

# Production secrets
npx wrangler secret put API_KEY --env production
```

Each environment has its own set of secrets.

## Accessing Secrets in Code

### From Fetch Handler

```typescript
interface Env {
  DATABASE_URL: string;
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Access secrets from env parameter
    const db = new Database(env.DATABASE_URL);
    const data = await db.query("SELECT * FROM users");
    return Response.json(data);
  }
};
```

### From Global env

```typescript
import { env } from "cloudflare:workers";

// Access secrets at module scope
const db = new Database(env.DATABASE_URL);

export default {
  async fetch(request: Request): Promise<Response> {
    const data = await db.query("SELECT * FROM users");
    return Response.json(data);
  }
};
```

**Benefits of global `env`:**
- Initialize clients at module scope
- Use secrets outside request handlers
- Cleaner code for dependencies

### With Node.js Compatibility

If `nodejs_compat` is enabled:

```typescript
interface Env {
  DATABASE_URL: string;
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Both work with nodejs_compat
    const url1 = env.DATABASE_URL;
    const url2 = process.env.DATABASE_URL;
    
    return Response.json({ url1, url2 });
  }
};
```

**Note:** `process.env` only works with `nodejs_compat` flag.

## Secret Store (Account-Level Secrets)

Secret Store provides centralized, account-level secrets that can be shared across multiple Workers.

### When to Use Secret Store

| Use Case | Worker Secrets | Secret Store |
|----------|---------------|--------------|
| Single Worker | ✅ Recommended | ❌ Overkill |
| Multiple Workers, same secret | ❌ Duplicate config | ✅ Recommended |
| Team with strict access control | ⚠️ Per-Worker permissions | ✅ Role-based access |
| Secret rotation | ⚠️ Update each Worker | ✅ Update once |
| Audit logging | ❌ Not available | ✅ Full audit trail |

### Creating Account-Level Secrets

**Via Wrangler:**

```bash
# Create a store (first time only)
npx wrangler secrets-store store create my-store --remote

# List stores
npx wrangler secrets-store store list

# Add a secret to the store
npx wrangler secrets-store secret create <STORE_ID> \
  --name DATABASE_URL \
  --scopes workers \
  --remote

# You'll be prompted for the value
Enter a secret value: › ********

# List secrets in a store
npx wrangler secrets-store secret list <STORE_ID> --remote
```

**Via Dashboard:**

1. Go to **Secrets Store** > **Create secret**
2. Enter **Name** and **Value**
3. Choose **Permission scope**: Workers
4. Click **Save**

### Binding Secret Store to Workers

**wrangler.jsonc:**

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "secrets_store_secrets": [
    {
      "binding": "DATABASE_URL",
      "store_id": "abc123def456",
      "secret_name": "DATABASE_URL"
    },
    {
      "binding": "API_KEY",
      "store_id": "abc123def456",
      "secret_name": "SHARED_API_KEY"
    }
  ]
}
```

**Via Dashboard:**

1. Go to **Workers & Pages** > Your Worker > **Settings** > **Bindings**
2. Click **Add** > **Secrets Store**
3. Enter **Variable name** (binding name)
4. Select **Secret name** from dropdown
5. Click **Deploy**

### Accessing Secret Store Values

Secret Store bindings require an async `get()` call:

```typescript
interface Env {
  DATABASE_URL: {
    get(): Promise<string>;
  };
  API_KEY: {
    get(): Promise<string>;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Must call .get() for Secret Store bindings
    const dbUrl = await env.DATABASE_URL.get();
    const apiKey = await env.API_KEY.get();
    
    const db = new Database(dbUrl);
    const data = await db.query("SELECT * FROM users");
    
    return Response.json(data);
  }
};
```

**Difference:**
- **Worker secret:** `env.SECRET_NAME` (direct access)
- **Secret Store:** `await env.SECRET_NAME.get()` (async call)

### Type Generation for Secret Store

`wrangler types` generates correct types for Secret Store bindings:

```typescript
// Auto-generated
interface Env {
  // Regular Worker secret
  WORKER_SECRET: string;
  
  // Secret Store binding
  STORE_SECRET: {
    get(): Promise<string>;
  };
}
```

### Local Development with Secret Store

Production Secret Store secrets are not accessible locally. Create local secrets:

```bash
# Create local secret (no --remote flag)
npx wrangler secrets-store secret create <STORE_ID> \
  --name DATABASE_URL \
  --scopes workers

# These are only for local development
```

Or use `.dev.vars` with the same binding names:

```bash
# .dev.vars
DATABASE_URL="postgresql://localhost:5432/dev"
```

## Complete Examples

### Basic Worker with Secrets

**`.dev.vars`:**
```bash
DATABASE_URL="postgresql://localhost:5432/dev"
API_KEY="dev-key-123"
```

**`src/index.ts`:**
```typescript
interface Env {
  DATABASE_URL: string;
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Use secrets
    const db = connect(env.DATABASE_URL);
    
    // Verify API key from request
    const requestKey = request.headers.get("x-api-key");
    if (requestKey !== env.API_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    const data = await db.query("SELECT * FROM users");
    return Response.json(data);
  }
};
```

**`wrangler.jsonc`:**
```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-07",
  "vars": {
    "ENVIRONMENT": "production",  // ✅ Non-sensitive
    "API_VERSION": "v1"            // ✅ Non-sensitive
  }
  // ❌ DO NOT put secrets here
}
```

**Set production secrets:**
```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put API_KEY
```

### CI/CD-Ready Setup

**`.dev.vars` (committed):**
```bash
# CI/CD: These generate types but don't contain real values
DATABASE_URL=""
STRIPE_SECRET_KEY=""
OPENAI_API_KEY=""
JWT_SECRET=""
```

**`.dev.vars.local` (not committed, for local dev):**
```bash
# Real local development values
DATABASE_URL="postgresql://localhost:5432/dev"
STRIPE_SECRET_KEY="sk_test_..."
OPENAI_API_KEY="sk-..."
JWT_SECRET="local-dev-secret"
```

**`.gitignore`:**
```
.dev.vars.local
.dev.vars.*
.env*
```

**CI/CD pipeline:**
```yaml
# .github/workflows/deploy.yml
- name: Generate types
  run: npx wrangler types
  
- name: Type check
  run: npm run type-check
  
- name: Deploy
  run: npx wrangler deploy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

**Production secrets are set separately:**
```bash
# One-time setup in production
npx wrangler secret put DATABASE_URL
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put JWT_SECRET
```

### Multi-Environment Setup

**`.dev.vars.staging`:**
```bash
DATABASE_URL="postgresql://staging.example.com:5432/db"
API_KEY="staging-key-456"
```

**`.dev.vars.production`:**
```bash
# Empty values for type generation
DATABASE_URL=""
API_KEY=""
```

**`wrangler.jsonc`:**
```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "env": {
    "staging": {
      "name": "my-worker-staging"
    },
    "production": {
      "name": "my-worker-production"
    }
  }
}
```

**Set secrets per environment:**
```bash
# Staging
npx wrangler secret put DATABASE_URL --env staging
npx wrangler secret put API_KEY --env staging

# Production
npx wrangler secret put DATABASE_URL --env production
npx wrangler secret put API_KEY --env production
```

**Local development:**
```bash
# Use staging secrets
npx wrangler dev --env staging

# Use production secrets (careful!)
npx wrangler dev --env production --remote
```

## Security Best Practices

### 1. Never Commit Secrets

```bash
# .gitignore
.dev.vars*
.env*
!.dev.vars.example
```

Create a `.dev.vars.example` template:

```bash
# .dev.vars.example
DATABASE_URL=""
API_KEY=""
STRIPE_SECRET=""
```

### 2. Use Empty Values in .dev.vars for CI

```bash
# .dev.vars (committed)
# Real values set in Cloudflare dashboard
DATABASE_URL=""
API_KEY=""
```

This allows:
- ✅ Type generation in CI
- ✅ No secrets in version control
- ✅ Developers know which secrets are required
- ✅ Production secrets set via dashboard/CLI

### 3. Rotate Secrets Regularly

```bash
# Generate new secret
NEW_SECRET=$(openssl rand -base64 32)

# Update in Cloudflare
echo $NEW_SECRET | npx wrangler secret put API_KEY

# Update in Secret Store (if used)
npx wrangler secrets-store secret create <STORE_ID> \
  --name API_KEY \
  --scopes workers \
  --remote
```

### 4. Validate Secret Format

```typescript
interface Env {
  DATABASE_URL: string;
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Validate secret format on first use
    if (!env.DATABASE_URL.startsWith("postgresql://")) {
      throw new Error("Invalid DATABASE_URL format");
    }
    
    if (env.API_KEY.length < 32) {
      throw new Error("API_KEY too short");
    }
    
    // Use secrets
    const db = connect(env.DATABASE_URL);
    return Response.json(await db.query("SELECT 1"));
  }
};
```

### 5. Minimize Secret Exposure

```typescript
// ❌ BAD: Logging secrets
console.log("Database URL:", env.DATABASE_URL);

// ❌ BAD: Including in responses
return Response.json({ apiKey: env.API_KEY });

// ✅ GOOD: Only use secrets internally
const client = new APIClient(env.API_KEY);
const result = await client.fetch();
return Response.json(result);
```

### 6. Use Secret Store for Shared Secrets

If multiple Workers need the same secret:

```bash
# ❌ BAD: Set same secret on each Worker
npx wrangler secret put SHARED_KEY --name worker-1
npx wrangler secret put SHARED_KEY --name worker-2
npx wrangler secret put SHARED_KEY --name worker-3

# ✅ GOOD: Use Secret Store
npx wrangler secrets-store secret create <STORE_ID> \
  --name SHARED_KEY \
  --scopes workers \
  --remote

# Bind to each Worker in wrangler.jsonc
```

Benefits:
- Single source of truth
- Rotate once, applies everywhere
- Role-based access control
- Audit trail

## Troubleshooting

### "Secret not found" in production

**Cause:** Secret not set in Cloudflare

**Solution:**
```bash
npx wrangler secret put SECRET_NAME
```

### Types missing for secrets

**Cause:** `.dev.vars` doesn't exist or `wrangler types` not run

**Solution:**
```bash
# Create .dev.vars with empty values
echo 'SECRET_NAME=""' > .dev.vars

# Generate types
npx wrangler types
```

### Local dev can't access production secrets

**Cause:** `.dev.vars` not set up

**Solution:**
```bash
# Create .dev.vars.local (not committed)
echo 'SECRET_NAME="local-dev-value"' > .dev.vars.local
```

Or use `--remote` (careful with production data):
```bash
npx wrangler dev --remote
```

### Secret Store binding returns undefined

**Cause:** Forgot to call `.get()`

**Solution:**
```typescript
// ❌ Wrong
const value = env.STORE_SECRET;

// ✅ Correct
const value = await env.STORE_SECRET.get();
```

### Different secret values in different Workers

**Cause:** Secrets are per-Worker by default

**Solution:** Use Secret Store for shared secrets across Workers

## Summary

| Aspect | Recommendation |
|--------|----------------|
| **Local dev** | Use `.dev.vars` with real values (not committed) |
| **CI/CD** | Use `.dev.vars` with empty values (committed) |
| **Type generation** | Run `npx wrangler types` after changing `.dev.vars` |
| **Production** | Use `npx wrangler secret put` or dashboard |
| **Shared secrets** | Use Secret Store for multiple Workers |
| **Configuration** | Use `vars` in wrangler.jsonc for non-sensitive values only |
| **Version control** | NEVER commit `.dev.vars` with real values |

**Key Principle:** Secrets are encrypted, invisible, and NEVER in wrangler.jsonc. Environment variables are plaintext and fine in wrangler.jsonc.
