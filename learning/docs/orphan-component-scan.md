---
title: Orphan Component Scan
created: 2026-04-25
source: tests/design-audit/scripts/discover-schema.ts (regex-based; lazy/re-export imports may produce false positives)
---

# Orphan Component Scan — Starting Point

**Method:** regex grep over all `from "..."` and `import("...")` strings in `app/`, `components/`, `hooks/`, `stores/`, `lib/`, `src/`. A component is flagged "orphan" if its file path does NOT appear as the suffix of any import string.

**Caveats:**
- Re-exports through `index.ts` may make a component importable under a different path. The scan would miss this.
- `React.lazy(() => import("..."))` and `dynamic(() => import("..."))` are tracked, but only with literal string paths.
- Variable interpolation in import paths is not tracked.

## Stats

- Total components scanned: **657**
- Likely orphan: **188** (28%)

## Recommended next steps

1. For each candidate below, verify with `git log -- <file>` whether it was authored recently (live work) vs old (likely dead).
2. For each, run `grep -rn "<ComponentName>" .` looking for non-`from`/non-`import` references — JSX usage, indirect imports.
3. Delete confirmed orphans in batches; commit per batch so reverts are easy.
4. Some flagged components may be re-exported via `components/<dir>/index.ts`. Search those index files first.

## Candidates

- `components/PerformanceMonitor.tsx`
- `components/ai/AIAssistantComingSoon.tsx`
- `components/ai/AIChatAssistant.tsx`
- `components/ai/AIWorkflowGenerator.tsx`
- `components/ai/NodeSuggestions.tsx`
- `components/ai/SmartComposeField.tsx`
- `components/ai/VoiceMode.tsx`
- `components/ai/VoiceModeSimple.tsx`
- `components/ai/WorkflowOptimizer.tsx`
- `components/app-shell/TaskUsageWidget.tsx`
- `components/billing/BillingOverview.tsx`
- `components/billing/PlanSelectorStyled.tsx`
- `components/billing/SubscriptionDetails.tsx`
- `components/billing/TaskBillingHistory.tsx`
- `components/common/Breadcrumbs.tsx`
- `components/common/EmptyStates.tsx`
- `components/common/ErrorRecovery.tsx`
- `components/community/CommunityContent.tsx`
- `components/dashboard/BillingWarningBanners.tsx`
- `components/dashboard/DashboardContent.tsx`
- `components/dashboard/DashboardSidebar.tsx`
- `components/enterprise/EnterpriseContent.tsx`
- `components/icons/CommunityIcon.tsx`
- `components/icons/TeamsIcon.tsx`
- `components/icons/WorkflowsIcon.tsx`
- `components/integrations/IntegrationCardWrapper.tsx`
- `components/integrations/IntegrationDiagnostics.tsx`
- `components/integrations/IntegrationHealthDashboard.tsx`
- `components/integrations/IntegrationStatus.tsx`
- `components/integrations/ReAuthNotification.tsx`
- `components/integrations/ReconnectAlert.tsx`
- `components/integrations/RedirectLoadingOverlay.tsx`
- `components/integrations/ScopeValidationAlert.tsx`
- `components/layout/Header.tsx`
- `components/new-design/AppsContent.tsx`
- `components/new-design/NewCTASection.tsx`
- `components/new-design/NewFeaturesGrid.tsx`
- `components/new-design/NewFooter.tsx`
- `components/new-design/NewHeader.tsx`
- `components/new-design/NewHeroSection.tsx`
- `components/new-design/NewHowItWorks.tsx`
- `components/new-design/NewIntegrationsShowcase.tsx`
- `components/new-design/NewWorkflowAnimation.tsx`
- `components/new-design/OrganizationSwitcher.tsx`
- `components/notifications/NotificationsDropdown.tsx`
- `components/plan-restrictions/LockedPage.tsx`
- `components/providers/PresenceProvider.tsx`
- `components/settings/BusinessContextSettings.tsx`
- `components/support/SupportContent.tsx`
- `components/teams/AuditLog.tsx`
- `components/teams/MemberManagement.tsx`
- `components/teams/OrganizationWorkflows.tsx`
- `components/teams/TeamInvitationCard.tsx`
- `components/teams/TeamManagement.tsx`
- `components/templates/ProviderSubstitutionModal.tsx`
- `components/templates/PublishTemplateDialog.tsx`
- `components/templates/TemplateMarketplace.tsx`
- `components/templates/TemplateSetupDialog.tsx`
- `components/templates/TemplatesContent.tsx`
- `components/ui/AIUsageIndicator.tsx`
- `components/ui/SlackEmailInviteMultiCombobox.tsx`
- `components/ui/UpgradePrompt.tsx`
- `components/ui/animated-container.tsx`
- `components/ui/aspect-ratio.tsx`
- `components/ui/breadcrumb.tsx`
- `components/ui/carousel.tsx`
- `components/ui/chart.tsx`
- `components/ui/collapsible-footer-section.tsx`
- `components/ui/drawer.tsx`
- `components/ui/enhanced-tooltip.tsx`
- `components/ui/form.tsx`
- `components/ui/gmail-labels-input.tsx`
- `components/ui/google-meet-card.tsx`
- `components/ui/hover-card.tsx`
- `components/ui/input-otp.tsx`
- `components/ui/lazy-image.tsx`
- `components/ui/loader.tsx`
- `components/ui/location-autocomplete.tsx`
- `components/ui/menubar.tsx`
- `components/ui/navigation-menu.tsx`
- `components/ui/optimized-image.tsx`
- `components/ui/pagination.tsx`
- `components/ui/prefetch-link.tsx`
- `components/ui/resizable.tsx`
- `components/ui/role-guard.tsx`
- `components/ui/role-restriction.tsx`
- `components/ui/sidebar.tsx`
- `components/ui/skeletons.tsx`
- `components/ui/slack-template-preview.tsx`
- `components/ui/sonner.tsx`
- `components/ui/stable-image.tsx`
- `components/ui/tag-input.tsx`
- `components/ui/theme-slide-toggle.tsx`
- `components/ui/theme-toggle.tsx`
- `components/ui/upgrade-overlay.tsx`
- `components/webhooks/TriggerWebhookManager.tsx`
- `components/webhooks/WebhookManager.tsx`
- `components/workflows/AIRouterConfigModal.tsx`
- `components/workflows/AIRouterNode.tsx`
- `components/workflows/APIKeySelector.tsx`
- `components/workflows/AddToOrganizationDialog.tsx`
- `components/workflows/CompanyFieldsSelector.tsx`
- `components/workflows/ConfigurationFormWithAI.tsx`
- `components/workflows/CreateWorkflowDialog.tsx`
- `components/workflows/DiscordChannelSelector.tsx`
- `components/workflows/DiscordChannelsPreview.tsx`
- `components/workflows/DiscordMessagesPreview.tsx`
- `components/workflows/DiscordUserSelector.tsx`
- `components/workflows/DynamicFieldInputs.tsx`
- `components/workflows/DynamicFieldSelector.tsx`
- `components/workflows/EnhancedExecutionPanel.tsx`
- `components/workflows/ErrorNotificationPopup.tsx`
- `components/workflows/ExecutionHistory.tsx`
- `components/workflows/ExecutionHistoryModal.tsx`
- `components/workflows/ExecutionStatusPanel.tsx`
- `components/workflows/FacebookInsightsPreview.tsx`
- `components/workflows/GmailEmailsPreview.tsx`
- `components/workflows/InterceptedActionsDisplay.tsx`
- `components/workflows/LiveTestModeBanner.tsx`
- `components/workflows/NodePalette.tsx`
- `components/workflows/NotionDatabaseConfig.tsx`
- `components/workflows/NotionRecordsPreview.tsx`
- `components/workflows/NotionWebhookSetupModal.tsx`
- `components/workflows/OneNoteSelector.tsx`
- `components/workflows/PreflightCheckDialog.tsx`
- `components/workflows/TestModeConfigSelector.tsx`
- `components/workflows/TestModeDebugLog.tsx`
- `components/workflows/TestPanel.tsx`
- `components/workflows/TriggerOutputSelector.tsx`
- `components/workflows/WorkflowComments.tsx`
- `components/workflows/WorkflowDebugger.tsx`
- `components/workflows/WorkflowExecutions.tsx`
- `components/workflows/WorkflowResultsDisplay.tsx`
- `components/workflows/WorkflowShareButton.tsx`
- `components/workflows/WorkflowTagBadge.tsx`
- `components/workflows/WorkflowToolbar.tsx`
- `components/workflows/WorkflowVersionControl.tsx`
- `components/workflows/WorkspaceSelector.tsx`
- `components/workflows/ai-agent/AgentChatPanel.tsx`
- `components/workflows/ai-agent/BuildBadge.tsx`
- `components/workflows/ai-agent/CostDisplay.tsx`
- `components/workflows/ai-builder/AIAgentBuilderContent.tsx`
- `components/workflows/ai-builder/AIWorkflowBuilderChat.tsx`
- `components/workflows/ai-builder/ClarificationQuestion.tsx`
- `components/workflows/ai-builder/MissingIntegrationsBadges.tsx`
- `components/workflows/ai-builder/NodeConfigurationStatus.tsx`
- `components/workflows/ai-builder/PulsingPlaceholders.tsx`
- `components/workflows/ai-builder/StatusBadge.tsx`
- `components/workflows/ai-builder/WorkflowBuildProgress.tsx`
- `components/workflows/ai-builder/WorkflowPlan.tsx`
- `components/workflows/builder/AddNodeButton.tsx`
- `components/workflows/builder/AddNodeButtonsOverlay.tsx`
- `components/workflows/builder/WorkflowDiffDialog.tsx`
- `components/workflows/configuration/ConfigurationFormLazy.tsx`
- `components/workflows/configuration/LiveWebhookListener.tsx`
- `components/workflows/configuration/VariablePickerSidePanel.tsx`
- `components/workflows/configuration/components/FieldsWithTable.tsx`
- `components/workflows/configuration/components/discord/DiscordProgressiveConfig.tsx`
- `components/workflows/configuration/components/google-drive/GoogleDriveFilePreview.tsx`
- `components/workflows/configuration/debug-drag-drop.tsx`
- `components/workflows/configuration/fields/DiscordRichTextEditorOptimized.tsx`
- `components/workflows/configuration/fields/DiscordRichTextEditorSimple.tsx`
- `components/workflows/configuration/fields/EmailRichTextEditorLazy.tsx`
- `components/workflows/configuration/fields/GmailEmailRichTextEditor.tsx`
- `components/workflows/configuration/fields/GoogleMeetButton.tsx`
- `components/workflows/configuration/fields/OutlookEmailRichTextEditor.tsx`
- `components/workflows/configuration/fields/StorageServiceConnectionBanner.tsx`
- `components/workflows/configuration/fields/discord/DiscordMultiMessageSelector.tsx`
- `components/workflows/configuration/fields/discord/DiscordReactionRemover.tsx`
- `components/workflows/configuration/fields/discord/DiscordServerField.tsx`
- `components/workflows/configuration/fields/google-sheets/GoogleSheetsColumnSelector.tsx`
- `components/workflows/configuration/fields/google-sheets/GoogleSheetsConditionBuilder.tsx`
- `components/workflows/configuration/fields/google-sheets/GoogleSheetsFormatting.tsx`
- `components/workflows/configuration/hooks/useBubbleManagement.ts`
- `components/workflows/configuration/hooks/useFieldLabels.ts`
- `components/workflows/configuration/hooks/useFileFieldHandler.ts`
- `components/workflows/configuration/providers/AirtableConfigurationLazy.tsx`
- `components/workflows/configuration/providers/logic/FilterConfiguration.tsx`
- `components/workflows/configuration/providers/logic/PathConditionConfiguration.tsx`
- `components/workflows/configuration/types/configuration-props.ts`
- `components/workflows/configuration/utils/field-visibility.ts`
- `components/workflows/configuration/utils/requestManager.ts`
- `components/workflows/errors/TestErrorDialog.tsx`
- `components/workflows/execution/LoopProgressIndicator.tsx`
- `components/workflows/nodes/AIAgentNode.tsx`
- `components/workflows/nodes/AINodeIndicators.tsx`
- `components/workflows/settings/NotificationSettings.tsx`
- `components/workspace/WorkspaceSwitcher.tsx`
