# Handler Patterns

Detailed guide to implementing Workers handlers, routing, and middleware patterns.

## Handler Types

Cloudflare Workers supports three main handler types that can be exported from your Worker:

### 1. HTTP Handler (fetch)

The most common handler, processes HTTP requests.

**Signature:**
```typescript
async fetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response>
```

**Parameters:**
- `request`: Incoming HTTP request with headers, method, body, etc.
- `env`: Environment bindings (KV, D1, R2, secrets, etc.)
- `ctx`: Execution context with `waitUntil()` and `passThroughOnException()`

**Example:**
```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Background task that doesn't block response
    ctx.waitUntil(logRequest(request, env));
    
    return new Response(`Path: ${url.pathname}`);
  }
};
```

### 2. Scheduled Handler (cron)

Executes on a schedule defined in wrangler.jsonc.

**Signature:**
```typescript
async scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void>
```

**ScheduledEvent properties:**
- `scheduledTime`: Timestamp in milliseconds when the event was scheduled
- `cron`: The cron pattern that triggered this event

**Example:**
```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`Cron triggered at: ${new Date(event.scheduledTime).toISOString()}`);
    console.log(`Pattern: ${event.cron}`);
    
    ctx.waitUntil(performMaintenance(env));
  }
};
```

**Configuration:**
```jsonc
{
  "triggers": {
    "crons": [
      "*/15 * * * *",  // Every 15 minutes
      "0 0 * * *"      // Daily at midnight
    ]
  }
}
```

### 3. Queue Consumer Handler

Processes messages from Cloudflare Queues.

**Signature:**
```typescript
async queue(
  batch: MessageBatch<T>,
  env: Env,
  ctx: ExecutionContext
): Promise<void>
```

**MessageBatch properties:**
- `queue`: Name of the queue
- `messages`: Array of Message<T> objects

**Message<T> properties:**
- `id`: Unique message ID
- `timestamp`: When message was sent
- `body`: Message payload (type T)
- `ack()`: Acknowledge successful processing
- `retry()`: Retry message later

**Example:**
```typescript
type TaskMessage = {
  taskId: string;
  userId: string;
  action: string;
};

export default {
  async queue(batch: MessageBatch<TaskMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processTask(message.body, env);
        message.ack();
      } catch (error) {
        console.error(`Failed to process ${message.id}:`, error);
        message.retry();
      }
    }
  }
};
```

## Routing Patterns

### Basic Path Routing

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    switch (url.pathname) {
      case "/":
        return new Response("Home");
      
      case "/api/users":
        return handleUsers(request, env);
      
      case "/api/posts":
        return handlePosts(request, env);
      
      default:
        return new Response("Not found", { status: 404 });
    }
  }
};
```

### Method-Based Routing

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === "/api/data") {
      switch (request.method) {
        case "GET":
          return getData(env);
        
        case "POST":
          return saveData(request, env);
        
        case "PUT":
          return updateData(request, env);
        
        case "DELETE":
          return deleteData(request, env);
        
        default:
          return new Response("Method not allowed", { status: 405 });
      }
    }
    
    return new Response("Not found", { status: 404 });
  }
};
```

### Pattern Matching with RegEx

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Match /users/:id
    const userMatch = path.match(/^\/users\/([^/]+)$/);
    if (userMatch) {
      const userId = userMatch[1];
      return getUser(userId, env);
    }
    
    // Match /posts/:postId/comments/:commentId
    const commentMatch = path.match(/^\/posts\/([^/]+)\/comments\/([^/]+)$/);
    if (commentMatch) {
      const [, postId, commentId] = commentMatch;
      return getComment(postId, commentId, env);
    }
    
    return new Response("Not found", { status: 404 });
  }
};
```

### Router Helper

```typescript
type RouteHandler = (request: Request, env: Env, params: Record<string, string>) => Promise<Response>;

class Router {
  private routes: Array<{ pattern: RegExp; handler: RouteHandler; methods: string[] }> = [];
  
  add(method: string | string[], pattern: string, handler: RouteHandler): void {
    const methods = Array.isArray(method) ? method : [method];
    const regexPattern = pattern.replace(/:[^/]+/g, "([^/]+)");
    this.routes.push({
      pattern: new RegExp(`^${regexPattern}$`),
      handler,
      methods
    });
  }
  
  async handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    for (const route of this.routes) {
      const match = path.match(route.pattern);
      if (match && route.methods.includes(request.method)) {
        const params: Record<string, string> = {};
        // Extract params if needed
        return route.handler(request, env, params);
      }
    }
    
    return new Response("Not found", { status: 404 });
  }
}

// Usage
const router = new Router();

router.add("GET", "/api/users/:id", async (req, env, params) => {
  return Response.json({ userId: params.id });
});

router.add(["POST", "PUT"], "/api/users", async (req, env) => {
  const body = await req.json();
  return Response.json({ success: true });
});

export default {
  fetch: (req: Request, env: Env) => router.handle(req, env)
};
```

## Middleware Patterns

### Middleware Chain

```typescript
type Middleware = (
  request: Request,
  env: Env,
  next: () => Promise<Response>
) => Promise<Response>;

function createMiddlewareChain(...middlewares: Middleware[]) {
  return async (request: Request, env: Env, handler: () => Promise<Response>): Promise<Response> => {
    let index = 0;
    
    const next = async (): Promise<Response> => {
      if (index < middlewares.length) {
        const middleware = middlewares[index++];
        return middleware(request, env, next);
      }
      return handler();
    };
    
    return next();
  };
}

// Middleware examples
const loggingMiddleware: Middleware = async (request, env, next) => {
  console.log(`${request.method} ${request.url}`);
  const start = Date.now();
  const response = await next();
  console.log(`Response: ${response.status} (${Date.now() - start}ms)`);
  return response;
};

const authMiddleware: Middleware = async (request, env, next) => {
  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== env.API_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return next();
};

const corsMiddleware: Middleware = async (request, env, next) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }
  
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  
  return new Response(response.body, {
    status: response.status,
    headers
  });
};

// Usage
const middleware = createMiddlewareChain(
  loggingMiddleware,
  corsMiddleware,
  authMiddleware
);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return middleware(request, env, async () => {
      return Response.json({ message: "Success" });
    });
  }
};
```

## Request Handling

### Reading Request Body

```typescript
// JSON
async function handleJSON(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    return Response.json({ received: body });
  } catch (error) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
}

// Text
async function handleText(request: Request): Promise<Response> {
  const text = await request.text();
  return new Response(`Received: ${text}`);
}

// Form data
async function handleForm(request: Request): Promise<Response> {
  const formData = await request.formData();
  const name = formData.get("name");
  return Response.json({ name });
}

// Binary data
async function handleBinary(request: Request): Promise<Response> {
  const buffer = await request.arrayBuffer();
  return Response.json({ size: buffer.byteLength });
}
```

### Query Parameters

```typescript
function handleQuery(request: Request): Response {
  const url = new URL(request.url);
  
  // Get single parameter
  const page = url.searchParams.get("page") || "1";
  
  // Get all values for a parameter
  const tags = url.searchParams.getAll("tag");
  
  // Check if parameter exists
  const hasFilter = url.searchParams.has("filter");
  
  // Iterate all parameters
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    params[key] = value;
  }
  
  return Response.json({ page, tags, hasFilter, params });
}
```

### Request Headers

```typescript
function handleHeaders(request: Request): Response {
  // Get specific header
  const contentType = request.headers.get("content-type");
  const userAgent = request.headers.get("user-agent");
  
  // Cloudflare-specific headers
  const ip = request.headers.get("cf-connecting-ip");
  const country = request.headers.get("cf-ipcountry");
  const ray = request.headers.get("cf-ray");
  
  // Check header existence
  const hasAuth = request.headers.has("authorization");
  
  return Response.json({
    contentType,
    userAgent,
    ip,
    country,
    ray,
    hasAuth
  });
}
```

## Response Patterns

### JSON Responses

```typescript
// Simple JSON
Response.json({ success: true });

// With status code
Response.json({ error: "Not found" }, { status: 404 });

// With headers
Response.json({ data: [] }, {
  status: 200,
  headers: {
    "Cache-Control": "max-age=3600",
    "X-Custom-Header": "value"
  }
});
```

### HTML Responses

```typescript
function htmlResponse(content: string): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/html;charset=UTF-8"
    }
  });
}

// Usage
htmlResponse(`
  <!DOCTYPE html>
  <html>
    <head><title>Hello</title></head>
    <body><h1>Hello World</h1></body>
  </html>
`);
```

### Redirects

```typescript
// Temporary redirect (302)
function redirect(url: string): Response {
  return Response.redirect(url, 302);
}

// Permanent redirect (301)
function permanentRedirect(url: string): Response {
  return Response.redirect(url, 301);
}
```

### Streaming Responses

```typescript
async function streamResponse(): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  
  // Write data in background
  (async () => {
    try {
      for (let i = 0; i < 100; i++) {
        await writer.write(encoder.encode(`Line ${i}\n`));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      await writer.close();
    }
  })();
  
  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain",
      "Transfer-Encoding": "chunked"
    }
  });
}
```

## ExecutionContext Methods

### waitUntil()

Extends the lifetime of the request for background tasks:

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Fast response
    const response = Response.json({ status: "accepted" });
    
    // Background tasks (don't block response)
    ctx.waitUntil(logAnalytics(request, env));
    ctx.waitUntil(updateCache(env));
    ctx.waitUntil(sendNotification(env));
    
    return response;
  }
};

async function logAnalytics(request: Request, env: Env): Promise<void> {
  // This runs after response is sent
  await env.ANALYTICS.writeDataPoint({
    blobs: [request.url],
    doubles: [Date.now()]
  });
}
```

### passThroughOnException()

Passes request to origin on unhandled exceptions:

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // If any error occurs, forward to origin
    ctx.passThroughOnException();
    
    // Try to handle request
    return handleRequest(request, env);
  }
};
```

## Best Practices

1. **Always handle OPTIONS for CORS**: Respond to preflight requests
2. **Validate request method**: Return 405 for unsupported methods
3. **Use URL for routing**: `new URL(request.url)` provides clean pathname
4. **Type your handlers**: Define types for request bodies and responses
5. **Use waitUntil for analytics**: Don't block responses with logging
6. **Implement middleware pattern**: Reusable request/response processing
7. **Return appropriate status codes**: 200, 400, 401, 404, 500, etc.
8. **Clone requests/responses if needed**: They can only be read once
9. **Handle errors at handler level**: Wrap fetch in try/catch
10. **Use ctx.passThroughOnException() carefully**: Only when you have an origin to fall back to
