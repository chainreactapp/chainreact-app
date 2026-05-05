"use client"
// FORCE REBUILD NOW
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Settings } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useDynamicOptions } from './hooks/useDynamicOptions';
import { useFieldChangeHandler } from './hooks/useFieldChangeHandler';
import { useIntegrationStore } from '@/stores/integrationStore';
import { isConnectedStatus } from '@/lib/integrations/connectionStatus';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useDebugStore } from '@/stores/debugStore';
import { ConfigurationLoadingScreen } from '@/components/ui/loading-screen';
import { useFieldValidation } from './hooks/useFieldValidation';
import { FieldVisibilityEngine } from '@/lib/workflows/fields/visibility';

// Provider-specific components
import { DiscordConfiguration } from './providers/DiscordConfiguration';
import { AskHumanConfiguration } from './providers/AskHumanConfiguration';
import { AIMessageConfiguration } from './providers/AIMessageConfiguration';
import { AirtableConfiguration } from './providers/AirtableConfiguration';
import { GoogleSheetsConfiguration } from './providers/GoogleSheetsConfiguration';
import { MicrosoftExcelConfiguration } from './providers/MicrosoftExcelConfiguration';
import { TwitterConfiguration } from './providers/TwitterConfiguration';
import { GmailConfiguration } from './providers/GmailConfiguration';
import { SlackConfiguration } from './providers/SlackConfiguration';
import { NotionConfiguration } from './providers/NotionConfiguration';
import { TrelloConfiguration } from './providers/TrelloConfiguration';
import { HubSpotConfiguration } from './providers/HubSpotConfiguration';
import { StripeConfiguration } from './providers/StripeConfiguration';
import { TeamsConfiguration } from './providers/TeamsConfiguration';
import { OutlookConfiguration } from './providers/OutlookConfiguration';
import { OneDriveConfiguration } from './providers/OneDriveConfiguration';
import { OneNoteConfiguration } from './providers/OneNoteConfiguration';
import { GoogleCalendarConfiguration } from './providers/GoogleCalendarConfiguration';
import { GoogleDriveConfiguration } from './providers/GoogleDriveConfiguration';
import { GoogleDocsConfiguration } from './providers/GoogleDocsConfiguration';
import { FacebookConfiguration } from './providers/FacebookConfiguration';
import { LinkedInConfiguration } from './providers/LinkedInConfiguration';
import { InstagramConfiguration } from './providers/InstagramConfiguration';
import { ShopifyConfiguration } from './providers/ShopifyConfiguration';
import { DropboxConfiguration } from './providers/DropboxConfiguration';
import { YouTubeConfiguration } from './providers/YouTubeConfiguration';
import { YouTubeStudioConfiguration } from './providers/YouTubeStudioConfiguration';
import { AIActionConfiguration } from './providers/AIActionConfiguration';
import { normalizeAllVariablesInObject } from '@/lib/workflows/variableReferences';
import { BoxConfiguration } from './providers/BoxConfiguration';
import { GitHubConfiguration } from './providers/GitHubConfiguration';
import { PayPalConfiguration } from './providers/PayPalConfiguration';
import { MondayConfiguration } from './providers/monday/MondayConfiguration';
import { GenericConfiguration } from './providers/GenericConfiguration';
import { ScheduleConfiguration } from './providers/ScheduleConfiguration';
import { IfThenConfiguration } from './providers/IfThenConfiguration';
import { RouterConfiguration } from './providers/logic/RouterConfiguration';
import { LoopConfiguration } from './providers/logic/LoopConfiguration';
import { HttpRequestConfiguration } from './providers/logic/HttpRequestConfiguration';
import { WebhookConfiguration } from './providers/WebhookConfiguration';

// Utility nodes
import { TransformerConfiguration } from './providers/utility/TransformerConfiguration';
import { ParseFileConfiguration } from './providers/utility/ParseFileConfiguration';
import { ExtractWebsiteDataConfiguration } from './providers/utility/ExtractWebsiteDataConfiguration';
import { ConditionalTriggerConfiguration } from './providers/utility/ConditionalTriggerConfiguration';
import { GoogleSearchConfiguration } from './providers/utility/GoogleSearchConfiguration';
import { TavilySearchConfiguration } from './providers/utility/TavilySearchConfiguration';

import { logger } from '@/lib/utils/logger'
import { safeLocalStorageSet } from '@/lib/utils/storage-cleanup'
import { collectFieldLabelsFromCache, loadLabelsIntoCache } from '@/lib/workflows/configuration/collect-labels'
import { isNodeTypeConnectionExempt, isProviderConnectionExempt } from './utils/connectionExemptions'
import { ServiceConnectionSelector } from './ServiceConnectionSelector'

interface ConfigurationFormProps {
  nodeInfo: any;
  initialData?: Record<string, any>;
  onSave: (data: Record<string, any>) => void;
  onCancel: () => void;
  onBack?: () => void;
  isEditMode?: boolean;
  workflowData?: any;
  currentNodeId?: string;
  onLoadingChange?: (isLoading: boolean) => void;
  getFormValues?: () => Record<string, any>;
  integrationName?: string;
  isConnectedToAIAgent?: boolean;
  isTemplateEditing?: boolean;
  templateDefaults?: Record<string, any>;
  isReopen?: boolean;
}

function ConfigurationForm({
  nodeInfo,
  initialData = {},
  onSave,
  onCancel,
  onBack,
  isEditMode = false,
  workflowData,
  currentNodeId,
  onLoadingChange,
  getFormValues,
  integrationName: integrationNameProp,
  isConnectedToAIAgent,
  isTemplateEditing = false,
  templateDefaults,
  isReopen = false,
}: ConfigurationFormProps) {
  // FIRST: All hooks must be called before any conditional returns

  // Track fields that have been manually cleared by provider-specific handlers
  // This prevents the initialization logic from restoring old values after they've been cleared
  const clearedFieldsRef = useRef<Set<string>>(new Set());

  // Track if form has been initialized for this node to prevent rerenders
  // This fixes a bug where trigger combobox selections clear when AI Agent conversation exists
  const hasInitializedForNodeRef = useRef<string | null>(null);

  // Get workflow ID from URL params
  const searchParams = useSearchParams()
  const workflowId = searchParams.get('id')

  // Common state and hooks
  const [values, setValues] = useState<Record<string, any>>(() => {
    // Extract real config values, excluding the reserved keys and metadata
    const { __dynamicOptions, __validationState, ...allValues } = initialData || {};

    // Filter out label keys (_label_*) and cached data (_cached_*)
    // These are metadata for instant display, not actual field values
    const configValues: Record<string, any> = {};
    for (const [key, value] of Object.entries(allValues)) {
      if (!key.startsWith('_label_') && !key.startsWith('_cached_')) {
        configValues[key] = value;
      }
    }

    logger.debug('🔄 [ConfigForm] Initializing values with initialData:', {
      nodeType: nodeInfo?.type,
      providerId: nodeInfo?.providerId,
      currentNodeId,
      initialData: configValues,
      hasAllFieldsAI: !!configValues?._allFieldsAI,
      allFieldsAIValue: configValues?._allFieldsAI,
      hasGuildId: !!configValues?.guildId,
      hasChannelId: !!initialData?.channelId,
      hasMessage: !!initialData?.message
    });
    return configValues || {};
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  // Initialize AI fields based on initial data containing AI placeholders or _allFieldsAI flag
  const [aiFields, setAiFields] = useState<Record<string, boolean>>(() => {
    const fields: Record<string, boolean> = {};
    if (initialData) {
      // Check if _allFieldsAI flag is set (for AI-generated workflows)
      if (initialData._allFieldsAI === true) {
        // Set all fields to AI mode by default (will be populated when fields are known)
        fields._allFieldsAI = true;
      } else {
        // Check individual fields for AI placeholders
        Object.entries(initialData).forEach(([key, value]) => {
          if (typeof value === 'string' && value.startsWith('{{AI_FIELD:')) {
            fields[key] = true;
          }
        });
      }
    }
    return fields;
  });
  const [loadingFields, setLoadingFields] = useState<Set<string>>(new Set());
  
  // Provider-specific state
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [showPreviewData, setShowPreviewData] = useState(false);
  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [googleSheetsSortField, setGoogleSheetsSortField] = useState<string | null>(null);
  const [googleSheetsSortDirection, setGoogleSheetsSortDirection] = useState<'asc' | 'desc'>('asc');
  const [googleSheetsSelectedRows, setGoogleSheetsSelectedRows] = useState<Set<string>>(new Set());
  const [airtableRecords, setAirtableRecords] = useState<any[]>([]);
  const [airtableTableSchema, setAirtableTableSchema] = useState<any>(null);

  const { validateRequiredFields, getMissingRequiredFields, getAllRequiredFields } = useFieldValidation({ nodeInfo, values });

  const {
    getIntegrationByProvider,
    getAllIntegrationsByProvider,
    getIntegrationById,
    hasMultipleAccounts,
    connectIntegration,
    fetchIntegrations,
    deleteIntegration,
    reconnectIntegration,
    setConfigurationModalOpen = () => {}
  } = useIntegrationStore();
  // Subscribe to integrations to trigger re-render when they change (important for shared auth like Excel/OneDrive)
  const integrations = useIntegrationStore(state => state.integrations);
  const { currentWorkflow, updateNode } = useWorkflowStore();
  const { logEvent } = useDebugStore();

  // Extract provider and node type (safe even if nodeInfo is null)
  const provider = nodeInfo?.providerId;
  const nodeType = nodeInfo?.type;

  // Determine whether this node/provider should bypass connection requirements
  const providerToCheck = provider;
  const skipConnectionCheck =
    isNodeTypeConnectionExempt(nodeType) ||
    isProviderConnectionExempt(providerToCheck);

  // Only look up integrations when we truly require them
  // Use useMemo to ensure this recalculates when integrations change
  const integration = React.useMemo(() => {
    if (skipConnectionCheck || !providerToCheck) return null;
    return getIntegrationByProvider(providerToCheck);
  }, [skipConnectionCheck, providerToCheck, getIntegrationByProvider, integrations]);

  // NEW: Multi-account support - get all accounts for this provider
  const allIntegrations = !skipConnectionCheck && providerToCheck
    ? getAllIntegrationsByProvider(providerToCheck)
    : [];
  const connectedIntegrations = allIntegrations.filter(i => isConnectedStatus(i.status));
  const showAccountSelector = connectedIntegrations.length > 1;

  // State for selected integration when multiple accounts exist
  // Initialize from saved node config or use first account
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string | undefined>(() => {
    // Check if node config has a saved integration_id
    const savedIntegrationId = initialData?.integration_id || values?.integration_id;

    // Validate that saved integration ID points to a connected integration
    // connectedIntegrations is filtered to only status === 'connected' at line 221
    if (savedIntegrationId) {
      const isValidConnectedIntegration = connectedIntegrations.some(
        (i) => i.id === savedIntegrationId
      );
      if (isValidConnectedIntegration) {
        return savedIntegrationId;
      }
      // Saved integration is expired/disconnected - log and fallback
      if (connectedIntegrations.length > 0) {
        logger.warn('[ConfigForm] Saved integration_id is not connected, falling back to first connected:', {
          savedIntegrationId,
          fallbackId: connectedIntegrations[0]?.id,
          connectedCount: connectedIntegrations.length
        });
      }
    }

    // Default to first connected integration
    return connectedIntegrations[0]?.id;
  });

  // Update selectedIntegrationId when integrations load or when saved ID becomes invalid
  useEffect(() => {
    // Case 1: No selection yet but connected integrations exist
    if (!selectedIntegrationId && connectedIntegrations.length > 0) {
      const firstConnected = connectedIntegrations[0];
      setSelectedIntegrationId(firstConnected.id);
      logger.debug('[ConfigForm] Auto-selected first connected integration:', { integrationId: firstConnected.id });
      return;
    }

    // Case 2: Current selection is no longer valid (integration expired/disconnected)
    if (selectedIntegrationId && connectedIntegrations.length > 0) {
      const isStillValid = connectedIntegrations.some(
        (i) => i.id === selectedIntegrationId
      );
      if (!isStillValid) {
        const firstConnected = connectedIntegrations[0];
        logger.warn('[ConfigForm] Selected integration is no longer connected, switching:', {
          oldId: selectedIntegrationId,
          newId: firstConnected.id
        });
        setSelectedIntegrationId(firstConnected.id);
        // Also update form values so it persists with node config
        setValues(prev => ({
          ...prev,
          integration_id: firstConnected.id
        }));
      }
    }
  }, [connectedIntegrations, selectedIntegrationId, setValues]);

  // Get the selected integration object
  const selectedIntegration = selectedIntegrationId
    ? getIntegrationById(selectedIntegrationId) || integration
    : integration;

  // Handle account selection change
  const handleSelectAccount = useCallback((integrationId: string) => {
    setSelectedIntegrationId(integrationId);
    // Save to form values so it persists with node config
    setValues(prev => ({
      ...prev,
      integration_id: integrationId
    }));
    logger.debug('[ConfigForm] Selected account changed:', { integrationId });
  }, []);

  const needsConnection =
    !skipConnectionCheck &&
    (
      !selectedIntegration ||
      !isConnectedStatus(selectedIntegration?.status)
    );

  // Detect when provider has integrations but all are expired/disconnected
  const hasExpiredIntegrations = !skipConnectionCheck &&
    allIntegrations.length > 0 &&
    connectedIntegrations.length === 0;

  const integrationName = integrationNameProp || nodeInfo?.label?.split(' ')[0] || provider;

  // Don't use saved dynamic options - always fetch fresh from Airtable
  const savedDynamicOptions = undefined;

  // Load saved labels from config into localStorage cache for instant display
  // This enables the "Zapier experience" where fields show saved values immediately
  // IMPORTANT: Run synchronously on initialization so labels are available before first render
  React.useMemo(() => {
    if (nodeInfo?.providerId && nodeInfo?.type && initialData) {
      // Load labels from saved config into localStorage SYNCHRONOUSLY
      loadLabelsIntoCache(nodeInfo.providerId, nodeInfo.type, initialData);

      logger.debug('[ConfigForm] Loaded saved labels into cache:', {
        providerId: nodeInfo.providerId,
        nodeType: nodeInfo.type,
        hasLabels: Object.keys(initialData).some(k => k.startsWith('_label_'))
      });
    }
  }, [nodeInfo?.providerId, nodeInfo?.type, initialData]);

  // Ensure Google providers and Microsoft Excel appear connected by fetching integrations if store hasn't resolved yet
  const hasRequestedIntegrationsRef = useRef(false);
  const lastProviderKeyRef = useRef<string | null>(null);

  // Store values in a ref to create a stable getFormValues callback that doesn't cause loadOptions to be recreated
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  // Stable getFormValues callback - uses ref to avoid recreating loadOptions on every values change
  const getFormValuesStable = useCallback(() => valuesRef.current, []);
  useEffect(() => {
    if (!provider) return;
    const providerKey = `${provider}|${currentNodeId || ''}|${nodeInfo?.type || ''}`;
    if (lastProviderKeyRef.current !== providerKey) {
      hasRequestedIntegrationsRef.current = false;
      lastProviderKeyRef.current = providerKey;
    }
    const isGoogleProvider = provider === 'google-sheets' || provider === 'google_drive' || provider === 'google-drive' || provider === 'google-docs' || provider === 'google_calendar' || provider === 'google-calendar' || provider === 'google' || provider === 'gmail';
    const isMicrosoftExcel = provider === 'microsoft-excel';
    if ((isGoogleProvider || isMicrosoftExcel) && !integration && !hasRequestedIntegrationsRef.current) {
      hasRequestedIntegrationsRef.current = true;
      // Non-forced fetch to avoid wiping cache mid-UI, just ensure the store has data
      const shouldForce = integrations.length === 0;
      try { fetchIntegrations(shouldForce); } catch {}
    }
  }, [provider, currentNodeId, nodeInfo?.type, integration, fetchIntegrations, integrations.length]);

  // Suppress background integration refreshes while the configuration modal is open
  useEffect(() => {
    setConfigurationModalOpen(true)
    return () => setConfigurationModalOpen(false)
  }, [setConfigurationModalOpen])

  // Dynamic options hook
  const {
    dynamicOptions,
    loading: loadingDynamic,
    isInitialLoading: isLoadingDynamicOptions,
    loadOptions,
    loadOptionsParallel,
    resetOptions
  } = useDynamicOptions({
    nodeType: nodeInfo?.type,
    // For HITL nodes, use 'discord' as providerId even though the node itself has no providerId
    // This allows the node to appear in Core while still loading Discord data
    providerId: nodeInfo?.type === 'hitl_conversation' ? 'discord' : (nodeInfo?.providerId || provider),
    workflowId,
    onOptionsUpdated: useCallback((updatedOptions: Record<string, any>) => {
      // Update the form values with the latest dynamic options
      // This ensures they persist between modal opens
      logger.debug('📝 [ConfigForm] Dynamic options updated, saving to form values:', Object.keys(updatedOptions));
      setValues(prev => ({
        ...prev,
        __dynamicOptions: updatedOptions
      }));
    }, []),
    onLoadingChange: (fieldName: string, isLoading: boolean) => {
      logger.debug(`🔧 [ConfigForm] onLoadingChange called:`, { fieldName, isLoading });

      setLoadingFields(prev => {
        const newSet = new Set(prev);
        if (isLoading) {
          logger.debug(`➕ [ConfigForm] Adding ${fieldName} to loadingFields`);
          newSet.add(fieldName);

          // Set a timeout to clear loading state after 10 seconds to prevent infinite loading
          setTimeout(() => {
            logger.debug(`⏱️ [ConfigForm] Timeout reached for ${fieldName}, clearing loading state`);
            setLoadingFields(prevFields => {
              const updatedSet = new Set(prevFields);
              if (updatedSet.has(fieldName)) {
                logger.debug(`🧹 [ConfigForm] Force clearing ${fieldName} from loadingFields due to timeout`);
                updatedSet.delete(fieldName);
              }
              return updatedSet;
            });
          }, 10000);
        } else {
          logger.debug(`➖ [ConfigForm] Removing ${fieldName} from loadingFields`);
          newSet.delete(fieldName);
        }
        logger.debug(`📊 [ConfigForm] LoadingFields after update:`, Array.from(newSet));
        return newSet;
      });

      // Call the parent onLoadingChange if it exists
      if (onLoadingChange) {
        // Need to check the new size after the state update
        setLoadingFields(prev => {
          onLoadingChange(prev.size > 0);
          return prev;
        });
      }
    },
    getFormValues: getFormValuesStable,
    initialOptions: savedDynamicOptions
  });

  // Base value setter (without provider logic)
  const setValueBase = useCallback((field: string, value: any) => {
    setValues(prev => ({
      ...prev,
      [field]: value
    }));

    // Clear error for this field
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });
  }, []);

  // Ref to track which fields have already loaded options to prevent infinite loops
  const loadedFieldsWithValues = useRef<Set<string>>(new Set());

  // Ref to track if we've auto-loaded fields to prevent duplicate loads within the same render cycle
  const hasAutoLoadedRef = useRef(false);

  // NOTE: hasAutoLoadedRef is reset in the useEffect at ~line 932 (Reset hasLoadedOnMount)
  // A separate useEffect was removed here as it was redundant - that effect already
  // resets hasAutoLoadedRef.current = false along with other refs

  // DISABLED: Auto-loading is now handled by useDynamicOptions hook
  // This was causing duplicate loads (3-5x) because both ConfigurationForm and useDynamicOptions
  // were loading the same fields independently, and React 18 Strict Mode was doubling each call.
  // The useDynamicOptions hook has better deduplication logic and request management.
  /*
  // Auto-load all dynamic dropdown fields when modal opens
  useEffect(() => {
    if (!nodeInfo?.configSchema) return;

    // Check if we've already loaded in this mount cycle
    if (hasAutoLoadedRef.current) {
      return;
    }

    // Mark as loaded for this mount cycle
    hasAutoLoadedRef.current = true;

    // Find all dynamic fields that don't depend on other fields (can be loaded immediately)
    const fieldsToLoad: Array<{ fieldName: string; dependsOn?: string; dependsOnValue?: any }> = [];

    nodeInfo.configSchema.forEach((field: any) => {
      // Only load dynamic fields
      if (!field.dynamic) return;

      // Skip fields that depend on other fields (they'll load when dependencies are met)
      if (field.dependsOn) {
        // Check if dependency value exists in initial data
        const dependencyValue = values[field.dependsOn] || initialData?.[field.dependsOn];
        if (dependencyValue) {
          fieldsToLoad.push({
            fieldName: field.name,
            dependsOn: field.dependsOn,
            dependsOnValue: dependencyValue
          });
        }
        return;
      }

      // Add independent fields
      fieldsToLoad.push({ fieldName: field.name });
    });

    // Load all fields in parallel for instant UX
    if (fieldsToLoad.length > 0) {
      loadOptionsParallel(fieldsToLoad);
    }
  }, [nodeInfo?.configSchema, loadOptionsParallel, values, initialData]);
  */

  // Consolidated field change handler hook
  const { handleFieldChange } = useFieldChangeHandler({
    nodeInfo,
    values,
    setValue: setValueBase,
    loadOptions,
    setLoadingFields,
    resetOptions,
    dynamicOptions,
    discordState: undefined, // TODO: Add Discord state if needed
    setSelectedRecord,
    setPreviewData,
    setShowPreviewData,
    setTableSearchQuery,
    setGoogleSheetsSortField,
    setGoogleSheetsSortDirection,
    setGoogleSheetsSelectedRows,
    setAirtableRecords,
    setAirtableTableSchema,
    currentNodeId,
    selectedRecord,
    loadedFieldsWithValues, // Pass the tracking ref
    clearedFieldsRef // Pass ref to track manually cleared fields
  });

  // Use the consolidated handler as setValue (except for Discord which uses setValueBase directly)
  const setValue = handleFieldChange;

  // NOTE: Conditional return for !nodeInfo moved to after all hooks (see ~line 1341)
  // This ensures React hooks are always called in the same order

  logger.debug('🔍 [ConfigForm] Provider routing:', {
    provider,
    nodeType,
    hasConfigSchema: !!nodeInfo.configSchema,
    schemaLength: nodeInfo.configSchema?.length || 0
  });

  // Initialize values from initial data or defaults
  useEffect(() => {
    if (!nodeInfo?.configSchema) return;

    // Prevent form reset when isConnectedToAIAgent recalculates due to workflowData changes
    // Only initialize once per node - subsequent renders should preserve user selections
    // This fixes a bug where trigger combobox selections clear when AI Agent conversation exists
    if (hasInitializedForNodeRef.current === currentNodeId) {
      logger.debug('🔄 [ConfigForm] Skipping re-initialization - already initialized for node:', currentNodeId);
      return;
    }

    // Mark as initialized for this node
    hasInitializedForNodeRef.current = currentNodeId ?? null;

    // Reset cleared fields when switching to a different node
    clearedFieldsRef.current = new Set();

    logger.debug('🔄 [ConfigForm] Initializing form values:', {
      nodeType: nodeInfo?.type,
      initialData,
      hasInitialData: !!initialData && Object.keys(initialData).length > 0,
      initialDataKeys: initialData ? Object.keys(initialData) : [],
      isConnectedToAIAgent
    });

    const initialValues: Record<string, any> = {};

    // Set initial data first
    if (initialData && Object.keys(initialData).length > 0) {
      // Check if _allFieldsAI is set (for AI-generated workflows)
      // OR if this node is connected to an AI Agent (auto-enable for AI chains)
      const allFieldsAI = initialData._allFieldsAI === true || (isConnectedToAIAgent && initialData._allFieldsAI !== false);

      Object.entries(initialData).forEach(([key, value]) => {
        if (value !== undefined) {
          // Check if this field was manually cleared by a provider handler
          if (clearedFieldsRef.current.has(key)) {
            logger.debug(`🚫 [ConfigForm] Skipping restore of ${key} because it was manually cleared by provider handler`);
            return;
          }

          // For Slack send message, clear AI placeholders from channel and asUser fields
          const isSlackSendMessage = nodeInfo?.type === 'slack_action_send_message';
          const isSlackSelectorField = isSlackSendMessage && (key === 'channel' || key === 'asUser');

          // For Notion create page, clear AI placeholders from database fields
          const isNotionCreatePage = nodeInfo?.type === 'notion_action_create_page';
          const isNotionDatabaseField = isNotionCreatePage && (key === 'database' || key === 'databaseId');

          const hasAIPlaceholder = typeof value === 'string' && value.startsWith('{{AI_FIELD:');

          if ((isSlackSelectorField || isNotionDatabaseField) && hasAIPlaceholder) {
            logger.debug(`🚫 [ConfigForm] Clearing AI placeholder from selector field: ${key}`);
            initialValues[key] = ''; // Clear the AI placeholder

            // Mark as manually cleared to prevent any restoration
            clearedFieldsRef.current.add(key);
            logger.debug(`🚫 [ConfigForm] Marked selector field as cleared: ${key}`);

            // Also ensure this field is not marked as an AI field
            // Use functional update to avoid needing aiFields in deps
            setAiFields(prev => {
              if (prev[key]) {
                const newFields = { ...prev };
                delete newFields[key];
                return newFields;
              }
              return prev;
            });
            return;
          }

          // Always restore if not manually cleared
          initialValues[key] = value;
        }
      });

      // For Slack send message, ALWAYS mark channel and asUser as cleared to prevent AI mode
      // This must happen regardless of whether they have values in initialData
      if (nodeInfo?.type === 'slack_action_send_message') {
        clearedFieldsRef.current.add('channel');
        clearedFieldsRef.current.add('asUser');
        logger.debug('🚫 [ConfigForm] Pre-marked Slack selector fields as cleared to prevent AI mode');
      }

      // For Notion create page, ALWAYS mark database fields as cleared to prevent AI mode
      if (nodeInfo?.type === 'notion_action_create_page') {
        clearedFieldsRef.current.add('database');
        clearedFieldsRef.current.add('databaseId');
        logger.debug('🚫 [ConfigForm] Pre-marked Notion database fields as cleared to prevent AI mode');
      }

      // If connected to AI Agent and _allFieldsAI not explicitly set, add it
      if (isConnectedToAIAgent && initialData._allFieldsAI === undefined) {
        initialValues._allFieldsAI = true;
        logger.debug('🤖 [ConfigForm] Auto-enabling _allFieldsAI for AI Agent chain');
      }

      // If _allFieldsAI is set, initialize all fields with AI placeholders
      if (allFieldsAI) {
        // Fields that should NOT be set to AI mode (user needs to select these)
        const selectorFields = new Set([
          // Airtable selectors
          'baseId', 'tableName', 'viewName',
          // Google Sheets selectors
          'spreadsheetId', 'sheetName',
          // Microsoft Excel selectors
          'workbookId', 'worksheetName',
          // Discord selectors
          'guildId', 'channelId',
          // Slack selectors
          'channel', 'workspace', 'asUser',
          // Notion selectors
          'databaseId', 'pageId', 'database',
          // Trello selectors
          'boardId', 'listId',
          // HubSpot selectors
          'objectType',
          // Generic selectors
          'recordId', 'id'
        ]);

        nodeInfo.configSchema.forEach((field: any) => {
          // Explicit check for Slack send message fields
          const isSlackSendMessage = nodeInfo?.type === 'slack_action_send_message';
          const isSlackSelectorField = isSlackSendMessage && (field.name === 'channel' || field.name === 'asUser');

          // Explicit check for Notion create page fields
          const isNotionCreatePage = nodeInfo?.type === 'notion_action_create_page';
          const isNotionDatabaseField = isNotionCreatePage && (field.name === 'database' || field.name === 'databaseId');

          // Don't set AI placeholders for:
          // - selector fields
          // - manually cleared fields
          // - Slack selector fields
          // - Notion database fields
          // - non-editable fields
          if (
            !selectorFields.has(field.name) &&
            !clearedFieldsRef.current.has(field.name) &&
            !isSlackSelectorField &&
            !isNotionDatabaseField &&
            !field.computed &&
            !field.autoNumber &&
            !field.formula &&
            !field.readOnly
          ) {
            if (initialValues[field.name] === undefined || initialValues[field.name] === '') {
              initialValues[field.name] = `{{AI_FIELD:${field.name}}}`;
            }
          } else if (isSlackSelectorField) {
            logger.debug(`🚫 [ConfigForm] Skipping AI mode for Slack selector field: ${field.name}`);
          } else if (isNotionDatabaseField) {
            logger.debug(`🚫 [ConfigForm] Skipping AI mode for Notion database field: ${field.name}`);
          } else if (clearedFieldsRef.current.has(field.name)) {
            logger.debug(`🚫 [ConfigForm] Skipping AI mode for manually cleared field: ${field.name}`);
          }
        });
      }
    } else {
      // No initial data - if connected to AI Agent, auto-enable AI mode
      if (isConnectedToAIAgent) {
        initialValues._allFieldsAI = true;
        logger.debug('🤖 [ConfigForm] No initial data but connected to AI Agent - enabling _allFieldsAI');
      }

      // For Slack send message, ALWAYS mark channel and asUser as cleared to prevent AI mode
      if (nodeInfo?.type === 'slack_action_send_message') {
        clearedFieldsRef.current.add('channel');
        clearedFieldsRef.current.add('asUser');
        logger.debug('🚫 [ConfigForm] Pre-marked Slack selector fields as cleared (no initial data)');
      }

      // For Notion create page, ALWAYS mark database fields as cleared to prevent AI mode
      if (nodeInfo?.type === 'notion_action_create_page') {
        clearedFieldsRef.current.add('database');
        clearedFieldsRef.current.add('databaseId');
        logger.debug('🚫 [ConfigForm] Pre-marked Notion database fields as cleared (no initial data)');
      }
    }

    // Set defaults for missing fields (only if not using AI for all fields)
    if (!initialValues._allFieldsAI) {
      nodeInfo.configSchema.forEach((field: any) => {
        if (field.defaultValue !== undefined && initialValues[field.name] === undefined) {
          let defaultValue = field.defaultValue;

          // Process dynamic default values
          if (typeof defaultValue === 'string') {
            const now = new Date();

            // {{currentDate}} - Current date in YYYY-MM-DD format
            if (defaultValue === '{{currentDate}}') {
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const day = String(now.getDate()).padStart(2, '0');
              defaultValue = `${year}-${month}-${day}`;
            }

            // {{roundedCurrentTime}} - Current time rounded to nearest 15 minutes
            else if (defaultValue === '{{roundedCurrentTime}}') {
              const minutes = now.getMinutes();
              const roundedMinutes = Math.round(minutes / 15) * 15;
              const adjustedTime = new Date(now);
              adjustedTime.setMinutes(roundedMinutes);
              adjustedTime.setSeconds(0);

              const hours = String(adjustedTime.getHours()).padStart(2, '0');
              const mins = String(adjustedTime.getMinutes()).padStart(2, '0');
              defaultValue = `${hours}:${mins}`;
            }

            // {{roundedCurrentTimePlusOneHour}} - Current time rounded + 1 hour
            else if (defaultValue === '{{roundedCurrentTimePlusOneHour}}') {
              const minutes = now.getMinutes();
              const roundedMinutes = Math.round(minutes / 15) * 15;
              const adjustedTime = new Date(now);
              adjustedTime.setMinutes(roundedMinutes);
              adjustedTime.setSeconds(0);
              adjustedTime.setHours(adjustedTime.getHours() + 1);

              const hours = String(adjustedTime.getHours()).padStart(2, '0');
              const mins = String(adjustedTime.getMinutes()).padStart(2, '0');
              defaultValue = `${hours}:${mins}`;
            }
          }

          initialValues[field.name] = defaultValue;
        }
      });
    }

    const normalizedInitialValues = normalizeAllVariablesInObject(initialValues);
    logger.debug('🔄 [ConfigForm] Setting form values to:', normalizedInitialValues);
    logger.debug('🔍 [ConfigForm] _allFieldsAI in initialValues:', normalizedInitialValues._allFieldsAI);
    logger.debug('🔍 [ConfigForm] _allFieldsAI in initialData:', initialData?._allFieldsAI);
    logger.debug('🔍 [ConfigForm] isConnectedToAIAgent:', isConnectedToAIAgent);
    setValues(normalizedInitialValues);
    setIsInitialLoading(false);
  }, [nodeInfo, initialData, isConnectedToAIAgent, currentNodeId]);

  // Sync aiFields state with values that contain AI placeholders
  useEffect(() => {
    // Fields that should NOT be set to AI mode (user needs to select these)
    // Updated: Added Slack selectors (channel, workspace, asUser)
    const selectorFields = new Set([
      // Airtable selectors
      'baseId', 'tableName', 'viewName',
      // Google Sheets selectors
      'spreadsheetId', 'sheetName',
      // Microsoft Excel selectors
      'workbookId', 'worksheetName',
      // Discord selectors
      'guildId', 'channelId',
      // Slack selectors
      'channel', 'workspace', 'asUser',
      // Notion selectors
      'databaseId', 'pageId', 'database',
      // Trello selectors
      'boardId', 'listId',
      // HubSpot selectors
      'objectType',
      // Generic selectors
      'recordId', 'id'
    ]);

    const newAiFields: Record<string, boolean> = {};

    // Check if _allFieldsAI flag is set OR if connected to AI Agent
    const shouldEnableAllAI = initialData?._allFieldsAI === true || values._allFieldsAI === true || isConnectedToAIAgent;

    if (shouldEnableAllAI) {
      newAiFields._allFieldsAI = true;
      // Mark all fields as AI fields EXCEPT selector fields and manually cleared fields
      if (nodeInfo?.configSchema) {
        nodeInfo.configSchema.forEach((field: any) => {
          // Explicit check for Slack send message fields
          const isSlackSendMessage = nodeInfo?.type === 'slack_action_send_message';
          const isSlackSelectorField = isSlackSendMessage && (field.name === 'channel' || field.name === 'asUser');

          // Explicit check for Notion create page fields
          const isNotionCreatePage = nodeInfo?.type === 'notion_action_create_page';
          const isNotionDatabaseField = isNotionCreatePage && (field.name === 'database' || field.name === 'databaseId');

          // Skip:
          // - selector fields
          // - manually cleared fields
          // - Slack selector fields
          // - Notion database fields
          // - computed fields
          // - read-only fields
          if (
            !selectorFields.has(field.name) &&
            !clearedFieldsRef.current.has(field.name) &&
            !isSlackSelectorField &&
            !isNotionDatabaseField &&
            !field.computed &&
            !field.autoNumber &&
            !field.formula &&
            !field.readOnly
          ) {
            newAiFields[field.name] = true;
          }
        });
      }
    } else {
      // Check individual field values for AI placeholders
      Object.entries(values).forEach(([key, value]) => {
        if (typeof value === 'string' && value.startsWith('{{AI_FIELD:')) {
          // For Slack send message, don't mark channel or asUser as AI fields even if they have the placeholder
          const isSlackSendMessage = nodeInfo?.type === 'slack_action_send_message';
          const isSlackSelectorField = isSlackSendMessage && (key === 'channel' || key === 'asUser');

          // For Notion create page, don't mark database fields as AI fields even if they have the placeholder
          const isNotionCreatePage = nodeInfo?.type === 'notion_action_create_page';
          const isNotionDatabaseField = isNotionCreatePage && (key === 'database' || key === 'databaseId');

          const isManuallyClearedField = clearedFieldsRef.current.has(key);

          if (!isSlackSelectorField && !isNotionDatabaseField && !isManuallyClearedField) {
            newAiFields[key] = true;
          }
        }
      });
    }

    // Only update if there are changes
    const hasChanges = Object.keys(newAiFields).some(
      key => newAiFields[key] !== aiFields[key]
    ) || Object.keys(aiFields).some(
      key => !newAiFields[key] && aiFields[key]
    );

    if (hasChanges && Object.keys(newAiFields).length > 0) {
      logger.debug('🤖 [ConfigForm] Syncing aiFields state:', newAiFields);
      setAiFields(newAiFields);
    }
  }, [values, initialData, nodeInfo, aiFields, isConnectedToAIAgent]);

  // Track if we've already loaded on mount to prevent duplicate calls
  const hasLoadedOnMount = useRef(false);
  const previousNodeKeyRef = useRef<string | null>(null);
  // Track which node type key was last loaded to detect node type changes
  const lastLoadedNodeTypeKeyRef = useRef<string | null>(null);
  // Counter that increments when modal reopens to force reload
  const [reloadCounter, setReloadCounter] = useState(0);
  // STRICT MODE GUARD: Track the last load timestamp to prevent double-execution
  // React 18 Strict Mode unmounts/remounts components, causing effects to run twice
  const lastLoadTimestampRef = useRef<{ key: string; time: number } | null>(null);

  // Ensure integrations are loaded on mount - WITH DEBOUNCE
  useEffect(() => {
    const componentId = Math.random().toString(36).substr(2, 9);
    logger.debug('🚨 [ConfigForm] MOUNT EFFECT RUNNING', {
      nodeType: nodeInfo?.type,
      providerId: nodeInfo?.providerId,
      timestamp: new Date().toISOString(),
      componentId
    });

    let mounted = true;
    let timeoutId: NodeJS.Timeout;

    // Don't reset the flag here - it's handled in the nodeInfo change effect
    // hasLoadedOnMount.current = false;

    // Clear options for Dropbox path field on mount to ensure fresh load
    if (nodeInfo?.providerId === 'dropbox' && resetOptions) {
      logger.debug('🧹 [ConfigForm] Clearing Dropbox path options on mount');
      resetOptions('path');
    }

    // Clear options for Trello board field on mount to ensure fresh load
    // This is critical after workflow execution that may have created new boards
    if (nodeInfo?.providerId === 'trello' && resetOptions) {
      logger.debug('🧹 [ConfigForm] Clearing Trello board options on mount to ensure fresh data');
      resetOptions('boardId');
    }

    // Skip integration fetch for providers that don't need it or already have their integration loaded
    // Check if we already have the integration for this provider
    const providerToCheck = nodeInfo?.providerId;
    const existingIntegration = getIntegrationByProvider(providerToCheck || '');
    const skipIntegrationFetch = nodeInfo?.providerId === 'logic' ||
                                 nodeInfo?.providerId === 'core' ||
                                 nodeInfo?.providerId === 'manual' ||
                                 nodeInfo?.providerId === 'schedule' ||
                                 nodeInfo?.providerId === 'webhook' ||
                                 (existingIntegration && existingIntegration.status === 'connected');

    if (skipIntegrationFetch) {
      logger.debug('⏭️ [ConfigForm] Skipping integration fetch', {
        provider: nodeInfo?.providerId,
        providerToCheck,
        hasExistingIntegration: !!existingIntegration,
        isConnected: existingIntegration?.status === 'connected'
      });
      return;
    }

    // Load integrations immediately for instant UX - no artificial delay
    const loadIntegrations = async () => {
      if (mounted) {
        logger.debug('🔄 [ConfigForm] Loading integrations immediately', { componentId });
        await fetchIntegrations(); // Regular fetch - concurrent calls are now handled properly
      }
    };

    loadIntegrations();

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      logger.debug('🚨 [ConfigForm] UNMOUNT EFFECT CLEANUP', {
        nodeType: nodeInfo?.type,
        timestamp: new Date().toISOString(),
        componentId
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally empty deps: cleanup only runs on unmount
  }, []);

  // Reset hasLoadedOnMount and clear options when modal opens (nodeInfo changes)
  useEffect(() => {
    // Always reset to ensure fresh data loads every time
    hasLoadedOnMount.current = false;
    loadedFieldsWithValues.current.clear();
    // Allow auto-load effect to run again when the modal is reopened or node changes
    hasAutoLoadedRef.current = false;

    // Store the previous node ID to check if we're opening the same node
    const prevNodeKey = `${nodeInfo?.id}-${nodeInfo?.type}`;
    const isNewNode = prevNodeKey !== previousNodeKeyRef.current;

    logger.debug('🔄 [ConfigForm] Reset hasLoadedOnMount for FRESH data load', {
      nodeId: nodeInfo?.id,
      nodeType: nodeInfo?.type,
      currentNodeId,
      isNewNode,
      previousKey: previousNodeKeyRef.current,
      newKey: prevNodeKey
    });
    previousNodeKeyRef.current = prevNodeKey;

    // Increment reload counter to force useEffect to re-run
    setReloadCounter(prev => prev + 1);

    // Only clear specific fields that need fresh data on each modal open
    // For Trello, always clear boards to get fresh data
    if (nodeInfo?.providerId === 'trello' && isNewNode) {
      logger.debug('🔄 [ConfigForm] Clearing Trello board cache on modal reopen');
      resetOptions('boardId');
    }

    // For Microsoft Excel, always clear workbooks to get fresh data when switching nodes
    if (nodeInfo?.providerId === 'microsoft-excel') {
      logger.debug('🔄 [ConfigForm] Clearing Microsoft Excel workbook cache on node switch');
      resetOptions('workbookId');
      // Also reset dependent fields
      resetOptions('worksheetName');
      resetOptions('tableName');
    }

    // For Airtable, don't reset bases as they rarely change
    // Only reset if it's a completely different node
    if (nodeInfo?.providerId === 'airtable') {
      logger.debug('🔄 [ConfigForm] Airtable node - skipping base reset to prevent constant reloading');
      // Don't reset baseId - let it use cached values
    } else if (nodeInfo?.configSchema) {
      // For other providers, ALWAYS reset loadOnMount fields for fresh data
      nodeInfo.configSchema.forEach((field: any) => {
        if (field.loadOnMount && field.dynamic) {
          logger.debug(`🔄 [ConfigForm] Resetting options for field: ${field.name}`);
          resetOptions(field.name);
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally only track nodeId and nodeType changes
  }, [nodeInfo?.id, nodeInfo?.type, resetOptions]);

  // Load fields marked with loadOnMount immediately when form opens
  /**
   * PURPOSE: Unified field option loader - handles loadOnMount, saved values, and dependent fields
   * TRIGGERS: Node changes, isInitialLoading, values changes, dynamicOptions changes, connection state
   * LOADS: All dynamic field options (loadOnMount fields, fields with saved values, dependent fields)
   * CONSOLIDATES: Former useEffect #9 (loadOnMount) + useEffect #10 (saved values + dependent fields)
   */
  useEffect(() => {
    if (!nodeInfo?.configSchema || isInitialLoading) {
      return;
    }

    if (needsConnection) {
      return;
    }

    // Check if we've already loaded for this specific node instance
    // Use a combination of nodeId, nodeType, and currentNodeId to ensure uniqueness
    const nodeInstanceKey = `${nodeInfo?.id}-${nodeInfo?.type}-${currentNodeId}-${reloadCounter}`;

    // STRICT MODE GUARD: Skip if we've loaded this exact instance within the last 100ms
    // This prevents React 18 Strict Mode from triggering duplicate loads during unmount/remount
    const now = Date.now();
    if (lastLoadTimestampRef.current) {
      const { key: lastKey, time: lastTime } = lastLoadTimestampRef.current;
      if (lastKey === nodeInstanceKey && (now - lastTime) < 100) {
        logger.debug('⏭️ [ConfigForm] Skipping duplicate load - Strict Mode guard', { nodeInstanceKey });
        return;
      }
    }

    // Track node type changes to force reload even with same node ID
    const currentNodeTypeKey = `${nodeInfo?.id}-${nodeInfo?.type}`;
    const nodeTypeChanged = currentNodeTypeKey !== lastLoadedNodeTypeKeyRef.current;

    // If node type changed, reset the hasLoadedOnMount flag
    if (nodeTypeChanged) {
      hasLoadedOnMount.current = false;
    }

    // UNIFIED FIELD LOADING: Find ALL fields that need options loaded
    // Handles: loadOnMount fields, fields with saved values, dependent fields with parent values
    const fieldsToLoad = nodeInfo.configSchema.filter((field: any) => {
      // Skip dynamic_fields type - they handle their own data loading
      if (field.type === 'dynamic_fields') return false;

      // Skip non-dynamic fields
      if (!field.dynamic) return false;

      // CASE 1: Fields with loadOnMount=true (instant load on modal open)
      if (field.loadOnMount === true) {
        // Only load if we haven't loaded this node's fields yet
        const shouldLoad = !hasLoadedOnMount.current;
        return shouldLoad;
      }

      // CASE 2 & 3: Fields with saved values OR dependent fields with parent values
      const savedValue = values[field.name];

      // For dependent fields, check if parent has a value
      if (field.dependsOn) {
        const parentValue = values[field.dependsOn];

        // Check if options already exist to prevent repeated loads
        const fieldOptions = dynamicOptions[field.name];
        const hasExistingOptions = fieldOptions && Array.isArray(fieldOptions) && fieldOptions.length > 0;

        // Skip if already has options (prevents repeated API calls)
        if (hasExistingOptions) {
          return false;
        }

        // STRONG VALIDATION: Only load if parent has a real value (not empty string, null, or undefined)
        const hasValidParentValue = parentValue !== undefined &&
                                     parentValue !== null &&
                                     parentValue !== '';

        if (hasValidParentValue && !loadedFieldsWithValues.current.has(field.name) && !loadingFields.has(field.name)) {
          logger.debug(`🔄 [ConfigForm] Field ${field.name} is dependent on ${field.dependsOn} which has value: ${parentValue}`);
          return true;
        }
      }

      // If no saved value, skip
      if (!savedValue) return false;

      // Skip if we've already loaded options for this field
      if (loadedFieldsWithValues.current.has(field.name)) {
        return false;
      }

      // Skip if field is currently loading
      if (loadingFields.has(field.name)) {
        logger.debug(`⏭️ [ConfigForm] Skipping ${field.name} - already loading`);
        return false;
      }

      // Check if options are already loaded
      const fieldOptions = dynamicOptions[field.name];
      const hasOptions = fieldOptions && Array.isArray(fieldOptions) && fieldOptions.length > 0;

      // Special handling for Trello Move Card - always load cardId and listId if boardId is set
      if (nodeInfo?.type === 'trello_action_move_card' && values.boardId) {
        if (field.name === 'cardId' || field.name === 'listId') {
          logger.debug(`🎯 [ConfigForm] Trello Move Card - field ${field.name} has saved value: ${savedValue}, hasOptions: ${hasOptions}`);
          // Load if no options or if saved value not in options
          if (!hasOptions) {
            return true;
          }
          // Check if saved value exists in options
          const valueExists = fieldOptions.some((opt: any) =>
            (opt.value === savedValue) || (opt.id === savedValue)
          );
          if (!valueExists) {
            logger.debug(`🎯 [ConfigForm] Saved value ${savedValue} not found in options for ${field.name}, need to reload`);
            return true;
          }
        }
      }

      // Special handling for Notion page field
      if (nodeInfo?.providerId === 'notion' && field.name === 'page' && values.workspace) {
        logger.debug(`🎯 [ConfigForm] Notion page field - saved value: ${savedValue}, hasOptions: ${hasOptions}`);
        if (!hasOptions) {
          return true;
        }
        // Check if saved value exists in options
        const valueExists = fieldOptions.some((opt: any) =>
          (opt.value === savedValue) || (opt.id === savedValue)
        );
        if (!valueExists) {
          logger.debug(`🎯 [ConfigForm] Saved page ${savedValue} not found in options, need to reload`);
          return true;
        }
        return false; // Page is already in options
      }

      // Always load for dependent fields if parent has value, even if options exist
      // This ensures the saved value displays correctly
      if (field.dependsOn && values[field.dependsOn]) {
        // Skip if field is already loading
        if (loadingFields.has(field.name)) {
          return false;
        }

        // If no options loaded yet, definitely need to load
        if (!hasOptions) {
          return true;
        }

        // If we have a saved value, check if it exists in current options
        if (savedValue) {
          // Handle multi-select fields (saved value is an array)
          if (Array.isArray(savedValue)) {
            const allValuesExist = savedValue.every(val =>
              fieldOptions.some((opt: any) =>
                (opt.value === val) || (opt.id === val) || (opt === val)
              )
            );
            return !allValuesExist;
          }
          // Single value field
          const valueExists = fieldOptions.some((opt: any) =>
            (opt.value === savedValue) || (opt.id === savedValue) || (opt === savedValue)
          );
          return !valueExists;
        }

        // No saved value but parent has value and we have options - don't reload
        return false;
      }

      // Only load if we have a value but no options yet
      return !hasOptions;
    });

    if (fieldsToLoad.length > 0) {
      // STRICT MODE GUARD: Record this load to prevent duplicate execution
      lastLoadTimestampRef.current = { key: nodeInstanceKey, time: now };

      // Mark loadOnMount fields as loaded
      hasLoadedOnMount.current = true;
      lastLoadedNodeTypeKeyRef.current = currentNodeTypeKey;

      // Mark saved value fields as loaded to prevent duplicate loads
      fieldsToLoad.forEach(field => {
        if (values[field.name]) {
          loadedFieldsWithValues.current.add(field.name);
        }
      });

      // Load ALL fields in parallel for instant UX
      loadOptionsParallel(
        fieldsToLoad.map((field: any) => ({
          fieldName: field.name,
          dependsOn: field.dependsOn,
          dependsOnValue: field.dependsOn ? values[field.dependsOn] : undefined
        }))
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally removed values/dynamicOptions to prevent feedback loop
  }, [nodeInfo?.id, nodeInfo?.type, currentNodeId, isInitialLoading, loadOptionsParallel, needsConnection, reloadCounter]);

  /**
   * PURPOSE: Handle edge cases that can't fit in the unified loader
   * TRIGGERS: Facebook pageId changes
   * LOADS: Facebook shareToGroups (special reactive case)
   * NOTE: Dependent field loading is now handled by the unified useEffect above
   */
  useEffect(() => {
    if (!nodeInfo?.configSchema || isInitialLoading) return;

    // Special handling for Facebook shareToGroups field
    // This is a reactive edge case that needs to load when pageId changes
    if (nodeInfo.type === 'facebook_action_create_post' && values.pageId && !dynamicOptions.shareToGroups) {
      logger.debug('🔄 [ConfigForm] Loading Facebook groups for sharing...');
      loadOptions('shareToGroups');
    }
  }, [nodeInfo, isInitialLoading, values.pageId, loadOptions, dynamicOptions]);

  // Listen for integration reconnection events to refresh integration status
  useEffect(() => {
    const handleReconnection = (event: CustomEvent) => {
      logger.debug('🔄 [ConfigForm] Integration reconnection event received:', event.detail);
      
      // Refresh integrations list to get updated status
      if (event.detail?.provider) {
        logger.debug('✅ [ConfigForm] Refreshing integrations after reconnection...');
        fetchIntegrations(true); // Force refresh
      }
    };
    
    // Listen for the reconnection event
    window.addEventListener('integration-reconnected', handleReconnection as EventListener);
    
    return () => {
      window.removeEventListener('integration-reconnected', handleReconnection as EventListener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally empty: event listeners only set up once on mount
  }, []);

  // Handle form submission
  const handleSubmit = async (submissionValues: Record<string, any>) => {
    const normalizedSubmissionValues = normalizeAllVariablesInObject({ ...submissionValues });

    // Collect field labels from localStorage cache to persist to database
    // This enables instant display when modal reopens (Zapier-like UX)
    const fieldLabels = nodeInfo?.providerId && nodeInfo?.type
      ? collectFieldLabelsFromCache(nodeInfo.providerId, nodeInfo.type, normalizedSubmissionValues)
      : {};

    // Merge labels into submission values
    const submissionWithLabels = {
      ...normalizedSubmissionValues,
      ...fieldLabels
    };

    logger.debug('🎯 [ConfigForm] handleSubmit called with values:', {
      allValues: submissionWithLabels,
      pageFieldsValue: submissionWithLabels.pageFields,
      hasPageFields: 'pageFields' in submissionWithLabels,
      labelCount: Object.keys(fieldLabels).length,
      labels: fieldLabels
    });
    setIsLoading(true);
    try {
      // OPTIMIZATION: Removed immediate Supabase save here.
      // Configuration is saved in the workflow builder's state and will be persisted
      // when the entire workflow is saved. This eliminates the delay caused by
      // multiple Supabase round-trips on every config save.
      // The saveNodeConfig function was causing:
      // 1. Get user call
      // 2. Fetch entire workflow call
      // 3. Update entire workflow call
      // This was taking several seconds and was unnecessary since the data
      // is already in React state and will be saved with the workflow.

      // Only save to localStorage as a quick cache/fallback (synchronous, no delay)
      if (workflowData?.id && currentNodeId && typeof window !== 'undefined') {
        const cacheKey = `workflow_${workflowData.id}_node_${currentNodeId}_config`;
        const stored = safeLocalStorageSet(cacheKey, {
          config: submissionWithLabels,
          timestamp: Date.now()
        });
        if (stored) {
          logger.debug('💾 [ConfigForm] Configuration cached locally for node:', currentNodeId);
        }
      }

      // Don't cache dynamicOptions - always fetch fresh from Airtable
      // Validate against actual submitted values, not potentially stale form state
      const missingRequiredFields = nodeInfo?.configSchema
        ? FieldVisibilityEngine.getMissingRequiredFields(
            nodeInfo.configSchema,
            submissionWithLabels,
            nodeInfo
          )
        : [];
      const allRequiredFields = getAllRequiredFields();

      const validationState = {
        missingRequired: missingRequiredFields,
        allRequiredFields: allRequiredFields,
        lastValidatedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        isValid: missingRequiredFields.length === 0
      };

      await onSave({
        ...submissionWithLabels,
        __validationState: validationState
      });

      // Note: Validation state update via old workflowStore is optional
      // The v2 builder's handleSaveNodeConfig already updates the node state
      // This is kept for backwards compatibility with non-v2 builder contexts
      if (currentWorkflow?.id && currentNodeId) {
        try {
          updateNode(currentNodeId, {
            data: {
              validationState
            }
          });
        } catch (storeError) {
          // Ignore - v2 builder handles state separately
          logger.debug('Optional workflowStore update skipped (expected in v2 builder)');
        }
      }
    } catch (error) {
      logger.error('Error saving configuration:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle integration connection
  const handleConnectIntegration = async () => {
    if (!provider || isProviderConnectionExempt(provider) || isNodeTypeConnectionExempt(nodeInfo?.type)) {
      return;
    }
    try {
      await connectIntegration(provider);
      // After successful connection, reload options for dynamic fields
      if (nodeInfo?.configSchema) {
        for (const field of nodeInfo.configSchema) {
          if (field.dynamic) {
            loadOptions(field.name, undefined, undefined, true); // Force refresh
          }
        }
      }
    } catch (error) {
      logger.error('Error connecting integration:', error);
    }
  };

  // NOW we can do the conditional return (after all hooks have been called)
  // This ensures React hooks are always called in the same order on every render
  if (!nodeInfo) {
    logger.debug('⚠️ [ConfigForm] No nodeInfo provided');
    return (
      <div className="flex items-center justify-center h-32 text-slate-500">
        <div className="text-center">
          <Settings className="h-8 w-8 mx-auto mb-2 text-slate-400" />
          <p>No configuration available for this node.</p>
        </div>
      </div>
    );
  }

  // Show a message when the node has no configuration fields (e.g., Manual Trigger)
  // The account selector in SetupTab still renders above this, so users can change accounts
  if (!nodeInfo.configSchema || nodeInfo.configSchema.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500 dark:text-slate-200">
        <div className="text-center">
          <Settings className="h-8 w-8 mx-auto mb-2 text-slate-400 dark:text-slate-400" />
          <p className="text-sm">No additional configuration needed for this node.</p>
        </div>
      </div>
    );
  }

  // Show loading screen during initial load only when:
  // 1. There are dynamic fields to fetch AND
  // 2. This is NOT a reopen (reopening should show saved values immediately)
  const hasDynamicFields = Array.isArray(nodeInfo?.configSchema) && nodeInfo.configSchema.some((field: any) => field?.dynamic);

  // When reopening a previously saved node, skip the loading screen entirely
  // The saved values should display immediately; dynamic options load in the background
  // and dropdowns will show loading state only when the user opens them
  if ((isInitialLoading || isLoadingDynamicOptions) && hasDynamicFields && !isReopen) {
    return (
      <ConfigurationLoadingScreen
        integrationName={integrationName}
      />
    );
  }

  // Common props for all provider components
  const commonProps = {
    nodeInfo,
    values,
    setValue,
    errors,
    onSubmit: handleSubmit,
    onCancel,
    onBack,
    isEditMode,
    workflowData,
    workflowId: workflowData?.id,
    currentNodeId,
    dynamicOptions,
    loadingDynamic,
    loadingFields,
    loadOptions,
    integrationName,
    integrationId: selectedIntegrationId || selectedIntegration?.id || integration?.id,
    needsConnection,
    hasExpiredIntegrations,
    // Multi-account support
    showAccountSelector,
    selectedIntegrationId,
    connectedIntegrations,
    onSelectAccount: handleSelectAccount,
    onConnectIntegration: handleConnectIntegration,
    aiFields,
    setAiFields,
    isConnectedToAIAgent,
    isReopen,
    // Provider-specific state
    selectedRecord,
    setSelectedRecord,
    previewData,
    setPreviewData,
    showPreviewData,
    setShowPreviewData,
    tableSearchQuery,
    setTableSearchQuery,
    googleSheetsSortField,
    setGoogleSheetsSortField,
    googleSheetsSortDirection,
    setGoogleSheetsSortDirection,
    googleSheetsSelectedRows,
    setGoogleSheetsSelectedRows,
    airtableRecords,
    setAirtableRecords,
    airtableTableSchema,
    setAirtableTableSchema
  };

  // Handle AI Message nodes with custom prompt builder
  if (nodeInfo?.type === 'ai_message') {
    return (
      <AIMessageConfiguration
        {...commonProps}
        setValue={setValueBase}
      />
    )
  }

  if (nodeInfo?.type?.startsWith('ai_action_')) {
    return (
      <AIActionConfiguration
        {...commonProps}
        errors={errors}
        dynamicOptions={dynamicOptions}
        loadingDynamic={loadingDynamic}
      />
    )
  }

  // THIRD THING: Route to the correct provider component
  // Check for specific node types that need custom configuration
  if (nodeInfo?.type === 'schedule') {
    logger.debug('⏰ [ConfigForm] Routing to Schedule configuration');
    return <ScheduleConfiguration {...commonProps} />;
  }

  // Check for if/then condition node
  if (nodeInfo?.type === 'if_then_condition') {
    logger.debug('🔀 [ConfigForm] Routing to If/Then configuration');
    return <IfThenConfiguration {...commonProps} />;
  }

  // Path Router node has no configuration - it's a placeholder node
  // Paths are configured via connected Path Condition nodes
  if (nodeInfo?.type === 'path') {
    logger.debug('🛤️ [ConfigForm] Path router has no config - showing placeholder');
    return null; // No config needed
  }

  // Check for router node (replaces filter and path_condition)
  if (nodeInfo?.type === 'router' || nodeInfo?.type === 'filter' || nodeInfo?.type === 'path_condition') {
    logger.debug('🔀 [ConfigForm] Routing to Router configuration');
    return <RouterConfiguration {...commonProps} />;
  }

  // Check for loop node
  if (nodeInfo?.type === 'loop') {
    logger.debug('🔁 [ConfigForm] Routing to Loop configuration');
    return <LoopConfiguration {...commonProps} />;
  }

  // Check for HTTP request node
  if (nodeInfo?.type === 'http_request') {
    logger.debug('🌐 [ConfigForm] Routing to HTTP Request configuration');
    return <HttpRequestConfiguration {...commonProps} />;
  }

  // Utility nodes
  if (nodeInfo?.type === 'transformer') {
    logger.debug('🔧 [ConfigForm] Routing to Transformer configuration');
    return <TransformerConfiguration {...commonProps} />;
  }

  if (nodeInfo?.type === 'parse_file') {
    logger.debug('📄 [ConfigForm] Routing to Parse File configuration');
    return <ParseFileConfiguration {...commonProps} />;
  }

  if (nodeInfo?.type === 'extract_website_data') {
    logger.debug('🌐 [ConfigForm] Routing to Extract Website Data configuration');
    return <ExtractWebsiteDataConfiguration {...commonProps} />;
  }

  if (nodeInfo?.type === 'conditional_trigger') {
    logger.debug('⚡ [ConfigForm] Routing to Conditional Trigger configuration');
    return <ConditionalTriggerConfiguration {...commonProps} />;
  }

  if (nodeInfo?.type === 'google_search') {
    logger.debug('🔍 [ConfigForm] Routing to Google Search configuration');
    return <GoogleSearchConfiguration {...commonProps} />;
  }

  if (nodeInfo?.type === 'tavily_search') {
    logger.debug('🔎 [ConfigForm] Routing to Tavily Search configuration');
    return <TavilySearchConfiguration {...commonProps} />;
  }

  if (nodeInfo?.type === 'hitl_conversation') {
    logger.debug('🧑‍🤝‍🧑 [ConfigForm] Routing to Ask Human configuration');
    return <AskHumanConfiguration {...commonProps} setValue={setValueBase} />;
  }

  // Gmail search email now uses GenericConfiguration like other actions
  // (removed special GmailFetchConfiguration with tabs since there are no advanced fields)

  switch (provider) {
    // Communication
    case 'discord':
      logger.debug('📘 [ConfigForm] Routing to Discord configuration');
      // Pass the base setValue for Discord to avoid complex field change logic
      // Also pass loadingFields so Discord can check if fields are loading
      return <DiscordConfiguration {...commonProps} setValue={setValueBase} loadingFields={loadingFields} />;
    
    case 'slack':
      logger.debug('💬 [ConfigForm] Routing to Slack configuration');
      return <SlackConfiguration {...commonProps} />;
    
    case 'teams':
      logger.debug('👥 [ConfigForm] Routing to Teams configuration');
      return <TeamsConfiguration {...commonProps} />;
    
    // Email
    case 'gmail':
      logger.debug('📧 [ConfigForm] Routing to Gmail configuration');
      return <GmailConfiguration {...commonProps} />;
    
    case 'microsoft-outlook':
    case 'outlook':
      return <OutlookConfiguration {...commonProps} />;
    
    // Productivity
    case 'notion':
      // NOTION WORKSPACE DEBUG: Log when Notion configuration is loaded
      if (commonProps.dynamicOptions?.workspace) {
        logger.debug('🔍 [NOTION DEBUG] Notion workspace options:', {
          workspaceOptions: commonProps.dynamicOptions.workspace,
          currentValue: commonProps.values?.workspace
        });
      }
      return <NotionConfiguration {...commonProps} />;
    
    case 'trello':
      return <TrelloConfiguration {...commonProps} />;
    
    case 'airtable':
      return (
        <AirtableConfiguration
          {...commonProps}
          isTemplateEditing={isTemplateEditing}
          templateDefaults={templateDefaults}
          initialConfig={initialData}
        />
      );
    
    // Google Services
    case 'google-sheets':
      logger.debug('📊 [ConfigForm] Routing to GoogleSheetsConfiguration', {
        nodeType: nodeInfo?.type,
        providerId: provider,
        configSchemaTypes: nodeInfo?.configSchema?.map((f: any) => f.type)
      });
      return <GoogleSheetsConfiguration {...commonProps} />;
    
    case 'google-calendar':
      return <GoogleCalendarConfiguration {...commonProps} />;
    
    case 'google-drive':
      return <GoogleDriveConfiguration {...commonProps} />;
    
    case 'google-docs':
      return <GoogleDocsConfiguration {...commonProps} />;
    
    // Microsoft Services
    case 'onedrive':
      return <OneDriveConfiguration {...commonProps} />;

    case 'microsoft-excel':
      return <MicrosoftExcelConfiguration {...commonProps} />;

    case 'microsoft-onenote':
    case 'onenote':
      return <OneNoteConfiguration {...commonProps} />;
    
    // Business & E-commerce
    case 'hubspot':
      return <HubSpotConfiguration {...commonProps} />;
    
    case 'stripe':
      logger.debug('💳 [ConfigForm] Routing to Stripe configuration');
      return <StripeConfiguration {...commonProps} />;
    
    case 'shopify':
      logger.debug('🛍️ [ConfigForm] Routing to Shopify configuration');
      return <ShopifyConfiguration {...commonProps} />;
    
    case 'paypal':
      logger.debug('💰 [ConfigForm] Routing to PayPal configuration');
      return <PayPalConfiguration {...commonProps} />;
    
    // Social Media
    case 'twitter':
      logger.debug('🐦 [ConfigForm] Routing to Twitter configuration');
      return <TwitterConfiguration {...commonProps} />;
    
    case 'facebook':
      logger.debug('👤 [ConfigForm] Routing to Facebook configuration');
      return <FacebookConfiguration {...commonProps} />;
    
    case 'linkedin':
      logger.debug('💼 [ConfigForm] Routing to LinkedIn configuration');
      return <LinkedInConfiguration {...commonProps} />;
    
    case 'instagram':
      logger.debug('📸 [ConfigForm] Routing to Instagram configuration');
      return <InstagramConfiguration {...commonProps} />;
    
    case 'youtube':
      logger.debug('📺 [ConfigForm] Routing to YouTube configuration');
      return <YouTubeConfiguration {...commonProps} />;
    
    case 'youtube-studio':
      logger.debug('🎬 [ConfigForm] Routing to YouTube Studio configuration');
      return <YouTubeStudioConfiguration {...commonProps} />;

    // File Storage
    case 'dropbox':
      logger.debug('📦 [ConfigForm] Routing to Dropbox configuration');
      return <DropboxConfiguration {...commonProps} />;
    
    case 'box':
      logger.debug('📦 [ConfigForm] Routing to Box configuration');
      return <BoxConfiguration {...commonProps} />;
    
    // Development
    case 'github':
      logger.debug('🐙 [ConfigForm] Routing to GitHub configuration');
      return <GitHubConfiguration {...commonProps} />;

    // Productivity
    case 'monday':
      logger.debug('📊 [ConfigForm] Routing to Monday.com configuration');
      return <MondayConfiguration {...commonProps} />;

    // Automation
    case 'webhook':
      logger.debug('🔗 [ConfigForm] Routing to Webhook configuration');
      return <WebhookConfiguration {...commonProps} />;

    default:
      logger.debug('📕 [ConfigForm] Routing to Generic configuration for provider:', provider);
      return <GenericConfiguration {...commonProps} resetOptions={resetOptions} />;
  }
}

export default ConfigurationForm;
