import { NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { cookies } from "next/headers"

import { logger } from '@/lib/utils/logger'
import { isConnectedStatus } from "@/lib/integrations/connectionStatus"

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    cookies()
    const supabase = await createSupabaseRouteHandlerClient()

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return errorResponse("Not authenticated" , 401)
    }

    // Fetch all dashboard data in parallel
    const [
      workflowsResult,
      integrationsResult,
      metricsResult,
      chartDataResult,
      activitiesResult
    ] = await Promise.allSettled([
      // Workflows
      supabase
        .from("workflows")
        .select("*")
        .eq("user_id", user.id),
      
      // Integrations
      supabase
        .from("integrations")
        .select("*")
        .eq("user_id", user.id),
      
      // Basic metrics (executions)
      supabase
        .from("workflow_execution_sessions")
        .select("id, status, execution_time_ms")
        .eq("user_id", user.id)
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()), // Last 30 days
      
      // Chart data (executions per day)
      supabase
        .from("workflow_execution_sessions")
        .select("created_at, status")
        .eq("user_id", user.id)
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()), // Last 7 days
      
      // Recent activities
      supabase
        .from("workflow_execution_sessions")
        .select("id, workflow_name, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10)
    ])

    // Process results
    const workflows = workflowsResult.status === 'fulfilled' ? workflowsResult.value.data || [] : []
    const integrations = integrationsResult.status === 'fulfilled' ? integrationsResult.value.data || [] : []
    const executions = metricsResult.status === 'fulfilled' ? metricsResult.value.data || [] : []
    const chartDataRaw = chartDataResult.status === 'fulfilled' ? chartDataResult.value.data || [] : []
    const activities = activitiesResult.status === 'fulfilled' ? activitiesResult.value.data || [] : []

    // Calculate metrics
    const activeWorkflows = workflows.filter((w: any) => w.status === 'active').length
    const successfulExecutions = executions.filter((e: any) => e.status === 'completed').length
    const totalExecutionTime = executions.reduce((sum: number, e: any) => sum + (e.execution_time_ms || 0), 0)
    const hoursSaved = Math.round(totalExecutionTime / (1000 * 60 * 60) * 10) / 10 // Rough estimate
    const connectedIntegrations = integrations.filter((i: any) => isConnectedStatus(i.status)).length

    // Process chart data
    const chartData = [
      { name: "Mon", workflows: 0, executions: 0 },
      { name: "Tue", workflows: 0, executions: 0 },
      { name: "Wed", workflows: 0, executions: 0 },
      { name: "Thu", workflows: 0, executions: 0 },
      { name: "Fri", workflows: 0, executions: 0 },
      { name: "Sat", workflows: 0, executions: 0 },
      { name: "Sun", workflows: 0, executions: 0 },
    ]

    // Group chart data by day of week
    chartDataRaw.forEach((execution: any) => {
      const day = new Date(execution.created_at).toLocaleDateString('en-US', { weekday: 'short' })
      const dayIndex = chartData.findIndex(d => d.name === day)
      if (dayIndex !== -1) {
        chartData[dayIndex].executions++
      }
    })

    return jsonResponse({
      success: true,
      data: {
        metrics: {
          workflowsRun: successfulExecutions,
          hoursSaved,
          integrations: connectedIntegrations,
          aiCommands: 0, // Placeholder
        },
        chartData,
        workflows,
        integrations,
        activities: activities.map((a: any) => ({
          id: a.id,
          type: 'workflow_execution',
          title: `${a.workflow_name} ${a.status}`,
          timestamp: a.created_at,
          status: a.status
        }))
      }
    })
  } catch (error: any) {
    logger.error("Dashboard API error:", error)
    return jsonResponse(
      {
        success: false,
        error: error.message || "Failed to fetch dashboard data",
      },
      { status: 500 }
    )
  }
} 
