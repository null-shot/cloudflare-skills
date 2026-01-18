# Testing Workflows with Vitest

Complete guide to testing Cloudflare Workflows using the Vitest integration and workflow introspection APIs.

## Setup

Install dependencies:

```bash
npm install -D vitest @cloudflare/vitest-pool-workers
```

Configure `vitest.config.ts`:

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        isolatedStorage: true, // Required for workflow test isolation
      },
    },
  },
});
```

**Important**: Set `isolatedStorage: true` for proper test isolation in Workflows. Each test gets its own storage instance.

## Workflow Introspection API

The `cloudflare:test` module provides powerful introspection APIs for testing Workflows.

### `introspectWorkflowInstance()` - Test Specific Instances

Use when you know the instance ID beforehand:

```typescript
import { env, introspectWorkflowInstance } from 'cloudflare:test';
import { it, expect } from 'vitest';

it('should disable all sleeps, mock an event and complete', async () => {
  // 1. CONFIGURATION
  await using instance = await introspectWorkflowInstance(env.MY_WORKFLOW, '123456');
  
  await instance.modify(async (m) => {
    await m.disableSleeps();
    await m.mockEvent({
      type: 'user-approval',
      payload: { approved: true, approverId: 'user-123' },
    });
  });
  
  // 2. EXECUTION
  await env.MY_WORKFLOW.create({ id: '123456' });
  
  // 3. ASSERTION
  await expect(instance.waitForStatus('complete')).resolves.not.toThrow();
  const output = await instance.getOutput();
  expect(output).toEqual({ success: true });
  
  // 4. DISPOSE: is implicit and automatic with 'await using'
});
```

**Key points**:
- Use `await using` for automatic disposal (required for test isolation)
- Or manually call `await instance.dispose()` in try/finally block
- Configure modifications before creating the instance
- Modifications apply only to that specific instance

### `introspectWorkflow()` - Test Unknown Instances

Use when instance IDs are unknown or multiple instances are created:

```typescript
import { env, introspectWorkflow, SELF } from 'cloudflare:test';
import { it, expect } from 'vitest';

it('should disable all sleeps for all instances', async () => {
  // 1. CONFIGURATION
  await using introspector = await introspectWorkflow(env.MY_WORKFLOW);
  
  await introspector.modifyAll(async (m) => {
    await m.disableSleeps();
    await m.mockEvent({
      type: 'user-approval',
      payload: { approved: true, approverId: 'user-123' },
    });
  });
  
  // 2. EXECUTION - trigger via fetch (could create multiple instances)
  await SELF.fetch('https://example.com/trigger-workflows');
  
  // 3. ASSERTION - check all created instances
  const instances = introspector.get();
  for (const instance of instances) {
    await expect(instance.waitForStatus('complete')).resolves.not.toThrow();
    const output = await instance.getOutput();
    expect(output).toEqual({ success: true });
  }
  
  // 4. DISPOSE: automatic with 'await using'
});
```

**When to use**:
- Instances created indirectly (via Worker fetch handler)
- Multiple instances created in single test
- Don't know instance IDs in advance

## Workflow Instance Introspector

Methods available on `WorkflowInstanceIntrospector` (returned by both `introspectWorkflowInstance` and `introspectWorkflow`):

### `modify(fn)`

Apply modifications to instance behavior:

```typescript
await instance.modify(async (m) => {
  // Disable sleeps
  await m.disableSleeps();
  
  // Mock step results
  await m.mockStepResult({ name: 'fetch-data' }, { data: 'mocked' });
  
  // Mock events
  await m.mockEvent({ type: 'approval', payload: { approved: true } });
  
  // Force step errors
  await m.mockStepError({ name: 'api-call' }, new Error('Timeout'), 1);
  
  // Force step timeout
  await m.forceStepTimeout({ name: 'slow-step' });
  
  // Force event timeout
  await m.forceEventTimeout({ name: 'wait-for-webhook' });
});
```

### `waitForStepResult(step)`

Wait for a specific step to complete and get its result:

```typescript
const result = await instance.waitForStepResult({ name: 'fetch-user' });
expect(result).toEqual({ userId: '123', name: 'Alice' });

// If multiple steps have same name, use index (1-based)
const result2 = await instance.waitForStepResult({ name: 'fetch-user', index: 2 });
```

### `waitForStatus(status)`

Wait for instance to reach a specific status:

```typescript
// Wait for completion
await instance.waitForStatus('complete');

// Wait for error state
await instance.waitForStatus('errored');

// Other statuses: 'running', 'queued', 'paused', 'terminated', 'unknown'
```

### `getOutput()`

Get the workflow's return value (only for completed instances):

```typescript
await instance.waitForStatus('complete');
const output = await instance.getOutput();
expect(output).toEqual({ processedItems: 42 });
```

### `getError()`

Get error information (only for errored instances):

```typescript
await instance.waitForStatus('errored');
const error = await instance.getError();
expect(error.name).toBe('Error');
expect(error.message).toContain('timeout');
```

### `dispose()`

Dispose the introspector (crucial for test isolation):

```typescript
// Manual disposal
const instance = await introspectWorkflowInstance(env.MY_WORKFLOW, 'id');
try {
  // ... test code ...
} finally {
  await instance.dispose();
}

// OR use 'await using' for automatic disposal (preferred)
await using instance = await introspectWorkflowInstance(env.MY_WORKFLOW, 'id');
```

## Workflow Instance Modifier

Available in `modify()` and `modifyAll()` callbacks:

### `disableSleeps()`

Make all `step.sleep()` calls resolve immediately:

```typescript
await instance.modify(async (m) => {
  // Disable all sleeps
  await m.disableSleeps();
  
  // Or disable specific sleeps
  await m.disableSleeps([
    { name: 'wait-1-hour' },
    { name: 'wait-5-minutes', index: 2 }, // Second occurrence
  ]);
});
```

**Use case**: Speed up tests that have long sleeps

### `mockStepResult()`

Mock a step's result without executing it:

```typescript
await instance.modify(async (m) => {
  await m.mockStepResult(
    { name: 'fetch-user-data' },
    { userId: '123', email: 'test@example.com' }
  );
  
  // Mock second occurrence of same step name
  await m.mockStepResult(
    { name: 'fetch-user-data', index: 2 },
    { userId: '456', email: 'other@example.com' }
  );
});
```

**Use case**: Test workflow logic without external dependencies

### `mockStepError()`

Force a step to throw an error:

```typescript
await instance.modify(async (m) => {
  // Fail once, then succeed (tests retry logic)
  await m.mockStepError(
    { name: 'api-call' },
    new Error('Service unavailable'),
    1 // Fail only first attempt
  );
  
  // Fail every time (workflow will error)
  await m.mockStepError(
    { name: 'critical-step' },
    new Error('Permanent failure')
    // No times specified = fail every attempt
  );
});
```

**Use case**: Test error handling and retry behavior

### `forceStepTimeout()`

Force a step to timeout immediately:

```typescript
await instance.modify(async (m) => {
  // Timeout once (tests retry after timeout)
  await m.forceStepTimeout({ name: 'slow-api' }, 1);
  
  // Timeout every time (workflow will error)
  await m.forceStepTimeout({ name: 'unreliable-service' });
});
```

**Use case**: Test timeout handling

### `mockEvent()`

Send a mock event to satisfy `step.waitForEvent()`:

```typescript
await instance.modify(async (m) => {
  await m.mockEvent({
    type: 'user-approval',
    payload: {
      approved: true,
      approverId: 'user-123',
      timestamp: Date.now(),
    },
  });
});
```

**Use case**: Test human-in-the-loop workflows without external events

### `forceEventTimeout()`

Force `step.waitForEvent()` to timeout:

```typescript
await instance.modify(async (m) => {
  await m.forceEventTimeout({ name: 'wait-for-webhook' });
});
```

**Use case**: Test event timeout handling

## Complete Testing Examples

### Test with Mocked Steps

```typescript
import { env, introspectWorkflowInstance } from 'cloudflare:test';
import { it, expect } from 'vitest';

it('should process order with mocked external calls', async () => {
  await using instance = await introspectWorkflowInstance(env.ORDER_WORKFLOW, 'order-123');
  
  await instance.modify(async (m) => {
    // Mock external API calls
    await m.mockStepResult(
      { name: 'fetch-inventory' },
      { inStock: true, quantity: 10 }
    );
    
    await m.mockStepResult(
      { name: 'charge-payment' },
      { transactionId: 'txn-456', success: true }
    );
    
    // Disable sleeps to speed up test
    await m.disableSleeps();
  });
  
  await env.ORDER_WORKFLOW.create({
    id: 'order-123',
    params: { orderId: 'order-123', items: [1, 2, 3] },
  });
  
  await instance.waitForStatus('complete');
  const output = await instance.getOutput();
  
  expect(output).toEqual({
    orderId: 'order-123',
    status: 'fulfilled',
    transactionId: 'txn-456',
  });
});
```

### Test Retry Logic

```typescript
it('should retry failed steps', async () => {
  await using instance = await introspectWorkflowInstance(env.MY_WORKFLOW, 'test-123');
  
  await instance.modify(async (m) => {
    // Fail twice, succeed on third attempt
    await m.mockStepError(
      { name: 'flaky-api' },
      new Error('Service temporarily unavailable'),
      2 // Fail first 2 attempts
    );
  });
  
  await env.MY_WORKFLOW.create({ id: 'test-123' });
  
  // Should eventually complete after retries
  await instance.waitForStatus('complete');
  
  const result = await instance.waitForStepResult({ name: 'flaky-api' });
  expect(result).toBeDefined();
});
```

### Test Error Scenarios

```typescript
it('should handle permanent failures', async () => {
  await using instance = await introspectWorkflowInstance(env.MY_WORKFLOW, 'test-456');
  
  await instance.modify(async (m) => {
    // Force permanent failure
    await m.mockStepError(
      { name: 'critical-step' },
      new Error('Unrecoverable error')
      // No times = fail every attempt
    );
  });
  
  await env.MY_WORKFLOW.create({ id: 'test-456' });
  
  await instance.waitForStatus('errored');
  
  const error = await instance.getError();
  expect(error.message).toContain('Unrecoverable error');
});
```

### Test Event-Driven Workflows

```typescript
it('should handle user approval event', async () => {
  await using instance = await introspectWorkflowInstance(env.APPROVAL_WORKFLOW, 'approval-789');
  
  await instance.modify(async (m) => {
    // Mock approval event
    await m.mockEvent({
      type: 'user-approval',
      payload: {
        approved: true,
        approverId: 'manager-123',
        comment: 'Looks good',
      },
    });
  });
  
  await env.APPROVAL_WORKFLOW.create({
    id: 'approval-789',
    params: { requestId: 'req-789' },
  });
  
  await instance.waitForStatus('complete');
  const output = await instance.getOutput();
  
  expect(output.approved).toBe(true);
  expect(output.approverId).toBe('manager-123');
});
```

### Test Multiple Instances

```typescript
it('should handle multiple workflow instances', async () => {
  await using introspector = await introspectWorkflow(env.MY_WORKFLOW);
  
  await introspector.modifyAll(async (m) => {
    await m.disableSleeps();
    await m.mockStepResult({ name: 'fetch-config' }, { timeout: 30 });
  });
  
  // Create multiple instances
  await env.MY_WORKFLOW.create({ id: 'instance-1', params: { userId: '1' } });
  await env.MY_WORKFLOW.create({ id: 'instance-2', params: { userId: '2' } });
  await env.MY_WORKFLOW.create({ id: 'instance-3', params: { userId: '3' } });
  
  const instances = introspector.get();
  expect(instances.length).toBe(3);
  
  for (const instance of instances) {
    await instance.waitForStatus('complete');
    const output = await instance.getOutput();
    expect(output.success).toBe(true);
  }
});
```

## Best Practices

### Always Dispose Introspectors

**Use `await using` (preferred)**:
```typescript
await using instance = await introspectWorkflowInstance(env.MY_WORKFLOW, 'id');
// Automatic disposal when scope exits
```

**Or manual disposal**:
```typescript
const instance = await introspectWorkflowInstance(env.MY_WORKFLOW, 'id');
try {
  // Test code
} finally {
  await instance.dispose(); // Always dispose
}
```

**Why**: Without disposal, isolated storage fails and state persists across tests.

### Target Specific Steps with Index

When multiple steps share the same name:

```typescript
// Target first occurrence (default)
await m.mockStepResult({ name: 'fetch-item' }, data1);

// Target second occurrence
await m.mockStepResult({ name: 'fetch-item', index: 2 }, data2);

// Target third occurrence
await m.mockStepResult({ name: 'fetch-item', index: 3 }, data3);
```

### Disable Sleeps for Faster Tests

```typescript
await instance.modify(async (m) => {
  await m.disableSleeps(); // All sleeps resolve immediately
});
```

### Test Idempotency

```typescript
it('should be idempotent', async () => {
  await using instance = await introspectWorkflowInstance(env.MY_WORKFLOW, 'same-id');
  
  // Create once
  await env.MY_WORKFLOW.create({ id: 'same-id', params: { value: 1 } });
  
  // Create again with same ID (should be idempotent)
  await env.MY_WORKFLOW.create({ id: 'same-id', params: { value: 2 } });
  
  await instance.waitForStatus('complete');
  
  // Should use first params
  const output = await instance.getOutput();
  expect(output.value).toBe(1);
});
```

### Test with Real Bindings

```typescript
it('should write to KV', async () => {
  await using instance = await introspectWorkflowInstance(env.MY_WORKFLOW, 'kv-test');
  
  // Don't mock KV - test real interaction
  await env.MY_WORKFLOW.create({
    id: 'kv-test',
    params: { key: 'test-key', value: 'test-value' },
  });
  
  await instance.waitForStatus('complete');
  
  // Verify KV write
  const stored = await env.KV.get('test-key');
  expect(stored).toBe('test-value');
});
```

## Isolated Storage Requirement

**Critical**: Set `isolatedStorage: true` in `vitest.config.ts`:

```typescript
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        isolatedStorage: true, // Required for workflows
      },
    },
  },
});
```

**Without isolated storage**:
- Test state leaks between tests
- Completed instances remain completed in next test
- Unpredictable test failures

**With isolated storage**:
- Each test gets fresh storage
- Proper test isolation
- Reliable test results

## Common Patterns

### Test Timeout Behavior

```typescript
it('should handle step timeout', async () => {
  await using instance = await introspectWorkflowInstance(env.MY_WORKFLOW, 'timeout-test');
  
  await instance.modify(async (m) => {
    await m.forceStepTimeout({ name: 'slow-operation' }, 2); // Timeout twice
  });
  
  await env.MY_WORKFLOW.create({ id: 'timeout-test' });
  
  // Should eventually succeed after retries
  await instance.waitForStatus('complete');
});
```

### Test Conditional Logic

```typescript
it('should follow premium path', async () => {
  await using instance = await introspectWorkflowInstance(env.MY_WORKFLOW, 'premium-test');
  
  await instance.modify(async (m) => {
    await m.mockStepResult(
      { name: 'check-user-tier' },
      { tier: 'premium' }
    );
  });
  
  await env.MY_WORKFLOW.create({
    id: 'premium-test',
    params: { userId: 'user-123' },
  });
  
  await instance.waitForStatus('complete');
  
  // Verify premium-specific step ran
  const premiumResult = await instance.waitForStepResult({
    name: 'premium-processing',
  });
  expect(premiumResult).toBeDefined();
});
```
