import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/**
 * Optional override for the Chromium binary the browser suites launch.
 *
 * Playwright normally downloads the exact browser build it was released with.
 * In an environment that already ships a compatible Chromium and cannot or
 * should not download another, `MOTIF_CHROMIUM_EXECUTABLE` names that binary.
 * The variable is ignored unless it is an absolute path to an existing file,
 * so an unset or stale value falls back to Playwright's own browser.
 */
export function browserExecutablePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidate = env.MOTIF_CHROMIUM_EXECUTABLE?.trim();
  if (!candidate || !isAbsolute(candidate)) return undefined;
  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** `launchOptions` fragment that only sets `executablePath` when the override is valid. */
export function browserLaunchOverride(env: NodeJS.ProcessEnv = process.env): { executablePath?: string } {
  const executablePath = browserExecutablePath(env);
  return executablePath ? { executablePath } : {};
}
