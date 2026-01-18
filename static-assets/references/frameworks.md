# Framework Integration Reference

How to configure popular frontend frameworks to work with Cloudflare Static Assets.

## Quick Reference

| Framework | Build Output | SPA Mode | Config File |
|-----------|--------------|----------|-------------|
| Vite (React/Vue/Svelte) | `dist/` | Yes | `vite.config.ts` |
| Create React App | `build/` | Yes | `package.json` |
| Next.js | `out/` | Yes (static export) | `next.config.js` |
| Remix | `public/build/` | No (SSR) | `remix.config.js` |
| Astro | `dist/` | Optional | `astro.config.mjs` |
| SvelteKit | `build/` | Optional | `svelte.config.js` |
| Angular | `dist/` | Yes | `angular.json` |
| Vue CLI | `dist/` | Yes | `vue.config.js` |

---

## Vite (React, Vue, Svelte)

### Configuration

**vite.config.ts:**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'public',
    emptyOutDir: true,
  }
})
```

**wrangler.jsonc:**

```jsonc
{
  "name": "vite-app",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/",
    "not_found_handling": "single-page-application"
  }
}
```

### Build and Deploy

```bash
# Build
npm run build

# Deploy
wrangler deploy
```

### With Worker API

**src/worker/index.ts:**

```typescript
interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname.startsWith("/api/")) {
      const users = await env.DB.prepare("SELECT * FROM users").all();
      return Response.json(users.results);
    }
    
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

**wrangler.jsonc:**

```jsonc
{
  "name": "vite-fullstack",
  "main": "src/worker/index.ts",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/",
    "not_found_handling": "single-page-application"
  }
}
```

---

## Create React App (CRA)

### Configuration

**package.json:** (no changes needed)

**wrangler.jsonc:**

```jsonc
{
  "name": "cra-app",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./build/",
    "not_found_handling": "single-page-application"
  }
}
```

### Build and Deploy

```bash
# Build
npm run build

# Deploy
wrangler deploy
```

### Environment Variables

Create React App uses `REACT_APP_` prefix:

**.env.production:**

```bash
REACT_APP_API_URL=https://your-worker.workers.dev
```

**src/App.tsx:**

```typescript
const apiUrl = process.env.REACT_APP_API_URL;

fetch(`${apiUrl}/api/users`)
  .then(res => res.json())
  .then(data => console.log(data));
```

---

## Next.js (Static Export)

### Configuration

**next.config.js:**

```javascript
/** @type {import('next').NextConfig} */
module.exports = {
  output: 'export',
  distDir: 'public',
  trailingSlash: true,
  images: {
    unoptimized: true, // Required for static export
  },
}
```

**wrangler.jsonc:**

```jsonc
{
  "name": "nextjs-static",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/",
    "not_found_handling": "single-page-application"
  }
}
```

### Build and Deploy

```bash
# Build static export
npm run build

# Deploy
wrangler deploy
```

### Limitations

Static export does NOT support:
- Server-side rendering (SSR)
- API routes (`pages/api/*`)
- Image optimization
- Incremental static regeneration (ISR)

**Solution:** Use Worker for API routes:

**src/worker.ts:**

```typescript
interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // API routes in Worker
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ message: "Hello from Worker" });
    }
    
    // Next.js static export
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

**wrangler.jsonc:**

```jsonc
{
  "name": "nextjs-hybrid",
  "main": "src/worker.ts",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/"
  }
}
```

---

## Remix

### Configuration

**remix.config.js:**

```javascript
/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
  ignoredRouteFiles: ["**/.*"],
  assetsBuildDirectory: "public/build",
  publicPath: "/build/",
  serverBuildPath: "build/index.js",
}
```

**wrangler.jsonc:**

```jsonc
{
  "name": "remix-app",
  "main": "./build/index.js",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/",
    "binding": "ASSETS"
  }
}
```

### Build and Deploy

```bash
# Build
npm run build

# Deploy
wrangler deploy
```

**Note:** Remix uses server-side rendering by default. The Worker runs Remix's server code, and assets are static files (CSS, images).

---

## Astro

### Configuration

**astro.config.mjs:**

```javascript
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  outDir: './public',
  build: {
    assets: '_assets'
  }
});
```

**wrangler.jsonc:**

```jsonc
{
  "name": "astro-app",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/"
  }
}
```

### Build and Deploy

```bash
# Build
npm run build

# Deploy
wrangler deploy
```

### With Cloudflare Adapter

For SSR support, use the Cloudflare adapter:

```bash
npm install @astrojs/cloudflare
```

**astro.config.mjs:**

```javascript
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare()
});
```

---

## SvelteKit

### Configuration

**svelte.config.js:**

```javascript
import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter()
  }
};

export default config;
```

**wrangler.jsonc:**

```jsonc
{
  "name": "sveltekit-app",
  "main": "./.svelte-kit/cloudflare/index.js",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./.svelte-kit/cloudflare/",
    "binding": "ASSETS"
  }
}
```

### Build and Deploy

```bash
# Install adapter
npm install -D @sveltejs/adapter-cloudflare

# Build
npm run build

# Deploy
wrangler deploy
```

---

## Angular

### Configuration

**angular.json:**

```json
{
  "projects": {
    "my-app": {
      "architect": {
        "build": {
          "options": {
            "outputPath": "public"
          }
        }
      }
    }
  }
}
```

**wrangler.jsonc:**

```jsonc
{
  "name": "angular-app",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/",
    "not_found_handling": "single-page-application"
  }
}
```

### Build and Deploy

```bash
# Build
ng build --configuration production

# Deploy
wrangler deploy
```

---

## Vue CLI

### Configuration

**vue.config.js:**

```javascript
module.exports = {
  outputDir: 'public',
  publicPath: '/',
}
```

**wrangler.jsonc:**

```jsonc
{
  "name": "vue-app",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/",
    "not_found_handling": "single-page-application"
  }
}
```

### Build and Deploy

```bash
# Build
npm run build

# Deploy
wrangler deploy
```

---

## Static Site Generators

### Hugo

```bash
# Build
hugo --destination public

# Deploy
wrangler deploy
```

**wrangler.jsonc:**

```jsonc
{
  "name": "hugo-site",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/"
  }
}
```

### Jekyll

```bash
# Build
jekyll build --destination public

# Deploy
wrangler deploy
```

**wrangler.jsonc:**

```jsonc
{
  "name": "jekyll-site",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/"
  }
}
```

### Eleventy (11ty)

**.eleventy.js:**

```javascript
module.exports = function(eleventyConfig) {
  return {
    dir: {
      output: "public"
    }
  };
};
```

**wrangler.jsonc:**

```jsonc
{
  "name": "eleventy-site",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/"
  }
}
```

---

## Common Patterns

### API Proxy

Route frontend API calls to Worker:

**Frontend (React/Vue/etc):**

```typescript
// Use relative URL - same origin
fetch('/api/users')
  .then(res => res.json())
  .then(users => console.log(users));
```

**Worker:**

```typescript
interface Env {
  ASSETS: Fetcher;
  API_KEY: string;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname.startsWith("/api/")) {
      // Proxy to external API
      const apiUrl = `https://external-api.com${url.pathname}`;
      return fetch(apiUrl, {
        headers: {
          "Authorization": `Bearer ${env.API_KEY}`
        }
      });
    }
    
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

### Environment Variables

Pass build-time config to frontend:

**.env.production:**

```bash
VITE_API_URL=https://api.example.com
VITE_ENV=production
```

**src/config.ts:**

```typescript
export const config = {
  apiUrl: import.meta.env.VITE_API_URL,
  environment: import.meta.env.VITE_ENV,
}
```

**Worker provides runtime config:**

```typescript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === "/api/config") {
      return Response.json({
        apiUrl: env.API_URL,
        features: env.FEATURE_FLAGS,
      });
    }
    
    return env.ASSETS.fetch(request);
  },
};
```

### Build Pipeline

**package.json:**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "wrangler dev",
    "deploy": "npm run build && wrangler deploy"
  }
}
```

### Monorepo Structure

```
my-app/
├── packages/
│   ├── frontend/          # Vite/React app
│   │   ├── src/
│   │   └── vite.config.ts
│   └── worker/            # Worker code
│       └── src/
│           └── index.ts
├── public/                # Build output
├── wrangler.jsonc
└── package.json
```

**wrangler.jsonc:**

```jsonc
{
  "name": "monorepo-app",
  "main": "packages/worker/src/index.ts",
  "compatibility_date": "2024-01-01",
  "assets": {
    "directory": "./public/",
    "not_found_handling": "single-page-application"
  }
}
```

---

## Troubleshooting

### Framework shows 404 on client routes

**Problem:** React Router, Vue Router routes return 404

**Solution:** Enable SPA mode in `wrangler.jsonc`:

```jsonc
{
  "assets": {
    "not_found_handling": "single-page-application"
  }
}
```

### Assets not updating after build

**Problem:** Old files still being served

**Solution:** Clear build directory before building:

```json
{
  "scripts": {
    "prebuild": "rm -rf public",
    "build": "vite build"
  }
}
```

### Import errors with Worker code

**Problem:** Frontend code importing Worker types

**Solution:** Separate tsconfig for Worker:

**tsconfig.worker.json:**

```json
{
  "extends": "./tsconfig.json",
  "include": ["src/worker/**/*"],
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"]
  }
}
```

### Base path issues

**Problem:** Assets loading from wrong path

**Solution:** Configure framework base path:

**vite.config.ts:**

```typescript
export default defineConfig({
  base: '/', // Ensure root path
})
```

### CORS errors with API routes

**Problem:** CORS errors when calling Worker API

**Solution:** Add CORS headers in Worker:

```typescript
function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(request)
      });
    }
    
    const response = await handleRequest(request, env);
    Object.entries(corsHeaders(request)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  },
};
```
