import { ActionResult } from '../index'
import { ExecutionContext } from '../../execution/types'
import { requireExplicitField } from '../core/requireExplicitField'
import { getMailchimpAuth } from './utils'
import crypto from 'crypto'

import { logger } from '@/lib/utils/logger'

/**
 * Add a subscriber to a Mailchimp audience
 */
export async function mailchimpAddSubscriber(
  config: any,
  context: ExecutionContext
): Promise<ActionResult> {
  try {
    // Q11 — `status` has CAN-SPAM / GDPR implications. 'subscribed' implies
    // explicit prior consent, 'pending' triggers a confirmation email,
    // 'unsubscribed' / 'cleaned' are administrative. Previous silent default
    // 'subscribed' removed; workflow author must explicitly choose based on
    // their opt-in process. UI recommends 'pending' unless explicit consent
    // already captured.
    const missingRequired = requireExplicitField(config, 'status')
    if (missingRequired) return missingRequired as unknown as ActionResult

    // Get Mailchimp auth with proper data center
    const { accessToken, dc } = await getMailchimpAuth(context.userId)

    // Resolve dynamic values
    const audienceId = context.dataFlowManager.resolveVariable(config.audience_id)
    const email = context.dataFlowManager.resolveVariable(config.email)
    const status = context.dataFlowManager.resolveVariable(config.status)

    // Get subscriber details
    const firstName = context.dataFlowManager.resolveVariable(config.first_name)
    const lastName = context.dataFlowManager.resolveVariable(config.last_name)
    const phone = context.dataFlowManager.resolveVariable(config.phone)
    const address = context.dataFlowManager.resolveVariable(config.address)
    const city = context.dataFlowManager.resolveVariable(config.city)
    const state = context.dataFlowManager.resolveVariable(config.state)
    const zip = context.dataFlowManager.resolveVariable(config.zip)
    const country = context.dataFlowManager.resolveVariable(config.country)
    const tagsInput = context.dataFlowManager.resolveVariable(config.tags)

    if (!audienceId) {
      throw new Error("Audience is required")
    }

    if (!email) {
      throw new Error("Email address is required")
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      throw new Error("Invalid email address format")
    }

    // Build merge fields object from standard Mailchimp fields
    const mergeFields: Record<string, any> = {}
    if (firstName) mergeFields.FNAME = firstName
    if (lastName) mergeFields.LNAME = lastName
    if (phone) mergeFields.PHONE = phone
    if (address) mergeFields.ADDRESS = { addr1: address, city, state, zip, country }
    else {
      if (city) mergeFields.CITY = city
      if (state) mergeFields.STATE = state
      if (zip) mergeFields.ZIP = zip
      if (country) mergeFields.COUNTRY = country
    }

    // Parse tags from comma-separated string
    const tagsConfig = tagsInput ? tagsInput.split(',').map((t: string) => t.trim()).filter(Boolean) : []

    // Build request body
    const requestBody: any = {
      email_address: email,
      status: status,
    }

    // Only include merge_fields if we have any
    if (Object.keys(mergeFields).length > 0) {
      requestBody.merge_fields = mergeFields
    }

    // Only include tags if we have any
    // Note: When creating/updating members, tags should be simple strings
    if (tagsConfig && tagsConfig.length > 0) {
      requestBody.tags = tagsConfig
    }

    logger.info('Adding subscriber to Mailchimp', {
      audienceId,
      status,
      hasName: !!(firstName || lastName),
      hasAddress: !!address,
      hasTags: tagsConfig.length > 0
    })

    // Use PUT to upsert (add or update) the subscriber
    // The subscriber hash is the MD5 hash of the lowercase email
    const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex')

    const url = `https://${dc}.api.mailchimp.com/3.0/lists/${audienceId}/members/${subscriberHash}`

    logger.info('Making Mailchimp API request', {
      url,
      method: 'PUT',
      hasAuth: !!accessToken,
      dc
    })

    let response
    try {
      response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })
    } catch (fetchError: any) {
      logger.error('Mailchimp fetch error', {
        error: fetchError.message,
        code: fetchError.code,
        cause: fetchError.cause
      })
      throw new Error(`Failed to connect to Mailchimp API: ${fetchError.message}`)
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.detail || errorData.title || `HTTP ${response.status}`
      logger.error('Mailchimp API error', {
        status: response.status,
        error: errorMessage,
        errorData
      })
      throw new Error(`Mailchimp API error: ${errorMessage}`)
    }

    const data = await response.json()

    logger.info('Successfully added subscriber to Mailchimp', {
      subscriberId: data.id,
      status: data.status
    })

    return {
      success: true,
      output: {
        subscriber_id: data.id,
        email: data.email_address,
        status: data.status,
        list_id: data.list_id,
        timestamp: data.timestamp_opt || new Date().toISOString()
      },
      message: `Successfully added ${email} to audience with status: ${data.status}`
    }
  } catch (error: any) {
    logger.error('Mailchimp Add Subscriber error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to add subscriber to Mailchimp'
    }
  }
}