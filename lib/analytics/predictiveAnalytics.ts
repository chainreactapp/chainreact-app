import { createClient } from "@/utils/supabaseClient"

import { logger } from '@/lib/utils/logger'

export interface WorkflowFailurePrediction {
  workflowId: string
  failureProbability: number
  riskFactors: string[]
  recommendations: string[]
  confidenceScore: number
}

export interface UsagePatternForecast {
  period: string
  predictedExecutions: number
  predictedCost: number
  growthRate: number
  seasonalFactors: Record<string, number>
}

export interface IntegrationHealthScore {
  integrationId: string
  overallScore: number
  reliabilityScore: number
  performanceScore: number
  errorRate: number
  uptimePercentage: number
  responseTimeAvg: number
  trend: "improving" | "stable" | "declining"
}

export interface ROICalculation {
  workflowId: string
  timeSavedHours: number
  costSavedAmount: number
  revenueGenerated: number
  implementationCost: number
  roiPercentage: number
  paybackPeriodMonths: number
}

export class PredictiveAnalytics {
  private supabase = createClient()

  // PR-AUTH-7: cached user id from the auth store. Lazy import keeps this
  // module loadable from server-only contexts even though it's authored as
  // client-side code.
  private async getCachedUserId(): Promise<string | undefined> {
    const { useAuthStore } = await import("@/stores/authStore")
    return useAuthStore.getState().user?.id
  }

  async predictWorkflowFailure(workflowId: string): Promise<WorkflowFailurePrediction> {
    try {
      // Get workflow execution history
      const { data: executions } = await this.supabase
        .from("workflow_execution_sessions")
        .select("*")
        .eq("workflow_id", workflowId)
        .order("started_at", { ascending: false })
        .limit(100)

      if (!executions || executions.length === 0) {
        return {
          workflowId,
          failureProbability: 0.1,
          riskFactors: ["Insufficient execution history"],
          recommendations: ["Monitor workflow performance over time"],
          confidenceScore: 0.3,
        }
      }

      // Calculate failure metrics
      const totalExecutions = executions.length
      const failedExecutions = executions.filter((e) => e.status === "error").length
      const recentFailures = executions.slice(0, 10).filter((e) => e.status === "error").length
      const avgExecutionTime =
        executions
          .filter((e) => e.completed_at && e.started_at)
          .reduce((sum, e) => sum + (new Date(e.completed_at!).getTime() - new Date(e.started_at).getTime()), 0) /
        totalExecutions

      // Simple prediction algorithm (in production, use ML models)
      const historicalFailureRate = failedExecutions / totalExecutions
      const recentFailureRate = recentFailures / Math.min(10, totalExecutions)
      const performanceDegradation = avgExecutionTime > 30000 ? 0.2 : 0 // 30 seconds threshold

      const failureProbability = Math.min(
        0.9,
        historicalFailureRate * 0.4 + recentFailureRate * 0.4 + performanceDegradation,
      )

      // Identify risk factors
      const riskFactors: string[] = []
      if (recentFailureRate > 0.2) riskFactors.push("High recent failure rate")
      if (avgExecutionTime > 30000) riskFactors.push("Slow execution times")
      if (historicalFailureRate > 0.1) riskFactors.push("Historical reliability issues")

      // Generate recommendations
      const recommendations: string[] = []
      if (recentFailureRate > 0.1) recommendations.push("Add error handling and retry logic")
      if (avgExecutionTime > 30000) recommendations.push("Optimize workflow performance")
      if (riskFactors.length === 0) recommendations.push("Workflow appears healthy")

      // Store prediction
      await this.supabase.from("predictions").insert({
        model_id: "workflow-failure-v1",
        user_id: await this.getCachedUserId(),
        prediction_type: "workflow_failure",
        input_data: { workflowId, totalExecutions, failedExecutions, avgExecutionTime },
        prediction_result: { failureProbability, riskFactors, recommendations },
        confidence_score: totalExecutions > 50 ? 0.8 : 0.5,
      })

      return {
        workflowId,
        failureProbability,
        riskFactors,
        recommendations,
        confidenceScore: totalExecutions > 50 ? 0.8 : 0.5,
      }
    } catch (error) {
      logger.error("Error predicting workflow failure:", error)
      throw error
    }
  }

  async forecastUsagePatterns(organizationId?: string): Promise<UsagePatternForecast[]> {
    try {
      // Get historical usage data
      const { data: metrics } = await this.supabase
        .from("analytics_metrics")
        .select("*")
        .eq("metric_type", "workflow_execution")
        .gte("timestamp", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()) // Last 90 days
        .order("timestamp", { ascending: true })

      if (!metrics || metrics.length === 0) {
        return []
      }

      // Group by day and calculate trends
      const dailyUsage = new Map<string, number>()
      metrics.forEach((metric) => {
        const day = new Date(metric.timestamp).toISOString().split("T")[0]
        dailyUsage.set(day, (dailyUsage.get(day) || 0) + metric.value)
      })

      // Simple linear regression for trend
      const days = Array.from(dailyUsage.keys()).sort()
      const values = days.map((day) => dailyUsage.get(day) || 0)
      const avgValue = values.reduce((sum, val) => sum + val, 0) / values.length
      const growthRate = values.length > 1 ? (values[values.length - 1] - values[0]) / values[0] : 0

      // Generate forecasts for next 30 days
      const forecasts: UsagePatternForecast[] = []
      for (let i = 1; i <= 30; i++) {
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + i)
        const period = futureDate.toISOString().split("T")[0]

        const predictedExecutions = Math.max(0, avgValue * (1 + growthRate * (i / 30)))
        const predictedCost = predictedExecutions * 0.01 // Assume $0.01 per execution

        forecasts.push({
          period,
          predictedExecutions: Math.round(predictedExecutions),
          predictedCost: Math.round(predictedCost * 100) / 100,
          growthRate: Math.round(growthRate * 10000) / 100, // Percentage
          seasonalFactors: {}, // Could add day-of-week patterns
        })
      }

      return forecasts
    } catch (error) {
      logger.error("Error forecasting usage patterns:", error)
      throw error
    }
  }

  async calculateIntegrationHealth(integrationId: string): Promise<IntegrationHealthScore> {
    try {
      // Get integration execution data
      const { data: executions } = await this.supabase
        .from("workflow_execution_sessions")
        .select(`
          *,
          workflows!inner(*)
        `)
        .gte("started_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // Last 30 days

      if (!executions) {
        throw new Error("Failed to fetch execution data")
      }

      // Filter executions that use this integration
      const integrationExecutions = executions.filter((execution) => {
        // This would need to be enhanced to properly identify integration usage
        return execution.execution_data?.integrations?.includes(integrationId)
      })

      if (integrationExecutions.length === 0) {
        return {
          integrationId,
          overallScore: 50,
          reliabilityScore: 50,
          performanceScore: 50,
          errorRate: 0,
          uptimePercentage: 100,
          responseTimeAvg: 0,
          trend: "stable",
        }
      }

      // Calculate metrics
      const totalExecutions = integrationExecutions.length
      const successfulExecutions = integrationExecutions.filter((e) => e.status === "completed").length
      const failedExecutions = totalExecutions - successfulExecutions
      const errorRate = failedExecutions / totalExecutions

      const executionTimes = integrationExecutions
        .filter((e) => e.completed_at && e.started_at)
        .map((e) => new Date(e.completed_at!).getTime() - new Date(e.started_at).getTime())

      const responseTimeAvg =
        executionTimes.length > 0 ? executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length : 0

      // Calculate scores (0-100)
      const reliabilityScore = Math.max(0, (1 - errorRate) * 100)
      const performanceScore = Math.max(0, Math.min(100, 100 - responseTimeAvg / 1000)) // Penalize slow responses
      const uptimePercentage = (successfulExecutions / totalExecutions) * 100
      const overallScore = (reliabilityScore + performanceScore) / 2

      // Determine trend (simplified)
      const recentExecutions = integrationExecutions.slice(0, Math.floor(totalExecutions / 3))
      const recentErrorRate = recentExecutions.filter((e) => e.status === "error").length / recentExecutions.length
      const trend = recentErrorRate < errorRate ? "improving" : recentErrorRate > errorRate ? "declining" : "stable"

      // Store health score
      await this.supabase.from("integration_health_scores").upsert({
        integration_id: integrationId,
        user_id: await this.getCachedUserId(),
        health_score: overallScore,
        reliability_score: reliabilityScore,
        performance_score: performanceScore,
        error_rate: errorRate,
        uptime_percentage: uptimePercentage,
        response_time_avg: responseTimeAvg,
      })

      return {
        integrationId,
        overallScore: Math.round(overallScore),
        reliabilityScore: Math.round(reliabilityScore),
        performanceScore: Math.round(performanceScore),
        errorRate: Math.round(errorRate * 10000) / 100, // Percentage
        uptimePercentage: Math.round(uptimePercentage * 100) / 100,
        responseTimeAvg: Math.round(responseTimeAvg),
        trend,
      }
    } catch (error) {
      logger.error("Error calculating integration health:", error)
      throw error
    }
  }

  async calculateROI(workflowId: string): Promise<ROICalculation> {
    try {
      // Get workflow execution data
      const { data: executions } = await this.supabase
        .from("workflow_execution_sessions")
        .select("*")
        .eq("workflow_id", workflowId)
        .gte("started_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // Last 30 days

      if (!executions || executions.length === 0) {
        return {
          workflowId,
          timeSavedHours: 0,
          costSavedAmount: 0,
          revenueGenerated: 0,
          implementationCost: 100, // Estimated base cost
          roiPercentage: -100,
          paybackPeriodMonths: 0,
        }
      }

      // Calculate time savings (assume each execution saves 15 minutes of manual work)
      const timeSavedHours = (executions.length * 15) / 60

      // Calculate cost savings (assume $25/hour labor cost)
      const costSavedAmount = timeSavedHours * 25

      // Estimate revenue generated (simplified - could be based on workflow type)
      const revenueGenerated = executions.filter((e) => e.status === "completed").length * 5 // $5 per successful execution

      // Estimate implementation cost (simplified)
      const implementationCost = 500 // Base implementation cost

      // Calculate ROI
      const totalBenefit = costSavedAmount + revenueGenerated
      const roiPercentage = ((totalBenefit - implementationCost) / implementationCost) * 100

      // Calculate payback period
      const monthlyBenefit = totalBenefit // Assuming this is monthly data
      const paybackPeriodMonths = monthlyBenefit > 0 ? implementationCost / monthlyBenefit : 0

      // Store ROI calculation
      await this.supabase.from("roi_calculations").insert({
        workflow_id: workflowId,
        user_id: await this.getCachedUserId(),
        time_saved_hours: timeSavedHours,
        cost_saved_amount: costSavedAmount,
        revenue_generated: revenueGenerated,
        implementation_cost: implementationCost,
        roi_percentage: roiPercentage,
        calculation_period_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        calculation_period_end: new Date().toISOString(),
      })

      return {
        workflowId,
        timeSavedHours: Math.round(timeSavedHours * 100) / 100,
        costSavedAmount: Math.round(costSavedAmount * 100) / 100,
        revenueGenerated: Math.round(revenueGenerated * 100) / 100,
        implementationCost,
        roiPercentage: Math.round(roiPercentage * 100) / 100,
        paybackPeriodMonths: Math.round(paybackPeriodMonths * 100) / 100,
      }
    } catch (error) {
      logger.error("Error calculating ROI:", error)
      throw error
    }
  }
}

export const predictiveAnalytics = new PredictiveAnalytics()

