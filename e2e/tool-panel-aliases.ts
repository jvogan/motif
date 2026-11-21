/**
 * Tool-opening helpers for the focused specs. The implementation lives in
 * `./tools-drawer`; this module re-exports it under the names those specs use,
 * so there is one implementation.
 *
 * `openTool`, `closeTool`, `openToolsDrawer` and `closeToolsDrawer` take the same
 * arguments here as there. `toolDetails` is `toolPanel` (a tool's `<details>`) and
 * `toolsButton` is `toolsDrawerButton` (the top-bar Tools toggle).
 */
export {
  closeTool,
  closeToolsDrawer,
  openTool,
  openToolsDrawer,
  toolPanel as toolDetails,
  toolsDrawerButton as toolsButton,
} from './tools-drawer';
