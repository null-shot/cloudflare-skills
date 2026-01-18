# Workers Security Best Practices

Complete security patterns for Cloudflare Workers including request validation, CORS, rate limiting, and input sanitization.

## Request Validation

Always validate incoming requests before processing:

```typescript
function validateRequest(request: Request): Response | null {
  // Validate HTTP method
  const allowedMethods = ["GET", "POST"];
  if (!allowedMethods.includes(request.method)) {
    return new Response("Method not allowed", { status: 405 });
  }
  
  // Validate content type for POST
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      return new Response("Content-Type must be application/json", { status: 415 });
    }
  }
  
  return null; // Validation passed
}
```

## Security Headers

Add security headers to all responses:

```typescript
function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-XSS-Protection", "1; mode=block");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Content-Security-Policy", "default-src 'self'");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
```

## CORS Configuration

Handle CORS for cross-origin requests:

```typescript
function handleCORS(request: Request): Response | null {
  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  
  return null;
}

function addCORSHeaders(response: Response, origin?: string): Response {
  const headers = new Headers(response.headers);
  
  // Restrict to specific origins in production
  const allowedOrigins = ["https://example.com", "https://app.example.com"];
  const requestOrigin = origin || "*";
  
  if (allowedOrigins.includes(requestOrigin) || process.env.ENVIRONMENT === "development") {
    headers.set("Access-Control-Allow-Origin", requestOrigin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  
  return new Response(response.body, {
    status: response.status,
    headers
  });
}
```

## Rate Limiting with KV

Implement rate limiting using Workers KV:

```typescript
async function rateLimit(request: Request, env: Env): Promise<Response | null> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `ratelimit:${ip}`;
  
  const count = await env.MY_KV.get(key);
  const limit = 100; // requests per minute
  
  if (count && parseInt(count) >= limit) {
    return new Response("Rate limit exceeded", { 
      status: 429,
      headers: { 
        "Retry-After": "60",
        "X-RateLimit-Limit": limit.toString(),
        "X-RateLimit-Remaining": "0"
      }
    });
  }
  
  // Increment counter with 60s TTL
  const newCount = count ? parseInt(count) + 1 : 1;
  await env.MY_KV.put(key, newCount.toString(), { expirationTtl: 60 });
  
  return null;
}
```

## Rate Limiting with Durable Objects

For more sophisticated rate limiting with sliding windows:

```typescript
export class RateLimiter {
  state: DurableObjectState;
  
  constructor(state: DurableObjectState) {
    this.state = state;
  }
  
  async fetch(request: Request): Promise<Response> {
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const limit = 100;
    
    // Get request timestamps from storage
    const timestamps = await this.state.storage.get<number[]>("timestamps") || [];
    
    // Remove timestamps outside the window
    const validTimestamps = timestamps.filter(ts => now - ts < windowMs);
    
    if (validTimestamps.length >= limit) {
      return new Response("Rate limit exceeded", { status: 429 });
    }
    
    // Add current timestamp
    validTimestamps.push(now);
    await this.state.storage.put("timestamps", validTimestamps);
    
    return new Response("OK", {
      headers: {
        "X-RateLimit-Limit": limit.toString(),
        "X-RateLimit-Remaining": (limit - validTimestamps.length).toString()
      }
    });
  }
}
```

## Input Sanitization

Sanitize all user inputs:

```typescript
function sanitizeInput(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Input must be a string");
  }
  
  // Remove potentially dangerous characters
  return input
    .replace(/[<>]/g, "") // Remove angle brackets
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .trim()
    .slice(0, 1000); // Limit length
}

function sanitizeHTML(html: string): string {
  // Basic HTML sanitization - use a library for production
  return html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
```

## Authentication Patterns

### Bearer Token Authentication

```typescript
async function authenticateRequest(request: Request, env: Env): Promise<Response | null> {
  const authHeader = request.headers.get("Authorization");
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized", { 
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" }
    });
  }
  
  const token = authHeader.slice(7);
  
  // Validate token (example with KV)
  const userId = await env.AUTH_TOKENS.get(token);
  
  if (!userId) {
    return new Response("Invalid token", { status: 401 });
  }
  
  // Attach user info to request (via context or custom property)
  return null; // Authentication passed
}
```

### API Key Authentication

```typescript
async function validateAPIKey(request: Request, env: Env): Promise<Response | null> {
  const apiKey = request.headers.get("X-API-Key");
  
  if (!apiKey) {
    return new Response("Missing API key", { status: 401 });
  }
  
  // Check against stored keys
  const isValid = await env.API_KEYS.get(apiKey);
  
  if (!isValid) {
    return new Response("Invalid API key", { status: 403 });
  }
  
  return null;
}
```

## Secret Management

Never hardcode secrets in your code:

```typescript
// ❌ BAD: Hardcoded secret
const API_KEY = "sk-1234567890abcdef";

// ✅ GOOD: Use environment bindings
interface Env {
  API_KEY: string;
  DATABASE_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await fetch("https://api.example.com", {
      headers: { "Authorization": `Bearer ${env.API_KEY}` }
    });
    return response;
  }
};
```

**Setting secrets:**

```bash
# Set secret via Wrangler
wrangler secret put API_KEY

# Or in wrangler.jsonc for non-sensitive vars
{
  "vars": {
    "ENVIRONMENT": "production"
  }
}
```

## Content Security Policy

Implement CSP headers for web applications:

```typescript
function addCSPHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.example.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.example.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; ");
  
  headers.set("Content-Security-Policy", csp);
  
  return new Response(response.body, {
    status: response.status,
    headers
  });
}
```

## Request Size Limits

Protect against large payloads:

```typescript
async function validateRequestSize(request: Request): Promise<Response | null> {
  const contentLength = request.headers.get("content-length");
  const maxSize = 10 * 1024 * 1024; // 10 MB
  
  if (contentLength && parseInt(contentLength) > maxSize) {
    return new Response("Request too large", { status: 413 });
  }
  
  return null;
}
```

## SQL Injection Prevention

Always use parameterized queries with D1:

```typescript
// ❌ BAD: String concatenation (SQL injection risk)
const email = request.url.searchParams.get("email");
const query = `SELECT * FROM users WHERE email = '${email}'`;
await env.DB.prepare(query).all();

// ✅ GOOD: Parameterized query
const email = request.url.searchParams.get("email");
await env.DB
  .prepare("SELECT * FROM users WHERE email = ?")
  .bind(email)
  .all();
```

## Complete Security Middleware Example

Combine multiple security patterns:

```typescript
interface Env {
  MY_KV: KVNamespace;
  AUTH_TOKENS: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Handle CORS preflight
    const corsResponse = handleCORS(request);
    if (corsResponse) return corsResponse;
    
    // 2. Validate request
    const validationError = validateRequest(request);
    if (validationError) return validationError;
    
    // 3. Check rate limit
    const rateLimitError = await rateLimit(request, env);
    if (rateLimitError) return rateLimitError;
    
    // 4. Authenticate
    const authError = await authenticateRequest(request, env);
    if (authError) return authError;
    
    // 5. Validate request size
    const sizeError = await validateRequestSize(request);
    if (sizeError) return sizeError;
    
    // 6. Process request
    let response = await handleRequest(request, env);
    
    // 7. Add security headers
    response = addSecurityHeaders(response);
    response = addCORSHeaders(response, request.headers.get("Origin") || undefined);
    
    return response;
  }
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  // Your application logic here
  return Response.json({ message: "Success" });
}
```

## Best Practices Summary

1. **Always validate inputs** - Never trust user data
2. **Use parameterized queries** - Prevent SQL injection
3. **Implement rate limiting** - Protect against abuse
4. **Add security headers** - Defense in depth
5. **Authenticate requests** - Verify identity
6. **Sanitize outputs** - Prevent XSS
7. **Use secrets management** - Never hardcode credentials
8. **Enable HTTPS only** - Workers enforce HTTPS by default
9. **Implement CORS carefully** - Restrict origins in production
10. **Log security events** - Monitor for suspicious activity
