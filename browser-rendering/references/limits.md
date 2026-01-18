# Browser Rendering Limits, Quotas, and Pricing

Complete guide to Cloudflare Browser Rendering limits, quotas, pricing, and troubleshooting.

## Quick Reference

| Plan | Daily Limit | Concurrent Browsers | New Browsers/Min | REST API Rate | Browser Timeout |
|------|-------------|---------------------|------------------|---------------|-----------------|
| **Free** | 10 min/day | 3 | 3/min | 6/min | 60 seconds |
| **Paid** | 10 hrs/month included | 30 | 30/min | 180/min | 60 seconds (up to 10 min with keep_alive) |

---

## Workers Free Plan Limits

### Usage Limits

- **Daily browser time**: **10 minutes per day**
- Resets at 00:00 UTC
- No overage pricing available - upgrade to Paid plan for more usage

### Concurrency Limits (Workers Bindings only)

- **Concurrent browsers**: **3 per account**
- **New browser instances**: **3 per minute**
- Does not apply to REST API

### REST API Rate Limits

- **Requests**: **6 per minute**
- Enforced with a fixed per-second fill rate: **1 request per 10 seconds**
- Cannot burst all 6 requests at once - must spread evenly over the minute

### Browser Timeout

- **Default timeout**: **60 seconds** of inactivity
- Browser automatically closes after 60 seconds without DevTools commands
- Cannot be extended on Free plan
- `browser.close()` immediately releases the browser instance

### Quota Exhaustion Behavior

When you exceed the 10-minute daily limit:
- New rendering requests return **429 error**: `"Browser time limit exceeded for today"`
- Wait until next UTC day for quota to reset
- Or upgrade to Paid plan for immediate access

---

## Workers Paid Plan Limits

### Usage Limits

- **Included browser time**: **10 hours per month** at no additional charge
- **Overage pricing**: **$0.09 per hour** beyond included 10 hours
- **Included concurrency**: **10 concurrent browsers** (monthly average) at no additional charge
- **Concurrency overage**: **$2.00 per additional browser** beyond included concurrency

### Concurrency Limits (Workers Bindings only)

- **Concurrent browsers**: **30 per account**
- **New browser instances**: **30 per minute**
- Higher limits available on request with clear use case demonstration

### REST API Rate Limits

- **Requests**: **180 per minute**
- Enforced with a fixed per-second fill rate: **3 requests per second**
- Cannot burst all 180 requests at once - must spread evenly over the minute
- Higher limits available on request

### Browser Timeout

- **Default timeout**: **60 seconds** of inactivity
- **Extended timeout**: Up to **10 minutes** using `keep_alive` option
- `browser.close()` immediately releases the browser instance

### Session Lifetime

- **No fixed maximum** as long as session remains active
- Sessions close automatically when:
  - Inactivity timeout reached (60 seconds or custom `keep_alive` duration)
  - Browser Rendering deploys a new release
  - Explicitly closed with `browser.close()`

---

## Pricing Details

### Browser Hours Calculation

Pricing is based on total browser time used:

1. **Daily tracking**: Browser usage is tracked per day
2. **Monthly billing**: Daily totals are summed for the billing cycle
3. **Rounding**: Rounded to nearest hour
4. **Overage charge**: $0.09 per hour beyond included 10 hours/month

**Example calculation:**
```
Day 1: 30 minutes
Day 2: 45 minutes
Day 3: 20 minutes
...
Monthly total: 15 hours
Included: 10 hours (free)
Overage: 5 hours × $0.09 = $0.45
```

### Concurrent Browser Calculation

Pricing is based on monthly average of daily peak concurrent browsers:

1. **Daily peak**: Track the maximum concurrent browsers each day
2. **Monthly average**: Average all daily peaks across the billing cycle
3. **Included**: 10 concurrent browsers at no charge
4. **Overage charge**: $2.00 per browser beyond included average

**Example calculation:**
```
Day 1 peak: 8 concurrent
Day 2 peak: 15 concurrent
Day 3 peak: 12 concurrent
...
30-day average: 11 concurrent browsers
Included: 10 browsers (free)
Overage: 1 browser × $2.00 = $2.00
```

**Note**: Short spikes are averaged in, so occasional bursts won't dramatically increase costs.

### REST API vs Workers Bindings Pricing

| Method | Browser Hours | Concurrency Pricing |
|--------|---------------|---------------------|
| **REST API** | ✓ Charged | ✗ Not applicable |
| **Workers Bindings** | ✓ Charged | ✓ Charged |

REST API usage only counts browser hours. Concurrency pricing only applies to Workers Bindings.

---

## Monitoring Usage

### Dashboard

View aggregate metrics in the Cloudflare dashboard:
- Go to **Browser Rendering** page
- See total REST API requests
- See total browser hours used
- View session history and close reasons

### REST API Response Headers

Every REST API response includes:
- **`X-Browser-Ms-Used`**: Browser time used for that request (in milliseconds)

**Example:**
```
X-Browser-Ms-Used: 1234
```
This request consumed 1.234 seconds of browser time.

### Workers Bindings Session APIs

Check usage programmatically:

```typescript
// View active sessions
const sessions = await playwright.sessions();
console.log(`Active sessions: ${sessions.length}`);

// View recent history
const history = await playwright.history();
for (const session of history) {
  console.log(`Session ${session.sessionId}:`);
  console.log(`  Duration: ${session.endTime - session.startTime}ms`);
  console.log(`  Close reason: ${session.closeReasonText}`);
}

// Check active limits
const limits = await playwright.limits();
console.log(`Concurrent sessions: ${limits.activeSessions.length}/${limits.maxConcurrentSessions}`);
console.log(`Can launch: ${limits.allowedBrowserAcquisitions}`);
console.log(`Wait time: ${limits.timeUntilNextAllowedBrowserAcquisition}ms`);
```

---

## Rate Limiting

### How Rate Limits Work

Rate limits are enforced with a **fixed per-second fill rate**, not burst allowance.

**Free plan example (6 requests/minute):**
- Translates to: **1 request per 10 seconds**
- ❌ Cannot send 6 requests at once
- ✓ Must spread requests evenly: 1 every 10 seconds

**Paid plan example (180 requests/minute):**
- Translates to: **3 requests per second**
- ❌ Cannot send 180 requests at once
- ✓ Must spread requests evenly: 3 per second

### Handling 429 Errors

When rate limited, the API responds with:
- HTTP status: **429 Too Many Requests**
- Header: **`Retry-After: {seconds}`** - how long to wait before retrying

**REST API example:**
```typescript
const response = await fetch(
  "https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/screenshot",
  {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: "https://example.com" }),
  }
);

if (response.status === 429) {
  const retryAfter = response.headers.get("Retry-After");
  console.log(`Rate limited. Waiting ${retryAfter} seconds...`);
  await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
  // Retry the request
}
```

**Workers Bindings example:**
```typescript
import puppeteer from "@cloudflare/puppeteer";

try {
  const browser = await puppeteer.launch(env.BROWSER);
  // ... use browser
} catch (error) {
  if (error.status === 429) {
    const retryAfter = error.headers.get("Retry-After");
    console.log(`Browser instance limit reached. Waiting ${retryAfter} seconds...`);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    // Retry launching browser
  }
}
```

---

## Browser Close Reasons

When viewing session history, you'll see different close reasons:

| Close Reason | Description | Recommended Action |
|--------------|-------------|-------------------|
| **NormalClosure** | Explicitly closed with `browser.close()` | ✓ Good - proper cleanup |
| **BrowserIdle** | Closed due to inactivity timeout | ⚠ Check if `browser.close()` is missing |
| **SessionRollout** | Closed due to Browser Rendering deployment | ℹ Normal during updates |

### Why BrowserIdle is a Warning

If you see many `BrowserIdle` closures, it means:
1. `browser.close()` was not called explicitly
2. Browser stayed open until timeout (60 seconds or `keep_alive` duration)
3. You're consuming more browser time than necessary

**Fix:**
```typescript
// ❌ Bad: browser stays open until timeout
const browser = await puppeteer.launch(env.BROWSER);
const page = await browser.newPage();
await page.goto(url);
return Response.json({ data: await page.content() });
// Missing browser.close()!

// ✓ Good: explicit cleanup
const browser = await puppeteer.launch(env.BROWSER);
try {
  const page = await browser.newPage();
  await page.goto(url);
  return Response.json({ data: await page.content() });
} finally {
  await browser.close(); // Always called
}
```

---

## Troubleshooting

### Error: 429 Browser time limit exceeded for today

**Cause:** You've hit the 10-minute daily limit on Workers Free plan.

**Solutions:**
1. **Upgrade to Paid plan**: Go to **Workers plans** in the dashboard
2. **Wait until next UTC day**: Quota resets at 00:00 UTC
3. **Optimize browser usage**: Ensure `browser.close()` is called promptly

**If you recently upgraded:**
- Redeploy your Worker to associate usage with the new plan
- Run: `wrangler deploy`

### Error: 429 Too many requests

**Cause:** Exceeding rate limits (requests per minute).

**Solutions:**
1. **Spread requests evenly**: Don't burst all requests at once
2. **Implement exponential backoff**: Read `Retry-After` header and wait
3. **Request higher limits**: Contact Cloudflare with clear use case

**Example rate limiter:**
```typescript
class RateLimiter {
  private queue: Array<() => void> = [];
  private requestsPerSecond: number;
  private lastRequestTime = 0;

  constructor(requestsPerMinute: number) {
    this.requestsPerSecond = requestsPerMinute / 60;
  }

  async throttle() {
    const now = Date.now();
    const minInterval = 1000 / this.requestsPerSecond;
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < minInterval) {
      await new Promise((resolve) =>
        setTimeout(resolve, minInterval - timeSinceLastRequest)
      );
    }

    this.lastRequestTime = Date.now();
  }
}

// Usage
const limiter = new RateLimiter(6); // 6 requests/min for Free plan

for (const url of urls) {
  await limiter.throttle();
  const response = await fetch(/* browser rendering API */);
}
```

### Higher Browser Usage Than Expected

**Cause:** Browser sessions not closed properly, staying open until timeout.

**Diagnostic steps:**
1. Check session history:
   ```typescript
   const history = await playwright.history();
   const idleClosures = history.filter(
     (s) => s.closeReasonText === "BrowserIdle"
   );
   console.log(`${idleClosures.length} sessions closed due to idle timeout`);
   ```

2. Review session durations:
   ```typescript
   for (const session of history) {
     const duration = session.endTime - session.startTime;
     console.log(`Session: ${duration}ms, reason: ${session.closeReasonText}`);
   }
   ```

**Solutions:**
1. **Always use try/finally**:
   ```typescript
   const browser = await puppeteer.launch(env.BROWSER);
   try {
     // ... operations
   } finally {
     await browser.close(); // Always called, even on error
   }
   ```

2. **Don't use `keep_alive` unnecessarily**: Default 60s timeout is often sufficient

3. **Monitor close reasons**: Check dashboard for `BrowserIdle` vs `NormalClosure` ratio

### Hitting Concurrent Browser Limits

**Cause:** Too many browsers open simultaneously.

**Diagnostic:**
```typescript
const limits = await playwright.limits();
console.log(`Active: ${limits.activeSessions.length}/${limits.maxConcurrentSessions}`);
console.log(`Can launch: ${limits.allowedBrowserAcquisitions}`);
```

**Solutions:**

1. **Optimize with tabs**: Use multiple tabs in one browser instead of multiple browsers
   ```typescript
   const browser = await puppeteer.launch(env.BROWSER);
   try {
     const page1 = await browser.newPage();
     const page2 = await browser.newPage();
     await Promise.all([
       page1.goto("https://example1.com"),
       page2.goto("https://example2.com"),
     ]);
   } finally {
     await browser.close();
   }
   ```

2. **Reuse sessions**: Keep browser open across requests
   ```typescript
   import { acquire, connect } from "@cloudflare/playwright";
   
   const { sessionId } = await acquire(env.BROWSER);
   
   // Reuse same session multiple times
   for (const url of urls) {
     const browser = await connect(env.BROWSER, sessionId);
     try {
       const page = await browser.newPage();
       await page.goto(url);
       // ... work
     } finally {
       await browser.close(); // Disconnects but keeps session alive
     }
   }
   ```

3. **Use incognito contexts**: Isolate work without multiple browsers
   ```typescript
   const browser = await puppeteer.launch(env.BROWSER);
   try {
     const context1 = await browser.createIncognitoBrowserContext();
     const context2 = await browser.createIncognitoBrowserContext();
     // Each context has isolated cookies/cache
   } finally {
     await browser.close();
   }
   ```

4. **Request higher limits**: Contact Cloudflare with clear use case

### Can't Extend Browser Timeout Beyond 60 Seconds

**Cause:** Not using `keep_alive` option (Paid plan only).

**Solution:**
```typescript
// Puppeteer
const browser = await puppeteer.launch(env.BROWSER, {
  keep_alive: 600000, // 10 minutes (max)
});

// Playwright
const browser = await launch(env.BROWSER, {
  keep_alive: 600000, // 10 minutes (max)
});
```

**Note:** `keep_alive` is only available on Paid plan.

### Session Closes Unexpectedly

**Possible causes:**
1. **Inactivity timeout**: No commands sent for 60 seconds (or `keep_alive` duration)
2. **Release deployment**: Browser Rendering rolled out a new release
3. **Explicit close**: `browser.close()` called elsewhere

**Diagnostic:**
```typescript
const history = await playwright.history();
const lastSession = history[0];
console.log(`Close reason: ${lastSession.closeReasonText}`);
console.log(`Duration: ${lastSession.endTime - lastSession.startTime}ms`);
```

**Solutions:**
- If `BrowserIdle`: Send commands more frequently or increase `keep_alive`
- If `SessionRollout`: Normal during updates, implement retry logic
- If `NormalClosure`: Check your code for unexpected `browser.close()` calls

---

## Requesting Higher Limits

Cloudflare grants requests for higher limits on a case-by-case basis.

**How to request:**
1. Go to Cloudflare dashboard
2. Navigate to **Support** → **Request higher limits**
3. Clearly demonstrate your use case and need

**What to include:**
- Current usage patterns and where you're hitting limits
- Expected growth or scaling needs
- Description of your application and its value
- Why the current limits are insufficient

**Limits you can request increases for:**
- Concurrent browsers (currently 30 on Paid)
- New browser instances per minute (currently 30 on Paid)
- REST API requests per minute (currently 180 on Paid)

---

## Cost Optimization Tips

1. **Always close browsers explicitly**: Prevent idle timeouts from consuming time
2. **Use REST API for simple tasks**: No concurrency pricing, just browser hours
3. **Cache aggressively**: Store screenshots/PDFs in R2 or KV
4. **Reuse sessions**: Eliminate cold start time and reduce concurrency
5. **Use multiple tabs**: More efficient than multiple browsers
6. **Set appropriate timeouts**: Don't use `keep_alive` if not needed
7. **Monitor close reasons**: Fix `BrowserIdle` closures
8. **Batch operations**: Process multiple items per browser session

**Example: Cost-efficient screenshot service with caching**
```typescript
interface Env {
  BROWSER: Fetcher;
  SCREENSHOTS: R2Bucket;
  CACHE: KVNamespace;
}

export default {
  async fetch(request, env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    
    // Check KV for metadata
    const cached = await env.CACHE.get(`screenshot:${url}`);
    if (cached) {
      // Return from R2
      const screenshot = await env.SCREENSHOTS.get(cached);
      return new Response(await screenshot.arrayBuffer(), {
        headers: { "Content-Type": "image/png", "X-Cache": "HIT" },
      });
    }
    
    // Generate new screenshot
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "load" }); // Don't wait for networkidle
      const screenshot = await page.screenshot({ type: "png" });
      
      // Cache in R2 and KV
      const key = crypto.randomUUID();
      await env.SCREENSHOTS.put(key, screenshot);
      await env.CACHE.put(`screenshot:${url}`, key, { expirationTtl: 86400 });
      
      return new Response(screenshot, {
        headers: { "Content-Type": "image/png", "X-Cache": "MISS" },
      });
    } finally {
      await browser.close(); // Always close!
    }
  },
} satisfies ExportedHandler<Env>;
```

---

## Summary

| Metric | Free | Paid |
|--------|------|------|
| Browser time | 10 min/day | 10 hrs/month + $0.09/hr |
| Concurrent browsers | 3 | 30 (10 included + $2/browser) |
| REST API rate | 6/min | 180/min |
| Browser timeout | 60s | 60s (up to 10 min with keep_alive) |
| Overage behavior | 429 error | Pay per use |
| Upgrade path | Go to Workers plans | Request higher limits |

**Key takeaways:**
- Always close browsers explicitly
- Monitor session history for idle closures
- Spread REST API requests evenly
- Cache aggressively
- Reuse sessions when possible
- Use try/finally for cleanup
