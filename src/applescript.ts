const DEFAULT_TIMEOUT = 10_000;

// Tyme's lastFetchedTaskRecord and fetchedTaskRecordIDs are app-global state
// and race across concurrent osascript processes. Serial execution is acceptable
// for a single-user local app.
// Known limitation: if an osascript process survives SIGKILL (kernel hang),
// its exec() never settles and the whole queue wedges until server restart.
let chain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

export class TymeAppleScriptError extends Error {
  constructor(
    message: string,
    public readonly script: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "TymeAppleScriptError";
  }
}

/**
 * Sanitize a string for safe interpolation into AppleScript/JXA scripts.
 * Prevents script injection by escaping backslashes, double quotes,
 * newlines, carriage returns, tabs, and stripping null bytes.
 */
export function sanitize(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\0/g, "");
}

async function exec(
  args: string[],
  timeout: number,
): Promise<string> {
  const proc = Bun.spawn(["osascript", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
    killTimer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, 2_000);
  }, timeout);

  try {
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (timedOut) {
      throw new TymeAppleScriptError(
        `Operation timed out after ${timeout}ms`,
        args.join(" "),
        "",
      );
    }

    if (exitCode !== 0) {
      const msg = stderr.trim();
      if (
        msg.includes("not running") ||
        msg.includes("Connection is invalid") ||
        // osascript puts the real error code at the very end of stderr;
        // anchoring avoids false positives on "(-600)" inside echoed user input
        /\(-6(00|09)\)$/.test(msg)
      ) {
        throw new TymeAppleScriptError(
          "Tyme is not running. Please launch Tyme first.",
          args.join(" "),
          msg,
        );
      }
      throw new TymeAppleScriptError(
        `AppleScript error: ${msg}`,
        args.join(" "),
        msg,
      );
    }

    return stdout.trim();
  } finally {
    clearTimeout(timer);
    if (killTimer !== undefined) {
      clearTimeout(killTimer);
    }
  }
}

export async function execAppleScript(
  script: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<string> {
  return withLock(() => exec(["-e", script], timeout));
}

export async function execJXA(
  script: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<string> {
  return withLock(() => exec(["-l", "JavaScript", "-e", script], timeout));
}

export type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function formatSuccess(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

export function formatError(error: unknown): McpToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
