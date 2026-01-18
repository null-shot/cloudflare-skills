# Queue Patterns

Advanced patterns for using Cloudflare Queues in production.

## Fan-Out Pattern

Distribute work from one queue to multiple downstream queues:

```typescript
interface Env {
  INCOMING_QUEUE: Queue;
  EMAIL_QUEUE: Queue<EmailTask>;
  ANALYTICS_QUEUE: Queue<AnalyticsEvent>;
  WEBHOOK_QUEUE: Queue<WebhookTask>;
}

export default {
  async queue(batch: MessageBatch<UserEvent>, env: Env) {
    for (const message of batch.messages) {
      const event = message.body;
      
      // Route to multiple downstream queues
      const tasks = [];
      
      if (event.shouldEmail) {
        tasks.push(env.EMAIL_QUEUE.send({
          to: event.userEmail,
          template: 'event-notification',
          data: event
        }));
      }
      
      // Always send to analytics
      tasks.push(env.ANALYTICS_QUEUE.send({
        eventType: event.type,
        userId: event.userId,
        timestamp: event.timestamp
      }));
      
      // Webhooks for certain event types
      if (['purchase', 'signup'].includes(event.type)) {
        tasks.push(env.WEBHOOK_QUEUE.send({
          url: event.webhookUrl,
          payload: event
        }));
      }
      
      await Promise.all(tasks);
    }
  }
};
```

## Priority Queue Pattern

Use separate queues for different priority levels:

```typescript
interface Env {
  HIGH_PRIORITY_QUEUE: Queue;
  LOW_PRIORITY_QUEUE: Queue;
}

// Producer routes based on priority
export default {
  async fetch(request: Request, env: Env) {
    const task = await request.json();
    
    if (task.priority === 'high') {
      await env.HIGH_PRIORITY_QUEUE.send(task);
    } else {
      await env.LOW_PRIORITY_QUEUE.send(task);
    }
    
    return Response.json({ status: 'queued' });
  }
};
```

**wrangler.jsonc:**
```jsonc
{
  "queues": {
    "producers": [
      { "name": "high-priority", "binding": "HIGH_PRIORITY_QUEUE" },
      { "name": "low-priority", "binding": "LOW_PRIORITY_QUEUE" }
    ],
    "consumers": [
      {
        "name": "high-priority",
        "max_batch_size": 10,
        "max_batch_timeout": 1  // Process quickly
      },
      {
        "name": "low-priority",
        "max_batch_size": 100,
        "max_batch_timeout": 30  // Larger batches
      }
    ]
  }
}
```

## Rate Limiting Pattern

Control the rate of requests to upstream APIs:

```typescript
interface Env {
  RATE_LIMITED_QUEUE: Queue;
  UPSTREAM_API: string;
}

export default {
  async queue(batch: MessageBatch, env: Env) {
    // Process messages sequentially with delay
    for (const message of batch.messages) {
      await fetch(env.UPSTREAM_API, {
        method: 'POST',
        body: JSON.stringify(message.body)
      });
      
      // Rate limit: 10 requests per second
      await sleep(100);
    }
  }
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Alternative: Configure batch size and timeout:**
```jsonc
{
  "queues": {
    "consumers": [{
      "name": "rate-limited-queue",
      "max_batch_size": 10,      // 10 requests per batch
      "max_batch_timeout": 1     // Every 1 second
    }]
  }
}
```

## Deduplication Pattern

Prevent duplicate processing using KV:

```typescript
interface Env {
  TASK_QUEUE: Queue;
  DEDUP_KV: KVNamespace;
}

export default {
  // Producer: Check for duplicates before sending
  async fetch(request: Request, env: Env) {
    const task = await request.json();
    const dedupKey = `dedup:${task.idempotencyKey}`;
    
    const existing = await env.DEDUP_KV.get(dedupKey);
    if (existing) {
      return Response.json({ status: 'already_queued' });
    }
    
    await Promise.all([
      env.TASK_QUEUE.send(task),
      env.DEDUP_KV.put(dedupKey, '1', { expirationTtl: 3600 })
    ]);
    
    return Response.json({ status: 'queued' });
  },

  // Consumer: Double-check in case of race
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      const dedupKey = `processed:${message.body.idempotencyKey}`;
      
      const alreadyProcessed = await env.DEDUP_KV.get(dedupKey);
      if (alreadyProcessed) {
        console.log('Skipping duplicate:', message.body.idempotencyKey);
        continue;
      }
      
      await processTask(message.body);
      
      // Mark as processed
      await env.DEDUP_KV.put(dedupKey, '1', { expirationTtl: 86400 });
    }
  }
};
```

## Aggregation Pattern

Aggregate data before processing:

```typescript
interface Env {
  EVENT_QUEUE: Queue;
  ANALYTICS_DB: D1Database;
}

export default {
  async queue(batch: MessageBatch<AnalyticsEvent>, env: Env) {
    // Aggregate events by user
    const userEvents = new Map<string, AnalyticsEvent[]>();
    
    for (const message of batch.messages) {
      const event = message.body;
      const userId = event.userId;
      
      if (!userEvents.has(userId)) {
        userEvents.set(userId, []);
      }
      userEvents.get(userId)!.push(event);
    }
    
    // Batch insert by user
    const statements = Array.from(userEvents.entries()).map(([userId, events]) => {
      return env.ANALYTICS_DB.prepare(
        'INSERT INTO user_events (user_id, event_count, last_seen) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET event_count = event_count + ?, last_seen = ?'
      ).bind(
        userId,
        events.length,
        new Date().toISOString(),
        events.length,
        new Date().toISOString()
      );
    });
    
    await env.ANALYTICS_DB.batch(statements);
  }
};
```

## Circuit Breaker Pattern

Pause processing when upstream fails:

```typescript
interface Env {
  TASK_QUEUE: Queue;
  CIRCUIT_KV: KVNamespace;
  RETRY_QUEUE: Queue;
}

export default {
  async queue(batch: MessageBatch, env: Env) {
    const circuitState = await env.CIRCUIT_KV.get('circuit:upstream');
    
    if (circuitState === 'open') {
      console.log('Circuit open, requeuing messages');
      await env.RETRY_QUEUE.sendBatch(batch.messages.map(m => m.body));
      return;
    }
    
    try {
      // Process messages
      for (const message of batch.messages) {
        await processMessage(message.body, env);
      }
      
      // Reset failure count on success
      await env.CIRCUIT_KV.put('circuit:failures', '0', { expirationTtl: 300 });
      
    } catch (error) {
      // Increment failure count
      const failures = parseInt(await env.CIRCUIT_KV.get('circuit:failures') || '0') + 1;
      await env.CIRCUIT_KV.put('circuit:failures', failures.toString(), { expirationTtl: 300 });
      
      // Open circuit after 5 failures
      if (failures >= 5) {
        await env.CIRCUIT_KV.put('circuit:upstream', 'open', { expirationTtl: 60 });
        console.error('Circuit opened due to repeated failures');
      }
      
      throw error;
    }
  }
};
```

## Message Transformation Pattern

Transform messages between different formats:

```typescript
interface Env {
  INCOMING_QUEUE: Queue;
  OUTGOING_QUEUE: Queue;
}

export default {
  async queue(batch: MessageBatch<LegacyFormat>, env: Env) {
    const transformed = batch.messages.map(message => ({
      id: message.body.legacy_id,
      userId: message.body.user_id,
      timestamp: new Date(message.body.created_at).toISOString(),
      data: {
        ...message.body.payload,
        version: 2
      }
    }));
    
    await env.OUTGOING_QUEUE.sendBatch(transformed);
  }
};
```

## Scheduled Processing Pattern

Use Cron Triggers to initiate batch processing:

```typescript
interface Env {
  NIGHTLY_QUEUE: Queue;
  DB: D1Database;
}

export default {
  // Cron trigger populates queue
  async scheduled(event: ScheduledEvent, env: Env) {
    const users = await env.DB.prepare(
      'SELECT id FROM users WHERE needs_daily_processing = 1'
    ).all();
    
    const tasks = users.results.map(user => ({ userId: user.id }));
    
    // Send in chunks of 100
    for (let i = 0; i < tasks.length; i += 100) {
      await env.NIGHTLY_QUEUE.sendBatch(tasks.slice(i, i + 100));
    }
  },

  // Queue consumer processes tasks
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      await processDailyTask(message.body.userId, env);
    }
  }
};
```

**wrangler.jsonc:**
```jsonc
{
  "triggers": {
    "crons": ["0 2 * * *"]  // 2 AM daily
  },
  "queues": {
    "producers": [
      { "name": "nightly-tasks", "binding": "NIGHTLY_QUEUE" }
    ],
    "consumers": [
      {
        "name": "nightly-tasks",
        "max_batch_size": 50,
        "max_batch_timeout": 30
      }
    ]
  }
}
```

## Best Practices

1. **Fan-out for parallel processing** - Split work into specialized queues
2. **Use separate queues for priorities** - Don't mix high and low priority in same queue
3. **Implement deduplication** - Prevent duplicate processing with KV
4. **Aggregate when possible** - Reduce database writes by batching similar operations
5. **Add circuit breakers** - Protect upstream services from cascading failures
6. **Transform at boundaries** - Keep message formats consistent within a system
7. **Schedule heavy workloads** - Use cron triggers to populate queues during off-peak hours
8. **Monitor queue depths** - Alert on growing queue sizes that indicate processing issues
