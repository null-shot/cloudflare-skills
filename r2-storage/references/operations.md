# R2 Operations Reference

Complete API reference for R2Bucket operations, conditional logic, streaming, and error handling.

## R2Bucket Interface

```typescript
interface R2Bucket {
  // Basic operations
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions): Promise<R2Object>;
  delete(keys: string | string[]): Promise<void>;
  
  // Listing
  list(options?: R2ListOptions): Promise<R2Objects>;
  
  // Multipart uploads
  createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload;
}
```

## Get Operations

### Basic Get

```typescript
const object = await bucket.get("path/to/file.txt");

if (!object) {
  return new Response("Not found", { status: 404 });
}

// Read body as different formats
const text = await object.text();
const json = await object.json();
const arrayBuffer = await object.arrayBuffer();
const blob = await object.blob();

// Or stream directly
return new Response(object.body);
```

### Get with Options

```typescript
interface R2GetOptions {
  onlyIf?: R2Conditional | Headers;
  range?: R2Range;
}

interface R2Conditional {
  etagMatches?: string;
  etagDoesNotMatch?: string;
  uploadedBefore?: Date;
  uploadedAfter?: Date;
}

interface R2Range {
  offset?: number;  // Byte offset to start reading
  length?: number;  // Number of bytes to read
  suffix?: number;  // Read last N bytes
}
```

**Example: Conditional Get**

```typescript
// Only fetch if ETag changed (cache validation)
const object = await bucket.get("data.json", {
  onlyIf: {
    etagDoesNotMatch: cachedEtag,
  },
});

if (!object) {
  // Not modified - use cached version
  return new Response(cachedData, {
    status: 304,
    headers: { "ETag": cachedEtag },
  });
}

// Modified - return new data
return new Response(object.body, {
  headers: { "ETag": object.httpEtag },
});
```

**Example: Range Requests**

```typescript
// Get first 1MB of file
const partial = await bucket.get("large-file.bin", {
  range: { offset: 0, length: 1024 * 1024 },
});

// Get last 1KB
const tail = await bucket.get("log.txt", {
  range: { suffix: 1024 },
});
```

## Head Operations

Get metadata without downloading the body.

```typescript
const object = await bucket.head("file.txt");

if (object) {
  console.log({
    key: object.key,
    size: object.size,
    etag: object.httpEtag,
    uploaded: object.uploaded,
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  });
}
```

**Use cases:**
- Check if object exists
- Get file size before downloading
- Read custom metadata
- Validate ETag for conditional operations

## Put Operations

### Basic Put

```typescript
interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  md5?: ArrayBuffer | string;  // Content verification
  sha1?: ArrayBuffer | string;
  sha256?: ArrayBuffer | string;
  sha384?: ArrayBuffer | string;
  sha512?: ArrayBuffer | string;
  onlyIf?: R2Conditional;
}

interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}
```

### Put with Metadata

```typescript
await bucket.put("document.pdf", pdfData, {
  httpMetadata: {
    contentType: "application/pdf",
    contentDisposition: 'attachment; filename="report.pdf"',
    cacheControl: "public, max-age=3600",
  },
  customMetadata: {
    author: "John Doe",
    version: "2.1",
    department: "engineering",
  },
});
```

### Put with Checksum Verification

```typescript
const data = new TextEncoder().encode("Hello R2");
const hash = await crypto.subtle.digest("SHA-256", data);

await bucket.put("verified.txt", data, {
  sha256: hash,  // R2 verifies integrity
  httpMetadata: {
    contentType: "text/plain",
  },
});
```

### Conditional Put (Optimistic Locking)

```typescript
// Only update if ETag matches (prevent lost updates)
const existing = await bucket.head("config.json");

if (existing) {
  try {
    await bucket.put("config.json", newConfig, {
      onlyIf: {
        etagMatches: existing.httpEtag,
      },
    });
  } catch (error) {
    // ETag mismatch - object was modified
    return new Response("Conflict: object was modified", { status: 409 });
  }
}
```

### Streaming Uploads

```typescript
// Stream from request directly to R2
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const key = new URL(request.url).pathname.slice(1);
    
    await env.BUCKET.put(key, request.body, {
      httpMetadata: {
        contentType: request.headers.get("content-type") || "application/octet-stream",
      },
    });
    
    return new Response("Uploaded", { status: 201 });
  },
};
```

## Delete Operations

### Single Delete

```typescript
await bucket.delete("file.txt");
```

### Batch Delete

```typescript
// Delete multiple objects at once
await bucket.delete([
  "uploads/2023/file1.jpg",
  "uploads/2023/file2.jpg",
  "uploads/2023/file3.jpg",
]);
```

**Note**: Delete operations are idempotent. Deleting a non-existent key does not throw an error.

## List Operations

### Basic Listing

```typescript
interface R2ListOptions {
  limit?: number;      // Max 1000
  prefix?: string;     // Filter by prefix
  cursor?: string;     // Pagination cursor
  delimiter?: string;  // Directory-like listing
  startAfter?: string; // Start listing after this key
  include?: ("httpMetadata" | "customMetadata")[];
}

const result = await bucket.list({
  limit: 100,
  prefix: "uploads/2024/",
});

console.log({
  objects: result.objects,
  truncated: result.truncated,
  cursor: result.cursor,
  delimitedPrefixes: result.delimitedPrefixes,
});
```

### Paginated Listing

```typescript
async function* listAll(
  bucket: R2Bucket,
  options: R2ListOptions = {}
): AsyncGenerator<R2Object> {
  let cursor: string | undefined;

  do {
    const result = await bucket.list({ ...options, cursor });

    for (const object of result.objects) {
      yield object;
    }

    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
}

// Usage
for await (const object of listAll(env.BUCKET, { prefix: "images/" })) {
  console.log(object.key, object.size);
}
```

### Directory-Style Listing

Use `delimiter` to simulate directory hierarchies.

```typescript
// List "directories" under uploads/
const result = await bucket.list({
  prefix: "uploads/",
  delimiter: "/",
});

// These are like subdirectories
console.log(result.delimitedPrefixes); // ["uploads/2023/", "uploads/2024/"]

// These are files directly in uploads/
console.log(result.objects.map(o => o.key)); // ["uploads/readme.txt"]
```

### List with Metadata

```typescript
const result = await bucket.list({
  include: ["httpMetadata", "customMetadata"],
  prefix: "documents/",
});

for (const object of result.objects) {
  console.log({
    key: object.key,
    contentType: object.httpMetadata?.contentType,
    author: object.customMetadata?.author,
  });
}
```

## Multipart Upload

For large files (> 100MB), use multipart uploads for better reliability.

### Creating Multipart Upload

```typescript
const upload = await bucket.createMultipartUpload("large-video.mp4", {
  httpMetadata: {
    contentType: "video/mp4",
  },
  customMetadata: {
    uploader: "user-123",
  },
});

console.log(upload.key, upload.uploadId);
```

### Uploading Parts

```typescript
const parts: R2UploadedPart[] = [];
const chunkSize = 10 * 1024 * 1024; // 10MB minimum per part

for (let i = 0; i < chunks.length; i++) {
  const part = await upload.uploadPart(i + 1, chunks[i]);
  parts.push(part);
}
```

### Completing Upload

```typescript
const object = await upload.complete(parts);

console.log({
  key: object.key,
  size: object.size,
  etag: object.httpEtag,
});
```

### Aborting Upload

```typescript
await upload.abort();
```

### Resuming Upload

```typescript
// Resume from saved uploadId
const upload = bucket.resumeMultipartUpload("large-file.bin", uploadId);

// Continue uploading parts
const part = await upload.uploadPart(5, chunk);
```

## R2Object Types

### R2Object (Metadata Only)

Returned by `head()` and after `put()`.

```typescript
interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  checksums: R2Checksums;
}
```

### R2ObjectBody (With Body)

Returned by `get()`.

```typescript
interface R2ObjectBody extends R2Object {
  body: ReadableStream<Uint8Array>;
  bodyUsed: boolean;
  
  // Convenience methods
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  blob(): Promise<Blob>;
}
```

### R2Objects (List Result)

```typescript
interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}
```

## Error Handling

### Object Not Found

```typescript
const object = await bucket.get("missing.txt");

if (!object) {
  return new Response("Object not found", { status: 404 });
}
```

### Conditional Operation Failed

```typescript
try {
  await bucket.put("file.txt", data, {
    onlyIf: { etagMatches: expectedEtag },
  });
} catch (error) {
  if (error.message.includes("etagMatches")) {
    return new Response("Conflict: object was modified", { status: 409 });
  }
  throw error;
}
```

### Multipart Upload Errors

```typescript
try {
  const upload = await bucket.createMultipartUpload("file.bin");
  const parts: R2UploadedPart[] = [];

  for (let i = 0; i < chunks.length; i++) {
    try {
      const part = await upload.uploadPart(i + 1, chunks[i]);
      parts.push(part);
    } catch (error) {
      console.error(`Failed to upload part ${i + 1}:`, error);
      await upload.abort();
      throw error;
    }
  }

  await upload.complete(parts);
} catch (error) {
  return new Response(`Upload failed: ${error.message}`, { status: 500 });
}
```

## Performance Optimization

### Parallel Uploads

```typescript
const uploadPromises = files.map((file, index) => {
  const key = `batch/${Date.now()}-${index}-${file.name}`;
  return env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });
});

await Promise.all(uploadPromises);
```

### Streaming Large Downloads

```typescript
// Don't buffer entire file in memory
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const object = await env.BUCKET.get("large-video.mp4");
    
    if (!object) {
      return new Response("Not found", { status: 404 });
    }

    // Stream directly to client
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "video/mp4",
        "Content-Length": object.size.toString(),
      },
    });
  },
};
```

### Conditional Requests for Caching

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const key = new URL(request.url).pathname.slice(1);
    const ifNoneMatch = request.headers.get("if-none-match");

    if (ifNoneMatch) {
      const object = await env.BUCKET.get(key, {
        onlyIf: { etagDoesNotMatch: ifNoneMatch },
      });

      if (!object) {
        return new Response(null, {
          status: 304,
          headers: { "ETag": ifNoneMatch },
        });
      }
    }

    const object = await env.BUCKET.get(key);
    if (!object) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
        "ETag": object.httpEtag,
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
};
```

## Size Limits

For comprehensive limit information, see **[limits.md](./limits.md)**.

**Quick reference:**

| Operation | Limit |
|-----------|-------|
| Maximum object size | 5 TiB (4.995 TiB usable) |
| Maximum upload size (single-part) | 5 GiB (4.995 GiB usable) |
| Maximum part size (multipart) | 5 GiB |
| Minimum part size (multipart) | 5 MiB (except last part) |
| Maximum parts per upload | 10,000 |
| Maximum list results per request | 1,000 |
| Object metadata size | 8 KiB (8,192 bytes) |
| Object key length | 1,024 bytes |

## Best Practices

1. **Use `head()` for existence checks**: Don't download the body if you only need metadata
2. **Enable streaming**: Use `ReadableStream` for large files to avoid memory issues
3. **Implement pagination**: Always handle `truncated` and `cursor` when listing
4. **Set appropriate Content-Type**: Browsers rely on this for correct handling
5. **Use custom metadata for filtering**: Store searchable attributes without downloading objects
6. **Implement ETags for caching**: Reduce bandwidth with conditional requests
7. **Use multipart for large files**: Files > 100MB should use multipart uploads
8. **Batch delete operations**: Delete multiple objects in one call when possible
9. **Handle 404s gracefully**: `get()` returns `null`, not an error
10. **Use range requests for large files**: Download only needed portions
