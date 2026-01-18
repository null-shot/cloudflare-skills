# Browser Rendering Patterns

Advanced patterns and techniques for Cloudflare Browser Rendering.

> **Note:** Examples in this guide primarily use Puppeteer, but the patterns also apply to Playwright and the REST API. Where patterns differ between methods, specific examples are provided.

## REST API Patterns

The REST API provides simple endpoints for common tasks without requiring Workers Bindings setup.

### Screenshot Endpoint

```bash
curl -X POST \
  https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/screenshot \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "fullPage": true,
    "type": "png",
    "viewport": {
      "width": 1920,
      "height": 1080
    }
  }' \
  --output screenshot.png
```

### PDF Generation Endpoint

```bash
curl -X POST \
  https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/pdf \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "format": "A4",
    "printBackground": true
  }' \
  --output document.pdf
```

### Markdown Extraction Endpoint

AI-powered extraction of clean markdown from web pages:

```bash
curl -X POST \
  https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/markdown \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### Structured Data Extraction (AI)

Extract structured data using AI:

```bash
curl -X POST \
  https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/json \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/products",
    "schema": {
      "products": {
        "name": "string",
        "price": "number",
        "inStock": "boolean"
      }
    }
  }'
```

### REST API with Worker Integration

Call REST API from a Worker to add caching or custom logic:

```typescript
interface Env {
  BROWSER_RENDERING_TOKEN: string;
  ACCOUNT_ID: string;
  SCREENSHOTS: R2Bucket;
}

export default {
  async fetch(request, env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    
    if (!url) {
      return new Response("Missing ?url parameter", { status: 400 });
    }

    // Check cache
    const cacheKey = `screenshot-${btoa(url)}.png`;
    const cached = await env.SCREENSHOTS.get(cacheKey);
    if (cached) {
      return new Response(await cached.arrayBuffer(), {
        headers: { "Content-Type": "image/png", "X-Cache": "HIT" },
      });
    }

    // Call REST API
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/browser-rendering/screenshot`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.BROWSER_RENDERING_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          fullPage: true,
          type: "png",
        }),
      }
    );

    if (!response.ok) {
      return new Response("Screenshot failed", { status: 500 });
    }

    const screenshot = await response.arrayBuffer();
    
    // Cache for future requests
    await env.SCREENSHOTS.put(cacheKey, screenshot);

    return new Response(screenshot, {
      headers: {
        "Content-Type": "image/png",
        "X-Cache": "MISS",
        "X-Browser-Ms-Used": response.headers.get("X-Browser-Ms-Used") || "unknown",
      },
    });
  },
} satisfies ExportedHandler<Env>;
```

---

## Caching Strategies

### Cache Screenshots in R2

Store generated screenshots in R2 to avoid regenerating them:

```typescript
import puppeteer from "@cloudflare/puppeteer";

interface Env {
  BROWSER_RENDERING: Fetcher;
  SCREENSHOTS: R2Bucket;
}

export default {
  async fetch(request, env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    
    if (!url) {
      return new Response("Missing ?url parameter", { status: 400 });
    }

    // Create cache key
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    const cacheKey = `screenshot-${hash}.png`;

    // Check cache first
    const cached = await env.SCREENSHOTS.get(cacheKey);
    if (cached) {
      return new Response(await cached.arrayBuffer(), {
        headers: { 
          "Content-Type": "image/png",
          "X-Cache": "HIT",
        },
      });
    }

    // Generate screenshot
    const browser = await puppeteer.launch(env.BROWSER_RENDERING);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: "networkidle0" });
      
      const screenshot = await page.screenshot({
        type: "png",
        fullPage: true,
      });

      // Cache for future requests
      await env.SCREENSHOTS.put(cacheKey, screenshot, {
        httpMetadata: { contentType: "image/png" },
      });

      return new Response(screenshot, {
        headers: { 
          "Content-Type": "image/png",
          "X-Cache": "MISS",
        },
      });
    } finally {
      await browser.close();
    }
  },
} satisfies ExportedHandler<Env>;
```

### Cache with KV for Quick Lookups

Use KV for metadata and small results:

```typescript
interface Env {
  BROWSER_RENDERING: Fetcher;
  CACHE: KVNamespace;
}

// Cache page metadata
const cacheKey = `metadata:${url}`;
const cached = await env.CACHE.get(cacheKey, "json");

if (cached) {
  return Response.json(cached);
}

// Scrape and cache
const metadata = await scrapePage(url, env);
await env.CACHE.put(cacheKey, JSON.stringify(metadata), {
  expirationTtl: 3600, // 1 hour
});

return Response.json(metadata);
```

---

## Rate Limiting

### Per-Domain Rate Limiting with Durable Objects

```typescript
import puppeteer from "@cloudflare/puppeteer";
import { DurableObject } from "cloudflare:workers";

export class RateLimiter extends DurableObject {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const domain = url.searchParams.get("domain");
    
    if (!domain) {
      return Response.json({ allowed: false }, { status: 400 });
    }

    const count = await this.ctx.storage.get<number>(`count:${domain}`) || 0;
    
    if (count >= 10) {
      return Response.json({ 
        allowed: false,
        message: "Rate limit exceeded",
      });
    }

    await this.ctx.storage.put(`count:${domain}`, count + 1, {
      expirationTtl: 60, // Reset after 1 minute
    });

    return Response.json({ allowed: true, remaining: 10 - count - 1 });
  }
}

interface Env {
  BROWSER_RENDERING: Fetcher;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
}

export default {
  async fetch(request, env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");
    
    if (!targetUrl) {
      return new Response("Missing ?url parameter", { status: 400 });
    }

    const domain = new URL(targetUrl).hostname;
    
    // Check rate limit
    const limiterId = env.RATE_LIMITER.idFromName(domain);
    const limiter = env.RATE_LIMITER.get(limiterId);
    const rateLimitResponse = await limiter.fetch(
      `https://internal/?domain=${domain}`
    );
    const { allowed } = await rateLimitResponse.json();
    
    if (!allowed) {
      return new Response("Rate limit exceeded", { status: 429 });
    }

    // Proceed with scraping
    const browser = await puppeteer.launch(env.BROWSER_RENDERING);
    try {
      const page = await browser.newPage();
      await page.goto(targetUrl);
      const text = await page.$eval("body", el => el.textContent);
      
      return Response.json({ text });
    } finally {
      await browser.close();
    }
  },
} satisfies ExportedHandler<Env>;
```

---

## Authentication Patterns

### Bearer Token Authentication

```typescript
const browser = await puppeteer.launch(env.BROWSER_RENDERING);
try {
  const page = await browser.newPage();
  
  await page.setExtraHTTPHeaders({
    "Authorization": `Bearer ${env.API_TOKEN}`,
  });
  
  await page.goto(url);
  const content = await page.content();
  
  return Response.json({ content });
} finally {
  await browser.close();
}
```

### Cookie-Based Authentication

```typescript
const browser = await puppeteer.launch(env.BROWSER_RENDERING);
try {
  const page = await browser.newPage();
  
  // Set authentication cookies
  await page.setCookie({
    name: "session_id",
    value: sessionToken,
    domain: new URL(url).hostname,
    httpOnly: true,
    secure: true,
  });
  
  await page.goto(url);
  const content = await page.content();
  
  return Response.json({ content });
} finally {
  await browser.close();
}
```

### Form-Based Login

```typescript
const browser = await puppeteer.launch(env.BROWSER_RENDERING);
try {
  const page = await browser.newPage();
  
  // Navigate to login page
  await page.goto("https://example.com/login");
  
  // Fill in credentials
  await page.type("#username", env.USERNAME);
  await page.type("#password", env.PASSWORD);
  
  // Submit form
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click("button[type=submit]"),
  ]);
  
  // Now navigate to target page
  await page.goto(targetUrl);
  const content = await page.content();
  
  return Response.json({ content });
} finally {
  await browser.close();
}
```

---

## Multi-Page Scraping

### Sequential Page Navigation

```typescript
const browser = await puppeteer.launch(env.BROWSER_RENDERING);
try {
  const page = await browser.newPage();
  const results = [];
  
  for (const url of urls) {
    await page.goto(url);
    const data = await page.evaluate(() => ({
      title: document.title,
      content: document.body.textContent,
    }));
    results.push(data);
  }
  
  return Response.json({ results });
} finally {
  await browser.close();
}
```

### Pagination Handling

```typescript
const browser = await puppeteer.launch(env.BROWSER_RENDERING);
try {
  const page = await browser.newPage();
  await page.goto(startUrl);
  
  const allItems = [];
  let hasNextPage = true;
  
  while (hasNextPage) {
    // Extract items from current page
    const items = await page.$$eval(".item", elements => 
      elements.map(el => ({
        title: el.querySelector("h3")?.textContent,
        link: el.querySelector("a")?.href,
      }))
    );
    allItems.push(...items);
    
    // Check for next page button
    const nextButton = await page.$(".next-page");
    if (nextButton) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0" }),
        nextButton.click(),
      ]);
    } else {
      hasNextPage = false;
    }
  }
  
  return Response.json({ items: allItems });
} finally {
  await browser.close();
}
```

---

## SEO and Metadata Extraction

### Complete SEO Analysis

```typescript
const browser = await puppeteer.launch(env.BROWSER_RENDERING);
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle0" });
  
  const seoData = await page.evaluate(() => {
    const getMeta = (name: string) => {
      const meta = document.querySelector(
        `meta[name="${name}"], meta[property="${name}"]`
      );
      return meta?.getAttribute("content") || null;
    };
    
    return {
      title: document.title,
      description: getMeta("description"),
      keywords: getMeta("keywords"),
      ogTitle: getMeta("og:title"),
      ogDescription: getMeta("og:description"),
      ogImage: getMeta("og:image"),
      ogUrl: getMeta("og:url"),
      twitterCard: getMeta("twitter:card"),
      canonical: document.querySelector("link[rel=canonical]")?.href,
      h1: Array.from(document.querySelectorAll("h1")).map(h => h.textContent),
      images: Array.from(document.querySelectorAll("img")).map(img => ({
        src: img.src,
        alt: img.alt,
      })),
      links: {
        internal: [],
        external: [],
      },
    };
  });
  
  return Response.json(seoData);
} finally {
  await browser.close();
}
```

### Structured Data Extraction

```typescript
const structuredData = await page.evaluate(() => {
  const scripts = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]')
  );
  
  return scripts.map(script => {
    try {
      return JSON.parse(script.textContent || "");
    } catch {
      return null;
    }
  }).filter(Boolean);
});

return Response.json({ structuredData });
```

---

## Performance Monitoring

### Track Page Load Metrics

```typescript
const browser = await puppeteer.launch(env.BROWSER_RENDERING);
try {
  const page = await browser.newPage();
  
  const startTime = Date.now();
  await page.goto(url, { waitUntil: "networkidle0" });
  const loadTime = Date.now() - startTime;
  
  const metrics = await page.evaluate(() => {
    const perf = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return {
      domContentLoaded: perf.domContentLoadedEventEnd - perf.fetchStart,
      loadComplete: perf.loadEventEnd - perf.fetchStart,
      firstPaint: performance.getEntriesByType("paint")
        .find(p => p.name === "first-paint")?.startTime,
      firstContentfulPaint: performance.getEntriesByType("paint")
        .find(p => p.name === "first-contentful-paint")?.startTime,
    };
  });
  
  return Response.json({
    totalTime: loadTime,
    ...metrics,
  });
} finally {
  await browser.close();
}
```

---

## Error Handling Patterns

### Comprehensive Error Handling

```typescript
interface Env {
  BROWSER_RENDERING: Fetcher;
}

async function safeScrape(url: string, env: Env) {
  let browser;
  
  try {
    // Validate URL
    let normalizedUrl;
    try {
      normalizedUrl = new URL(url).toString();
    } catch {
      return {
        success: false,
        error: "Invalid URL format",
      };
    }
    
    // Launch browser
    browser = await puppeteer.launch(env.BROWSER_RENDERING);
    const page = await browser.newPage();
    
    // Set timeout
    page.setDefaultTimeout(30000);
    
    // Navigate with error handling
    try {
      await page.goto(normalizedUrl, { 
        waitUntil: "networkidle0",
        timeout: 30000,
      });
    } catch (error) {
      if (error.name === "TimeoutError") {
        return {
          success: false,
          error: "Page load timeout",
        };
      }
      
      if (error.message.includes("net::ERR")) {
        return {
          success: false,
          error: "Network error",
        };
      }
      
      throw error;
    }
    
    // Extract content
    const content = await page.evaluate(() => ({
      title: document.title,
      text: document.body.textContent,
    }));
    
    return {
      success: true,
      data: content,
    };
    
  } catch (error) {
    console.error("Scraping error:", error);
    return {
      success: false,
      error: "Internal scraping error",
    };
    
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    
    if (!url) {
      return Response.json(
        { error: "Missing ?url parameter" },
        { status: 400 }
      );
    }
    
    const result = await safeScrape(url, env);
    
    if (!result.success) {
      return Response.json(
        { error: result.error },
        { status: 500 }
      );
    }
    
    return Response.json(result.data);
  },
} satisfies ExportedHandler<Env>;
```

---

## Integration Patterns

### Screenshot Service with R2 and KV

Complete service combining KV metadata and R2 storage:

```typescript
import puppeteer from "@cloudflare/puppeteer";

interface Env {
  BROWSER_RENDERING: Fetcher;
  SCREENSHOTS: R2Bucket;
  METADATA: KVNamespace;
}

interface ScreenshotMetadata {
  url: string;
  timestamp: number;
  size: number;
  width: number;
  height: number;
}

export default {
  async fetch(request, env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    const refresh = searchParams.has("refresh");
    
    if (!url) {
      return new Response("Missing ?url parameter", { status: 400 });
    }

    // Generate cache key
    const hash = await generateHash(url);
    const metadataKey = `meta:${hash}`;
    const screenshotKey = `screenshot-${hash}.png`;
    
    // Check cache unless refresh requested
    if (!refresh) {
      const metadata = await env.METADATA.get<ScreenshotMetadata>(
        metadataKey,
        "json"
      );
      
      if (metadata) {
        const screenshot = await env.SCREENSHOTS.get(screenshotKey);
        if (screenshot) {
          return new Response(await screenshot.arrayBuffer(), {
            headers: {
              "Content-Type": "image/png",
              "X-Cache": "HIT",
              "X-Timestamp": metadata.timestamp.toString(),
            },
          });
        }
      }
    }

    // Generate new screenshot
    const browser = await puppeteer.launch(env.BROWSER_RENDERING);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: "networkidle0" });
      
      const screenshot = await page.screenshot({
        type: "png",
        fullPage: true,
      });

      // Store in R2
      await env.SCREENSHOTS.put(screenshotKey, screenshot, {
        httpMetadata: { contentType: "image/png" },
      });

      // Store metadata in KV
      const metadata: ScreenshotMetadata = {
        url,
        timestamp: Date.now(),
        size: screenshot.byteLength,
        width: 1920,
        height: 1080,
      };
      
      await env.METADATA.put(metadataKey, JSON.stringify(metadata), {
        expirationTtl: 86400, // 24 hours
      });

      return new Response(screenshot, {
        headers: {
          "Content-Type": "image/png",
          "X-Cache": "MISS",
          "X-Timestamp": metadata.timestamp.toString(),
        },
      });
    } finally {
      await browser.close();
    }
  },
} satisfies ExportedHandler<Env>;

async function generateHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
```

### Queue-Based Scraping

Use Queues to handle large scraping jobs:

```typescript
import puppeteer from "@cloudflare/puppeteer";

interface ScrapeMessage {
  url: string;
  jobId: string;
}

interface Env {
  BROWSER_RENDERING: Fetcher;
  SCRAPE_QUEUE: Queue<ScrapeMessage>;
  RESULTS: KVNamespace;
}

// Producer: Add URLs to queue
export default {
  async fetch(request, env): Promise<Response> {
    const { urls } = await request.json() as { urls: string[] };
    const jobId = crypto.randomUUID();
    
    // Send all URLs to queue
    await env.SCRAPE_QUEUE.sendBatch(
      urls.map(url => ({ body: { url, jobId } }))
    );
    
    return Response.json({ 
      jobId,
      queued: urls.length,
    });
  },

  // Consumer: Process queue messages
  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      const { url, jobId } = message.body;
      
      const browser = await puppeteer.launch(env.BROWSER_RENDERING);
      try {
        const page = await browser.newPage();
        await page.goto(url, { timeout: 30000 });
        
        const data = await page.evaluate(() => ({
          title: document.title,
          text: document.body.textContent,
        }));
        
        // Store result
        await env.RESULTS.put(`${jobId}:${url}`, JSON.stringify(data));
        
        message.ack();
      } catch (error) {
        console.error(`Failed to scrape ${url}:`, error);
        message.retry();
      } finally {
        await browser.close();
      }
    }
  },
} satisfies ExportedHandler<Env>;
```

---

## Best Practices Summary

1. **Always close browsers** - Use try/finally to ensure cleanup
2. **Cache aggressively** - Store results in R2 or KV
3. **Set timeouts** - Prevent hanging requests
4. **Validate inputs** - Normalize URLs before navigation
5. **Handle errors gracefully** - Catch and classify different error types
6. **Rate limit by domain** - Use Durable Objects for distributed limiting
7. **Monitor performance** - Track metrics and costs
8. **Respect robots.txt** - Check site policies
9. **Use appropriate waitUntil** - Balance speed vs completeness
10. **Test locally** - Use wrangler dev before deploying
