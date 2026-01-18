# S3 API Compatibility Reference

Cloudflare R2 is fully compatible with the AWS S3 API. Use AWS SDK, tools like `s3cmd`, `aws-cli`, or any S3-compatible client.

## Why Use S3 Compatibility

- **Presigned URLs**: Generate time-limited upload/download URLs
- **Existing tools**: Use `aws-cli`, Terraform, Rclone, s3cmd
- **Migration**: Drop-in replacement for S3 workflows
- **Client-side uploads**: Let clients upload directly to R2
- **Legacy integrations**: Connect existing S3-based systems

**When to use native R2Bucket**: For basic operations (get, put, delete, list) inside Workers. It's more efficient and doesn't require credentials.

**When to use AWS SDK**: When you need presigned URLs, S3-specific features, or integrating with external tools.

## Setup with AWS SDK v3

### Install Dependencies

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### Generate R2 API Tokens

1. Go to Cloudflare Dashboard → R2 → Settings
2. Create API Token with R2 Read & Write permissions
3. Save `Access Key ID` and `Secret Access Key`
4. Note your Account ID from the dashboard URL

### Wrangler Configuration

Add Node.js compatibility flag:

```jsonc
// wrangler.jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat_v2"],
  "r2_buckets": [
    { "binding": "BUCKET", "bucket_name": "my-bucket" }
  ]
}
```

**Add secrets** (never hardcode credentials):

```bash
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID
```

### S3 Client Setup

```typescript
import { S3Client } from "@aws-sdk/client-s3";

export interface Env {
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
}

function getS3Client(env: Env): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}
```

**Important**: Always use `region: "auto"` for R2.

## Basic Operations with AWS SDK

### Put Object

```typescript
import { PutObjectCommand } from "@aws-sdk/client-s3";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const s3 = getS3Client(env);

    await s3.send(
      new PutObjectCommand({
        Bucket: "my-bucket",
        Key: "example.txt",
        Body: "Hello from S3 SDK!",
        ContentType: "text/plain",
        Metadata: {
          author: "worker",
          timestamp: new Date().toISOString(),
        },
      })
    );

    return Response.json({ success: true });
  },
};
```

### Get Object

```typescript
import { GetObjectCommand } from "@aws-sdk/client-s3";

const response = await s3.send(
  new GetObjectCommand({
    Bucket: "my-bucket",
    Key: "example.txt",
  })
);

// Convert Body stream to string
const body = await response.Body?.transformToString();
console.log(body);

// Access metadata
console.log({
  contentType: response.ContentType,
  etag: response.ETag,
  metadata: response.Metadata,
});
```

### Delete Object

```typescript
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

await s3.send(
  new DeleteObjectCommand({
    Bucket: "my-bucket",
    Key: "example.txt",
  })
);
```

### List Objects

```typescript
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

const response = await s3.send(
  new ListObjectsV2Command({
    Bucket: "my-bucket",
    Prefix: "uploads/",
    MaxKeys: 100,
  })
);

for (const object of response.Contents || []) {
  console.log({
    key: object.Key,
    size: object.Size,
    lastModified: object.LastModified,
  });
}
```

## Presigned URLs

Generate time-limited URLs that allow clients to upload or download directly without Worker authentication.

### Presigned Download URL

Allow users to download files without exposing credentials.

```typescript
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const key = url.searchParams.get("file");

    if (!key) {
      return new Response("Missing file parameter", { status: 400 });
    }

    const s3 = getS3Client(env);
    const command = new GetObjectCommand({
      Bucket: "my-bucket",
      Key: key,
    });

    // URL valid for 1 hour
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return Response.json({ downloadUrl: signedUrl });
  },
};
```

**Client usage:**

```javascript
const response = await fetch("/download-url?file=document.pdf");
const { downloadUrl } = await response.json();

// User can now download directly from R2
window.location.href = downloadUrl;
```

### Presigned Upload URL

Allow users to upload files directly to R2 without going through your Worker.

```typescript
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === "/upload-url") {
      const filename = url.searchParams.get("filename");
      const contentType = url.searchParams.get("contentType") || "application/octet-stream";

      const key = `uploads/${crypto.randomUUID()}-${filename}`;
      const s3 = getS3Client(env);

      const command = new PutObjectCommand({
        Bucket: "my-bucket",
        Key: key,
        ContentType: contentType,
      });

      // URL valid for 5 minutes
      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

      return Response.json({
        uploadUrl,
        key,
        method: "PUT",
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
```

**Client usage:**

```javascript
async function uploadFile(file) {
  // 1. Get presigned URL
  const response = await fetch(
    `/upload-url?filename=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(file.type)}`
  );
  const { uploadUrl, key } = await response.json();

  // 2. Upload directly to R2
  await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type,
    },
  });

  return key;
}

// Usage
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];
const key = await uploadFile(file);
console.log("Uploaded to:", key);
```

### Presigned URL with Custom Metadata

```typescript
const command = new PutObjectCommand({
  Bucket: "my-bucket",
  Key: key,
  ContentType: "image/jpeg",
  Metadata: {
    userId: "user-123",
    uploadSource: "web-app",
  },
  CacheControl: "public, max-age=31536000",
});

const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
```

### Presigned URL with Content Disposition

Force download with specific filename:

```typescript
const command = new GetObjectCommand({
  Bucket: "my-bucket",
  Key: "report.pdf",
  ResponseContentDisposition: 'attachment; filename="Monthly-Report-Jan-2024.pdf"',
});

const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
```

## Multipart Upload with S3 API

For large files, use multipart uploads.

### Create Multipart Upload

```typescript
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";

// Initiate
const createResponse = await s3.send(
  new CreateMultipartUploadCommand({
    Bucket: "my-bucket",
    Key: "large-file.zip",
    ContentType: "application/zip",
  })
);

const uploadId = createResponse.UploadId;
```

### Upload Parts

```typescript
const parts = [];
const chunkSize = 10 * 1024 * 1024; // 10MB

for (let i = 0; i < chunks.length; i++) {
  const partNumber = i + 1;
  
  const uploadResponse = await s3.send(
    new UploadPartCommand({
      Bucket: "my-bucket",
      Key: "large-file.zip",
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: chunks[i],
    })
  );

  parts.push({
    PartNumber: partNumber,
    ETag: uploadResponse.ETag,
  });
}
```

### Complete Upload

```typescript
await s3.send(
  new CompleteMultipartUploadCommand({
    Bucket: "my-bucket",
    Key: "large-file.zip",
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts,
    },
  })
);
```

### Abort Upload

```typescript
await s3.send(
  new AbortMultipartUploadCommand({
    Bucket: "my-bucket",
    Key: "large-file.zip",
    UploadId: uploadId,
  })
);
```

## Using AWS CLI

### Configure AWS CLI

Create `~/.aws/credentials`:

```ini
[r2]
aws_access_key_id = YOUR_R2_ACCESS_KEY_ID
aws_secret_access_key = YOUR_R2_SECRET_ACCESS_KEY
```

Create `~/.aws/config`:

```ini
[profile r2]
region = auto
endpoint_url = https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
```

### CLI Commands

```bash
# List buckets
aws s3 ls --profile r2 --endpoint-url https://ACCOUNT_ID.r2.cloudflarestorage.com

# Upload file
aws s3 cp local-file.txt s3://my-bucket/file.txt --profile r2

# Download file
aws s3 cp s3://my-bucket/file.txt local-file.txt --profile r2

# Sync directory
aws s3 sync ./dist/ s3://my-bucket/public/ --profile r2

# List objects in bucket
aws s3 ls s3://my-bucket/ --recursive --profile r2

# Delete object
aws s3 rm s3://my-bucket/file.txt --profile r2

# Generate presigned URL (requires specific endpoint)
aws s3 presign s3://my-bucket/file.txt --expires-in 3600 --profile r2 \
  --endpoint-url https://ACCOUNT_ID.r2.cloudflarestorage.com
```

## Migration from AWS S3 to R2

### 1. Assess Current Usage

- Identify S3 buckets and their access patterns
- Check for S3-specific features (versioning, lifecycle policies, replication)
- Review IAM policies and access controls

### 2. Create R2 Buckets

```bash
# Create matching buckets in R2
wrangler r2 bucket create my-app-assets
wrangler r2 bucket create my-app-uploads
```

### 3. Update Endpoint Configuration

Change S3 endpoint in your code:

```typescript
// Before (AWS S3)
const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// After (R2)
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
```

### 4. Migrate Data

**Option A: Using rclone**

```bash
# Configure rclone for S3
rclone config create s3source s3 \
  provider AWS \
  access_key_id YOUR_AWS_KEY \
  secret_access_key YOUR_AWS_SECRET \
  region us-east-1

# Configure rclone for R2
rclone config create r2dest s3 \
  provider Cloudflare \
  access_key_id YOUR_R2_KEY \
  secret_access_key YOUR_R2_SECRET \
  endpoint https://ACCOUNT_ID.r2.cloudflarestorage.com

# Copy data
rclone copy s3source:my-bucket r2dest:my-bucket --progress
```

**Option B: Using Worker**

```typescript
// Migration worker (run once)
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const s3Source = new S3Client({
      region: "us-east-1",
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const s3Dest = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });

    // List and copy objects
    let continuationToken: string | undefined;
    let copied = 0;

    do {
      const listResponse = await s3Source.send(
        new ListObjectsV2Command({
          Bucket: "source-bucket",
          ContinuationToken: continuationToken,
        })
      );

      for (const object of listResponse.Contents || []) {
        // Get from S3
        const getResponse = await s3Source.send(
          new GetObjectCommand({
            Bucket: "source-bucket",
            Key: object.Key,
          })
        );

        // Put to R2
        await s3Dest.send(
          new PutObjectCommand({
            Bucket: "dest-bucket",
            Key: object.Key,
            Body: getResponse.Body,
            ContentType: getResponse.ContentType,
            Metadata: getResponse.Metadata,
          })
        );

        copied++;
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return Response.json({ copied });
  },
};
```

### 5. Update DNS/CDN

If using custom domains:

1. Update CNAME records to point to R2
2. Configure R2 public bucket if needed
3. Test thoroughly before switching production traffic

## S3 API Feature Support

### Supported Operations

- ✅ GetObject, PutObject, DeleteObject, HeadObject
- ✅ ListObjectsV2
- ✅ CreateMultipartUpload, UploadPart, CompleteMultipartUpload
- ✅ CopyObject
- ✅ GetObjectAttributes
- ✅ Presigned URLs

### Partially Supported

- ⚠️ **Object versioning**: Not supported (only latest version exists)
- ⚠️ **Object locking**: Not supported
- ⚠️ **Lifecycle policies**: Use Cloudflare dashboard, not S3 API

### Not Supported

- ❌ **ACLs**: R2 uses bucket-level permissions
- ❌ **Bucket policies**: Use Cloudflare dashboard
- ❌ **Replication**: Not available
- ❌ **Server-side encryption (SSE-C, SSE-KMS)**: R2 encrypts at rest automatically
- ❌ **Requester pays**: Not supported
- ❌ **Notifications**: Use Workers and bindings instead

## Performance Comparison

| Feature | R2 | AWS S3 |
|---------|-----|--------|
| Egress fees | Free | $0.09/GB |
| Operations | Free (Class A/B) | $0.005 per 1000 |
| Storage | $0.015/GB-month | $0.023/GB-month |
| Global access | Fast via Cloudflare network | Regional by default |
| Native Workers integration | ✅ Zero latency | ❌ External API calls |

## Best Practices

1. **Use native R2Bucket in Workers**: Avoid S3 SDK overhead for basic operations
2. **Reserve AWS SDK for presigned URLs**: Use when clients need direct access
3. **Cache S3Client instances**: Don't create new client on every request
4. **Set appropriate expiration**: Keep presigned URL validity short (5-15 minutes for uploads)
5. **Validate uploads**: Check file exists after presigned URL expires
6. **Use HTTPS only**: R2 requires HTTPS for presigned URLs
7. **Store credentials as secrets**: Never hardcode in code or config files
8. **Test presigned URLs**: Validate they work before sending to clients
9. **Monitor expiration**: Track when presigned URLs expire to avoid user errors
10. **Use region: "auto"**: Always use `auto` region for R2

## Troubleshooting

### "InvalidAccessKeyId" Error

- Verify credentials are correct
- Ensure secrets are properly set: `wrangler secret list`
- Check account ID matches the one in dashboard URL

### "SignatureDoesNotMatch" Error

- Verify secret access key is correct (regenerate if needed)
- Ensure no extra whitespace in credentials
- Check endpoint URL is correct

### Presigned URL Not Working

- Verify URL hasn't expired
- Check CORS settings if accessing from browser
- Ensure HTTP method matches (PUT for upload, GET for download)
- Verify Content-Type header matches what was signed

### Performance Issues with AWS SDK

- Use native R2Bucket binding instead for better performance
- Cache S3Client instances
- Consider streaming instead of buffering entire files
- Use Workers R2 binding for operations inside Workers
