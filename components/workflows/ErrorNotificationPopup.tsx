"use client"

import React, { useState, useEffect } from 'react'
import { X, AlertCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useWorkflowErrorStore } from '@/stores/workflowErrorStore'
import { formatDistanceToNow } from 'date-fns'

interface ErrorNotificationPopupProps {
  workflowId: string
}

export default function ErrorNotificationPopup({ workflowId }: ErrorNotificationPopupProps) {
  const { currentWorkflowErrors, clearErrorsForWorkflow } = useWorkflowErrorStore()
  const [isVisible, setIsVisible] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  // Show popup when new errors are added
  useEffect(() => {
    if (currentWorkflowErrors.length > 0) {
      setIsVisible(true)
    }
  }, [currentWorkflowErrors.length])

  // Auto-hide after 10 seconds if not expanded
  useEffect(() => {
    if (isVisible && !isExpanded && currentWorkflowErrors.length > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 10000)
      return () => clearTimeout(timer)
    }
  }, [isVisible, isExpanded, currentWorkflowErrors.length])

  if (!isVisible || currentWorkflowErrors.length === 0) {
    return null
  }

  const latestError = currentWorkflowErrors[0]
  const errorCount = currentWorkflowErrors.length

  const handleDismiss = () => {
    setIsVisible(false)
  }

  const handleClearAll = () => {
    clearErrorsForWorkflow(workflowId)
    setIsVisible(false)
  }

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)]">
      <Card className="bg-red-50 border-red-200 shadow-lg">
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <h3 className="font-semibold text-red-800">
                Workflow Execution Error{errorCount > 1 ? 's' : ''}
              </h3>
              {errorCount > 1 && (
                <Badge variant="destructive" className="text-xs">
                  {errorCount}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {errorCount > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleExpanded}
                  aria-label={isExpanded ? "Collapse error details" : "Expand error details"}
                  className="h-6 w-6 p-0 text-red-600 hover:text-red-800"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                aria-label="Dismiss error notification"
                className="h-6 w-6 p-0 text-red-600 hover:text-red-800"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Latest Error */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-red-700">
                {latestError.nodeName}
              </span>
              <div className="flex items-center gap-1 text-xs text-red-600">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(latestError.timestamp), { addSuffix: true })}
              </div>
            </div>
            <p className="text-sm text-red-700 bg-red-100 p-2 rounded border">
              {latestError.errorMessage}
            </p>
          </div>

          {/* Expanded Errors List */}
          {isExpanded && errorCount > 1 && (
            <div className="mb-3 max-h-32 overflow-y-auto space-y-2">
              {currentWorkflowErrors.slice(1).map((error) => (
                <div key={error.id} className="text-xs border-l-2 border-red-300 pl-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-red-700">{error.nodeName}</span>
                    <span className="text-red-600">
                      {formatDistanceToNow(new Date(error.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-red-600">{error.errorMessage}</p>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              className="text-red-700 border-red-300 hover:bg-red-100"
            >
              Clear All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="text-red-600 hover:text-red-800"
            >
              Dismiss
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}





