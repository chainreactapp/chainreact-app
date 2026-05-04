/**
 * Trigger Tester
 *
 * Tests trigger nodes by:
 * 1. Creating a test workflow with the trigger
 * 2. Sending a simulated webhook payload
 * 3. Verifying the workflow was triggered correctly
 */

import type { TriggerTest } from './test-config'

export async function testTrigger(provider: string, trigger: TriggerTest): Promise<void> {
  // Create a test workflow with the trigger node
  const workflow = await createTestWorkflow(provider, trigger)

  try {
    // Activate the workflow (creates webhook if needed)
    await activateWorkflow(workflow.id)

    // Send test webhook payload
    await sendTestWebhook(provider, trigger.webhookPayload)

    // Wait for workflow to execute
    await waitForTriggerExecution(workflow.id, trigger.expectedTrigger)

    // Cleanup
    await deactivateWorkflow(workflow.id)
    await deleteWorkflow(workflow.id)
  } catch (error) {
    // Cleanup even on error
    await deactivateWorkflow(workflow.id).catch(() => {})
    await deleteWorkflow(workflow.id).catch(() => {})
    throw error
  }
}

// ================================================================
// HELPER FUNCTIONS
// ================================================================

/**
 * Create a test workflow with the trigger node
 */
async function createTestWorkflow(provider: string, trigger: TriggerTest) {
  const response = await fetch('http://localhost:3000/api/workflows', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.TEST_USER_TOKEN}`,
    },
    body: JSON.stringify({
      name: `[AUTO-TEST] ${provider} - ${trigger.triggerName}`,
      description: 'Automated integration test workflow',
      nodes: [
        {
          id: 'trigger-1',
          type: 'custom',
          position: { x: 100, y: 100 },
          data: {
            type: trigger.nodeType,
            title: trigger.triggerName,
            providerId: provider,
            config: {},
          },
        },
        {
          id: 'action-1',
          type: 'custom',
          position: { x: 400, y: 100 },
          data: {
            type: 'log_message',
            title: 'Log Message',
            config: {
              message: 'Trigger test completed successfully',
            },
          },
        },
      ],
      connections: [
        {
          id: 'edge-1',
          source: 'trigger-1',
          target: 'action-1',
          sourceHandle: 'success',
          targetHandle: 'input',
        },
      ],
      is_active: false, // Will activate separately
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create test workflow: ${error}`)
  }

  return response.json()
}

/**
 * Activate the workflow (creates webhooks, etc.)
 */
async function activateWorkflow(workflowId: string): Promise<void> {
  const response = await fetch(`http://localhost:3000/api/workflows/${workflowId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.TEST_USER_TOKEN}`,
    },
    body: JSON.stringify({
      is_active: true,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to activate workflow: ${error}`)
  }

  // Wait for webhook to be created (async process)
  await new Promise(resolve => setTimeout(resolve, 2000))
}

/**
 * Deactivate the workflow (removes webhooks, etc.)
 */
async function deactivateWorkflow(workflowId: string): Promise<void> {
  const response = await fetch(`http://localhost:3000/api/workflows/${workflowId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.TEST_USER_TOKEN}`,
    },
    body: JSON.stringify({
      is_active: false,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to deactivate workflow: ${error}`)
  }
}

/**
 * Send test webhook payload to the provider's webhook endpoint
 */
async function sendTestWebhook(provider: string, payload: any): Promise<void> {
  // Map provider to webhook endpoint
  const webhookEndpoint = getWebhookEndpoint(provider)

  const response = await fetch(webhookEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Test-Webhook': 'true', // Mark as test webhook
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to send test webhook: ${error}`)
  }
}

/**
 * Get webhook endpoint for a provider
 */
function getWebhookEndpoint(provider: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // Map providers to their webhook routes
  const webhookPaths: Record<string, string> = {
    gmail: '/api/webhooks/gmail',
    hubspot: '/api/webhooks/hubspot',
    slack: '/api/webhooks/slack',
    discord: '/api/webhooks/discord',
    gumroad: '/api/webhooks/gumroad',
    'google-sheets': '/api/webhooks/google-sheets',
    notion: '/api/webhooks/notion',
    stripe: '/api/webhooks/stripe-integration',
    airtable: '/api/webhooks/airtable',
    trello: '/api/webhooks/trello',
  }

  const path = webhookPaths[provider]
  if (!path) {
    throw new Error(`No webhook endpoint configured for provider: ${provider}`)
  }

  return `${baseUrl}${path}`
}

/**
 * Wait for the workflow to be triggered and executed
 */
async function waitForTriggerExecution(
  workflowId: string,
  expectedTrigger: boolean,
  maxWaitTime = 10000
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitTime) {
    // Check for recent executions of this workflow
    const response = await fetch(`http://localhost:3000/api/workflows/${workflowId}/executions`, {
      headers: {
        'Authorization': `Bearer ${process.env.TEST_USER_TOKEN}`,
      },
    })

    if (!response.ok) {
      throw new Error('Failed to fetch workflow executions')
    }

    const executions = await response.json()

    // Check if there's a recent execution (within last 15 seconds)
    const recentExecution = executions.find((ex: any) => {
      const executedAt = new Date(ex.started_at).getTime()
      return Date.now() - executedAt < 15000
    })

    if (expectedTrigger && recentExecution) {
      // Trigger should fire and it did - success
      if (recentExecution.status === 'failed' || recentExecution.status === 'error') {
        throw new Error(`Trigger fired but execution failed: ${recentExecution.error || 'Unknown error'}`)
      }
      return
    }

    // Wait 500ms before checking again
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  if (expectedTrigger) {
    throw new Error('Trigger did not fire within timeout period')
  }

  // Trigger should NOT fire and it didn't - success
}

/**
 * Delete the test workflow
 */
async function deleteWorkflow(workflowId: string): Promise<void> {
  await fetch(`http://localhost:3000/api/workflows/${workflowId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${process.env.TEST_USER_TOKEN}`,
    },
  })
}
