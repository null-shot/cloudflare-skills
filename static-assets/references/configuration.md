# Static Assets Configuration Reference

Complete guide to configuring static assets in `wrangler.jsonc`.

## Assets Configuration Object

```jsonc
{
  "assets": {
    "directory": "./public/",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "html_handling": "auto-trailing-slash",
    "serve_directly": true
  }
}
```

## Configuration Options

### directory

**Type:** `string`  
**Required:** Yes  
**Default:** None

Path to the directory containing static files to serve. Relative to `wrangler.jsonc`.

```jsonc
{
  "assets": {
    "directory": "./public/"
  }
}
```

**Common patterns:**
- `"./public/"` - Standard public directory
- `"./dist/"` - Vite/Webpack build output
- `"./build/"` - Create React App output
- `"./out/"` - Next.js static export

### binding

**Type:** `string`  
**Required:** No  
**Default:** `"ASSETS"`

Name of the binding to access assets from your Worker code.

```jsonc
{
  "assets": {
    "directory": "./public/",
    "binding": "STATIC_FILES"
  }
}
```

```typescript
interface Env {
  STATIC_FILES: Fetcher; // Matches binding name
}

export default {
  fetch(request, env) {
    return env.STATIC_FILES.fetch(request);
  },
};
```

### not_found_handling

**Type:** `"none" | "single-page-application" | "404-page"`  
**Required:** No  
**Default:** `"none"`

How to handle requests for files that don't exist.

#### "none" (Default)

Returns standard 404 response for missing files:

```jsonc
{
  "assets": {
    "directory": "./public/",
    "not_found_handling": "none"
  }
}
```

**Behavior:**
- `/missing.html` → 404 Not Found
- `/nonexistent/` → 404 Not Found

**Use when:** Serving static files without client-side routing.

#### "single-page-application"

Routes all 404s to `/index.html` for client-side routing:

```jsonc
{
  "assets": {
    "directory": "./public/",
    "not_found_handling": "single-page-application"
  }
}
```

**Behavior:**
- `/` → `/index.html`
- `/about` → `/index.html` (if /about.html doesn't exist)
- `/user/profile` → `/index.html`
- `/styles.css` → serves actual file if exists, otherwise `/index.html`

**Use when:** Building React, Vue, Angular apps with client-side routing.

#### "404-page"

Serves `/404.html` for missing files:

```jsonc
{
  "assets": {
    "directory": "./public/",
    "not_found_handling": "404-page"
  }
}
```

**Behavior:**
- `/missing.html` → serves `/404.html` with 404 status
- Requires `public/404.html` to exist

**Use when:** You want a custom 404 page but don't need SPA routing.

### html_handling

**Type:** `"auto-trailing-slash" | "force-trailing-slash" | "drop-trailing-slash" | "none"`  
**Required:** No  
**Default:** `"auto-trailing-slash"`

Controls how HTML files are served and trailing slashes are handled.

#### "auto-trailing-slash" (Default)

Automatically adds or removes trailing slashes as needed:

```jsonc
{
  "assets": {
    "directory": "./public/",
    "html_handling": "auto-trailing-slash"
  }
}
```

**Behavior:**
- `/about` → serves `/about.html` or `/about/index.html`
- `/about/` → serves `/about/index.html` or `/about.html`
- Both work, redirects to canonical version

#### "force-trailing-slash"

All directory requests must have trailing slash:

```jsonc
{
  "assets": {
    "directory": "./public/",
    "html_handling": "force-trailing-slash"
  }
}
```

**Behavior:**
- `/about` → 301 redirect to `/about/`
- `/about/` → serves `/about/index.html`

#### "drop-trailing-slash"

No trailing slashes allowed:

```jsonc
{
  "assets": {
    "directory": "./public/",
    "html_handling": "drop-trailing-slash"
  }
}
```

**Behavior:**
- `/about/` → 301 redirect to `/about`
- `/about` → serves `/about.html`

#### "none"

No automatic HTML handling:

```jsonc
{
  "assets": {
    "directory": "./public/",
    "html_handling": "none"
  }
}
```

**Behavior:**
- `/about.html` → serves file
- `/about` → 404 (unless exact file exists)

### serve_directly

**Type:** `boolean`  
**Required:** No  
**Default:** `true`

Whether to serve assets directly without executing Worker code for static files.

```jsonc
{
  "assets": {
    "directory": "./public/",
    "serve_directly": false
  }
}
```

**When `true` (default):**
- Static files bypass Worker execution
- Faster response times for assets
- Worker only runs for routes not matching static files

**When `false`:**
- All requests go through Worker
- Allows custom logic before serving assets
- Slightly slower but more flexible

**Use `false` when:**
- Need authentication checks for all files
- Want to modify responses for all assets
- Need custom logging for every request

## Complete Configuration Examples

### Static Site (No Worker)

```jsonc
{
  "name": "my-static-site",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/"
  }
}
```

### SPA (React, Vue, Angular)

```jsonc
{
  "name": "my-spa",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./dist/",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  }
}
```

### Hybrid Worker + SPA

```jsonc
{
  "name": "my-app",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "serve_directly": false
  },
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  }
}
```

### Marketing Site with Custom 404

```jsonc
{
  "name": "marketing-site",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/",
    "not_found_handling": "404-page",
    "html_handling": "auto-trailing-slash"
  }
}
```

## Env Interface for TypeScript

Always define the ASSETS binding in your Env interface:

```typescript
interface Env {
  ASSETS: Fetcher;
  
  // Other bindings
  DB?: D1Database;
  KV?: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // env.ASSETS is typed correctly
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

## ASSETS Fetcher Methods

The ASSETS binding implements the `Fetcher` interface:

```typescript
interface Fetcher {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}
```

### Basic Usage

```typescript
// Pass through original request
env.ASSETS.fetch(request)

// Create new request for specific file
env.ASSETS.fetch(new Request("https://example.com/index.html"))

// Modify request before serving
const modifiedRequest = new Request(request.url, {
  method: request.method,
  headers: new Headers(request.headers),
});
modifiedRequest.headers.set("X-Custom-Header", "value");
env.ASSETS.fetch(modifiedRequest)
```

### Handling Responses

```typescript
const response = await env.ASSETS.fetch(request);

// Check status
if (response.status === 404) {
  return new Response("Custom 404 page", { status: 404 });
}

// Modify headers
const newResponse = new Response(response.body, response);
newResponse.headers.set("Cache-Control", "max-age=3600");
return newResponse;

// Clone for multiple uses
const response1 = await env.ASSETS.fetch(request);
const response2 = response1.clone();
```

## Combining with Other Bindings

```jsonc
{
  "name": "full-stack-app",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  },
  "kv_namespaces": [
    { "binding": "CACHE", "id": "abc123" }
  ],
  "d1_databases": [
    { "binding": "DB", "database_name": "prod-db", "database_id": "xyz789" }
  ],
  "r2_buckets": [
    { "binding": "UPLOADS", "bucket_name": "user-uploads" }
  ],
  "ai": {
    "binding": "AI"
  },
  "observability": {
    "enabled": true
  }
}
```

```typescript
interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
  DB: D1Database;
  UPLOADS: R2Bucket;
  AI: Ai;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // API routes use all bindings
    if (url.pathname.startsWith("/api/")) {
      // Use KV, D1, R2, AI...
      return handleAPI(request, env);
    }
    
    // Static assets
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

## Troubleshooting

### Assets not serving

**Problem:** 404 for all static files

**Solution:** Verify `directory` path is correct relative to `wrangler.jsonc`:

```bash
# Check directory exists
ls public/

# Verify wrangler.jsonc path
cat wrangler.jsonc | grep directory
```

### SPA routing not working

**Problem:** 404 on client-side routes

**Solution:** Enable SPA mode:

```jsonc
{
  "assets": {
    "not_found_handling": "single-page-application"
  }
}
```

### Worker not executing

**Problem:** Worker code not running for any requests

**Solution:** Set `serve_directly: false`:

```jsonc
{
  "assets": {
    "serve_directly": false
  }
}
```

### TypeScript errors with ASSETS

**Problem:** `Property 'ASSETS' does not exist on type 'Env'`

**Solution:** Add to Env interface:

```typescript
interface Env {
  ASSETS: Fetcher;
}
```

### Cache not updating

**Problem:** Old files still serving after update

**Solution:** Use immutable cache for hashed files only:

```typescript
if (url.pathname.match(/\.[a-f0-9]{8}\.(js|css)$/)) {
  response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
} else {
  response.headers.set("Cache-Control", "public, max-age=3600");
}
```

## Performance Optimization

### 1. Enable Direct Serving

```jsonc
{
  "assets": {
    "serve_directly": true  // Default, fastest
  }
}
```

### 2. Set Long Cache Headers

```typescript
if (url.pathname.match(/\.(js|css|woff2|png|jpg)$/)) {
  const response = await env.ASSETS.fetch(request);
  const newResponse = new Response(response.body, response);
  newResponse.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return newResponse;
}
```

### 3. Use Compression

Cloudflare automatically compresses assets, but ensure files are optimized:

```bash
# Minify JavaScript
npx terser input.js -o output.js

# Optimize images
npx imagemin public/*.jpg --out-dir=public/
```

### 4. Minimize Worker Execution

```typescript
// Fast path for static assets
if (!url.pathname.startsWith("/api/")) {
  return env.ASSETS.fetch(request);
}

// Only run Worker logic for API routes
return handleAPI(request, env);
```
