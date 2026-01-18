# Queue Error Handling

Comprehensive guide to handling errors in Cloudflare Queues.

## Retry Behavior

Messages are automatically retried when the queue handler throws an error:

```typescript
export default {
  async queue(batch: MessageBatch, env: Env) {
    // Throwing an error triggers retry for entire batch
    const response = await fetch(env.UPSTREAM_API);
    
    if (!response.ok) {
      throw new Error(`Upstream failed: ${response.status}`);
      // This batch will be retried after retry_delay seconds
    }
  }
};
```

**Retry Configuration:**
```jsonc
{
  "queues": {
    "consumers": [{
      "name": "my-queue",
      "retry_delay": 300,      // 5 minutes between retries
      "max_retries": 3,        // Try up to 3 times
      "dead_letter_queue": "my-queue-dlq"
    }]
  }
}
```

## Retry Strategies

### Strategy 1: Exponential Backoff

Use KV to track attempt counts and implement exponential backoff:

```typescript
interface Env {
  TASK_QUEUE: Queue;
  RETRY_STATE: KVNamespace;
}

export default {
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      const messageId = message.id;
      const attemptKey = `attempts:${messageId}`;
      
      const attempts = parseInt(await env.RETRY_STATE.get(attemptKey) || '0');
      
      try {
        await processMessage(message.body, env);
        
        // Success - clean up state
        await env.RETRY_STATE.delete(attemptKey);
        
      } catch (error) {
        const nextAttempt = attempts + 1;
        
        // Exponential backoff: 2^attempt minutes
        const backoffMinutes = Math.pow(2, nextAttempt);
        
        console.error(`Attempt ${nextAttempt} failed for ${messageId}`, error);
        
        if (nextAttempt >= 5) {
          // Give up after 5 attempts
          console.error('Max attempts reached, moving to DLQ');
          throw error;
        }
        
        // Store attempt count
        await env.RETRY_STATE.put(
          attemptKey,
          nextAttempt.toString(),
          { expirationTtl: backoffMinutes * 60 }
        );
        
        throw error; // Trigger retry
      }
    }
  }
};
```

### Strategy 2: Selective Retry

Only retry on transient errors:

```typescript
export default {
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      try {
        await processMessage(message.body, env);
        
      } catch (error) {
        // Identify error type
        if (isTransientError(error)) {
          console.log('Transient error, will retry:', error);
          throw error; // Trigger retry
          
        } else if (isPermanentError(error)) {
          console.error('Permanent error, skipping:', error);
          // Don't throw - message will be acknowledged
          // Optionally send to error tracking queue
          await env.ERROR_QUEUE.send({
            originalMessage: message.body,
            error: error.message,
            timestamp: new Date().toISOString()
          });
          
        } else {
          // Unknown error - retry to be safe
          throw error;
        }
      }
    }
  }
};

function isTransientError(error: any): boolean {
  // Network timeouts, 5xx errors, etc.
  return error.message.includes('timeout') ||
         error.message.includes('503') ||
         error.message.includes('504');
}

function isPermanentError(error: any): boolean {
  // Validation errors, 4xx errors, etc.
  return error.message.includes('validation') ||
         error.message.includes('400') ||
         error.message.includes('404');
}
```

### Strategy 3: Partial Batch Retry

Process successful messages, requeue failures:

```typescript
interface Env {
  MAIN_QUEUE: Queue;
  RETRY_QUEUE: Queue;
}

export default {
  async queue(batch: MessageBatch, env: Env) {
    const failedMessages = [];
    
    for (const message of batch.messages) {
      try {
        await processMessage(message.body, env);
      } catch (error) {
        console.error('Message failed:', error);
        failedMessages.push(message.body);
      }
    }
    
    if (failedMessages.length > 0) {
      // Send failed messages to retry queue
      await env.RETRY_QUEUE.sendBatch(failedMessages);
      console.log(`Requeued ${failedMessages.length} failed messages`);
    }
    
    // Don't throw - successfully processed messages won't be retried
  }
};
```

## Dead Letter Queue Management

### Setting Up DLQ

```jsonc
{
  "queues": {
    "producers": [
      { "name": "main-queue", "binding": "MAIN_QUEUE" },
      { "name": "main-queue-dlq", "binding": "DLQ" }
    ],
    "consumers": [
      {
        "name": "main-queue",
        "dead_letter_queue": "main-queue-dlq",
        "max_retries": 3
      },
      {
        "name": "main-queue-dlq"
        // No DLQ for DLQ - messages are logged and stored
      }
    ]
  }
}
```

### DLQ Consumer

Log and store failed messages for analysis:

```typescript
interface Env {
  DLQ: Queue;
  FAILED_MESSAGES: KVNamespace;
  ERROR_LOG: D1Database;
}

export default {
  // Main queue consumer
  async queue(batch: MessageBatch, env: Env) {
    // Process normally - failures go to DLQ
    for (const message of batch.messages) {
      await processMessage(message.body, env);
    }
  }
};

// Separate worker for DLQ
export class DLQWorker {
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      const failureId = crypto.randomUUID();
      
      // Store in KV for 30 days
      await env.FAILED_MESSAGES.put(
        `dlq:${failureId}`,
        JSON.stringify({
          id: message.id,
          body: message.body,
          timestamp: message.timestamp,
          attempts: message.attempts || 'unknown'
        }),
        { expirationTtl: 86400 * 30 }
      );
      
      // Log to D1 for querying
      await env.ERROR_LOG.prepare(
        'INSERT INTO failed_messages (id, queue_name, message_body, failed_at) VALUES (?, ?, ?, ?)'
      ).bind(
        failureId,
        'main-queue',
        JSON.stringify(message.body),
        new Date().toISOString()
      ).run();
      
      console.error('DLQ message:', {
        id: failureId,
        body: message.body
      });
    }
  }
}
```

### Replaying DLQ Messages

Manually replay messages after fixing issues:

```typescript
interface Env {
  FAILED_MESSAGES: KVNamespace;
  MAIN_QUEUE: Queue;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/admin/replay-dlq') {
      // List all DLQ messages
      const list = await env.FAILED_MESSAGES.list({ prefix: 'dlq:' });
      
      const replayedCount = 0;
      
      for (const key of list.keys) {
        const data = await env.FAILED_MESSAGES.get(key.name);
        if (!data) continue;
        
        const failed = JSON.parse(data);
        
        // Resend to main queue
        await env.MAIN_QUEUE.send(failed.body);
        
        // Remove from DLQ storage
        await env.FAILED_MESSAGES.delete(key.name);
        
        replayedCount++;
      }
      
      return Response.json({
        status: 'replayed',
        count: replayedCount
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
};
```

## Error Monitoring

Track and alert on queue errors:

```typescript
interface Env {
  TASK_QUEUE: Queue;
  ANALYTICS: AnalyticsEngineDataset;
}

export default {
  async queue(batch: MessageBatch, env: Env) {
    const startTime = Date.now();
    let successCount = 0;
    let failureCount = 0;
    
    for (const message of batch.messages) {
      try {
        await processMessage(message.body, env);
        successCount++;
        
      } catch (error) {
        failureCount++;
        
        // Log to Analytics Engine
        env.ANALYTICS.writeDataPoint({
          indexes: ['queue_error'],
          blobs: [
            'task-queue',
            error.message,
            message.body.type || 'unknown'
          ],
          doubles: [1] // Error count
        });
        
        throw error; // Still throw to trigger retry
      }
    }
    
    // Log batch metrics
    env.ANALYTICS.writeDataPoint({
      indexes: ['queue_batch'],
      blobs: ['task-queue'],
      doubles: [
        batch.messages.length,
        successCount,
        failureCount,
        Date.now() - startTime
      ]
    });
  }
};
```

## Timeout Handling

Handle long-running tasks that exceed batch timeout:

```typescript
interface Env {
  TASK_QUEUE: Queue;
  LONG_RUNNING_QUEUE: Queue;
}

export default {
  async queue(batch: MessageBatch, env: Env) {
    const batchTimeout = 25000; // 25 seconds (leave 5s buffer)
    const startTime = Date.now();
    
    for (const message of batch.messages) {
      // Check if we're approaching timeout
      if (Date.now() - startTime > batchTimeout) {
        console.log('Approaching timeout, requeuing remaining messages');
        
        // Requeue unprocessed messages
        const remaining = batch.messages.slice(
          batch.messages.indexOf(message)
        );
        await env.TASK_QUEUE.sendBatch(remaining.map(m => m.body));
        
        return; // Exit early
      }
      
      try {
        await processMessage(message.body, env);
      } catch (error) {
        // Check if error is due to long execution
        if (error.message.includes('timeout')) {
          // Move to queue with longer timeout
          await env.LONG_RUNNING_QUEUE.send(message.body);
        } else {
          throw error;
        }
      }
    }
  }
};
```

**Configure separate queue for long tasks:**
```jsonc
{
  "queues": {
    "consumers": [
      {
        "name": "task-queue",
        "max_batch_size": 100,
        "max_batch_timeout": 30
      },
      {
        "name": "long-running-queue",
        "max_batch_size": 1,      // Process one at a time
        "max_batch_timeout": 30   // Full timeout per message
      }
    ]
  }
}
```

## Best Practices

1. **Always configure DLQ** - Never lose messages due to repeated failures
2. **Log all DLQ messages** - Store in KV/D1 for later analysis and replay
3. **Distinguish error types** - Only retry transient errors, skip permanent ones
4. **Use exponential backoff** - Avoid overwhelming failing services
5. **Monitor error rates** - Alert when failure rate exceeds threshold
6. **Set appropriate retry_delay** - Give failing services time to recover
7. **Implement circuit breakers** - Stop processing when upstream is down
8. **Handle timeouts gracefully** - Requeue unprocessed messages before batch timeout
9. **Track message attempts** - Use KV to implement custom retry logic
10. **Build replay mechanisms** - Allow manual replay of DLQ messages after fixes
11. **Don't await writes in error handlers** - Use fire-and-forget for Analytics Engine
12. **Test failure scenarios** - Ensure retry and DLQ logic works as expected
