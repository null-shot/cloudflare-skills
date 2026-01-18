# R2 Limits and Restrictions

Comprehensive reference for Cloudflare R2 storage limits, rate limits, and operational constraints.

## Storage Limits

| Feature | Limit | Notes |
|---------|-------|-------|
| **Data per bucket** | Unlimited | No hard cap on total storage per bucket |
| **Buckets per account** | 1,000,000 | Maximum number of buckets you can create |
| **Object size** | 5 TiB per object | Actual limit: 5 TiB minus 5 GiB = 4.995 TiB |
| **Maximum upload size (single-part)** | 5 GiB per request | Actual limit: 5 GiB minus 5 MiB = 4.995 GiB |
| **Maximum upload size (multipart)** | 4.995 TiB | Must use multipart for files > 5 GiB |

**Storage Units Note**: Limits use binary units (GiB = 2³⁰ bytes, TiB = 2⁴⁰ bytes), not decimal units (GB = 10⁹ bytes).

## Multipart Upload Limits

| Feature | Limit | Notes |
|---------|-------|-------|
| **Maximum parts per upload** | 10,000 | Total parts allowed in a multipart upload |
| **Minimum part size** | 5 MiB | Required for all parts except the last |
| **Maximum part size** | 5 GiB | Cannot exceed this per part |
| **Part size consistency** | All parts must be equal | Except the last part, which can be smaller |
| **Last part minimum** | No minimum | Last part can be any size ≤ other parts |

### Multipart Upload Calculations

```typescript
// Calculate optimal part size for a given file
function calculatePartSize(fileSize: number): {
  partSize: number;
  numParts: number;
} {
  const MIN_PART_SIZE = 5 * 1024 * 1024; // 5 MiB
  const MAX_PART_SIZE = 5 * 1024 * 1024 * 1024; // 5 GiB
  const MAX_PARTS = 10000;

  // Start with minimum part size
  let partSize = MIN_PART_SIZE;
  let numParts = Math.ceil(fileSize / partSize);

  // If too many parts, increase part size
  if (numParts > MAX_PARTS) {
    partSize = Math.ceil(fileSize / MAX_PARTS);
    
    // Ensure part size doesn't exceed maximum
    if (partSize > MAX_PART_SIZE) {
      throw new Error(`File too large: ${fileSize} bytes exceeds R2 limit`);
    }
    
    numParts = Math.ceil(fileSize / partSize);
  }

  return { partSize, numParts };
}

// Example usage
const fileSize = 100 * 1024 * 1024 * 1024; // 100 GiB
const { partSize, numParts } = calculatePartSize(fileSize);
console.log(`Use ${numParts} parts of ${partSize / (1024 * 1024)} MiB each`);
```

## Object Metadata Limits

| Feature | Limit | Notes |
|---------|-------|-------|
| **Object key length** | 1,024 bytes | Maximum length for object names |
| **Object metadata size** | 8,192 bytes (8 KiB) | Total size of all custom metadata |
| **Custom metadata key length** | Part of 8 KiB total | Key + value must fit in 8 KiB |
| **Custom metadata value length** | Part of 8 KiB total | Key + value must fit in 8 KiB |

### Key Naming Best Practices

```typescript
// Good: hierarchical, descriptive, under 1024 bytes
const goodKey = "uploads/2024/01/user-123/document-abc.pdf"; // 45 bytes

// Bad: exceeds 1024 bytes (will be rejected)
const badKey = "a".repeat(1025);

// Validate key length before upload
function validateKey(key: string): boolean {
  const keyBytes = new TextEncoder().encode(key).length;
  if (keyBytes > 1024) {
    throw new Error(`Key too long: ${keyBytes} bytes (max 1024)`);
  }
  return true;
}
```

### Metadata Size Validation

```typescript
// Calculate metadata size
function validateMetadata(metadata: Record<string, string>): boolean {
  let totalSize = 0;
  
  for (const [key, value] of Object.entries(metadata)) {
    totalSize += new TextEncoder().encode(key).length;
    totalSize += new TextEncoder().encode(value).length;
  }
  
  if (totalSize > 8192) {
    throw new Error(`Metadata too large: ${totalSize} bytes (max 8192)`);
  }
  
  return true;
}

// Example
const metadata = {
  author: "John Doe",
  department: "Engineering",
  project: "Q1-2024",
  description: "Project report",
};

validateMetadata(metadata); // Will throw if > 8 KiB
```

## Rate Limits

### Bucket Management Operations

| Operation Type | Limit | Applies To |
|---------------|-------|------------|
| **Bucket operations** | 50 per second per bucket | Create, delete, list, configure buckets |
| **Object operations** | No rate limit | Get, put, delete, list objects (normal usage) |

**Bucket management operations** include:
- Creating buckets
- Deleting buckets
- Listing buckets
- Configuring bucket settings (CORS, public access, etc.)

**Object operations** (not rate-limited under normal usage):
- Reading objects (`get`, `head`)
- Writing objects (`put`)
- Deleting objects (`delete`)
- Listing objects within a bucket (`list`)

### Concurrent Writes to Same Key

| Scenario | Limit | Behavior |
|----------|-------|----------|
| **Writes to same object key** | 1 per second | Additional writes get HTTP 429 |
| **Writes to different keys** | No limit | Fully parallel, no rate limiting |

```typescript
// This will trigger rate limiting (429 errors)
async function badPattern(bucket: R2Bucket) {
  // Multiple concurrent writes to SAME key
  await Promise.all([
    bucket.put("counter.json", JSON.stringify({ value: 1 })),
    bucket.put("counter.json", JSON.stringify({ value: 2 })), // 429!
    bucket.put("counter.json", JSON.stringify({ value: 3 })), // 429!
  ]);
}

// This is fine - different keys
async function goodPattern(bucket: R2Bucket) {
  await Promise.all([
    bucket.put("file1.json", JSON.stringify({ value: 1 })),
    bucket.put("file2.json", JSON.stringify({ value: 2 })),
    bucket.put("file3.json", JSON.stringify({ value: 3 })),
  ]);
}

// Sequential writes to same key (respects 1/second limit)
async function sequentialPattern(bucket: R2Bucket) {
  await bucket.put("counter.json", JSON.stringify({ value: 1 }));
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
  await bucket.put("counter.json", JSON.stringify({ value: 2 }));
}
```

### Public Bucket Rate Limiting (r2.dev)

| Access Method | Rate Limit | Recommendation |
|---------------|------------|----------------|
| **r2.dev subdomain** | Variable (hundreds of requests/second) | Testing only, not production |
| **Custom domain** | Much higher | Use for production |

**Important**: The `r2.dev` endpoint is throttled for heavy traffic:
- Throttled at "hundreds of requests per second"
- You'll receive `429 Too Many Requests` responses
- Bandwidth may also be throttled
- **Always use custom domains for production**

```typescript
// Development/testing - r2.dev (rate limited)
// https://my-bucket.account-id.r2.dev/file.jpg

// Production - custom domain (higher limits)
// https://assets.example.com/file.jpg
```

## Workers Integration Limits

When using R2 from Cloudflare Workers, these additional limits apply:

| Feature | Free Plan | Paid Plan | Notes |
|---------|-----------|-----------|-------|
| **Subrequests per invocation** | 50 | 1,000 | Each R2 operation counts as a subrequest |
| **Simultaneous open connections** | 6 | 6 | Open R2 operations (get, put, list, etc.) |
| **Request body size** | 100 MB | 500 MB (Enterprise) | Incoming HTTP request to Worker |
| **Worker memory** | 128 MB | 128 MB | Total memory per Worker isolate |
| **Daily requests** | 100,000 | Unlimited | Total Worker invocations per day |

### Subrequest Limits Impact

```typescript
// Each R2 operation is a subrequest
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // This uses 3 subrequests (50 on free, 1000 on paid)
    const obj1 = await env.BUCKET.get("file1.txt"); // 1 subrequest
    const obj2 = await env.BUCKET.get("file2.txt"); // 1 subrequest
    await env.BUCKET.put("file3.txt", "data");     // 1 subrequest
    
    return new Response("OK");
  },
};

// Listing operations also count as subrequests
async function listAll(bucket: R2Bucket): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  
  // Each list() call is 1 subrequest
  // With truncation, this could use many subrequests
  do {
    const result = await bucket.list({ cursor, limit: 1000 });
    objects.push(...result.objects);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  
  return objects;
}
```

### Connection Limit Impact

```typescript
// Maximum 6 simultaneous open connections
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // This is fine - only 3 concurrent operations
    const [obj1, obj2, obj3] = await Promise.all([
      env.BUCKET.get("file1.txt"),
      env.BUCKET.get("file2.txt"),
      env.BUCKET.get("file3.txt"),
    ]);
    
    // This would queue/serialize beyond 6 connections
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => 
        env.BUCKET.get(`file${i}.txt`)
      )
    ); // First 6 run concurrently, others queue
    
    return Response.json({ results });
  },
};
```

### Upload Size Considerations

```typescript
// Worker request body limits affect R2 uploads
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // On Free/Pro: max 100 MB incoming request
    // On Enterprise: max 500 MB incoming request
    
    // For larger files, use presigned URLs for direct upload
    // or implement chunked/multipart uploads
    
    if (request.headers.get("content-length")) {
      const size = parseInt(request.headers.get("content-length")!, 10);
      const maxSize = 100 * 1024 * 1024; // 100 MB
      
      if (size > maxSize) {
        return new Response(
          "File too large, use multipart upload",
          { status: 413 }
        );
      }
    }
    
    await env.BUCKET.put("upload.bin", request.body);
    return new Response("Uploaded", { status: 201 });
  },
};
```

## Custom Domain Limits

| Feature | Limit | Notes |
|---------|-------|-------|
| **Custom domains per bucket** | 50 | Maximum custom domains you can attach |

Custom domains provide:
- No rate limiting (much higher than r2.dev)
- Full Cloudflare CDN caching
- Custom caching rules
- Transform Rules and Page Rules
- Detailed analytics
- SSL/TLS termination

## Service Level Agreement (SLA)

**Applies to**: Enterprise customers only

| Metric | Target | Credit |
|--------|--------|--------|
| **Monthly uptime** | 99.9% | 10-50% credits if below threshold |
| **Error rate window** | 5 minutes | Measured over rolling 5-minute periods |
| **Excluded errors** | HTTP 429, 400-499 | Client errors and rate limits excluded |
| **Counted errors** | HTTP 500, 502, 503, 504 | Server errors only |

## Pricing-Related Limits

R2 has **zero egress fees** but has storage and operation costs:

| Operation Class | Cost | Examples |
|-----------------|------|----------|
| **Class A operations** | $4.50 per million | PUT, POST, LIST, COPY |
| **Class B operations** | $0.36 per million | GET, HEAD |
| **Storage** | $0.015 per GB-month | Total data stored |
| **Egress** | Free | No bandwidth charges |

**No hard limits on operations**, but you're billed for usage.

## Practical Limit Examples

### Example 1: Large File Upload Strategy

```typescript
// File: 500 GiB video file
// Strategy: Multipart upload

const fileSize = 500 * 1024 * 1024 * 1024; // 500 GiB
const partSize = 100 * 1024 * 1024; // 100 MiB per part
const numParts = Math.ceil(fileSize / partSize); // 5,120 parts

// Valid: under 10,000 part limit
console.log(`Uploading ${numParts} parts`); // 5,120 parts

// Upload
const upload = await bucket.createMultipartUpload("large-video.mp4");
// ... upload parts
```

### Example 2: Batch Operations

```typescript
// Delete 5,000 objects at once
const keysToDelete = Array.from(
  { length: 5000 },
  (_, i) => `temp/file-${i}.txt`
);

// No batch delete limit documented, but consider chunking
const chunkSize = 1000;
for (let i = 0; i < keysToDelete.length; i += chunkSize) {
  const chunk = keysToDelete.slice(i, i + chunkSize);
  await bucket.delete(chunk);
}
```

### Example 3: High-Throughput Reading

```typescript
// Reading many objects in parallel (respect 6 connection limit)
async function readBatch(bucket: R2Bucket, keys: string[]): Promise<string[]> {
  const CONCURRENT_LIMIT = 6; // Worker connection limit
  const results: string[] = [];
  
  for (let i = 0; i < keys.length; i += CONCURRENT_LIMIT) {
    const batch = keys.slice(i, i + CONCURRENT_LIMIT);
    const batchResults = await Promise.all(
      batch.map(async (key) => {
        const obj = await bucket.get(key);
        return obj ? await obj.text() : "";
      })
    );
    results.push(...batchResults);
  }
  
  return results;
}
```

## Error Handling for Limits

### HTTP 429: Rate Limit Exceeded

```typescript
async function putWithRetry(
  bucket: R2Bucket,
  key: string,
  data: string,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await bucket.put(key, data);
      return;
    } catch (error: any) {
      if (error.message?.includes("429") || error.status === 429) {
        // Rate limited - exponential backoff
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error; // Other error
    }
  }
  throw new Error(`Failed after ${maxRetries} retries`);
}
```

### Object Too Large

```typescript
async function uploadWithSizeCheck(
  bucket: R2Bucket,
  key: string,
  file: File
): Promise<void> {
  const MAX_SINGLE_PART = 5 * 1024 * 1024 * 1024; // 5 GiB
  const MAX_OBJECT_SIZE = 5 * (1024 ** 4); // 5 TiB
  
  if (file.size > MAX_OBJECT_SIZE) {
    throw new Error(`File exceeds maximum size: ${file.size} bytes`);
  }
  
  if (file.size > MAX_SINGLE_PART) {
    // Use multipart upload
    await uploadMultipart(bucket, key, file);
  } else {
    // Single-part upload
    await bucket.put(key, file.stream());
  }
}
```

## Request Limit Increases

Need higher limits? Complete the [Cloudflare Limit Increase Request Form](https://www.cloudflare.com/lp/limit-increase/).

Some limits that *may* be increased with approval:
- Buckets per account (from 1,000,000)
- Custom domains per bucket (from 50)
- Bucket management operation rate (from 50/sec)

**Note**: Object size, part size, and metadata limits are generally fixed and cannot be increased.

## Best Practices for Working Within Limits

1. **Use unique keys**: Avoid concurrent writes to the same key
2. **Implement exponential backoff**: Handle 429 errors gracefully
3. **Chunk large operations**: Batch deletions and listings into manageable sizes
4. **Monitor subrequest usage**: Stay within Worker subrequest limits
5. **Use custom domains**: Avoid r2.dev rate limiting in production
6. **Validate before upload**: Check file sizes and key lengths client-side
7. **Use multipart for large files**: Any file > 100 MB should use multipart
8. **Cache metadata**: Use `head()` to cache metadata instead of repeated `get()` calls
9. **Parallelize smartly**: Respect the 6 concurrent connection limit in Workers
10. **Plan for growth**: Design with limit headroom for traffic spikes

## Monitoring and Observability

Track your usage against limits:

```typescript
// Track operation counts
let operationCount = 0;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    operationCount++;
    
    if (operationCount > 950) { // Approaching 1000 subrequest limit
      console.warn("Approaching subrequest limit:", operationCount);
    }
    
    const object = await env.BUCKET.get("file.txt");
    return new Response(object?.body);
  },
};
```

Use Cloudflare Analytics to monitor:
- Request rates (watch for 429 responses)
- Bandwidth usage
- Error rates
- Response times

## Summary Table

| Category | Key Limit | Impact |
|----------|-----------|--------|
| Storage | 5 TiB per object | Use multipart for large files |
| Upload | 5 GiB single-part | Switch to multipart above 100 MB |
| Metadata | 8 KiB total | Keep metadata concise |
| Keys | 1,024 bytes | Use hierarchical naming |
| Rate (same key) | 1 write/second | Use unique keys or queue writes |
| Rate (r2.dev) | ~100s req/sec | Use custom domain for production |
| Workers | 6 connections | Batch operations carefully |
| Workers | 50/1000 subrequests | Monitor operation counts |

## Related Documentation

- [Cloudflare R2 Official Limits](https://developers.cloudflare.com/r2/platform/limits/)
- [Workers Platform Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [R2 Multipart Upload Guide](https://developers.cloudflare.com/r2/objects/multipart-objects/)
- [Custom Domains for R2](https://developers.cloudflare.com/r2/buckets/public-buckets/)
