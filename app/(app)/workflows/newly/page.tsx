'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Search,
  Plus,
  Filter,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  Play,
  Pause,
  Copy,
  Archive,
  Trash2,
  Circle,
  CheckCircle2,
  Clock,
  AlertCircle,
  Calendar,
  Activity,
  TrendingUp,
  Eye,
  Edit,
  Zap,
  Workflow,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Mock data
const workflows = [
  {
    id: '1',
    name: 'Customer onboarding automation',
    status: 'active',
    lastRun: '2 minutes ago',
    nextRun: 'When trigger fires',
    runs: 342,
    successRate: 98.5,
    triggers: ['Gmail', 'HubSpot'],
    updated: '2025-01-19',
  },
  {
    id: '2',
    name: 'Weekly analytics report',
    status: 'active',
    lastRun: '5 hours ago',
    nextRun: 'Every Monday at 9 AM',
    runs: 48,
    successRate: 100,
    triggers: ['Schedule'],
    updated: '2025-01-18',
  },
  {
    id: '3',
    name: 'Social media cross-post',
    status: 'paused',
    lastRun: '4 days ago',
    nextRun: '-',
    runs: 156,
    successRate: 94.2,
    triggers: ['Twitter'],
    updated: '2025-01-15',
  },
  {
    id: '4',
    name: 'Lead qualification pipeline',
    status: 'draft',
    lastRun: 'Never',
    nextRun: 'Not scheduled',
    runs: 0,
    successRate: 0,
    triggers: ['HubSpot'],
    updated: '2025-01-10',
  },
  {
    id: '5',
    name: 'Invoice processing workflow',
    status: 'active',
    lastRun: '1 hour ago',
    nextRun: 'When trigger fires',
    runs: 89,
    successRate: 96.6,
    triggers: ['Gmail'],
    updated: '2025-01-19',
  },
  {
    id: '6',
    name: 'Slack notification system',
    status: 'error',
    lastRun: '10 minutes ago',
    nextRun: 'Retrying in 5 min',
    runs: 234,
    successRate: 87.3,
    triggers: ['Webhook'],
    updated: '2025-01-19',
  },
]

type StatusFilter = 'all' | 'active' | 'paused' | 'draft' | 'error'

export default function WorkflowsNewlyPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filteredWorkflows = workflows.filter((w) => {
    const matchesSearch = w.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || w.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const handleSelectAll = () => {
    if (selectedIds.length === filteredWorkflows.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filteredWorkflows.map((w) => w.id))
    }
  }

  const handleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const stats = [
    { label: 'Total workflows', value: workflows.length, icon: Workflow },
    { label: 'Active', value: workflows.filter((w) => w.status === 'active').length, icon: Zap },
    { label: 'Total runs', value: workflows.reduce((sum, w) => sum + w.runs, 0).toLocaleString(), icon: Activity },
    { label: 'Avg success', value: '94.8%', icon: TrendingUp },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
        {/* Command Bar */}
        <div className="h-14 border-b border-slate-200 flex items-center px-6 gap-4">
          <div className="flex items-center gap-3 flex-1">
            <h1 className="text-base font-semibold text-slate-900">Workflows</h1>
            <div className="h-4 w-px bg-slate-200"></div>
            <div className="flex items-center gap-1">
              {(['all', 'active', 'paused', 'draft', 'error'] as StatusFilter[]).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-md transition-colors capitalize',
                    statusFilter === status
                      ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  )}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-slate-600 h-8">
              <Filter className="w-4 h-4 mr-1.5" />
              Filter
            </Button>
            <div className="h-4 w-px bg-slate-200"></div>
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white h-8">
              <Plus className="w-4 h-4 mr-1.5" />
              New workflow
            </Button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="grid grid-cols-4 gap-4">
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                  <stat.icon className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <div className="text-xl font-bold text-slate-900">{stat.value}</div>
                  <div className="text-xs text-slate-600">{stat.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Batch Actions Bar */}
        {selectedIds.length > 0 && (
          <div className="border-b border-slate-200 bg-indigo-50 px-6 py-2 flex items-center justify-between">
            <div className="text-sm font-medium text-indigo-900">
              {selectedIds.length} selected
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="text-indigo-700 hover:bg-indigo-100 h-8">
                <Play className="w-4 h-4 mr-1.5" />
                Run
              </Button>
              <Button variant="ghost" size="sm" className="text-indigo-700 hover:bg-indigo-100 h-8">
                <Pause className="w-4 h-4 mr-1.5" />
                Pause
              </Button>
              <Button variant="ghost" size="sm" className="text-indigo-700 hover:bg-indigo-100 h-8">
                <Copy className="w-4 h-4 mr-1.5" />
                Duplicate
              </Button>
              <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 h-8">
                <Trash2 className="w-4 h-4 mr-1.5" />
                Delete
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <th className="w-12 px-6 py-3 text-left">
                  <Checkbox
                    checked={selectedIds.length === filteredWorkflows.length && filteredWorkflows.length > 0}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all workflows"
                  />
                </th>
                <th className="w-12 px-3 py-3"></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Last run
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Runs
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Success
                </th>
                <th className="w-12 px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredWorkflows.map((workflow) => (
                <React.Fragment key={workflow.id}>
                  <tr
                    className={cn(
                      'group hover:bg-slate-50 transition-colors',
                      selectedIds.includes(workflow.id) && 'bg-indigo-50 hover:bg-indigo-50'
                    )}
                  >
                    <td className="px-6 py-4">
                      <Checkbox
                        checked={selectedIds.includes(workflow.id)}
                        onCheckedChange={() => handleSelectOne(workflow.id)}
                        aria-label={`Select workflow ${workflow.name}`}
                      />
                    </td>
                    <td className="px-3 py-4">
                      <button
                        onClick={() => setExpandedId(expandedId === workflow.id ? null : workflow.id)}
                        className="text-slate-400 hover:text-slate-600"
                        aria-label={expandedId === workflow.id ? `Collapse ${workflow.name}` : `Expand ${workflow.name}`}
                      >
                        {expandedId === workflow.id ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 text-sm">{workflow.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <StatusBadge status={workflow.status} />
                    </td>
                    <td className="px-3 py-4 text-sm text-slate-600">{workflow.lastRun}</td>
                    <td className="px-3 py-4 text-right text-sm font-medium text-slate-900">
                      {workflow.runs.toLocaleString()}
                    </td>
                    <td className="px-3 py-4 text-right text-sm font-medium text-slate-900">
                      {workflow.successRate}%
                    </td>
                    <td className="px-3 py-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label={`Actions for ${workflow.name}`}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <Eye className="w-4 h-4 mr-2" />
                            View details
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Copy className="w-4 h-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem>
                            <Play className="w-4 h-4 mr-2" />
                            Run now
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Archive className="w-4 h-4 mr-2" />
                            Archive
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-red-600">
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                  {expandedId === workflow.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={8} className="px-6 py-6">
                        <ExpandedRow workflow={workflow} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          {filteredWorkflows.length === 0 && (
            <div className="text-center py-12">
              <div className="text-slate-400 mb-2">
                <Search className="w-12 h-12 mx-auto" />
              </div>
              <h3 className="text-base font-semibold text-slate-900 mb-1">No workflows found</h3>
              <p className="text-sm text-slate-600">Try adjusting your search or filters</p>
            </div>
          )}
        </div>
    </div>
  )
}

// Status Badge Component
function StatusBadge({ status }: { status: string }) {
  const config = {
    active: {
      icon: CheckCircle2,
      label: 'Active',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    paused: {
      icon: Pause,
      label: 'Paused',
      className: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    draft: {
      icon: Clock,
      label: 'Draft',
      className: 'bg-slate-100 text-slate-700 border-slate-200',
    },
    error: {
      icon: AlertCircle,
      label: 'Error',
      className: 'bg-red-50 text-red-700 border-red-200',
    },
  }

  const { icon: Icon, label, className } = config[status as keyof typeof config] || config.draft

  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border', className)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}

// Expanded Row Component
function ExpandedRow({ workflow }: { workflow: typeof workflows[0] }) {
  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Triggers</div>
          <div className="flex flex-wrap gap-2">
            {workflow.triggers.map((trigger) => (
              <Badge key={trigger} variant="secondary" className="bg-white border border-slate-200">
                {trigger}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Next run</div>
          <div className="text-sm text-slate-900">{workflow.nextRun}</div>
        </div>
      </div>
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Performance</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Total runs</span>
              <span className="font-medium text-slate-900">{workflow.runs}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Success rate</span>
              <span className="font-medium text-slate-900">{workflow.successRate}%</span>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Quick actions</div>
          <div className="flex flex-col gap-2">
            <Button variant="outline" size="sm" className="justify-start">
              <Play className="w-4 h-4 mr-2" />
              Run now
            </Button>
            <Button variant="outline" size="sm" className="justify-start">
              <Activity className="w-4 h-4 mr-2" />
              View history
            </Button>
            <Button variant="outline" size="sm" className="justify-start">
              <Edit className="w-4 h-4 mr-2" />
              Edit workflow
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
