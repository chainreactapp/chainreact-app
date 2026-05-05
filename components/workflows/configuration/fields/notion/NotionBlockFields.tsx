import React, { useEffect, useState, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { ProfessionalSearch } from '@/components/ui/professional-search'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, FolderOpen, FileText, FileSpreadsheet, FileImage, File, Grid, List, Check, ChevronDown, Search } from 'lucide-react'
import { useIntegrationStore } from '@/stores/integrationStore'
import { getAuthHeader } from '@/lib/auth/getAuthHeader'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ConfigurationSectionHeader } from '../../components/ConfigurationSectionHeader'

import { logger } from '@/lib/utils/logger'

interface NotionBlockFieldsProps {
  value: any
  onChange: (value: any) => void
  field: any
  values: Record<string, any>
  loadOptions?: (fieldName: string, dependsOn?: string, dependsOnValue?: any, forceRefresh?: boolean) => Promise<void>
  setFieldValue?: (field: string, value: any) => void
}

interface BlockField {
  id: string
  type: string
  label: string
  value?: any
  options?: Array<{ value: string; label: string }>
  required?: boolean
}

interface PageBlock {
  id: string
  type: string
  properties: BlockField[]
  hasChildren: boolean
}

export function NotionBlockFields({
  value = {},
  onChange,
  field,
  values,
  loadOptions,
  setFieldValue
}: NotionBlockFieldsProps) {
  logger.info('🏗️ [NotionBlockFields] Component rendering with:', {
    hasValue: !!value,
    valueKeys: Object.keys(value || {}),
    page: values?.page,
    workspace: values?.workspace,
    operation: values?.operation
  })

  const [blocks, setBlocks] = useState<PageBlock[]>([])
  const [loading, setLoading] = useState(false)
  const [fieldValues, setFieldValues] = useState<Record<string, any>>(value || {})
  const [googleDriveDialogOpen, setGoogleDriveDialogOpen] = useState(false)
  const [googleDriveFiles, setGoogleDriveFiles] = useState<any[]>([])
  const [loadingGoogleDrive, setLoadingGoogleDrive] = useState(false)
  const [currentEmbedField, setCurrentEmbedField] = useState<string>('')
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const lastFetchedPageRef = useRef<string | null>(null)
  
  // Google Drive modal state
  const [searchQuery, setSearchQuery] = useState('')
  const [fileTypeFilter, setFileTypeFilter] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<'lastModified' | 'lastModifiedByMe' | 'lastOpenedByMe' | 'name'>('lastModified')
  const [showFileTypeDropdown, setShowFileTypeDropdown] = useState(false)
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  
  const { getIntegrationByProvider, integrations, fetchIntegrations } = useIntegrationStore()

  // Fetch integrations on mount
  useEffect(() => {
    fetchIntegrations()
  }, [])

  // Fetch blocks when page changes
  useEffect(() => {
    logger.info('🎯 [NotionBlockFields] useEffect triggered with:', {
      page: values.page,
      workspace: values.workspace,
      lastFetchedPage: lastFetchedPageRef.current,
      currentLoading: loading,
      blocksLength: blocks.length
    })

    const fetchBlocks = async () => {
      if (!values.page || !values.workspace) {
        logger.info('⏭️ [NotionBlockFields] No page or workspace, skipping')
        return
      }

      // Only fetch if the page actually changed
      if (lastFetchedPageRef.current === values.page) {
        logger.info('📌 [NotionBlockFields] Page has not changed, skipping fetch')
        return
      }

      logger.info('🔄 [NotionBlockFields] Fetching blocks for new page:', values.page)
      setLoading(true)
      try {
        const integration = getIntegrationByProvider('notion')
        if (!integration) {
          logger.error('No Notion integration found')
          return
        }

        const response = await fetch('/api/integrations/notion/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            integrationId: integration.id,
            dataType: 'page_blocks',
            options: {
              pageId: values.page,
              workspace: values.workspace
            }
          })
        })

        if (!response.ok) {
          throw new Error('Failed to fetch page blocks')
        }

        const result = await response.json()
        const pageBlocks = result.data || []
        
        logger.info('📦 [NotionBlockFields] Fetched blocks:', pageBlocks)
        setBlocks(pageBlocks)
        lastFetchedPageRef.current = values.page // Mark this page as fetched

        // Initialize field values, preserving any saved values from `value` prop
        const savedValues = value || {}
        const initialValues: Record<string, any> = {}
        let titleFieldId: string | null = null
        let titleValue: string = ''

        logger.info('💾 [NotionBlockFields] Saved values from previous configuration:', {
          hasSavedValues: Object.keys(savedValues).length > 0,
          savedValueKeys: Object.keys(savedValues),
          savedValues
        })

        // Debug: Log all properties to see what we're getting
        logger.info('🔍 [NotionBlockFields] Examining all properties:')
        
        // Look for the primary_properties block first
        const primaryPropsBlock = pageBlocks.find((block: PageBlock) => block.type === 'primary_properties')
        
        pageBlocks.forEach((block: PageBlock) => {
          logger.info(`  📦 Block type: ${block.type}, properties: ${block.properties.length}`)
          
          block.properties.forEach((prop: BlockField) => {
            // Log every property for debugging
            logger.info('    Property:', {
              id: prop.id,
              label: prop.label,
              type: prop.type,
              required: prop.required,
              value: prop.value,
              valueLength: prop.value ? String(prop.value).length : 0
            })
            
            // Use saved value if it exists, otherwise use the value from API
            if (savedValues[prop.id] !== undefined) {
              initialValues[prop.id] = savedValues[prop.id]
              if (prop.type === 'todo_list_items') {
                logger.info('    ✅ Using saved todo list:', {
                  fieldId: prop.id,
                  savedValue: savedValues[prop.id]
                })
              }
            } else if (prop.type === 'todo_list_items' && prop.items) {
              // For todo list items, store the items array with originalItems for deletion tracking
              initialValues[prop.id] = {
                items: prop.items,
                originalItems: prop.items  // Track original items to detect deletions
              }
              logger.info('    📝 Initializing todo list from API:', {
                fieldId: prop.id,
                items: prop.items,
                originalItems: prop.items
              })
            } else if (prop.value !== undefined) {
              initialValues[prop.id] = prop.value
            }

            // Find and track title field - check if this is a title property
            // Title properties in Notion databases have type 'text' and are usually required
            // According to pageBlocks.ts line 388-396, title type becomes 'text' with required: true
            const propLabel = (prop.label || '').toLowerCase()
            const isExactTitleMatch = propLabel === 'title' || propLabel === 'name'
            const isLikelyTitle = isExactTitleMatch ||
              propLabel.includes('title') ||
              propLabel.includes('name') ||
              propLabel === 'task' ||
              propLabel === 'item' ||
              propLabel === 'page'

            // Check if this property is in the primary_properties block
            const isPrimaryProperty = block.type === 'primary_properties'

            // Scoring system to find the best title candidate
            let score = 0
            if (prop.required) score += 3 // Required fields are more likely to be title
            if (isPrimaryProperty) score += 2 // Primary properties block is where title usually is
            if (isExactTitleMatch) score += 5 // Exact matches get highest priority
            if (isLikelyTitle) score += 1 // Partial matches get some points
            if (prop.value) score += 2 // Fields with values are better candidates

            // Use the saved value or the prop value for title checking
            const fieldValue = savedValues[prop.id] !== undefined ? savedValues[prop.id] : prop.value

            // Consider this field as title if it scores high enough and has a value
            if (prop.type === 'text' && score >= 3 && fieldValue) {
              // Only update if this is a better candidate than what we have
              if (!titleFieldId || score >= 5 || (isPrimaryProperty && !titleValue)) {
                titleFieldId = prop.id
                titleValue = fieldValue || ''
                logger.info(`    ✅ Found title field! Score: ${score}`, {
                  id: prop.id,
                  label: prop.label,
                  value: fieldValue,
                  required: prop.required,
                  isPrimaryProperty
                })
              }
            }
          })
        })
        
        // Fallback: If no title found, try to get the first required text field from primary_properties
        if (!titleValue && primaryPropsBlock) {
          const firstRequiredText = primaryPropsBlock.properties.find((prop: BlockField) => 
            prop.type === 'text' && prop.required && prop.value
          )
          
          if (firstRequiredText) {
            titleFieldId = firstRequiredText.id
            titleValue = firstRequiredText.value
            logger.info('    📌 Using first required text field as title fallback:', {
              id: firstRequiredText.id,
              label: firstRequiredText.label,
              value: firstRequiredText.value
            })
          }
        }
        
        // Also set the title in the parent form if we found it
        logger.info('🎯 [NotionBlockFields] Title setup:', {
          titleFieldId,
          titleValue,
          hasSetFieldValue: !!setFieldValue,
          operation: values.operation,
          allValues: values
        })
        
        // Only set title if the operation shows the title field (create, update, etc)
        const operationsWithTitle = ['create', 'create_database', 'update', 'update_database']
        const shouldSetTitle = operationsWithTitle.includes(values.operation)
        
        logger.info('🎭 [NotionBlockFields] Title setting conditions:', {
          titleValue,
          hasSetFieldValue: !!setFieldValue,
          shouldSetTitle,
          operation: values.operation,
          operationsWithTitle
        })
        
        if (titleValue && setFieldValue && shouldSetTitle) {
          // Update the parent form's title field with a small delay to ensure DOM is ready
          logger.info('📝 [NotionBlockFields] Setting title field to:', titleValue)
          logger.info('    Title value type:', typeof titleValue)
          logger.info('    Title value length:', titleValue.length)
          
          // Try immediate update
          logger.info('    💫 Attempting immediate setFieldValue...')
          setFieldValue('title', titleValue)
          
          // Also try with a small delay to ensure the field is rendered
          setTimeout(() => {
            logger.info('⏱️ [NotionBlockFields] Delayed title set to:', titleValue)
            setFieldValue('title', titleValue)
            
            // Also try to trigger change event on the actual input element
            const titleInput = document.querySelector('input[name="title"]') as HTMLInputElement
            if (titleInput) {
              logger.info('    🎯 Found title input element, setting value directly')
              titleInput.value = titleValue
              titleInput.dispatchEvent(new Event('input', { bubbles: true }))
              titleInput.dispatchEvent(new Event('change', { bubbles: true }))
            }
          }, 200)
          
          // Try with a longer delay as well
          setTimeout(() => {
            logger.info('⏳ [NotionBlockFields] Second delayed title set to:', titleValue)
            setFieldValue('title', titleValue)
            
            // Check if the value was actually set
            const titleInput = document.querySelector('input[name="title"]') as HTMLInputElement
            if (titleInput) {
              logger.info('    📊 Title input current value:', titleInput.value)
              if (!titleInput.value || titleInput.value !== titleValue) {
                logger.info('    🔄 Value not set, trying again...')
                titleInput.value = titleValue
                titleInput.dispatchEvent(new Event('input', { bubbles: true }))
                titleInput.dispatchEvent(new Event('change', { bubbles: true }))
              }
            }
          }, 500)
          
          // Try a different approach - directly update through onChange if available
          if (values.onChange) {
            logger.info('🔄 [NotionBlockFields] Also trying direct onChange')
            values.onChange('title', titleValue)
          }
        } else {
          logger.info('⚠️ [NotionBlockFields] Not setting title:', {
            hasTitle: !!titleValue,
            titleValue: titleValue,
            hasSetFieldValue: !!setFieldValue,
            shouldSetTitle,
            operation: values.operation
          })
          
          // Even if we don't have a title value yet, we might need to look harder
          if (!titleValue && shouldSetTitle && primaryPropsBlock) {
            logger.info('    🔍 Looking harder for any text field with content...')
            const anyTextField = primaryPropsBlock.properties.find((prop: BlockField) => 
              prop.type === 'text' && prop.value && String(prop.value).trim()
            )
            if (anyTextField) {
              logger.info('    💡 Found a text field with content:', anyTextField)
              setTimeout(() => {
                setFieldValue('title', anyTextField.value)
              }, 700)
            }
          }
        }
        
        logger.info('🔧 [NotionBlockFields] Initial values being set:', initialValues)
        setFieldValues(initialValues)
        onChange(initialValues)
        
      } catch (error: any) {
        logger.error('Failed to fetch blocks:', error)
        // Don't show scary errors for permission issues - we handle this gracefully in the UI
        if (!error.message?.includes('Cannot access')) {
          logger.error('Unexpected error fetching blocks:', error)
        }
        // Clear blocks to show the help message
        setBlocks([])
      } finally {
        setLoading(false)
      }
    }

    fetchBlocks()
  }, [values.page, values.workspace]) // Only re-run when page or workspace changes

  const handleFieldChange = (fieldId: string, newValue: any) => {
    const updated = { ...fieldValues, [fieldId]: newValue }
    logger.info('📝 [NotionBlockFields] Field changed:', {
      fieldId,
      newValue,
      isTodoList: newValue?.items !== undefined,
      allUpdatedValues: updated
    })
    setFieldValues(updated)
    onChange(updated)
  }

  const handleGoogleDriveBrowse = async (fieldKey: string) => {
    setCurrentEmbedField(fieldKey)
    
    // Check if Google Drive integration is connected (provider is 'google-drive' in database)
    const googleDriveIntegration = integrations.find(i => 
      i.provider === 'google-drive' && i.status === 'connected'
    )
    
    if (!googleDriveIntegration) {
      // Show connect modal instead of redirecting
      setShowConnectModal(true)
      return
    }
    
    // If connected, open file browser dialog
    setGoogleDriveDialogOpen(true)
    setLoadingGoogleDrive(true)
    
    try {
      // PR-AUTH-5: cached auth header.
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      }

      // Fetch Google Drive files (including folders)
      const response = await fetch('/api/integrations/fetch-user-data', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          integrationId: googleDriveIntegration.id,
          dataType: 'google-drive-files',
          options: {
            mimeType: 'application/vnd.google-apps.folder,application/vnd.google-apps.document,application/vnd.google-apps.spreadsheet,application/vnd.google-apps.presentation,application/pdf',
            maxResults: 100
          }
        })
      })
      
      if (!response.ok) {
        throw new Error('Failed to fetch Google Drive files')
      }
      
      const result = await response.json()
      setGoogleDriveFiles(result.data || [])
    } catch (error) {
      logger.error('Error fetching Google Drive files:', error)
      setGoogleDriveFiles([])
    } finally {
      setLoadingGoogleDrive(false)
    }
  }

  const handleConnectGoogleDrive = () => {
    // Open Google Drive OAuth in a new window
    const width = 600
    const height = 700
    const left = window.screen.width / 2 - width / 2
    const top = window.screen.height / 2 - height / 2
    
    const oauthWindow = window.open(
      '/api/integrations/google-drive/oauth',
      'google-drive-oauth',
      `width=${width},height=${height},top=${top},left=${left},toolbar=no,menubar=no`
    )
    
    // Check if the window was closed and refresh integrations
    const checkInterval = setInterval(() => {
      if (oauthWindow?.closed) {
        clearInterval(checkInterval)
        setShowConnectModal(false)
        // Refresh integrations after a delay to allow OAuth to complete
        setTimeout(() => {
          window.location.reload()
        }, 1000)
      }
    }, 500)
  }

  const handleSelectGoogleDriveFile = (file: any) => {
    setSelectedFileId(file.id)
  }

  const handleConfirmSelection = () => {
    const selectedFile = googleDriveFiles.find(f => f.id === selectedFileId)
    if (selectedFile && currentEmbedField) {
      handleFieldChange(currentEmbedField, selectedFile.webViewLink || selectedFile.url || selectedFile.id)
      setGoogleDriveDialogOpen(false)
      setCurrentEmbedField('')
      setSelectedFileId(null)
    }
  }

  // Filter and sort Google Drive files
  const getFilteredAndSortedFiles = () => {
    let filtered = [...googleDriveFiles]
    
    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(file => 
        file.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }
    
    // Apply file type filter
    if (fileTypeFilter !== 'all') {
      filtered = filtered.filter(file => {
        switch (fileTypeFilter) {
          case 'folders':
            return file.mimeType === 'application/vnd.google-apps.folder'
          case 'documents':
            return file.mimeType?.includes('document')
          case 'spreadsheets':
            return file.mimeType?.includes('spreadsheet')
          case 'presentations':
            return file.mimeType?.includes('presentation')
          case 'pdfs':
            return file.mimeType?.includes('pdf')
          case 'images':
            return file.mimeType?.includes('image')
          default:
            return true
        }
      })
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'lastModified':
        case 'lastModifiedByMe':
        case 'lastOpenedByMe':
          // Use modifiedTime for all date-based sorts
          return new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime()
        default:
          return 0
      }
    })
    
    return filtered
  }

  const handleSearch = () => {
    // Search is already reactive via getFilteredAndSortedFiles
    // This function is for the search button click
    logger.info('Searching for:', searchQuery)
  }

  const fileTypeOptions = [
    { value: 'all', label: 'All Files', icon: null },
    { value: 'folders', label: 'Folders', icon: FolderOpen },
    { value: 'documents', label: 'Documents', icon: FileText },
    { value: 'spreadsheets', label: 'Spreadsheets', icon: FileSpreadsheet },
    { value: 'presentations', label: 'Presentations', icon: FileImage },
    { value: 'pdfs', label: 'PDFs', icon: FileText },
    { value: 'images', label: 'Images', icon: FileImage },
  ]

  const sortOptions = [
    { value: 'lastModified', label: 'Last modified' },
    { value: 'lastModifiedByMe', label: 'Last modified by me' },
    { value: 'lastOpenedByMe', label: 'Last opened by me' },
    { value: 'name', label: 'Name' },
  ]

  const renderField = (property: BlockField) => {
    const fieldKey = property.id
    const currentValue = fieldValues[fieldKey] ?? property.value

    switch (property.type) {
      case 'todo_list_items':
        // Get current items from fieldValues or use property items as default
        const currentTodoItems = fieldValues[fieldKey]?.items ||
                                 (Array.isArray(fieldValues[fieldKey]) ? fieldValues[fieldKey] : null) ||
                                 property.items ||
                                 []

        return (
          <div key={fieldKey} className="space-y-3">
            <Label className="text-sm font-semibold">{property.label}</Label>
            <div className="space-y-2 border rounded-lg p-3 bg-card">
              {currentTodoItems.map((item: any, index: number) => (
                <div key={item.id} className="flex items-center gap-3 p-2 hover:bg-accent/50 rounded transition-colors">
                  <Checkbox
                    id={`${fieldKey}-${item.id}`}
                    checked={item.checked}
                    onCheckedChange={(checked) => {
                      // Update the entire todo list structure when checkbox changes
                      const updatedItems = currentTodoItems.map((todoItem: any, i: number) =>
                        i === index ? { ...todoItem, checked } : todoItem
                      )
                      // Preserve originalItems for deletion tracking
                      const originalItems = fieldValues[fieldKey]?.originalItems
                      handleFieldChange(fieldKey, { items: updatedItems, originalItems })
                    }}
                  />
                  <Input
                    type="text"
                    value={item.content}
                    onChange={(e) => {
                      // Update the entire todo list structure when content changes
                      const updatedItems = currentTodoItems.map((todoItem: any, i: number) =>
                        i === index ? { ...todoItem, content: e.target.value } : todoItem
                      )
                      // Preserve originalItems for deletion tracking
                      const originalItems = fieldValues[fieldKey]?.originalItems
                      handleFieldChange(fieldKey, { items: updatedItems, originalItems })
                    }}
                    placeholder="Enter to-do item..."
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      // Remove this to-do item
                      const newItems = currentTodoItems.filter((_: any, i: number) => i !== index)
                      // Preserve originalItems for deletion tracking
                      const originalItems = fieldValues[fieldKey]?.originalItems || currentTodoItems
                      handleFieldChange(fieldKey, { items: newItems, originalItems })
                    }}
                    className="text-red-500 hover:text-red-700 p-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  // Add new to-do item
                  const newItem = {
                    id: `new-${Date.now()}`,
                    content: '',
                    checked: false
                  }
                  const updatedItems = [...currentTodoItems, newItem]
                  // Preserve originalItems for deletion tracking
                  const originalItems = fieldValues[fieldKey]?.originalItems
                  handleFieldChange(fieldKey, { items: updatedItems, originalItems })
                }}
                className="w-full p-2 border-2 border-dashed border-gray-300 hover:border-gray-400 rounded text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                + Add To-Do Item
              </button>
            </div>
          </div>
        )
      
      case 'document_embed':
        return (
          <div key={fieldKey} className="space-y-2">
            <Label className="flex items-center gap-2">
              {property.label}
              {property.embedType === 'google_drive' && <span className="text-xs text-blue-600">(Google Drive)</span>}
              {property.embedType === 'pdf' && <span className="text-xs text-orange-600">(PDF)</span>}
              {property.embedType === 'figma' && <span className="text-xs text-purple-600">(Figma)</span>}
            </Label>
            <div className="flex gap-2">
              {property.embedType === 'google_drive' && (
                <>
                  <Input
                    id={fieldKey}
                    type="text"
                    value={currentValue || ''}
                    onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                    placeholder={property.placeholder}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                    onClick={() => handleGoogleDriveBrowse(fieldKey)}
                  >
                    Browse
                  </button>
                </>
              )}
              {property.embedType === 'pdf' && (
                <>
                  <Input
                    id={fieldKey}
                    type="text"
                    value={currentValue || ''}
                    onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                    placeholder={property.placeholder}
                    className="flex-1"
                  />
                  <Input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        // TODO: Handle file upload
                        logger.info('Upload PDF:', file.name)
                      }
                    }}
                    className="hidden"
                    id={`${fieldKey}-upload`}
                  />
                  <label
                    htmlFor={`${fieldKey}-upload`}
                    className="px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 text-sm cursor-pointer"
                  >
                    Upload
                  </label>
                </>
              )}
              {property.embedType === 'figma' && (
                <Input
                  id={fieldKey}
                  type="url"
                  value={currentValue || ''}
                  onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                  placeholder={property.placeholder}
                  className="flex-1"
                />
              )}
            </div>
          </div>
        )
      
      case 'file_attachment':
        return (
          <div key={fieldKey} className="space-y-2">
            <Label>{property.label}</Label>
            <div className="flex gap-2">
              <Input
                id={fieldKey}
                type="text"
                value={currentValue || ''}
                onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                placeholder={property.placeholder}
                className="flex-1"
              />
              <Input
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    // TODO: Handle file upload
                    logger.info('Upload file:', file.name)
                  }
                }}
                className="hidden"
                id={`${fieldKey}-file-upload`}
              />
              <label
                htmlFor={`${fieldKey}-file-upload`}
                className="px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm cursor-pointer"
              >
                Upload
              </label>
            </div>
          </div>
        )
      
      case 'select':
      case 'status':
        return (
          <div key={fieldKey} className="space-y-2">
            <Label htmlFor={fieldKey}>{property.label}</Label>
            <Select
              value={currentValue || ''}
              onValueChange={(val) => handleFieldChange(fieldKey, val)}
            >
              <SelectTrigger id={fieldKey}>
                <SelectValue placeholder={`Select ${property.label.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {property.options?.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                )) || (
                  <SelectItem value={currentValue || 'none'}>
                    {currentValue || 'None'}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        )

      case 'multi_select':
        return (
          <div key={fieldKey} className="space-y-2">
            <Label>{property.label}</Label>
            <div className="space-y-2 border rounded-md p-3">
              {property.options?.map(opt => (
                <div key={opt.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${fieldKey}-${opt.value}`}
                    checked={Array.isArray(currentValue) && currentValue.includes(opt.value)}
                    onCheckedChange={(checked) => {
                      const current = Array.isArray(currentValue) ? currentValue : []
                      const updated = checked
                        ? [...current, opt.value]
                        : current.filter(v => v !== opt.value)
                      handleFieldChange(fieldKey, updated)
                    }}
                  />
                  <Label htmlFor={`${fieldKey}-${opt.value}`} className="text-sm font-normal">
                    {opt.label}
                  </Label>
                </div>
              )) || (
                <div className="text-sm text-muted-foreground">
                  {Array.isArray(currentValue) ? currentValue.join(', ') : 'No options'}
                </div>
              )}
            </div>
          </div>
        )

      case 'people':
        // People values are objects with {id, name} - display names but preserve the full objects
        const peopleDisplayValue = Array.isArray(currentValue)
          ? currentValue.map((p: any) => typeof p === 'object' ? p.name : p).join(', ')
          : (typeof currentValue === 'object' ? currentValue?.name : currentValue) || ''

        return (
          <div key={fieldKey} className="space-y-2">
            <Label htmlFor={fieldKey}>{property.label}</Label>
            <Input
              id={fieldKey}
              type="text"
              value={peopleDisplayValue}
              disabled={true}
              className="bg-muted"
              placeholder="People assigned to this item (read-only)"
            />
            <p className="text-xs text-muted-foreground">
              People properties cannot be edited through this interface. Use Notion directly to change assignments.
            </p>
          </div>
        )

      case 'checkbox':
        return (
          <div key={fieldKey} className="flex items-center space-x-2">
            <Checkbox
              id={fieldKey}
              checked={currentValue === true}
              onCheckedChange={(checked) => handleFieldChange(fieldKey, checked)}
            />
            <Label htmlFor={fieldKey}>{property.label}</Label>
          </div>
        )

      case 'number':
        return (
          <div key={fieldKey} className="space-y-2">
            <Label htmlFor={fieldKey}>{property.label}</Label>
            <Input
              id={fieldKey}
              type="number"
              value={currentValue || ''}
              onChange={(e) => handleFieldChange(fieldKey, e.target.value ? parseFloat(e.target.value) : null)}
              placeholder={`Enter ${property.label.toLowerCase()}`}
            />
          </div>
        )

      case 'date':
        return (
          <div key={fieldKey} className="space-y-2">
            <Label htmlFor={fieldKey}>{property.label}</Label>
            <Input
              id={fieldKey}
              type="date"
              value={currentValue || ''}
              onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
              disabled={property.disabled}
            />
          </div>
        )
      
      case 'url':
        return (
          <div key={fieldKey} className="space-y-2">
            <Label htmlFor={fieldKey}>{property.label}</Label>
            <Input
              id={fieldKey}
              type="url"
              value={currentValue || ''}
              onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
              placeholder={property.placeholder || `Enter ${property.label.toLowerCase()}`}
              disabled={property.disabled}
            />
          </div>
        )
      
      case 'email':
        return (
          <div key={fieldKey} className="space-y-2">
            <Label htmlFor={fieldKey}>{property.label}</Label>
            <Input
              id={fieldKey}
              type="email"
              value={currentValue || ''}
              onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
              placeholder={property.placeholder || `Enter ${property.label.toLowerCase()}`}
              disabled={property.disabled}
            />
          </div>
        )

      case 'text':
      default:
        // For longer text content, use textarea
        if (property.label === 'Content' || (currentValue && String(currentValue).length > 100)) {
          return (
            <div key={fieldKey} className="space-y-2">
              <Label htmlFor={fieldKey} className="flex items-center gap-2">
                {property.label}
                {property.required && <span className="text-red-500">*</span>}
                {property.disabled && <span className="text-xs text-muted-foreground">(Read-only)</span>}
              </Label>
              <Textarea
                id={fieldKey}
                value={currentValue || ''}
                onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
                placeholder={property.placeholder || `Enter ${property.label.toLowerCase()}`}
                rows={4}
                disabled={property.disabled}
                className={property.disabled ? 'bg-muted cursor-not-allowed' : ''}
              />
            </div>
          )
        }

        return (
          <div key={fieldKey} className="space-y-2">
            <Label htmlFor={fieldKey} className="flex items-center gap-2">
              {property.label}
              {property.required && <span className="text-red-500">*</span>}
              {property.disabled && <span className="text-xs text-muted-foreground">(Read-only)</span>}
            </Label>
            <Input
              id={fieldKey}
              type="text"
              value={currentValue || ''}
              onChange={(e) => handleFieldChange(fieldKey, e.target.value)}
              placeholder={property.placeholder || `Enter ${property.label.toLowerCase()}`}
              disabled={property.disabled}
              className={property.disabled ? 'bg-muted cursor-not-allowed' : ''}
            />
          </div>
        )
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Loading page blocks...</span>
      </div>
    )
  }

  if (blocks.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          Select a page to load its blocks and properties
        </div>
        {values.page && (
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-2">
              ⚠️ Page Access Required
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-200 mb-3">
              If you're seeing this message, the selected page may not be accessible. In Notion:
            </p>
            <ol className="text-xs text-amber-700 dark:text-amber-300 space-y-1 ml-4">
              <li>1. Open the page in Notion</li>
              <li>2. Click Share → Connections</li>
              <li>3. Add your ChainReact integration</li>
              <li>4. Try selecting the page again here</li>
            </ol>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-3 italic">
              Note: Notion requires explicit permission for each page you want to automate.
            </p>
          </div>
        )}
      </div>
    )
  }

  // Separate different block types
  const contentBlocks = blocks.filter(b => 
    b.type !== 'database_properties' && 
    b.type !== 'primary_properties' && 
    b.type !== 'secondary_properties' &&
    b.type !== 'todo_list' &&
    b.type !== 'document_embedding_section'
  )
  const todoListBlock = blocks.find(b => b.type === 'todo_list')
  const documentSection = blocks.find(b => b.type === 'document_embedding_section')
  const primaryProperties = blocks.find(b => b.type === 'primary_properties')
  const secondaryProperties = blocks.find(b => b.type === 'secondary_properties')
  const propertyBlock = blocks.find(b => b.type === 'database_properties') // Fallback for old format

  return (
    <>
      <div className="space-y-6">
        {/* To-Do List Section */}
        {todoListBlock && (
        <div className="space-y-4">
          <ConfigurationSectionHeader
            label={null}
            prefix={
              <span className="bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-1 rounded text-xs">
                TO-DO LIST
              </span>
            }
            className="border-none pb-0"
          />
          <div className="border rounded-lg p-4 bg-green-50/30 dark:bg-green-900/10">
            {todoListBlock.properties.map(renderField)}
          </div>
        </div>
      )}
      
      {/* Document Embedding Section */}
      {documentSection && (
        <div className="space-y-4">
          <ConfigurationSectionHeader
            label={null}
            prefix={
              <span className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded text-xs">
                DOCUMENT EMBEDS
              </span>
            }
            className="border-none pb-0"
          />
          <div className="border rounded-lg p-4 bg-indigo-50/30 dark:bg-indigo-900/10">
            <p className="text-xs text-muted-foreground mb-4">
              Embed documents from various sources into your Notion page
            </p>
            <div className="space-y-4">
              {documentSection.properties.map(renderField)}
            </div>
          </div>
        </div>
      )}
      
      {/* Content Blocks Section */}
      {contentBlocks.length > 0 && (
        <div className="space-y-4">
          <ConfigurationSectionHeader
            label={null}
            prefix={
              <span className="bg-primary/10 text-primary px-2 py-1 rounded text-xs">
                CONTENT BLOCKS
              </span>
            }
            className="border-none pb-0"
          />
          <div className="space-y-3">
            {contentBlocks.map((block) => (
              <div key={block.id} className="border rounded-lg p-4 space-y-3 bg-card">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm capitalize">
                    {block.type.replace(/_/g, ' ')}
                  </h4>
                  <span className="text-xs text-muted-foreground">
                    Block {contentBlocks.indexOf(block) + 1}
                  </span>
                </div>
                
                <div className="space-y-3">
                  {block.properties.map(renderField)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Primary Properties Section (Header Properties) */}
      {primaryProperties && (
        <div className="space-y-4">
          <ConfigurationSectionHeader
            label={null}
            prefix={
              <span className="bg-purple-500/10 text-purple-600 dark:text-purple-400 px-2 py-1 rounded text-xs">
                PRIMARY PROPERTIES
              </span>
            }
            suffix={
              <span className="text-xs text-muted-foreground font-normal">
                (Typically shown in page header)
              </span>
            }
            className="border-none pb-0"
          />
          <div className="border rounded-lg p-4 space-y-4 bg-purple-50/30 dark:bg-purple-900/10">
            <div className="grid gap-4 md:grid-cols-2">
              {primaryProperties.properties.map(renderField)}
            </div>
          </div>
        </div>
      )}
      
      {/* Secondary Properties Section (Additional Fields) */}
      {secondaryProperties && (
        <div className="space-y-4">
          <ConfigurationSectionHeader
            label={null}
            prefix={
              <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-1 rounded text-xs">
                ADDITIONAL PROPERTIES
              </span>
            }
            className="border-none pb-0"
          />
          <div className="border rounded-lg p-4 space-y-4 bg-amber-50/30 dark:bg-amber-900/10">
            <div className="grid gap-4">
              {secondaryProperties.properties.map(renderField)}
            </div>
          </div>
        </div>
      )}
      
      {/* Fallback for old format */}
      {!primaryProperties && !secondaryProperties && propertyBlock && (
        <div className="space-y-4">
          <ConfigurationSectionHeader
            label={null}
            prefix={
              <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-1 rounded text-xs">
                DATABASE PROPERTIES
              </span>
            }
            className="border-none pb-0"
          />
          <div className="border rounded-lg p-4 space-y-4 bg-amber-50/50 dark:bg-amber-900/10">
            <p className="text-xs text-muted-foreground mb-3">
              These are database-specific fields that structure your page data
            </p>
            <div className="grid gap-4">
              {propertyBlock.properties.map(renderField)}
            </div>
          </div>
        </div>
      )}
      
      {/* If no blocks or properties */}
      {blocks.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-8">
          No editable content or properties found on this page
        </div>
      )}
    </div>

    {/* Google Drive File Browser Dialog */}
    <Dialog open={googleDriveDialogOpen} onOpenChange={setGoogleDriveDialogOpen}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Select Google Drive File</DialogTitle>
        </DialogHeader>
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Select a file from Google Drive</h2>
        </div>
        
        {/* Search and View Controls */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex-1 relative flex items-center gap-2">
            {/* File type filter dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowFileTypeDropdown(!showFileTypeDropdown)}
                className="flex items-center gap-2 px-3 h-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-l-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {fileTypeOptions.find(opt => opt.value === fileTypeFilter)?.label || 'All Files'}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-500" />
              </button>
              
              {/* Dropdown menu */}
              {showFileTypeDropdown && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg z-50">
                  {fileTypeOptions.map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setFileTypeFilter(option.value)
                          setShowFileTypeDropdown(false)
                        }}
                        className={cn(
                          "flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors",
                          fileTypeFilter === option.value && "bg-slate-100 dark:bg-slate-800"
                        )}
                      >
                        {Icon && <Icon className="w-4 h-4 text-slate-500" />}
                        <span className="text-slate-700 dark:text-slate-300">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            
            {/* Search input */}
            <div className="flex-1">
              <ProfessionalSearch
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClear={() => setSearchQuery('')}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch()
                  }
                }}
                className="pl-9 pr-10 h-9 bg-white dark:bg-slate-900 border-l-0 rounded-l-none rounded-r-md border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={handleSearch}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
              >
                <Search className="w-4 h-4 text-slate-600 dark:text-slate-200" />
              </button>
            </div>
          </div>
          
          {/* View mode and sort controls */}
          <div className="flex items-center gap-1">
            {/* List view button */}
            <button 
              type="button"
              onClick={() => setViewMode('list')}
              className={cn(
                "p-2 rounded-md transition-colors",
                viewMode === 'list' 
                  ? "bg-slate-200 dark:bg-slate-700" 
                  : "hover:bg-slate-200 dark:hover:bg-slate-700"
              )}
              title="List view"
            >
              <List className="w-4 h-4 text-slate-600 dark:text-slate-200" />
            </button>
            
            {/* Grid view button */}
            <button 
              type="button"
              onClick={() => setViewMode('grid')}
              className={cn(
                "p-2 rounded-md transition-colors",
                viewMode === 'grid' 
                  ? "bg-slate-200 dark:bg-slate-700" 
                  : "hover:bg-slate-200 dark:hover:bg-slate-700"
              )}
              title="Grid view"
            >
              <Grid className="w-4 h-4 text-slate-600 dark:text-slate-200" />
            </button>
            
            {/* Sort dropdown */}
            <div className="relative ml-2">
              <button
                type="button"
                onClick={() => setShowSortDropdown(!showSortDropdown)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors"
                title="Sort options"
              >
                <svg className="w-4 h-4 text-slate-600 dark:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4 4m0 0l4-4m-4 4V4" />
                </svg>
              </button>
              
              {/* Sort dropdown menu */}
              {showSortDropdown && (
                <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg z-50">
                  {sortOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSortBy(option.value as any)
                        setShowSortDropdown(false)
                      }}
                      className={cn(
                        "flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors",
                        sortBy === option.value && "bg-slate-100 dark:bg-slate-800"
                      )}
                    >
                      {sortBy === option.value && <Check className="w-3 h-3 text-blue-500" />}
                      <span className={cn(
                        "text-slate-700 dark:text-slate-300",
                        sortBy === option.value ? "ml-0" : "ml-5"
                      )}>{option.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Files Section */}
        <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-slate-900">
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-4">
            {fileTypeFilter === 'folders' ? 'Folders' : 'Files'}
          </h3>
          
          {loadingGoogleDrive ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
              <span className="text-sm text-slate-500 dark:text-slate-400">Loading files...</span>
            </div>
          ) : getFilteredAndSortedFiles().length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-500 dark:text-slate-400">
              {searchQuery ? `No files found matching "${searchQuery}"` : 'No files found'}
            </div>
          ) : viewMode === 'list' ? (
            // List View
            <div className="space-y-0">
              <div className="grid grid-cols-[1fr,150px,150px] gap-4 pb-2 mb-2 border-b border-slate-200 dark:border-slate-700">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Name</div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Owner</div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Last modified</div>
              </div>
              {getFilteredAndSortedFiles().map((file: any) => {
                // Determine file icon
                const getFileIcon = () => {
                  if (file.mimeType === 'application/vnd.google-apps.folder') return FolderOpen
                  else if (file.mimeType?.includes('document')) return FileText
                  else if (file.mimeType?.includes('spreadsheet')) return FileSpreadsheet
                  else if (file.mimeType?.includes('presentation')) return FileImage
                  else if (file.mimeType?.includes('pdf')) return FileText
                  else if (file.mimeType?.includes('image')) return FileImage
                  return File
                }
                
                const IconComponent = getFileIcon()
                const formatDate = (dateString: string) => {
                  const date = new Date(dateString)
                  const now = new Date()
                  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
                  
                  if (diffDays === 0) return 'Today'
                  if (diffDays === 1) return 'Yesterday'
                  if (diffDays < 7) return `${diffDays} days ago`
                  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
                  
                  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                }
                
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => handleSelectGoogleDriveFile(file)}
                    className={cn(
                      "grid grid-cols-[1fr,150px,150px] gap-4 px-3 py-2 transition-colors rounded-md",
                      selectedFileId === file.id 
                        ? "bg-blue-50 dark:bg-blue-900/30" 
                        : "hover:bg-slate-50 dark:hover:bg-slate-800"
                    )}
                  >
                    <div className="flex items-center gap-2 text-left">
                      <IconComponent className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <span className="text-sm text-slate-700 dark:text-slate-300 truncate">
                        {file.name}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      me
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      {formatDate(file.modifiedTime)}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            // Grid View
            <div className="grid grid-cols-5 gap-4">
              {getFilteredAndSortedFiles().map((file: any) => {
                // Determine file icon and color based on MIME type
                const getFileIcon = () => {
                  if (file.mimeType === 'application/vnd.google-apps.folder') {
                    return { icon: FolderOpen, color: 'text-yellow-500', bgColor: 'bg-yellow-50 dark:bg-yellow-900/20' }
                  } else if (file.mimeType?.includes('document')) {
                    return { icon: FileText, color: 'text-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-900/20' }
                  } else if (file.mimeType?.includes('spreadsheet')) {
                    return { icon: FileSpreadsheet, color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-900/20' }
                  } else if (file.mimeType?.includes('presentation')) {
                    return { icon: FileImage, color: 'text-orange-500', bgColor: 'bg-orange-50 dark:bg-orange-900/20' }
                  } else if (file.mimeType?.includes('pdf')) {
                    return { icon: FileText, color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-900/20' }
                  } else if (file.mimeType?.includes('image')) {
                    return { icon: FileImage, color: 'text-purple-500', bgColor: 'bg-purple-50 dark:bg-purple-900/20' }
                  } 
                    return { icon: File, color: 'text-slate-500', bgColor: 'bg-slate-50 dark:bg-slate-800' }
                  
                }
                
                const fileInfo = getFileIcon()
                const IconComponent = fileInfo.icon
                
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => handleSelectGoogleDriveFile(file)}
                    className={cn(
                      "group flex flex-col items-center p-3 rounded-lg transition-all relative",
                      selectedFileId === file.id 
                        ? "bg-blue-50 dark:bg-blue-900/30 ring-2 ring-blue-500" 
                        : "hover:bg-slate-50 dark:hover:bg-slate-800 hover:shadow-md",
                      "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    )}
                  >
                    {/* Selection Indicator */}
                    {selectedFileId === file.id && (
                      <div className="absolute top-2 left-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center z-10">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                    
                    {/* File Preview/Icon - Fixed size container */}
                    <div className={cn(
                      "w-full h-24 rounded-lg flex items-center justify-center mb-3 overflow-hidden",
                      "border-2 transition-colors",
                      selectedFileId === file.id 
                        ? "border-blue-500" 
                        : "border-slate-200 dark:border-slate-700 group-hover:border-slate-300 dark:group-hover:border-slate-600",
                      fileInfo.bgColor
                    )}>
                      {file.thumbnailLink ? (
                        <div className="relative w-full h-full">
                          <img 
                            src={file.thumbnailLink} 
                            alt={file.name}
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              // Fallback to icon if thumbnail fails to load
                              const container = e.currentTarget.parentElement
                              if (container) {
                                container.style.display = 'none'
                                container.nextElementSibling?.classList.remove('hidden')
                              }
                            }}
                          />
                        </div>
                      ) : null}
                      <IconComponent 
                        className={cn(
                          "w-12 h-12",
                          fileInfo.color,
                          file.thumbnailLink ? "hidden" : ""
                        )} 
                      />
                    </div>
                    
                    {/* File Name */}
                    <div className="w-full text-center">
                      <p className="text-xs text-slate-700 dark:text-slate-300 truncate px-1" title={file.name}>
                        {file.name}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
          <Button
            variant="outline"
            onClick={() => setGoogleDriveDialogOpen(false)}
            className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            disabled={!selectedFileId}
            onClick={handleConfirmSelection}
            className="bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Select File
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* Google Drive Connect Modal */}
    <Dialog open={showConnectModal} onOpenChange={setShowConnectModal}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-slate-900 dark:text-slate-100">Connect Google Drive</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-200">
            To browse and embed Google Drive files, you need to connect your Google Drive account first.
          </p>
          <div className="flex gap-3">
            <Button
              type="button"
              onClick={handleConnectGoogleDrive}
              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white"
            >
              Connect Google Drive
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowConnectModal(false)}
              className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
