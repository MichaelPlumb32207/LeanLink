/**
 * Hold off macOS idle sleep for the lifetime of a long-running CLI script.
 * Spawns `caffeinate -i -w <our pid>` detached — it exits on its own the
 * moment the script does. Best-effort and macOS-only (no-op elsewhere).
 *
 * Limits: `-i` prevents *idle* sleep only. Closing the lid still sleeps the
 * machine (that needs external power + display, or a manual pmset override) —
 * chunked runners are resumable precisely because this can't be fully prevented.
 */
import { spawn } from 'child_process';

export function keepAwakeWhileRunning(label: string): void {
  if (process.platform !== 'darwin') return;
  try {
    const child = spawn('caffeinate', ['-i', '-w', String(process.pid)], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    console.log(
      `Keep-awake: idle sleep is off while ${label} runs (lid-close still sleeps — leave the lid open).`,
    );
  } catch {
    /* caffeinate missing — proceed without protection */
  }
}
