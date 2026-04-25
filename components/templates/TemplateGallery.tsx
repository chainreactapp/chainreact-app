"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ProfessionalSearch } from "@/components/ui/professional-search"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Copy, Eye, Loader2, Edit, Play, Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { useAuthStore } from "@/stores/authStore"
import { isProfileAdmin } from "@/lib/types/admin"
import { useWorkflowStore } from "@/stores/workflowStore"
import { TemplatePreviewWithProvider } from "./TemplatePreview"
import { TemplatePreviewModal } from "./TemplatePreviewModal"
import { Input } from "@/components/ui/input"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

import { logger } from '@/lib/utils/logger'

interface Template {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  workflow_json?: any
  nodes?: any[]
  connections?: any[]
  draft_nodes?: any[]
  draftNodes?: any[]
  draft_connections?: any[]
  draftConnections?: any[]
  draft_default_field_values?: Record<string, any>
  draftDefaultFieldValues?: Record<string, any>
  draft_integration_setup?: any
  draftIntegrationSetup?: any
  draft_setup_overview?: any
  draftSetupOverview?: any
  created_at: string
  creator?: {
    email: string
  }
  is_predefined?: boolean
  is_ai_generated?: boolean
  original_prompt?: string
  difficulty?: string
  estimatedTime?: string
  integrations?: string[]
  airtable_setup?: any
  airtableSetup?: any
  integration_setup?: any
  integrationSetup?: any
  status?: string
  primary_setup_target?: string | null
  published_at?: string | null
  is_public?: boolean
}

const categories = [
  "all",
  "AI Automation",
  "AI Agent Testing",
  "Customer Service",
  "Sales & CRM",
  "Social Media",
  "Productivity",
  "Data Sync",
  "E-commerce",
  "Notifications",
  "HR",
  "DevOps",
  "Marketing",
  "Finance",
]

// Helper function to properly capitalize tags
const capitalizeTag = (tag: string): string => {
  const tagMap: Record<string, string> = {
    'ai-agent': 'AI Agent',
    'ai agent': 'AI Agent',
    'ai-message': 'AI Message',
    'ai message': 'AI Message',
    'gmail': 'Gmail',
    'email': 'Email',
    'airtable': 'Airtable',
    'discord': 'Discord',
    'slack': 'Slack',
    'notion': 'Notion',
    'hubspot': 'HubSpot',
    'salesforce': 'Salesforce',
    'stripe': 'Stripe',
    'shopify': 'Shopify',
    'google-sheets': 'Google Sheets',
    'google sheets': 'Google Sheets',
    'google-drive': 'Google Drive',
    'google drive': 'Google Drive',
    'onedrive': 'OneDrive',
    'dropbox': 'Dropbox',
    'trello': 'Trello',
    'asana': 'Asana',
    'leads': 'Leads',
    'crm': 'CRM',
    'sales automation': 'Sales Automation',
    'email automation': 'Email Automation',
    'test': 'Test',
    'advanced': 'Advanced',
    'intermediate': 'Intermediate',
    'beginner': 'Beginner',
    'draft': 'Draft',
    'ready': 'Ready',
    'published': 'Published',
  }

  const lowerTag = tag.toLowerCase()
  return tagMap[lowerTag] || tag.split(' ').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ')
}

const formatStatus = (status?: string | null) => {
  if (!status) return 'Draft'
  return capitalizeTag(status)
}

const getStatusBadgeVariant = (status?: string | null) => {
  switch (status) {
    case 'published':
      return 'default' as const
    case 'ready':
      return 'secondary' as const
    default:
      return 'outline' as const
  }
}

// Helper function to get nodes and connections from template (handles both formats)
const getTemplateWorkflowData = (
  template: Template,
  options: { preferDraft?: boolean } = {}
) => {
  const preferDraft = Boolean(options.preferDraft)
  const draftNodes = template.draftNodes || template.draft_nodes
  const draftConnections = template.draftConnections || template.draft_connections

  if (preferDraft && Array.isArray(draftNodes) && draftNodes.length > 0) {
    const connections = Array.isArray(draftConnections) ? draftConnections : []
    logger.info('Using draft nodes/connections:', draftNodes.length, connections.length)
    return {
      nodes: draftNodes,
      connections,
    }
  }

  // Try direct nodes/connections first
  if (template.nodes && template.connections) {
    logger.info('Using direct nodes/connections:', template.nodes.length, template.connections.length)
    return {
      nodes: template.nodes,
      connections: template.connections
    }
  }

  // Try workflow_json
  if (template.workflow_json) {
    const nodes = template.workflow_json.nodes || []
    const connections = template.workflow_json.connections || template.workflow_json.edges || []
    logger.info('Using workflow_json:', nodes.length, connections.length)
    return {
      nodes,
      connections
    }
  }

  logger.info('No workflow data found for template')
  return { nodes: [], connections: [] }
}

export function TemplateGallery() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [predefinedTemplates, setPredefinedTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [copying, setCopying] = useState<string | null>(null)
  const [showPredefined, setShowPredefined] = useState(true)
  const [showAIGenerated, setShowAIGenerated] = useState(true)
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [newTemplateForm, setNewTemplateForm] = useState({
    name: "",
    description: "",
    category: "AI Automation",
    tags: "",
    primarySetupTarget: "airtable",
  })
  const router = useRouter()
  const { toast } = useToast()
  const { profile } = useAuthStore()
  const { addWorkflowToStore } = useWorkflowStore()
  const isAdmin = isProfileAdmin(profile)

  useEffect(() => {
    fetchTemplates()
    fetchPredefinedTemplates()
  }, [selectedCategory, searchQuery, isAdmin])

  const fetchTemplates = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (selectedCategory !== "all") params.set("category", selectedCategory)
      if (searchQuery) params.set("search", searchQuery)

      if (isAdmin) params.set("scope", "admin")

      const response = await fetch(`/api/templates?${params}`)
      const data = await response.json()

      if (data.templates) {
        setTemplates(data.templates)
      }
    } catch (error) {
      logger.error("Error fetching templates:", error)
      toast({
        title: "Error",
        description: "Failed to fetch templates",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const fetchPredefinedTemplates = async () => {
    try {
      const params = new URLSearchParams()
      if (selectedCategory !== "all") params.set("category", selectedCategory)
      if (searchQuery) params.set("search", searchQuery)

      const response = await fetch(`/api/templates/predefined?${params}`)
      const data = await response.json()

      if (data.templates) {
        // Filter out templates that use admin-only or unavailable integrations
        const unavailableIntegrations = ['twitter', 'x', 'shopify', 'github']

        console.log('Total templates from API:', data.templates.length)
        console.log('All template names:', data.templates.map((t: Template) => t.name))

        const filteredTemplates = data.templates.filter((template: Template) => {
          // Hide templates that include twitter, shopify, or other unavailable integrations
          const hasUnavailableIntegration = template.integrations?.some((integration: string) =>
            unavailableIntegrations.includes(integration.toLowerCase())
          )

          if (hasUnavailableIntegration) {
            console.log(`Filtered out: ${template.name} (integrations: ${template.integrations?.join(', ')})`)
          }

          return !hasUnavailableIntegration
        })

        console.log('Templates after filtering:', filteredTemplates.length)
        console.log('Filtered template names:', filteredTemplates.map((t: Template) => t.name))

        setPredefinedTemplates(filteredTemplates)
      }
    } catch (error) {
      logger.error("Error fetching predefined templates:", error)
    }
  }

  const handleCreateTemplate = async () => {
    if (!newTemplateForm.name.trim()) {
      toast({
        title: "Name required",
        description: "Enter a template name to continue",
        variant: "destructive",
      })
      return
    }

    try {
      setCreatingTemplate(true)
      const tags = newTemplateForm.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)

      const response = await fetch(`/api/templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newTemplateForm.name.trim(),
          description: newTemplateForm.description.trim(),
          category: newTemplateForm.category || "AI Automation",
          tags,
          is_public: false,
          primary_setup_target: newTemplateForm.primarySetupTarget || null,
          status: "draft",
          workflow_json: { nodes: [], connections: [] },
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Failed to create template")
      }

      const createdTemplate = data?.template
      if (createdTemplate) {
        setTemplates((prev) => [createdTemplate, ...prev])
      }

      toast({
        title: "Template created",
        description: "Finish configuring the template in the builder.",
      })

      setShowCreateDialog(false)
      setNewTemplateForm({
        name: "",
        description: "",
        category: "AI Automation",
        tags: "",
        primarySetupTarget: "airtable",
      })

      if (createdTemplate?.id) {
        router.push(`/workflows/builder?editTemplate=${createdTemplate.id}`)
      }
    } catch (error: any) {
      logger.error("Error creating template:", error)
      toast({
        title: "Error",
        description: error?.message || "Failed to create template",
        variant: "destructive",
      })
    } finally {
      setCreatingTemplate(false)
    }
  }

  const handleCopyTemplate = async (templateId: string) => {
    try {
      setCopying(templateId)
      logger.info(`Copying template ${templateId}...`)

      const response = await fetch(`/api/templates/${templateId}/copy`, {
        method: "POST",
      })

      const data = await response.json()
      logger.info("Copy response:", data)

      if (!response.ok) {
        logger.error("Copy failed with status:", response.status, data)
        throw new Error(data.error || `Failed to copy template (${response.status})`)
      }

      if (data.workflow && data.workflow.id) {
        logger.info(`Workflow created with ID: ${data.workflow.id}, adding to store...`)

        // Add the workflow to the store immediately to avoid cache issues
        addWorkflowToStore(data.workflow)

        toast({
          title: "Success",
          description: "Template copied to your workflows",
        })

        logger.info(`Navigating to workflow builder...`)
        router.push(`/workflows/builder/${data.workflow.id}?editTemplate=${templateId}`)
      } else {
        logger.error("No workflow ID in response:", data)
        throw new Error(data.error || "Failed to copy template - no workflow ID returned")
      }
    } catch (error) {
      logger.error("Error copying template:", error)
      const errorMessage = error instanceof Error ? error.message : "Failed to copy template"
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setCopying(null)
    }
  }

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch =
      !searchQuery ||
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesCategory = selectedCategory === "all" || template.category === selectedCategory

    // Filter by AI-generated status
    const matchesAIFilter = showAIGenerated || !template.is_ai_generated

    return matchesSearch && matchesCategory && matchesAIFilter
  })

  // Deduplicate templates by ID to avoid duplicate key errors
  const deduplicateTemplates = (templates: Template[]) => {
    const seen = new Set<string>()
    return templates.filter(template => {
      if (seen.has(template.id)) {
        return false
      }
      seen.add(template.id)
      return true
    })
  }

  // Filter predefined templates by AI status too
  const filteredPredefined = predefinedTemplates.filter(template =>
    showAIGenerated || !template.is_ai_generated
  )

  const allTemplates = deduplicateTemplates(
    showPredefined ? [...filteredPredefined, ...filteredTemplates] : filteredTemplates
  )

  // Count AI-generated templates
  const aiGeneratedCount = [...predefinedTemplates, ...templates].filter(t => t.is_ai_generated).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Workflow Templates</h2>
          <p className="text-gray-600">Get started quickly with pre-built workflows</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowCreateDialog(true)} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New Template
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <ProfessionalSearch
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery('')}
          />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>
                {category === "all" ? "All Categories" : category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Filter Badges */}
      {aiGeneratedCount > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={showAIGenerated ? "default" : "outline"}
            className="cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => setShowAIGenerated(!showAIGenerated)}
          >
            {showAIGenerated ? "✓ " : ""}AI Generated ({aiGeneratedCount})
          </Badge>
        </div>
      )}

      {/* Templates Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {allTemplates.map((template) => {
            const preferDraft = isAdmin && template.status !== "published"
            const workflowData = getTemplateWorkflowData(template, { preferDraft })

            return (
              <Card key={template.id} className="hover:shadow-lg transition-shadow flex flex-col">
              <CardHeader className="flex-shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 mb-2 flex-wrap">
                      <CardTitle className="text-lg leading-tight">{template.name}</CardTitle>
                      {template.is_predefined && (
                        <Badge className="bg-gradient-to-r from-orange-500 to-rose-600 text-white border-0 flex-shrink-0">
                          Official
                        </Badge>
                      )}
                      {template.is_ai_generated && (
                        <Badge variant="outline" className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-500/40 flex-shrink-0">
                          AI Generated
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="mt-2 line-clamp-2">{template.description}</CardDescription>
                  </div>
                </div>

                {/* Mini workflow preview */}
                <div className="mt-4 rounded-lg overflow-hidden border bg-gray-50" style={{ height: '200px', width: '100%' }}>
                  <TemplatePreviewWithProvider
                    nodes={workflowData.nodes}
                    connections={workflowData.connections}
                    interactive={false}
                    showControls={false}
                    className=""
                  />
                </div>

                {isAdmin && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Badge variant={getStatusBadgeVariant(template.status)} className="capitalize">
                      {formatStatus(template.status)}
                    </Badge>
                    {template.primary_setup_target && (
                      <Badge variant="outline" className="text-xs capitalize">
                        Setup: {capitalizeTag(template.primary_setup_target.replace(/[_-]/g, " "))}
                      </Badge>
                    )}
                    {template.published_at && (
                      <span className="text-xs text-gray-500">
                        Published {new Date(template.published_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-4">
                  <Badge variant="secondary">{template.category}</Badge>
                  {template.difficulty && (
                    <Badge variant="outline" className="text-xs">
                      {capitalizeTag(template.difficulty)}
                    </Badge>
                  )}
                  {template.estimatedTime && (
                    <Badge variant="outline" className="text-xs">
                      ⏱️ {template.estimatedTime}
                    </Badge>
                  )}
                  {template.tags?.slice(0, 2).map((tag, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {capitalizeTag(tag)}
                    </Badge>
                  ))}
                </div>
              </CardHeader>

              <CardContent className="mt-auto pt-0">
                <div className="flex flex-col gap-3 pt-4 border-t">
                  <div className="text-sm text-gray-500">
                    {template.is_ai_generated ? 'AI Generated' : 'by ChainReact'}
                  </div>

                  <div className="flex gap-2">
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          router.push(`/workflows/builder?editTemplate=${template.id}`)
                        }}
                        title="Edit Template"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedTemplate(template)
                        setShowPreviewModal(true)
                      }}
                      title="Preview Template"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>

                    <Button
                      size="sm"
                      onClick={() => handleCopyTemplate(template.id)}
                      disabled={copying === template.id}
                      title="Use Template"
                    >
                      {copying === template.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {!loading && allTemplates.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-500 mb-4">No templates found</div>
          <p className="text-sm text-gray-400">Try adjusting your search criteria or browse all templates</p>
        </div>
      )}

      {/* Interactive Preview Modal */}
      <TemplatePreviewModal
        template={selectedTemplate ? {
          ...selectedTemplate,
          ...getTemplateWorkflowData(selectedTemplate, {
            preferDraft: isAdmin && selectedTemplate.status !== "published"
          })
        } : null}
        open={showPreviewModal}
        onOpenChange={setShowPreviewModal}
      />

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Template</DialogTitle>
            <DialogDescription>
              Provide initial details for the template. You can configure the workflow and setup guide in the builder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Name</label>
              <Input
                placeholder="Template name"
                value={newTemplateForm.name}
                onChange={(e) => setNewTemplateForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Description</label>
              <Textarea
                rows={3}
                placeholder="Describe what this template does"
                value={newTemplateForm.description}
                onChange={(e) => setNewTemplateForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Category</label>
                <Select
                  value={newTemplateForm.category}
                  onValueChange={(value) => setNewTemplateForm((prev) => ({ ...prev, category: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories
                      .filter((category) => category !== "all")
                      .map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Primary setup target</label>
                <Select
                  value={newTemplateForm.primarySetupTarget}
                  onValueChange={(value) => setNewTemplateForm((prev) => ({ ...prev, primarySetupTarget: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="airtable">Airtable</SelectItem>
                    <SelectItem value="google_sheets">Google Sheets</SelectItem>
                    <SelectItem value="gmail">Gmail</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Tags</label>
              <Input
                placeholder="crm, sales, support"
                value={newTemplateForm.tags}
                onChange={(e) => setNewTemplateForm((prev) => ({ ...prev, tags: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Comma-separated list</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} disabled={creatingTemplate}>
              Cancel
            </Button>
            <Button onClick={handleCreateTemplate} disabled={creatingTemplate}>
              {creatingTemplate ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Create &amp; Configure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
