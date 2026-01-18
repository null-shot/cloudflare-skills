# Testing R2 with Vitest

Use `@cloudflare/vitest-pool-workers` to test Workers that use R2 storage inside the Workers runtime.

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
        miniflare: {
          r2Buckets: ["MY_BUCKET"], // Test-only buckets
        },
      },
    },
  },
});
```

## Unit Tests (Direct R2 Access)

```typescript
import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

describe("R2 operations", () => {
  it("puts and gets objects", async () => {
    await env.MY_BUCKET.put("test.txt", "Hello, World!");
    
    const object = await env.MY_BUCKET.get("test.txt");
    expect(object).not.toBeNull();
    expect(await object!.text()).toBe("Hello, World!");
  });

  it("returns null for missing objects", async () => {
    const object = await env.MY_BUCKET.get("nonexistent");
    expect(object).toBeNull();
  });

  it("deletes objects", async () => {
    await env.MY_BUCKET.put("to-delete.txt", "data");
    await env.MY_BUCKET.delete("to-delete.txt");
    
    const object = await env.MY_BUCKET.get("to-delete.txt");
    expect(object).toBeNull();
  });

  it("handles binary data", async () => {
    const buffer = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    await env.MY_BUCKET.put("binary.bin", buffer);
    
    const object = await env.MY_BUCKET.get("binary.bin");
    const result = new Uint8Array(await object!.arrayBuffer());
    expect(result).toEqual(buffer);
  });
});
```

## Testing Object Metadata

```typescript
describe("R2 metadata", () => {
  it("stores custom metadata", async () => {
    await env.MY_BUCKET.put("with-meta.txt", "content", {
      customMetadata: {
        author: "Alice",
        version: "1.0",
      },
    });

    const object = await env.MY_BUCKET.get("with-meta.txt");
    expect(object!.customMetadata).toEqual({
      author: "Alice",
      version: "1.0",
    });
  });

  it("sets content type", async () => {
    await env.MY_BUCKET.put("data.json", '{"key": "value"}', {
      httpMetadata: { contentType: "application/json" },
    });

    const object = await env.MY_BUCKET.get("data.json");
    expect(object!.httpMetadata.contentType).toBe("application/json");
  });

  it("checks object existence with head", async () => {
    await env.MY_BUCKET.put("exists.txt", "data");
    
    const head = await env.MY_BUCKET.head("exists.txt");
    expect(head).not.toBeNull();
    expect(head!.size).toBe(4);
    
    const missing = await env.MY_BUCKET.head("missing.txt");
    expect(missing).toBeNull();
  });
});
```

## Testing List Operations

```typescript
describe("R2 list", () => {
  beforeAll(async () => {
    await env.MY_BUCKET.put("images/cat.jpg", "cat-data");
    await env.MY_BUCKET.put("images/dog.jpg", "dog-data");
    await env.MY_BUCKET.put("docs/readme.md", "readme-data");
  });

  it("lists objects with prefix", async () => {
    const list = await env.MY_BUCKET.list({ prefix: "images/" });
    
    expect(list.objects).toHaveLength(2);
    expect(list.objects.map((o) => o.key)).toEqual([
      "images/cat.jpg",
      "images/dog.jpg",
    ]);
  });

  it("lists with delimiter for directories", async () => {
    const list = await env.MY_BUCKET.list({ delimiter: "/" });
    
    expect(list.delimitedPrefixes).toContain("images/");
    expect(list.delimitedPrefixes).toContain("docs/");
  });

  it("paginates results", async () => {
    const list = await env.MY_BUCKET.list({ limit: 1 });
    
    expect(list.objects).toHaveLength(1);
    expect(list.truncated).toBe(true);
    expect(list.cursor).toBeDefined();
  });
});
```

## Integration Tests (via SELF)

```typescript
import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

describe("Worker with R2", () => {
  beforeAll(async () => {
    await env.MY_BUCKET.put("hello.txt", "Hello, World!");
  });

  it("serves files from R2", async () => {
    const response = await SELF.fetch("http://example.com/files/hello.txt");
    
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello, World!");
  });

  it("returns 404 for missing files", async () => {
    const response = await SELF.fetch("http://example.com/files/missing.txt");
    expect(response.status).toBe(404);
  });

  it("uploads files to R2", async () => {
    const response = await SELF.fetch("http://example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: "New file content",
    });

    expect(response.status).toBe(200);
    
    // Verify upload
    const object = await env.MY_BUCKET.get("uploaded-file.txt");
    expect(await object!.text()).toBe("New file content");
  });
});
```

## Testing Multipart Uploads

```typescript
describe("Multipart uploads", () => {
  it("handles multipart upload", async () => {
    const key = "large-file.bin";
    
    // Create multipart upload
    const upload = await env.MY_BUCKET.createMultipartUpload(key);
    
    // Upload parts
    const part1 = await upload.uploadPart(1, new Uint8Array(1024).fill(1));
    const part2 = await upload.uploadPart(2, new Uint8Array(1024).fill(2));
    
    // Complete upload
    await upload.complete([part1, part2]);
    
    // Verify
    const object = await env.MY_BUCKET.get(key);
    expect(object!.size).toBe(2048);
  });

  it("can abort multipart upload", async () => {
    const upload = await env.MY_BUCKET.createMultipartUpload("aborted.bin");
    await upload.uploadPart(1, new Uint8Array(1024));
    
    await upload.abort();
    
    // Object should not exist
    const object = await env.MY_BUCKET.get("aborted.bin");
    expect(object).toBeNull();
  });
});
```

## Testing Conditional Operations

```typescript
describe("Conditional operations", () => {
  it("uses onlyIf for conditional get", async () => {
    await env.MY_BUCKET.put("conditional.txt", "data");
    const head = await env.MY_BUCKET.head("conditional.txt");
    
    // Get with matching etag
    const object = await env.MY_BUCKET.get("conditional.txt", {
      onlyIf: { etagMatches: head!.etag },
    });
    expect(object).not.toBeNull();
    
    // Get with non-matching etag
    const notModified = await env.MY_BUCKET.get("conditional.txt", {
      onlyIf: { etagMatches: "wrong-etag" },
    });
    expect(notModified).toBeNull();
  });
});
```

## Test Isolation

Each test gets isolated R2 state:

```typescript
describe("Isolation", () => {
  it("first test creates object", async () => {
    await env.MY_BUCKET.put("isolated.txt", "data");
    const object = await env.MY_BUCKET.get("isolated.txt");
    expect(object).not.toBeNull();
  });

  it("second test has empty bucket", async () => {
    const object = await env.MY_BUCKET.get("isolated.txt");
    expect(object).toBeNull();
  });
});
```

## Mocking R2 (Unit Tests)

For pure unit tests without Miniflare:

```typescript
import { vi } from "vitest";

const mockBucket = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  head: vi.fn(),
  list: vi.fn(),
};

describe("With mocked R2", () => {
  it("handles get", async () => {
    mockBucket.get.mockResolvedValue({
      text: () => Promise.resolve("mocked content"),
    });

    const result = await mockBucket.get("test.txt");
    expect(await result.text()).toBe("mocked content");
  });
});
```

## Running Tests

```bash
npx vitest        # Watch mode
npx vitest run    # Single run
```

## Known Issues

- **Fake timers don't work** with R2 operations
- **Size limits** not strictly enforced in local testing
- **S3 compatibility** features may behave differently locally

## Best Practices

1. **Use isolated storage** for test independence
2. **Seed test data in `beforeAll`** for consistent state
3. **Test error cases** like missing objects
4. **Test metadata operations** if using them
5. **Test list pagination** if listing many objects
6. **Clean up large test files** to avoid slow tests
7. **Mock R2 for pure unit tests** when not testing storage behavior
