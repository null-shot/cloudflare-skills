# Testing Browser Rendering

Browser Rendering bindings require **mocking** for local testing since headless browsers don't run in test environments.

## Testing Approach

The Browser Rendering API (`@cloudflare/puppeteer`) connects to remote headless Chromium instances. In tests:

1. **Mock Puppeteer** for unit tests
2. **Test Worker logic** separately from browser interactions
3. **Use integration tests** with mocked browser responses

## Setup

### Install Dependencies

```bash
npm i -D vitest@~3.2.0 @cloudflare/vitest-pool-workers
```

### vitest.config.ts

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

## Mocking Puppeteer

Create comprehensive mocks for `@cloudflare/puppeteer`:

```typescript
// test/mocks/puppeteer.ts
import { vi } from "vitest";

export function createMockBrowser() {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
    pdf: vi.fn().mockResolvedValue(Buffer.from("fake-pdf-data")),
    content: vi.fn().mockResolvedValue("<html><body>Mock Content</body></html>"),
    evaluate: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    metrics: vi.fn().mockResolvedValue({
      Timestamp: Date.now(),
      Documents: 1,
      Frames: 1,
      JSEventListeners: 10,
    }),
  };

  const mockBrowser = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
    version: vi.fn().mockResolvedValue("HeadlessChrome/120.0.0.0"),
  };

  return { mockBrowser, mockPage };
}
```

## Unit Tests with Mocks

```typescript
// test/screenshot.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockBrowser } from "./mocks/puppeteer";

// Mock the module
vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn(),
  },
}));

import puppeteer from "@cloudflare/puppeteer";
import { takeScreenshot } from "../src/screenshot";

describe("Screenshot service", () => {
  const { mockBrowser, mockPage } = createMockBrowser();

  beforeEach(() => {
    vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as any);
  });

  it("takes screenshot of URL", async () => {
    const mockEnv = { BROWSER: {} };
    
    const result = await takeScreenshot(mockEnv, "https://example.com");

    expect(puppeteer.launch).toHaveBeenCalledWith(mockEnv.BROWSER);
    expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", expect.any(Object));
    expect(mockPage.screenshot).toHaveBeenCalled();
    expect(result).toBeInstanceOf(Buffer);
  });

  it("closes browser after screenshot", async () => {
    const mockEnv = { BROWSER: {} };
    
    await takeScreenshot(mockEnv, "https://example.com");

    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it("handles navigation errors", async () => {
    mockPage.goto.mockRejectedValueOnce(new Error("Navigation failed"));
    const mockEnv = { BROWSER: {} };

    await expect(takeScreenshot(mockEnv, "https://invalid.url")).rejects.toThrow("Navigation failed");
    expect(mockBrowser.close).toHaveBeenCalled(); // Cleanup still happens
  });
});
```

## Testing Worker HTTP Handler

```typescript
// test/worker.spec.ts
import { SELF, env } from "cloudflare:test";
import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock puppeteer before imports
vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn(),
        screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
        close: vi.fn(),
      }),
      close: vi.fn(),
    }),
  },
}));

describe("Screenshot API", () => {
  it("returns screenshot for valid URL", async () => {
    const response = await SELF.fetch("http://example.com/screenshot?url=https://example.com");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("returns 400 for missing URL", async () => {
    const response = await SELF.fetch("http://example.com/screenshot");

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("URL required");
  });

  it("returns 400 for invalid URL", async () => {
    const response = await SELF.fetch("http://example.com/screenshot?url=not-a-url");

    expect(response.status).toBe(400);
  });
});
```

## Testing Page Evaluation Logic

```typescript
describe("Page evaluation", () => {
  const { mockBrowser, mockPage } = createMockBrowser();

  beforeEach(() => {
    vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as any);
  });

  it("extracts data from page", async () => {
    mockPage.evaluate.mockResolvedValue({
      title: "Example Page",
      links: 5,
      images: 3,
    });

    const mockEnv = { BROWSER: {} };
    const result = await extractPageData(mockEnv, "https://example.com");

    expect(result).toEqual({
      title: "Example Page",
      links: 5,
      images: 3,
    });
  });

  it("handles evaluation errors", async () => {
    mockPage.evaluate.mockRejectedValue(new Error("Script error"));
    const mockEnv = { BROWSER: {} };

    await expect(extractPageData(mockEnv, "https://example.com")).rejects.toThrow("Script error");
  });
});
```

## Testing Screenshot Options

```typescript
describe("Screenshot options", () => {
  it("supports full page screenshot", async () => {
    const { mockBrowser, mockPage } = createMockBrowser();
    vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as any);

    await takeScreenshot(env, "https://example.com", { fullPage: true });

    expect(mockPage.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: true })
    );
  });

  it("supports custom viewport", async () => {
    const { mockBrowser, mockPage } = createMockBrowser();
    vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as any);

    await takeScreenshot(env, "https://example.com", {
      viewport: { width: 1920, height: 1080 },
    });

    expect(mockPage.setViewport).toHaveBeenCalledWith({
      width: 1920,
      height: 1080,
    });
  });
});
```

## Testing PDF Generation

```typescript
describe("PDF generation", () => {
  it("generates PDF from URL", async () => {
    const { mockBrowser, mockPage } = createMockBrowser();
    vi.mocked(puppeteer.launch).mockResolvedValue(mockBrowser as any);

    mockPage.pdf.mockResolvedValue(Buffer.from("%PDF-1.4 fake pdf content"));

    const result = await generatePDF(env, "https://example.com");

    expect(mockPage.pdf).toHaveBeenCalledWith(
      expect.objectContaining({ format: "A4" })
    );
    expect(result.toString()).toContain("%PDF");
  });
});
```

## Example Implementation

```typescript
// src/screenshot.ts
import puppeteer from "@cloudflare/puppeteer";

interface ScreenshotOptions {
  fullPage?: boolean;
  viewport?: { width: number; height: number };
}

export async function takeScreenshot(
  env: { BROWSER: unknown },
  url: string,
  options: ScreenshotOptions = {}
): Promise<Buffer> {
  const browser = await puppeteer.launch(env.BROWSER);
  
  try {
    const page = await browser.newPage();
    
    if (options.viewport) {
      await page.setViewport(options.viewport);
    }
    
    await page.goto(url, { waitUntil: "networkidle0" });
    
    const screenshot = await page.screenshot({
      fullPage: options.fullPage ?? false,
      type: "png",
    });
    
    return screenshot as Buffer;
  } finally {
    await browser.close();
  }
}
```

## Running Tests

```bash
npx vitest        # Watch mode
npx vitest run    # Single run
```

## Known Limitations

- **No local browser execution** - Real browsers don't run in tests
- **XPath not supported** in Cloudflare's Puppeteer fork
- **Some Puppeteer features** may be restricted

## Best Practices

1. **Always mock Puppeteer** for unit tests
2. **Test browser logic separately** from HTTP handler
3. **Clean up browsers** in finally blocks
4. **Test error scenarios** (navigation failures, timeouts)
5. **Mock different responses** for different test cases
6. **Test option handling** (viewport, fullPage, etc.)
7. **Use integration tests in staging** for real browser behavior
