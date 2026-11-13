/**
 * Every Ukrainian namespace dictionary, keyed by the locale namespace string
 * its owner registers. Each dictionary keeps the ownerвЂ™s English keys and
 * falls back to English per key; see README.
 */

import { ukAccountNotifications } from './locales/account-notifications.ts'
import { ukActionCards } from './locales/action-cards.ts'
import { ukAgentTeam } from './locales/agent-team.ts'
import { ukApproval } from './locales/approval.ts'
import { ukChat } from './locales/chat.ts'
import { ukClaudeCodeMods } from './locales/claude-code-mods.ts'
import { ukCommand } from './locales/command.ts'
import { ukCommon } from './locales/common.ts'
import { ukContextMenu } from './locales/context-menu.ts'
import { ukConversation } from './locales/conversation.ts'
import { ukCordis } from './locales/cordis.ts'
import { ukCotTranslation } from './locales/cot-translation.ts'
import { ukCreationRecommendations } from './locales/creation-recommendations.ts'
import { ukCuaPermissions } from './locales/cua-permissions.ts'
import { ukDeliverables } from './locales/deliverables.ts'
import { ukDirectoryBrowser } from './locales/directory-browser.ts'
import { ukDocumentHtml } from './locales/document-html.ts'
import { ukDocumentMarkdown } from './locales/document-markdown.ts'
import { ukEntryCustomization } from './locales/entry-customization.ts'
import { ukFeedback } from './locales/feedback.ts'
import { ukFileActions } from './locales/file-actions.ts'
import { ukFileDrag } from './locales/file-drag.ts'
import { ukForgePanel } from './locales/forge-panel.ts'
import { ukGoal } from './locales/goal.ts'
import { ukInspectorPanel } from './locales/inspector-panel.ts'
import { ukJob } from './locales/job.ts'
import { ukLiveshare } from './locales/liveshare.ts'
import { ukMessageQuotes } from './locales/message-quotes.ts'
import { ukModel } from './locales/model.ts'
import { ukOpenInApp } from './locales/open-in-app.ts'
import { ukPermissionAccess } from './locales/permission-access.ts'
import { ukPlan } from './locales/plan.ts'
import { ukPluginManager } from './locales/plugin-manager.ts'
import { ukPluginMarket } from './locales/plugin-market.ts'
import { ukPluginRecommendations } from './locales/plugin-recommendations.ts'
import { ukQuestion } from './locales/question.ts'
import { ukReference } from './locales/reference.ts'
import { ukScheduleCatalog } from './locales/schedule-catalog.ts'
import { ukScheduleManager } from './locales/schedule-manager.ts'
import { ukSecretMask } from './locales/secret-mask.ts'
import { ukSessionInspector } from './locales/session-inspector.ts'
import { ukSessionLogDownload } from './locales/session-log-download.ts'
import { ukSettings } from './locales/settings.ts'
import { ukSettingsAccount } from './locales/settings-account.ts'
import { ukSettingsAgentLoop } from './locales/settings-agent-loop.ts'
import { ukSettingsAgentPreset } from './locales/settings-agent-preset.ts'
import { ukSettingsLocale } from './locales/settings-locale.ts'
import { ukSettingsModels } from './locales/settings-models.ts'
import { ukSettingsPermission } from './locales/settings-permission.ts'
import { ukSettingsPluginInventory } from './locales/settings-plugin-inventory.ts'
import { ukSettingsPlugins } from './locales/settings-plugins.ts'
import { ukSettingsSessionLog } from './locales/settings-session-log.ts'
import { ukSettingsShell } from './locales/settings-shell.ts'
import { ukSettingsSubagent } from './locales/settings-subagent.ts'
import { ukSettingsTheme } from './locales/settings-theme.ts'
import { ukSettingsWebSearch } from './locales/settings-web-search.ts'
import { ukShortcuts } from './locales/shortcuts.ts'
import { ukShortcutsLayout } from './locales/shortcuts-layout.ts'
import { ukSidebar } from './locales/sidebar.ts'
import { ukSidebarBrowser } from './locales/sidebar-browser.ts'
import { ukSidebarCodePreview } from './locales/sidebar-code-preview.ts'
import { ukSidebarDocumentPreview } from './locales/sidebar-document-preview.ts'
import { ukSidebarExcel } from './locales/sidebar-excel.ts'
import { ukSidebarFiles } from './locales/sidebar-files.ts'
import { ukSidebarImage } from './locales/sidebar-image.ts'
import { ukSidebarOffice } from './locales/sidebar-office.ts'
import { ukSidebarPdf } from './locales/sidebar-pdf.ts'
import { ukSidebarRight } from './locales/sidebar-right.ts'
import { ukSidebarTerminal } from './locales/sidebar-terminal.ts'
import { ukSkill } from './locales/skill.ts'
import { ukSkills } from './locales/skills.ts'
import { ukSlashMenu } from './locales/slash-menu.ts'
import { ukStats } from './locales/stats.ts'
import { ukSubagent } from './locales/subagent.ts'
import { ukTrajectory } from './locales/trajectory.ts'
import { ukVoiceInput } from './locales/voice-input.ts'
import { ukWorkMode } from './locales/work-mode.ts'
import { ukWorkflowRun } from './locales/workflow-run.ts'
import { ukWorkspace } from './locales/workspace.ts'

/** One translated namespace: keys identical to the owner's English dictionary. */
export type UkDictionary = Readonly<Record<string, string>>

/** Ukrainian dictionaries by locale namespace. */
export const UK_DICTIONARIES: Readonly<Record<string, UkDictionary>> = {
  'account.notifications': ukAccountNotifications,
  'actionCards': ukActionCards,
  'agent-team': ukAgentTeam,
  'approval': ukApproval,
  'chat': ukChat,
  'claude-code-mods': ukClaudeCodeMods,
  'command': ukCommand,
  'common': ukCommon,
  'contextMenu': ukContextMenu,
  'conversation': ukConversation,
  'cordis': ukCordis,
  'cotTranslation': ukCotTranslation,
  'creationRecommendations': ukCreationRecommendations,
  'cuaPermissions': ukCuaPermissions,
  'deliverables': ukDeliverables,
  'directory-browser': ukDirectoryBrowser,
  'documentHtml': ukDocumentHtml,
  'documentMarkdown': ukDocumentMarkdown,
  'entryCustomization': ukEntryCustomization,
  'feedback': ukFeedback,
  'fileActions': ukFileActions,
  'fileDrag': ukFileDrag,
  'forgePanel': ukForgePanel,
  'goal': ukGoal,
  'inspectorPanel': ukInspectorPanel,
  'job': ukJob,
  'liveshare': ukLiveshare,
  'messageQuotes': ukMessageQuotes,
  'model': ukModel,
  'open-in-app': ukOpenInApp,
  'permission.access': ukPermissionAccess,
  'plan': ukPlan,
  'pluginManager': ukPluginManager,
  'pluginMarket': ukPluginMarket,
  'pluginRecommendations': ukPluginRecommendations,
  'question': ukQuestion,
  'reference': ukReference,
  'schedule.catalog': ukScheduleCatalog,
  'schedule.manager': ukScheduleManager,
  'secretMask': ukSecretMask,
  'session-inspector': ukSessionInspector,
  'session-log-download': ukSessionLogDownload,
  'settings': ukSettings,
  'settings.account': ukSettingsAccount,
  'settings.agentLoop': ukSettingsAgentLoop,
  'settings.agentPreset': ukSettingsAgentPreset,
  'settings.locale': ukSettingsLocale,
  'settings.models': ukSettingsModels,
  'settings.permission': ukSettingsPermission,
  'settings.pluginInventory': ukSettingsPluginInventory,
  'settings.plugins': ukSettingsPlugins,
  'settings.sessionLog': ukSettingsSessionLog,
  'settings.shell': ukSettingsShell,
  'settings.subagent': ukSettingsSubagent,
  'settings.theme': ukSettingsTheme,
  'settings.webSearch': ukSettingsWebSearch,
  'shortcuts': ukShortcuts,
  'shortcuts.layout': ukShortcutsLayout,
  'sidebar': ukSidebar,
  'sidebarBrowser': ukSidebarBrowser,
  'sidebarCodePreview': ukSidebarCodePreview,
  'sidebarDocumentPreview': ukSidebarDocumentPreview,
  'sidebarExcel': ukSidebarExcel,
  'sidebarFiles': ukSidebarFiles,
  'sidebarImage': ukSidebarImage,
  'sidebarOffice': ukSidebarOffice,
  'sidebarPdf': ukSidebarPdf,
  'sidebarRight': ukSidebarRight,
  'sidebarTerminal': ukSidebarTerminal,
  'skill': ukSkill,
  'skills': ukSkills,
  'slash.menu': ukSlashMenu,
  'stats': ukStats,
  'subagent': ukSubagent,
  'trajectory': ukTrajectory,
  'voice-input': ukVoiceInput,
  'workMode': ukWorkMode,
  'workflowRun': ukWorkflowRun,
  'workspace': ukWorkspace,
}
