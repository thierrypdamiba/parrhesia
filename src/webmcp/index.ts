// Public surface of the WebMCP layer (PLAN.md P5). Integration mounts:
//
//   const rail = useWebmcp(pageState, { navigate, onLetterChanged, onCall });
//   <ToolRail status={rail} />
//
// Everything else is exported for tests, the agents section (P6) and README generation.

export { ToolRail, EMPTY_RAIL_STATUS, modeBadge, type RailStatus } from './rail';
export { useWebmcp, type UseWebmcpOptions } from './useWebmcp';
export {
  PUBLIC_VIEW_TOOLS,
  buildExecutes,
  desiredTools,
  evaluateGates,
  specFor,
  staticSetFor,
  staticTools,
  titleFor,
  toolsNotNow,
  toolsNow,
  pushStateNavigate,
  type LetterRef,
  type PageState,
  type ToolAvailability,
  type ToolContext,
  type ToolExecutes,
} from './tools';
export { ToolRegistry, type RegistrySnapshot, type ToolSpec } from './registry';
export { ReadRanges, readCallFor, type Range } from './readRanges';
export {
  PROBE,
  detectMode,
  getModelContext,
  hostLabel,
  isChatGptHost,
  isTopLevelPage,
  readConfiguredMode,
  readNavigatorFacts,
  type ModelContextHost,
  type NavigatorFacts,
  type ToolMode,
  type ToolModeConfig,
} from './host';
export {
  CallLog,
  fitBudget,
  formatCall,
  isToolError,
  jsonLength,
  parseInput,
  preview,
  type CallLogEntry,
  type ToolError,
} from './guard';
export * from './schema';
