# Cloudflare Queues Limits

Comprehensive guide to limits, quotas, and constraints for Cloudflare Queues.

## Message Limits

### Message Size

| Limit | Value |
|-------|-------|
| Maximum message size | 128 KB |
| Maximum batch total size | 256 MB |
| Recommended message size | < 100 KB |

**Best Practices:**
```typescript
interface Env {
  QUEUE: Queue;
  LARGE_PAYLOADS: R2Bucket;
}

async function sendMessage(data: any, env: Env) {
  const serialized = JSON.stringify(data);
  const sizeKB = new Blob([serialized]).size / 1024;
  
  if (sizeKB > 100) {
    // Store large payload in R2/KV
    const key = crypto.randomUUID();
    await env.LARGE_PAYLOADS.put(key, serialized);
    
    // Send reference instead
    await env.QUEUE.send({
      type: 'large_payload',
      storageKey: key,
      size: sizeKB
    });
  } else {
    await env.QUEUE.send(data);
  }
}
```

### Message Count

| Limit | Value |
|-------|-------|
| Maximum messages in single `sendBatch()` | 100 |
| Maximum messages per consumer batch | 100 |
| Recommended batch size | 10-50 messages |

**Batching Strategy:**
```typescript
// Split large arrays into batches of 100
async function sendLargeBatch(messages: any[], env: Env) {
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    await env.QUEUE.sendBatch(batch);
  }
}
```

## Consumer Configuration Limits

### Batch Processing

| Setting | Minimum | Maximum | Default |
|---------|---------|---------|---------|
| `max_batch_size` | 1 | 100 | 10 |
| `max_batch_timeout` | 1 second | 30 seconds | 5 seconds |
| `max_retries` | 0 | No limit | 3 |
| `retry_delay` | 0 seconds | No limit | 0 seconds |

**Configuration Example:**
```jsonc
{
  "queues": {
    "consumers": [{
      "name": "my-queue",
      "max_batch_size": 100,        // Process up to 100 messages
      "max_batch_timeout": 30,      // Wait max 30 seconds
      "max_retries": 5,             // Retry up to 5 times
      "retry_delay": 300,           // Wait 5 minutes between retries
      "dead_letter_queue": "my-dlq" // Required for DLQ
    }]
  }
}
```

### Consumer Behavior

- **Batch Timeout**: Consumer waits up to `max_batch_timeout` seconds to accumulate messages
- **Batch Size**: Consumer processes when `max_batch_size` is reached OR timeout expires
- **Concurrency**: Multiple consumer instances can run concurrently (auto-scaled by Cloudflare)
- **Retries**: Entire batch is retried if handler throws an error

**Understanding Batch Triggers:**
```typescript
// Batch is triggered when EITHER condition is met:
// 1. max_batch_size messages accumulated (e.g., 100 messages)
// 2. max_batch_timeout seconds elapsed (e.g., 30 seconds)

export default {
  async queue(batch: MessageBatch, env: Env) {
    console.log(`Processing batch of ${batch.messages.length} messages`);
    // Could be anywhere from 1 to max_batch_size messages
  }
};
```

## Queue Operations Limits

### Throughput

| Operation | Limit |
|-----------|-------|
| Messages sent per second | No hard limit (auto-scaled) |
| Messages processed per second | No hard limit (auto-scaled) |
| Queue creation | No limit |

**Note:** Cloudflare auto-scales queue processing based on queue depth. No manual scaling required.

### Queue Count

| Limit | Value |
|-------|-------|
| Queues per account | No hard limit |
| Producers per Worker | No limit |
| Consumers per Worker | No limit |
| Dead letter queues | One per consumer |

## Message Retention

### Retention Limits

| Type | Retention |
|------|-----------|
| Standard messages | Not guaranteed past delivery |
| Dead letter queue messages | 3 days |
| In-flight messages | Until processed or moved to DLQ |

**DLQ Message Persistence:**
```typescript
// Messages in DLQ expire after 3 days
// Archive them for longer retention
interface Env {
  DLQ_QUEUE: Queue;
  ARCHIVE_DB: D1Database;
}

export default {
  async queue(batch: MessageBatch, env: Env) {
    // Store DLQ messages for long-term retention
    const statements = batch.messages.map(msg =>
      env.ARCHIVE_DB.prepare(
        'INSERT INTO dlq_archive (message_id, body, failed_at) VALUES (?, ?, ?)'
      ).bind(
        msg.id,
        JSON.stringify(msg.body),
        new Date().toISOString()
      )
    );
    
    await env.ARCHIVE_DB.batch(statements);
  }
};
```

## CPU and Memory Limits

### Worker Limits (applies to queue consumers)

| Resource | Limit |
|----------|-------|
| CPU time per batch | 30 seconds (Standard), 15 minutes (Unbound) |
| Memory | 128 MB |
| Subrequests per batch | 50 (Standard), 1000 (Unbound) |

**Note:** Queue consumers use the same limits as regular Workers.

**Handling CPU Limits:**
```typescript
export default {
  async queue(batch: MessageBatch, env: Env) {
    const startTime = Date.now();
    const CPU_TIME_LIMIT = 25000; // 25 seconds (leave 5s buffer)
    
    for (const message of batch.messages) {
      if (Date.now() - startTime > CPU_TIME_LIMIT) {
        // Requeue remaining messages
        const remaining = batch.messages.slice(
          batch.messages.indexOf(message)
        );
        await env.QUEUE.sendBatch(remaining.map(m => m.body));
        return;
      }
      
      await processMessage(message.body, env);
    }
  }
};
```

## Request Rate Limits

### API Operations

| Operation | Rate Limit |
|-----------|------------|
| `send()` / `sendBatch()` | No specific limit |
| Queue management (create, delete) | Standard API limits |

**Handling High Throughput:**
```typescript
// No special handling needed - queues auto-scale
// But consider batching for efficiency
async function efficientSend(messages: any[], env: Env) {
  if (messages.length === 1) {
    await env.QUEUE.send(messages[0]);
  } else {
    // Batch when possible
    await env.QUEUE.sendBatch(messages);
  }
}
```

## Dead Letter Queue Limits

### DLQ Configuration

| Limit | Value |
|-------|-------|
| DLQ per consumer | 1 |
| DLQ message retention | 3 days |
| DLQ nesting | Not allowed (DLQ cannot have its own DLQ) |

**DLQ Best Practices:**
```jsonc
{
  "queues": {
    "consumers": [
      {
        "name": "main-queue",
        "dead_letter_queue": "main-dlq",
        "max_retries": 3
      },
      {
        "name": "main-dlq"
        // No DLQ for the DLQ itself
        // Messages here must be handled or they expire after 3 days
      }
    ]
  }
}
```

## Naming Constraints

### Queue Names

| Constraint | Requirement |
|------------|-------------|
| Length | 1-63 characters |
| Characters | Lowercase letters, numbers, hyphens |
| Start/end | Must start and end with letter or number |
| Pattern | `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` |

**Valid Queue Names:**
```typescript
// Valid
"user-events"
"analytics-queue"
"api-requests-v2"
"queue123"

// Invalid
"User-Events"          // Uppercase not allowed
"analytics_queue"      // Underscore not allowed
"-my-queue"            // Cannot start with hyphen
"queue-"               // Cannot end with hyphen
"a".repeat(64)         // Too long (max 63 chars)
```

## Message Ordering

### Ordering Guarantees

| Guarantee | Supported |
|-----------|-----------|
| FIFO (First In, First Out) | Best effort, not guaranteed |
| Message ordering within batch | Not guaranteed |
| Exactly-once delivery | Not guaranteed |

**Handling Ordering:**
```typescript
// If ordering is critical, include sequence numbers
interface OrderedMessage {
  sequenceNumber: number;
  data: any;
}

export default {
  async queue(batch: MessageBatch<OrderedMessage>, env: Env) {
    // Sort by sequence number
    const sorted = batch.messages
      .map(m => m.body)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    for (const message of sorted) {
      await processInOrder(message, env);
    }
  }
};
```

## Visibility Timeout

### Message Visibility

| Setting | Behavior |
|---------|----------|
| In-flight visibility | Messages being processed are invisible to other consumers |
| Retry visibility | Failed messages become visible again after `retry_delay` |

**Implications:**
```typescript
// Message is invisible while being processed
// If handler throws, message becomes visible again after retry_delay
export default {
  async queue(batch: MessageBatch, env: Env) {
    // Messages in this batch are invisible to other consumers
    // until this handler completes or fails
    
    for (const message of batch.messages) {
      await processMessage(message.body, env);
    }
    
    // On success: messages are deleted
    // On error: messages become visible after retry_delay
  }
};
```

## Plan-Specific Limits

### Free and Paid Plans

| Feature | Free | Paid |
|---------|------|------|
| Queue operations | Included | Included |
| Message size | 128 KB | 128 KB |
| Max batch size | 100 | 100 |
| Retention | Same | Same |
| Consumer CPU time | 30s (Standard) | 15m (Unbound available) |

**Note:** Queue operations count toward Worker request limits on your plan.

## Monitoring Queue Depth

Track queue metrics to avoid hitting processing capacity:

```typescript
interface Env {
  QUEUE: Queue;
  ANALYTICS: AnalyticsEngineDataset;
}

export default {
  // Producer tracks queue depth
  async fetch(request: Request, env: Env) {
    await env.QUEUE.send({ data: 'payload' });
    
    // Log queue operations
    env.ANALYTICS.writeDataPoint({
      indexes: ['queue_operation'],
      blobs: ['send', 'my-queue'],
      doubles: [1]
    });
    
    return Response.json({ status: 'queued' });
  },

  // Consumer tracks processing rate
  async queue(batch: MessageBatch, env: Env) {
    const startTime = Date.now();
    
    for (const message of batch.messages) {
      await processMessage(message.body, env);
    }
    
    // Log batch metrics
    env.ANALYTICS.writeDataPoint({
      indexes: ['queue_batch'],
      blobs: ['my-queue'],
      doubles: [
        batch.messages.length,
        Date.now() - startTime
      ]
    });
  }
};
```

## Best Practices for Working Within Limits

1. **Keep messages small** - Under 100KB when possible
2. **Use appropriate batch sizes** - 10-50 messages for most use cases
3. **Set reasonable timeouts** - Balance latency vs batch efficiency
4. **Archive DLQ messages** - 3-day retention requires active archival
5. **Monitor CPU usage** - Requeue if approaching 30s limit
6. **Implement idempotency** - No exactly-once guarantee
7. **Handle ordering externally** - Use sequence numbers if order matters
8. **Use R2/KV for large payloads** - Send references instead of full data
9. **Batch operations** - Use `sendBatch()` instead of multiple `send()` calls
10. **Test retry logic** - Ensure handlers work correctly on retries

## Exceeding Limits

### What Happens

| Limit Exceeded | Result |
|----------------|--------|
| Message > 128 KB | Error thrown, message not sent |
| Batch > 100 messages | Error thrown, nothing sent |
| CPU timeout (30s) | Worker terminated, batch retried |
| Memory exceeded | Worker terminated, batch retried |
| DLQ retention (3 days) | Messages deleted automatically |

### Error Handling

```typescript
async function sendWithLimitHandling(data: any, env: Env) {
  const serialized = JSON.stringify(data);
  const sizeBytes = new Blob([serialized]).size;
  
  if (sizeBytes > 128_000) { // 128 KB
    throw new Error(
      `Message too large: ${sizeBytes} bytes (max 128 KB)`
    );
  }
  
  try {
    await env.QUEUE.send(data);
  } catch (error) {
    if (error.message.includes('too large')) {
      // Handle oversized message
      console.error('Message exceeds size limit');
    } else {
      throw error;
    }
  }
}
```

## Related Resources

- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Queue Monitoring Guide](https://developers.cloudflare.com/queues/observability/)
