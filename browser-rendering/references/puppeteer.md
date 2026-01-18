# Puppeteer API Reference for Cloudflare

Complete reference for using `@cloudflare/puppeteer` in Cloudflare Workers.

> **Note:** Cloudflare also supports [@cloudflare/playwright](https://developers.cloudflare.com/browser-rendering/playwright/) as an alternative to Puppeteer. Playwright offers a modern API with built-in test assertions, trace files, and storage state management. This guide focuses on Puppeteer, but most concepts apply to Playwright as well.

## Browser Class

### puppeteer.launch()

Launch a new browser instance.

```typescript
import puppeteer from "@cloudflare/puppeteer";

const browser = await puppeteer.launch(env.BROWSER_RENDERING);
```

**Parameters:**
- `binding: Fetcher` - The browser binding from your Env interface

**Returns:** `Promise<Browser>`

### browser.newPage()

Create a new page in the browser.

```typescript
const page = await browser.newPage();
```

**Returns:** `Promise<Page>`

### browser.close()

Close the browser and free resources.

```typescript
await browser.close();
```

**CRITICAL:** Always call this to prevent memory leaks.

---

## Page Class

### Navigation

#### page.goto()

Navigate to a URL.

```typescript
await page.goto(url, options);
```

**Options:**
```typescript
{
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
  timeout?: number; // milliseconds, default 30000
  referer?: string;
}
```

**waitUntil values:**
- `load` - Wait for load event (default)
- `domcontentloaded` - Wait for DOMContentLoaded event
- `networkidle0` - Wait until no network connections for 500ms
- `networkidle2` - Wait until no more than 2 network connections for 500ms

**Example:**
```typescript
await page.goto("https://example.com", {
  waitUntil: "networkidle0",
  timeout: 30000,
});
```

#### page.reload()

Reload the current page.

```typescript
await page.reload(options);
```

---

### Content Extraction

#### page.content()

Get the full HTML content of the page.

```typescript
const html = await page.content();
```

**Returns:** `Promise<string>` - Full HTML document

#### page.$eval()

Run a function on the first element matching a selector.

```typescript
const text = await page.$eval("h1", el => el.textContent);
```

**Parameters:**
- `selector: string` - CSS selector
- `pageFunction: (element) => T` - Function to run on the element

**Returns:** `Promise<T>` - Result of the function

**Example:**
```typescript
const links = await page.$eval("a", el => ({
  text: el.textContent,
  href: el.href,
}));
```

#### page.$$eval()

Run a function on all elements matching a selector.

```typescript
const allLinks = await page.$$eval("a", elements => {
  return elements.map(el => ({
    text: el.textContent,
    href: el.href,
  }));
});
```

**Parameters:**
- `selector: string` - CSS selector
- `pageFunction: (elements) => T` - Function to run on array of elements

**Returns:** `Promise<T>` - Result of the function

#### page.evaluate()

Execute JavaScript in the page context.

```typescript
const data = await page.evaluate(() => {
  return {
    title: document.title,
    url: window.location.href,
    userAgent: navigator.userAgent,
  };
});
```

**Parameters:**
- `pageFunction: (...args) => T` - Function to execute in page context
- `...args` - Arguments to pass to the function (must be serializable)

**Returns:** `Promise<T>` - Result of the function (must be serializable)

**Complex extraction example:**
```typescript
const articles = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("article")).map(article => ({
    title: article.querySelector("h2")?.textContent,
    date: article.querySelector("time")?.getAttribute("datetime"),
    excerpt: article.querySelector("p")?.textContent,
    link: article.querySelector("a")?.href,
  }));
});
```

---

### Viewport and Display

#### page.setViewport()

Set the viewport size and device scale factor.

```typescript
await page.setViewport({
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
});
```

**Options:**
```typescript
{
  width: number;
  height: number;
  deviceScaleFactor?: number; // default 1
  isMobile?: boolean; // default false
  hasTouch?: boolean; // default false
  isLandscape?: boolean; // default false
}
```

**Common presets:**
```typescript
// Desktop
await page.setViewport({ width: 1920, height: 1080 });

// Mobile (iPhone 12)
await page.setViewport({ 
  width: 390, 
  height: 844, 
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

// Tablet (iPad)
await page.setViewport({ 
  width: 768, 
  height: 1024,
  isMobile: true,
  hasTouch: true,
});
```

---

### Screenshots

#### page.screenshot()

Take a screenshot of the page.

```typescript
const screenshot = await page.screenshot(options);
```

**Options:**
```typescript
{
  type?: "png" | "jpeg" | "webp"; // default "png"
  quality?: number; // 0-100, only for jpeg/webp
  fullPage?: boolean; // default false
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  omitBackground?: boolean; // default false (transparent background)
  encoding?: "binary" | "base64"; // default "binary"
}
```

**Examples:**

Full page PNG:
```typescript
const screenshot = await page.screenshot({
  type: "png",
  fullPage: true,
});

return new Response(screenshot, {
  headers: { "Content-Type": "image/png" },
});
```

JPEG with quality:
```typescript
const screenshot = await page.screenshot({
  type: "jpeg",
  quality: 80,
  fullPage: false,
});
```

Specific region:
```typescript
const screenshot = await page.screenshot({
  clip: {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  },
});
```

Base64 encoding:
```typescript
const screenshot = await page.screenshot({
  type: "png",
  encoding: "base64",
});

return Response.json({ image: screenshot });
```

---

### PDF Generation

#### page.pdf()

Generate a PDF of the page.

```typescript
const pdf = await page.pdf(options);
```

**Options:**
```typescript
{
  format?: "Letter" | "Legal" | "A4" | "A3"; // default "Letter"
  width?: string | number; // e.g. "210mm", 8.5
  height?: string | number; // e.g. "297mm", 11
  margin?: {
    top?: string | number;
    right?: string | number;
    bottom?: string | number;
    left?: string | number;
  };
  printBackground?: boolean; // default false
  landscape?: boolean; // default false
  pageRanges?: string; // e.g. "1-5, 8, 11-13"
  scale?: number; // default 1
  preferCSSPageSize?: boolean; // default false
}
```

**Examples:**

Basic A4 PDF:
```typescript
const pdf = await page.pdf({
  format: "A4",
  printBackground: true,
});

return new Response(pdf, {
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": "attachment; filename=page.pdf",
  },
});
```

Custom size with margins:
```typescript
const pdf = await page.pdf({
  width: "8.5in",
  height: "11in",
  margin: {
    top: "1in",
    right: "0.5in",
    bottom: "1in",
    left: "0.5in",
  },
  printBackground: true,
});
```

Landscape orientation:
```typescript
const pdf = await page.pdf({
  format: "A4",
  landscape: true,
  printBackground: true,
});
```

---

### Waiting Strategies

#### page.waitForSelector()

Wait for a selector to appear in the DOM.

```typescript
await page.waitForSelector(selector, options);
```

**Options:**
```typescript
{
  visible?: boolean; // wait for element to be visible
  hidden?: boolean; // wait for element to be hidden
  timeout?: number; // milliseconds, default 30000
}
```

**Examples:**
```typescript
// Wait for element to appear
await page.waitForSelector(".loaded");

// Wait for element to be visible
await page.waitForSelector(".modal", { visible: true });

// Wait for element to disappear
await page.waitForSelector(".spinner", { hidden: true });
```

#### page.waitForFunction()

Wait for a function to return a truthy value.

```typescript
await page.waitForFunction(pageFunction, options, ...args);
```

**Examples:**
```typescript
// Wait for custom condition
await page.waitForFunction(() => {
  return document.querySelector(".content")?.textContent?.length > 0;
});

// With timeout
await page.waitForFunction(
  () => window.dataLoaded === true,
  { timeout: 10000 }
);

// With arguments
await page.waitForFunction(
  (minCount) => document.querySelectorAll(".item").length >= minCount,
  {},
  10 // minCount argument
);
```

#### page.waitForTimeout()

Wait for a specific amount of time.

```typescript
await page.waitForTimeout(milliseconds);
```

**Example:**
```typescript
await page.waitForTimeout(2000); // Wait 2 seconds
```

**Note:** Prefer `waitForSelector` or `waitForFunction` over hard-coded timeouts when possible.

---

### HTTP Headers and Authentication

#### page.setExtraHTTPHeaders()

Set extra HTTP headers for all requests.

```typescript
await page.setExtraHTTPHeaders({
  "Authorization": `Bearer ${token}`,
  "X-Custom-Header": "value",
});
```

**Example with API token:**
```typescript
await page.setExtraHTTPHeaders({
  "Authorization": `Bearer ${env.API_TOKEN}`,
  "Accept-Language": "en-US",
});
await page.goto(url);
```

#### page.authenticate()

Provide credentials for HTTP authentication.

```typescript
await page.authenticate({
  username: "user",
  password: "pass",
});
```

---

### Cookies

#### page.setCookie()

Set cookies for the page.

```typescript
await page.setCookie(...cookies);
```

**Cookie format:**
```typescript
{
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number; // Unix timestamp
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}
```

**Example:**
```typescript
await page.setCookie({
  name: "session",
  value: "abc123",
  domain: "example.com",
  httpOnly: true,
  secure: true,
});
```

#### page.cookies()

Get all cookies for the page.

```typescript
const cookies = await page.cookies();
```

---

## Element Handles

### page.$()

Get the first element matching a selector.

```typescript
const element = await page.$("selector");
if (element) {
  // Element found
}
```

**Returns:** `Promise<ElementHandle | null>`

### page.$$()

Get all elements matching a selector.

```typescript
const elements = await page.$$("selector");
```

**Returns:** `Promise<ElementHandle[]>`

### ElementHandle methods

```typescript
const element = await page.$("button");

// Click
await element.click();

// Type text
await element.type("text to type");

// Get property
const value = await element.getProperty("value");
const href = await element.getProperty("href");
```

---

## Keyboard and Mouse

### page.type()

Type text into a focused element.

```typescript
await page.type("input[name=email]", "user@example.com");
```

### page.click()

Click an element.

```typescript
await page.click("button#submit");
```

**Options:**
```typescript
{
  button?: "left" | "right" | "middle";
  clickCount?: number; // for double-click
  delay?: number; // milliseconds between mousedown and mouseup
}
```

### page.keyboard

```typescript
await page.keyboard.press("Enter");
await page.keyboard.type("text to type");
await page.keyboard.down("Shift");
await page.keyboard.up("Shift");
```

---

## Best Practices

1. **Always close browsers** - Use try/finally blocks
2. **Set reasonable timeouts** - Prevent hanging requests
3. **Use appropriate waitUntil** - Balance speed vs content readiness
4. **Validate URLs** - Normalize and validate before navigation
5. **Handle errors** - Catch TimeoutError and navigation errors
6. **Limit concurrent browsers** - Each browser consumes memory
7. **Cache results** - Store screenshots/PDFs in R2 or KV
8. **Monitor performance** - Track browser launch and page load times
9. **Test locally first** - Use `wrangler dev` to iterate quickly
10. **Respect rate limits** - Don't overwhelm target sites

---

## Common Issues

### Timeout Errors

```typescript
try {
  await page.goto(url, { timeout: 30000 });
} catch (error) {
  if (error.name === "TimeoutError") {
    // Handle timeout
    return new Response("Page load timeout", { status: 504 });
  }
  throw error;
}
```

### Memory Management

```typescript
// Good: Close browser in finally block
const browser = await puppeteer.launch(env.BROWSER_RENDERING);
try {
  const page = await browser.newPage();
  // ... operations
} finally {
  await browser.close(); // Always called
}
```

### Navigation Failed

```typescript
try {
  await page.goto(url);
} catch (error) {
  if (error.message.includes("net::ERR_NAME_NOT_RESOLVED")) {
    return new Response("Invalid URL", { status: 400 });
  }
  throw error;
}
```
