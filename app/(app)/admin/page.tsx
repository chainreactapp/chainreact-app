"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/stores/authStore"
import { useAdminStore } from "@/stores/adminStore"
import UserRoleManagement from "@/components/admin/UserRoleManagement"
import AIUsageAdmin from "@/components/admin/AIUsageAdmin"
import BetaTestersContent from "@/components/admin/BetaTestersContent"
import WaitlistContent from "@/components/admin/WaitlistContent"
import WebhookSettings from "@/components/admin/WebhookSettings"
import { NodeTestingDashboard } from "@/components/admin/NodeTestingDashboard"
import { TemplateAnalyticsDashboard } from "@/components/admin/TemplateAnalyticsDashboard"
import { AgentEvalDashboard } from "@/components/admin/agent-eval/AgentEvalDashboard"
import V2ExecutionRollout from "@/components/admin/V2ExecutionRollout"
import { Crown, Shield, Users, Settings, User, Building, Zap, Sparkles, TestTube, FlaskConical, ListChecks, Webhook, PlayCircle, BarChart3, Activity, Rocket } from "lucide-react"
import { LightningLoader } from '@/components/ui/lightning-loader'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RoleBadge } from "@/components/ui/role-badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type UserRole } from "@/lib/utils/roles"
import { isProfileAdmin } from "@/lib/types/admin"

export default function AdminPage() {
  const { profile, user } = useAuthStore()
  const { userStats, loading, fetchUserStats } = useAdminStore()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("overview")

  const isAdmin = isProfileAdmin(profile)
  // If user is admin, show admin badge; otherwise show their role badge
  const userRole = isAdmin ? 'admin' : ((profile?.role as UserRole) || 'free')

  useEffect(() => {
    if (isProfileAdmin(profile)) {
      fetchUserStats().catch(error => {
        console.error('Failed to fetch user stats:', error)
      })
    }
  }, [profile, fetchUserStats])

  // Show loading while profile loads
  if (!profile) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <LightningLoader size="lg" color="primary" />
      </div>
    )
  }

  // After profile loads, check if admin
  if (!isProfileAdmin(profile)) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-4">You do not have admin privileges.</p>
          <p className="text-sm text-muted-foreground">Admin status: {String(isProfileAdmin(profile))}</p>
          <button
            onClick={() => router.push('/workflows')}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md"
          >
            Go to Workflows
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full p-6 space-y-8">
        {/* Admin Header */}
        <div className="bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-200/20 rounded-2xl p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Crown className="w-8 h-8 text-red-500" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
              <p className="text-muted-foreground">System administration and user management</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-muted-foreground">Logged in as:</span>
            <span className="font-medium">{user?.email}</span>
            <RoleBadge role={userRole} />
          </div>
          
          {/* External Status Links */}
          <div className="mt-4 pt-4 border-t border-red-200/20">
            <div className="flex items-center space-x-4 text-sm">
              <span className="text-muted-foreground">Infrastructure Status:</span>
              <a 
                href="https://status.vercel.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center space-x-1 text-blue-600 hover:text-blue-700 transition-colors"
              >
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>Vercel</span>
              </a>
              <a 
                href="https://status.supabase.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center space-x-1 text-blue-600 hover:text-blue-700 transition-colors"
              >
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>Supabase</span>
              </a>
            </div>
          </div>
        </div>

        {/* Admin Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-10">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Crown className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              User Management
            </TabsTrigger>
            <TabsTrigger value="beta-testers" className="flex items-center gap-2">
              <TestTube className="h-4 w-4" />
              Beta Testers
            </TabsTrigger>
            <TabsTrigger value="waitlist" className="flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              Waitlist
            </TabsTrigger>
            <TabsTrigger value="ai-usage" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI Usage
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="flex items-center gap-2">
              <Webhook className="h-4 w-4" />
              Webhooks
            </TabsTrigger>
            <TabsTrigger value="node-testing" className="flex items-center gap-2">
              <PlayCircle className="h-4 w-4" />
              Node Testing
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="agent-eval" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Agent Eval
            </TabsTrigger>
            <TabsTrigger value="v2-rollout" className="flex items-center gap-2">
              <Rocket className="h-4 w-4" />
              v2 Rollout
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Admin Stats - First Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="bg-card rounded-2xl shadow-lg border border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {loading ? "Loading..." : userStats.totalUsers}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    All registered users
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card rounded-2xl shadow-lg border border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Free Users</CardTitle>
                  <User className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {loading ? "Loading..." : userStats.freeUsers}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Users with free plan
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card rounded-2xl shadow-lg border border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Pro Users</CardTitle>
                  <Crown className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {loading ? "Loading..." : userStats.proUsers}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Users with pro plan
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card rounded-2xl shadow-lg border border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Business Users</CardTitle>
                  <Building className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {loading ? "Loading..." : userStats.businessUsers}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Users with business plan
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Admin Stats - Second Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="bg-card rounded-2xl shadow-lg border border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Beta Testers</CardTitle>
                  <FlaskConical className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {loading ? "Loading..." : userStats.betaUsers}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Active beta testers
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card rounded-2xl shadow-lg border border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Enterprise Users</CardTitle>
                  <Shield className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {loading ? "Loading..." : userStats.enterpriseUsers}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Users with enterprise plan
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="users" className="space-y-6">
            <UserRoleManagement />
          </TabsContent>

          <TabsContent value="beta-testers" className="space-y-6">
            <BetaTestersContent />
          </TabsContent>

          <TabsContent value="waitlist" className="space-y-6">
            <WaitlistContent />
          </TabsContent>

          <TabsContent value="ai-usage" className="space-y-6">
            <AIUsageAdmin />
          </TabsContent>

          <TabsContent value="webhooks" className="space-y-6">
            <WebhookSettings />
          </TabsContent>

          <TabsContent value="node-testing" className="space-y-6">
            <NodeTestingDashboard />
          </TabsContent>

          <TabsContent value="templates" className="space-y-6">
            <TemplateAnalyticsDashboard />
          </TabsContent>

          <TabsContent value="agent-eval" className="space-y-6">
            <AgentEvalDashboard />
          </TabsContent>

          <TabsContent value="v2-rollout" className="space-y-6">
            <V2ExecutionRollout />
          </TabsContent>
        </Tabs>
    </div>
  )
} 