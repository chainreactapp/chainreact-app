"use client"

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { FileUpload } from "@/components/ui/file-upload";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { FullscreenTextArea } from "../FullscreenTextEditor";
import { formatVariableForDisplay } from "@/lib/utils/variableDisplay";
import { ALL_NODE_COMPONENTS } from "@/lib/workflows/nodes";
import { Bot, X, Hash } from "lucide-react";
import { useVariableDropTarget } from "../../hooks/useVariableDropTarget";
import { insertVariableIntoTextInput, normalizeDraggedVariable } from "@/lib/workflows/variableInsertion";
import { VariablePickerDropdown } from "../../VariablePickerDropdown";
import { ConnectButton } from "./ConnectButton";
import { VariableSelectionDropdown } from "./VariableSelectionDropdown";

import { logger } from '@/lib/utils/logger'

interface GenericTextInputProps {
  field: any;
  value: any;
  onChange: (value: any) => void;
  error?: string;
  dynamicOptions?: Array<{value: string; label: string;}>;
  onDynamicLoad?: (fieldName: string) => void;
  workflowNodes?: any[];
  aiFields?: Record<string, boolean>;
  setAiFields?: (fields: Record<string, boolean>) => void;
  isConnectedToAIAgent?: boolean;
  workflowData?: { nodes: any[], edges: any[] };
  currentNodeId?: string;
  enableConnectMode?: boolean; // New prop to enable connect button mode
  showConnectButton?: React.ReactNode; // Custom connect button to render
  // External connect state management (for when parent controls the button)
  isConnectedMode?: boolean;
  onConnectToggle?: () => void;
}

/**
 * Generic text input field for basic text, email, number, and textarea fields
 * Supports drag and drop for variables and AI mode
 */
export function GenericTextInput({
  field,
  value,
  onChange,
  error,
  dynamicOptions,
  onDynamicLoad,
  workflowNodes,
  aiFields,
  setAiFields,
  isConnectedToAIAgent,
  workflowData,
  currentNodeId,
  enableConnectMode = false,
  showConnectButton,
  isConnectedMode: externalIsConnectedMode,
  onConnectToggle: externalOnConnectToggle,
}: GenericTextInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<Array<{value: string; label: string;}>>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [variablePickerOpen, setVariablePickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Check if value is a connected variable ({{nodeId.field}})
  const isConnectedValue = (val: any) => {
    if (typeof val !== 'string') return false
    const trimmed = val.trim()
    return trimmed.startsWith('{{') && trimmed.endsWith('}}') && !trimmed.includes(' ')
  }

  // Use external state if provided, otherwise use internal state
  const [internalIsConnectedMode, setInternalIsConnectedMode] = useState(() => isConnectedValue(value))
  const isConnectedMode = externalIsConnectedMode !== undefined ? externalIsConnectedMode : internalIsConnectedMode

  // Update internal connected mode when value changes externally (only if not using external state)
  useEffect(() => {
    if (enableConnectMode && externalIsConnectedMode === undefined) {
      setInternalIsConnectedMode(isConnectedValue(value))
    }
  }, [value, enableConnectMode, externalIsConnectedMode])

  // Handle connect button toggle - use external handler if provided
  const handleConnectToggle = externalOnConnectToggle || (() => {
    if (internalIsConnectedMode) {
      // Disconnect: Switch back to text input and clear value
      setInternalIsConnectedMode(false)
      onChange('')
    } else {
      // Connect: Switch to dropdown mode (keep value if it's already a variable)
      setInternalIsConnectedMode(true)
    }
  })
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Check if this field is in AI mode
  const isAIEnabled = aiFields?.[field.name] || (typeof value === 'string' && value.startsWith('{{AI_FIELD:'));

  // Format variable for display - convert workflow nodes to the format expected by formatVariableForDisplay
  const nodeInfo = workflowNodes?.map((node: any) => {
    // Get the node component definition to access outputSchema
    const nodeComponent = ALL_NODE_COMPONENTS.find(comp => comp.type === node.data?.type);

    return {
      id: node.id,
      title: node.data?.title || node.data?.label || nodeComponent?.title || 'Custom',
      type: node.data?.type || 'unknown',
      outputSchema: nodeComponent?.outputSchema || node.data?.outputSchema
    };
  });
  const { display: formattedDisplay } = formatVariableForDisplay(value || "", nodeInfo);

  const trimmedValue = typeof value === 'string' ? value.trim() : ''
  const isAIPlaceholder =
    typeof trimmedValue === 'string' &&
    trimmedValue.startsWith('{{AI_FIELD:') &&
    trimmedValue.endsWith('}}') &&
    trimmedValue.length > 12

  const aiPlaceholderText = field.aiPlaceholder || 'Defined by the model'
  const placeholderText = isAIPlaceholder
    ? aiPlaceholderText
    : (field.placeholder || `Enter ${field.label || field.name}...`)

  const renderedValue = isEditing
    ? (value || '')
    : (isAIPlaceholder ? '' : formattedDisplay)

  const hasUserValue =
    value !== undefined &&
    value !== null &&
    (typeof value !== 'string' || value.trim() !== '')

  const autoGeneratedTypes = new Set([
    'autoNumber',
    'formula',
    'rollup',
    'createdTime',
    'lastModifiedTime',
    'count',
    'createdBy',
    'lastModifiedBy'
  ])
  const isAutoGeneratedField = Boolean(
    field.autoGenerated ||
    field.autoNumber ||
    field.readOnly ||
    field.computed ||
    field.formula ||
    (field.airtableFieldType && autoGeneratedTypes.has(field.airtableFieldType))
  )
  const isComputedAutoField = Boolean(
    field.readOnly ||
    field.computed ||
    field.formula ||
    (field.airtableFieldType && autoGeneratedTypes.has(field.airtableFieldType))
  )
  if (isAutoGeneratedField) {
    logger.info('🧾 [GenericTextInput] Auto-generated field detected:', {
      fieldName: field.name,
      autoGenerated: field.autoGenerated,
      autoNumber: field.autoNumber,
      hasUserValue
    })
  }
  const [autoGeneratedOverride, setAutoGeneratedOverride] = useState(() => {
    if (!isAutoGeneratedField) return false
    if (hasUserValue && !isComputedAutoField) {
      return true
    }
    return false
  })

  const autoGeneratedFieldNameRef = useRef(field.name)

  useEffect(() => {
    if (autoGeneratedFieldNameRef.current !== field.name) {
      autoGeneratedFieldNameRef.current = field.name
      setAutoGeneratedOverride(isAutoGeneratedField ? hasUserValue : false)
    }
  }, [field.name, hasUserValue, isAutoGeneratedField])

  useEffect(() => {
    if (
      isAutoGeneratedField &&
      hasUserValue &&
      !autoGeneratedOverride &&
      !isComputedAutoField
    ) {
      setAutoGeneratedOverride(true)
    }
  }, [autoGeneratedOverride, hasUserValue, isAutoGeneratedField, isComputedAutoField])

  const showAutoGeneratedOverlay = isAutoGeneratedField && !autoGeneratedOverride

  const handleRemoveAutoGeneratedPlaceholder = useCallback(() => {
    setAutoGeneratedOverride(true)
    onChange('')
    setIsEditing(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [onChange])

  // Load suggestions when field has dynamic options
  useEffect(() => {
    if (field.dynamic && onDynamicLoad && !dynamicOptions?.length) {
      onDynamicLoad(field.name);
    }
  }, [field.dynamic, field.name, onDynamicLoad, dynamicOptions]);

  const resolveCurrentValue = useCallback(() => {
    if (typeof value === "string") return value
    if (value === null || value === undefined) return ""
    return String(value)
  }, [value])

  const handleVariableInsert = useCallback((rawVariable: string, event?: React.DragEvent) => {
    if (!inputRef.current) return

    let variableText = normalizeDraggedVariable(rawVariable)
    if (!variableText) return

    // Try to extract alias from drag event if available
    if (event) {
      try {
        const jsonData = event.dataTransfer?.getData('application/json')
        if (jsonData) {
          const parsed = JSON.parse(jsonData)
          // Use alias for display if available, but keep actual variable reference
          if (parsed.alias) {
            variableText = parsed.alias
          } else if (parsed.variable) {
            variableText = normalizeDraggedVariable(parsed.variable)
          }
        }
      } catch (err) {
        logger.info("[GenericTextInput] Could not parse JSON drag data, using text/plain:", err)
      }
    }

    try {
      inputRef.current.focus()
    } catch (error) {
      logger.warn("[GenericTextInput] Failed to focus input before inserting variable", error)
    }

    insertVariableIntoTextInput(
      inputRef.current,
      variableText,
      resolveCurrentValue(),
      onChange
    )

    setIsEditing(true)
    setShowSuggestions(false)
  }, [onChange, resolveCurrentValue, setShowSuggestions])

  const { eventHandlers: dropEventHandlers, isDragOver } = useVariableDropTarget({
    fieldId: field.name,
    fieldLabel: field.label || field.name,
    elementRef: inputRef,
    onInsert: handleVariableInsert
  })

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const inputValue = e.target.value;
    onChange(inputValue);

    // Check if user just typed {{ to trigger variable autocomplete
    if (inputValue.endsWith('{{') && workflowData && currentNodeId) {
      setVariablePickerOpen(true);
    }

    // Show suggestions if we have dynamic options and user is typing
    if (field.dynamic && dynamicOptions && inputValue.length > 0) {
      const lastCommaIndex = inputValue.lastIndexOf(',');
      const currentInput = lastCommaIndex >= 0
        ? inputValue.substring(lastCommaIndex + 1).trim()
        : inputValue.trim();

      if (currentInput.length > 0) {
        const filtered = dynamicOptions.filter(option =>
          (option.label || '').toLowerCase().includes(currentInput.toLowerCase()) ||
          (option.value || '').toLowerCase().includes(currentInput.toLowerCase())
        ).slice(0, 5); // Limit to 5 suggestions

        setFilteredSuggestions(filtered);
        setShowSuggestions(filtered.length > 0);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  };

  // Handle suggestion click
  const handleSuggestionClick = (suggestion: {value: string; label: string;}) => {
    const currentValue = value || '';
    const lastCommaIndex = currentValue.lastIndexOf(',');
    
    let newValue;
    if (lastCommaIndex >= 0) {
      // Replace the text after the last comma
      newValue = `${currentValue.substring(0, lastCommaIndex + 1) } ${ suggestion.value}`;
    } else {
      // Replace the entire value
      newValue = suggestion.value;
    }
    
    onChange(newValue);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  // Handle click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node) &&
          inputRef.current && !inputRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showAiPlaceholderOverlay = isAIPlaceholder && !isEditing;

  const clearAiPlaceholderValue = () => {
    if (setAiFields && aiFields && aiFields[field.name]) {
      const newAiFields = { ...aiFields };
      delete newAiFields[field.name];
      setAiFields(newAiFields);
    }
    onChange('');
  };

  const handleRemoveAiPlaceholder = () => {
    clearAiPlaceholderValue();
    setIsEditing(true);
    setShowSuggestions(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const renderPlaceholderOverlay = () => {
    if (showAiPlaceholderOverlay) {
      return (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between rounded-md bg-muted/80 text-muted-foreground px-3">
          <div className="flex items-center gap-2 text-sm">
            <Bot className="h-4 w-4" />
            <span>{aiPlaceholderText}</span>
          </div>
          <button
            type="button"
            onClick={handleRemoveAiPlaceholder}
            className="pointer-events-auto text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )
    }

    if (showAutoGeneratedOverlay) {
      // Determine the placeholder text based on field type
      let placeholderText =
        field.autoGeneratedMessage ||
        field.placeholder ||
        field.description ||
        'Automatically generated by Airtable';
      if (!field.autoGeneratedMessage) {
        if (field.airtableFieldType === 'autoNumber') {
          placeholderText = 'Generated automatically when record is created';
        } else if (field.airtableFieldType === 'formula') {
          placeholderText = 'Calculated by Airtable formula';
        } else if (field.airtableFieldType === 'rollup') {
          placeholderText = 'Calculated from linked records';
        }
      }

      return (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between rounded-md bg-muted/80 text-muted-foreground px-3">
          <div className="flex items-center gap-2 text-sm">
            <Hash className="h-4 w-4" />
            <span>{placeholderText}</span>
          </div>
          {!isComputedAutoField && (
            <button
              type="button"
              onClick={handleRemoveAutoGeneratedPlaceholder}
              className="pointer-events-auto text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )
    }

    return null
  }

  const overlayAwareTabIndex = (showAiPlaceholderOverlay || showAutoGeneratedOverlay) ? -1 : undefined

  const commonProps = {
    id: field.name,
    placeholder: showAutoGeneratedOverlay ? "" : placeholderText,
    value: renderedValue,
    onChange: handleChange,
    onDragOver: dropEventHandlers.onDragOver,
    onDragLeave: dropEventHandlers.onDragLeave,
    onDrop: dropEventHandlers.onDrop,
    onKeyDown: (e: React.KeyboardEvent) => {
      // For computed fields with overlay, prevent typing but allow shortcuts and navigation
      if (showAutoGeneratedOverlay && !e.metaKey && !e.ctrlKey) {
        // Allow: selection (Cmd/Ctrl+A), copy (Cmd/Ctrl+C), navigation keys
        const allowedKeys = ['a', 'c', 'x', 'v', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab'];
        if (!allowedKeys.includes(e.key)) {
          e.preventDefault();
        }
      }
    },
    onFocus: () => {
      dropEventHandlers.onFocus()
      if (!showAiPlaceholderOverlay && !showAutoGeneratedOverlay) {
        setIsEditing(true);
      }
    },
    onBlur: () => {
      dropEventHandlers.onBlur()
      setIsEditing(false)
    },
    className: cn(
      error && "border-red-500",
      !isEditing && !isAIPlaceholder && formattedDisplay !== (value || '') && "text-blue-600",
      !isEditing && isAIPlaceholder && "text-muted-foreground",
      isDragOver && "ring-2 ring-blue-400 ring-offset-1",
      showAutoGeneratedOverlay && "opacity-0 select-none"
    ),
    readOnly: Boolean(field.readOnly) || showAiPlaceholderOverlay,
    ref: inputRef
  };

  // If in AI mode, show the "Defined by AI" UI (no label, FieldRenderer handles it)
  if (isAIEnabled) {
    return (
      <div className="space-y-1">
        <div className="bg-muted/80 text-muted-foreground dark:bg-gray-700 dark:text-gray-300 rounded-md px-3 py-2 flex items-center gap-2 border border-border/50">
          <Bot className="h-4 w-4" />
          <span className="text-sm flex-1">
            Defined automatically by the model
          </span>
          {setAiFields && (
            <button
              type="button"
              onClick={() => {
                // Remove from AI fields
                const newAiFields = { ...aiFields };
                delete newAiFields[field.name];
                setAiFields(newAiFields);
                // Clear the value
                onChange('');
              }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
    );
  }

  // Render field content (normal mode)
  switch (field.type) {
    case "textarea": {
      // If connect mode is enabled, render dropdown instead of textarea
      if (enableConnectMode && workflowData && currentNodeId) {
        return (
          <>
            {isConnectedMode ? (
              <VariableSelectionDropdown
                workflowData={workflowData}
                currentNodeId={currentNodeId}
                value={value || ''}
                onChange={onChange}
                placeholder="Select a variable..."
                disabled={false}
              />
            ) : (
              <FullscreenTextArea
                value={value || ""}
                onChange={onChange}
                placeholder={field.placeholder || `Enter ${field.label || field.name}...`}
                className={cn(
                  error && "border-red-500"
                )}
                error={!!error}
                rows={(field as any).rows || 6}
                fieldLabel={field.label || field.name}
                disabled={field.disabled || false}
                showPlaceholderOverlay={false}
                placeholderOverlayLabel=""
                onClearPlaceholder={() => {}}
              />
            )}
          </>
        )
      }

      // Standard textarea mode (no connect mode)
      const textAreaOverlayActive = showAiPlaceholderOverlay || showAutoGeneratedOverlay
      const textAreaOverlayLabel = showAiPlaceholderOverlay ? aiPlaceholderText : "Automatically generated"
      const textAreaOverlayClear = showAiPlaceholderOverlay ? clearAiPlaceholderValue : handleRemoveAutoGeneratedPlaceholder

      return (
        <FullscreenTextArea
          value={value || ""}
          onChange={onChange}
          placeholder={field.placeholder || `Enter ${field.label || field.name}...`}
          className={cn(
            error && "border-red-500"
          )}
          error={!!error}
          rows={(field as any).rows || 6}
          fieldLabel={field.label || field.name}
          disabled={field.disabled || false}
          showPlaceholderOverlay={textAreaOverlayActive}
          placeholderOverlayLabel={textAreaOverlayLabel}
          onPlaceholderClear={() => {
            textAreaOverlayClear();
          }}
        />
      );
    }

    case "number":
      // Check if value contains a variable - if so, render as text input
      const stringValue = typeof value === 'string' ? value : '';
      const hasVariable = stringValue.includes('{{') && stringValue.includes('}}');

      // If connect mode is enabled, render dropdown instead of number input when in connected mode
      if (enableConnectMode && isConnectedMode && workflowData && currentNodeId) {
        return (
          <VariableSelectionDropdown
            workflowData={workflowData}
            currentNodeId={currentNodeId}
            value={value || ''}
            onChange={onChange}
            placeholder="Select a variable..."
            disabled={false}
          />
        );
      }

      // Check if this field should be displayed as a slider
      const hasSliderConfig = (field as any).min !== undefined &&
                             (field as any).max !== undefined &&
                             (field as any).step !== undefined;
      const showUnit = (field as any).unit;

      if (hasSliderConfig) {
        // Display as slider with value label
        return (
          <div className="space-y-2">
            <div className="flex items-center space-x-4">
              <Slider
                value={[value || (field as any).defaultValue || (field as any).min || 0]}
                onValueChange={(values) => onChange(values[0])}
                min={(field as any).min}
                max={(field as any).max}
                step={(field as any).step}
                className="flex-1"
                disabled={field.disabled}
              />
              <div className="flex items-center space-x-1 min-w-[80px]">
                <Input
                  type={hasVariable ? "text" : "number"}
                  value={value || (field as any).defaultValue || 0}
                  onChange={(e) => {
                    if (hasVariable) {
                      // Allow text input for variables
                      onChange(e.target.value);
                    } else {
                      const newValue = parseFloat(e.target.value);
                      if (!isNaN(newValue)) {
                        onChange(Math.min((field as any).max, Math.max((field as any).min, newValue)));
                      }
                    }
                  }}
                  min={(field as any).min}
                  max={(field as any).max}
                  step={(field as any).step}
                  className="w-16 text-center"
                  disabled={field.disabled}
                />
                {showUnit && (
                  <span className="text-sm text-muted-foreground">{showUnit}</span>
                )}
              </div>
            </div>
            {(field as any).helpText && (
              <p className="text-xs text-muted-foreground">{(field as any).helpText}</p>
            )}
          </div>
        );
      }

      // Default number input - use text input if value contains a variable
      return (
        <div className="relative">
          <Input
            {...commonProps}
            type={hasVariable ? "text" : "number"}
            min={(field as any).min}
            max={(field as any).max}
            step={(field as any).step || 1}
            tabIndex={overlayAwareTabIndex}
          />
          {renderPlaceholderOverlay()}
        </div>
      );

    case "email": {
      const rawEmailValue = typeof value === "string" ? value : "";
      const emailAcceptsVariable =
        rawEmailValue.startsWith("{{") && rawEmailValue.endsWith("}}");

      // If connect mode is enabled, render dropdown instead of email input when in connected mode
      if (enableConnectMode && isConnectedMode && workflowData && currentNodeId) {
        return (
          <VariableSelectionDropdown
            workflowData={workflowData}
            currentNodeId={currentNodeId}
            value={value || ''}
            onChange={onChange}
            placeholder="Select a variable..."
            disabled={false}
          />
        );
      }

      return (
        <div className="relative">
          <Input
            {...commonProps}
            type={emailAcceptsVariable ? "text" : "email"}
            tabIndex={overlayAwareTabIndex}
          />
          {renderPlaceholderOverlay()}
        </div>
      );
    }

    case "time": {
      const rawTimeValue = typeof value === "string" ? value : "";
      const timeAcceptsVariable =
        rawTimeValue.startsWith("{{") && rawTimeValue.endsWith("}}");

      return (
        <div className="relative">
          <Input
            {...commonProps}
            type={timeAcceptsVariable ? "text" : "time"}
            className={cn(
              commonProps.className,
              "w-auto max-w-[150px]",
              error && "border-red-500"
            )}
            tabIndex={overlayAwareTabIndex}
          />
          {renderPlaceholderOverlay()}
        </div>
      );
    }

    case "file":
      // If field accepts variables, we need to handle both file uploads and variable text
      if (field.acceptsVariables) {
        // Check if value is a variable string (e.g., {{nodeId.file}})
        const isVariable = typeof value === 'string' && value.includes('{{') && value.includes('}}');

        if (isVariable) {
          // Show the variable as text input with drag support
          return (
            <div className="relative">
              <Input
                type="text"
                value={value || ""}
                onChange={(e) => onChange(e.target.value)}
                placeholder={field.placeholder || "Upload files or drag variables..."}
                className={cn(
                  "pr-10",
                  error && "border-red-500"
                )}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                disabled={field.disabled}
              />
              {value && (
                <button
                  type="button"
                  onClick={() => onChange("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              )}
            </div>
          );
        }

        // Check if value contains uploaded files
        if (value && Array.isArray(value)) {
          // Show uploaded files
          return (
            <div className="space-y-2">
              <div className="text-sm text-gray-600">
                {value.length} file(s) attached
              </div>
              <div className="space-y-1">
                {value.map((file: any, index: number) => (
                  <div key={index} className="flex items-center justify-between p-2 border rounded">
                    <span className="text-sm">{file.name || file.fileName || `File ${index + 1}`}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const newValue = value.filter((_: any, i: number) => i !== index);
                        onChange(newValue.length > 0 ? newValue : null);
                      }}
                      className="text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Clear all files
              </button>
            </div>
          );
        }
      }

      // Standard file upload
      // Pass the value directly to FileUpload - it handles both File objects and saved metadata
      // Ensure value is always an array for FileUpload component
      const fileValue = value ? (Array.isArray(value) ? value : [value]) : undefined;
      logger.info('📎 [GenericTextInput] Passing file value to FileUpload:', {
        value,
        fileValue,
        isArray: Array.isArray(value),
        firstFile: fileValue?.[0]
      });
      return (
        <FileUpload
          value={fileValue}
          onChange={async (files) => {
            // Convert FileList to array of file objects that can be stored
            if (files && files.length > 0) {
              // For all file uploads, upload to server immediately (same as Google Drive)
              logger.info('📎 [GenericTextInput] Uploading files:', files.length);
              
              try {
                // PR-AUTH-5: cached auth header. If no token is available
                // (signed out / refresh failed), the upload will hit a 401
                // and the existing !response.ok branch surfaces the error.
                // Pre-PR this stored unsigned file metadata as a fallback;
                // we keep that fallback when getAuthHeader returns {} so
                // existing UX (workflow opens with file metadata) still works
                // for new/unsaved workflows that don't need the server.
                const { getAuthHeader } = await import('@/lib/auth/getAuthHeader');
                const authHeader = await getAuthHeader();
                if (!authHeader.Authorization) {
                  const fileArray = Array.from(files).map(file => ({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    lastModified: file.lastModified
                  }));
                  onChange(field.multiple ? fileArray : fileArray[0]);
                  return;
                }

                // Get workflow and node IDs from context
                const workflowId = field.workflowId || 'temp';
                const nodeId = field.nodeId || `temp-${Date.now()}`;

                const uploadedFiles = [];

                for (const file of Array.from(files)) {
                  logger.info('📎 [GenericTextInput] Uploading file:', file.name);

                  const formData = new FormData();
                  formData.append('file', file);
                  formData.append('workflowId', workflowId);
                  formData.append('nodeId', nodeId);

                  const response = await fetch('/api/workflows/files/upload', {
                    method: 'POST',
                    headers: authHeader,
                    body: formData
                  });
                  
                  if (!response.ok) {
                    const error = await response.json();
                    logger.error('📎 [GenericTextInput] Upload failed:', error);
                    throw new Error(error.error || 'Failed to upload file');
                  }
                  
                  const result = await response.json();
                  logger.info('📎 [GenericTextInput] Upload successful:', result);
                  
                  // Store the file info - use the fileId as the identifier
                  uploadedFiles.push({
                    id: result.fileId,
                    fileName: result.fileName,
                    fileSize: result.fileSize,
                    fileType: result.fileType,
                    filePath: result.filePath,
                    isTemporary: result.isTemporary
                  });
                }
                
                // Store the uploaded file info
                logger.info('📎 [GenericTextInput] Setting uploadedFiles value:', {
                  multiple: field.multiple,
                  uploadedFilesCount: uploadedFiles.length,
                  uploadedFiles: uploadedFiles,
                  valueToSet: field.multiple ? uploadedFiles : uploadedFiles[0]
                });
                onChange(field.multiple ? uploadedFiles : uploadedFiles[0]);
                
              } catch (error) {
                logger.error('📎 [GenericTextInput] Error uploading files:', error);
                // Fallback to storing file metadata
                const fileArray = Array.from(files).map(file => ({
                  name: file.name,
                  size: file.size,
                  type: file.type,
                  lastModified: file.lastModified
                }));
                onChange(field.multiple ? fileArray : fileArray[0]);
              }
            } else {
              onChange(null);
            }
          }}
          accept={field.accept || "*/*"}
          maxSize={field.maxSize || 25 * 1024 * 1024} // 25MB default
          maxFiles={field.multiple ? 10 : 1}
          placeholder={field.placeholder || "Choose files to attach..."}
          disabled={field.disabled}
          hideUploadedFiles={false} // Show the uploaded files
        />
      );

    case "text":
    default:
      // If connect mode is enabled, render appropriate field (button is rendered by parent in label row)
      if (enableConnectMode && workflowData && currentNodeId) {
        return (
          <>
            {isConnectedMode ? (
              <VariableSelectionDropdown
                workflowData={workflowData}
                currentNodeId={currentNodeId}
                value={value || ''}
                onChange={onChange}
                placeholder="Select a variable..."
                disabled={false}
              />
            ) : (
              <div className="relative">
                <Input
                  {...commonProps}
                  type="text"
                  tabIndex={(showAiPlaceholderOverlay || showAutoGeneratedOverlay) ? -1 : undefined}
                />
                {renderPlaceholderOverlay()}
              </div>
            )}
          </>
        )
      }

      // Standard mode with variable picker
      return (
        <div className="relative">
          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <Input
                {...commonProps}
                type="text"
                tabIndex={(showAiPlaceholderOverlay || showAutoGeneratedOverlay) ? -1 : undefined}
              />
              {renderPlaceholderOverlay()}
              {showSuggestions && !showAiPlaceholderOverlay && !showAutoGeneratedOverlay && (
                <div
                  ref={suggestionsRef}
                  className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600 rounded-md shadow-lg max-h-48 overflow-auto"
                >
                  {filteredSuggestions.map((suggestion, index) => (
                    <div
                      key={index}
                      className="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm border-b border-gray-600 last:border-b-0"
                      onClick={() => handleSuggestionClick(suggestion)}
                    >
                      <div className="font-medium text-white">{suggestion.label}</div>
                      {suggestion.label !== suggestion.value && (
                        <div className="text-xs text-gray-300">{suggestion.value}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Variable Picker Button - for rich text fields */}
            {workflowData && currentNodeId && !showAiPlaceholderOverlay && !showAutoGeneratedOverlay && (
              <VariablePickerDropdown
                workflowData={workflowData}
                currentNodeId={currentNodeId}
                open={variablePickerOpen}
                onOpenChange={setVariablePickerOpen}
                onSelect={(variableRef) => {
                  const currentValue = value || '';

                  // If the value ends with {{, remove it before inserting the variable
                  const valueWithoutBraces = currentValue.endsWith('{{')
                    ? currentValue.slice(0, -2)
                    : currentValue;

                  // Insert variable at cursor position
                  insertVariableIntoTextInput(
                    inputRef.current,
                    variableRef,
                    valueWithoutBraces,
                    onChange
                  )

                  // Close the picker and focus input
                  setVariablePickerOpen(false)
                  inputRef.current?.focus()
                }}
              />
            )}
          </div>
        </div>
      );
  }
}
