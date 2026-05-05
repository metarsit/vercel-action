import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

async function getExecOutput(
  command: string,
  args: string[],
  options: exec.ExecOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await exec.exec(command, args, {
    ...options,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString();
      },
      stderr: (data: Buffer) => {
        stderr += data.toString();
      },
    },
    ignoreReturnCode: true,
  });
  return { stdout, stderr, exitCode };
}

function resolveSpec(version: string): string {
  const trimmed = version.trim();
  if (!trimmed || trimmed === "latest") {
    return "vercel@latest";
  }
  return `vercel@${trimmed}`;
}

async function findVercelBinary(): Promise<string | null> {
  try {
    return await io.which("vercel", true);
  } catch {
    return null;
  }
}

async function run(): Promise<void> {
  try {
    const version = core.getInput("vercel-version") || "latest";
    const workingDir = core.getInput("working-directory");

    const npmCmd = os.platform() === "win32" ? "npm.cmd" : "npm";
    const spec = resolveSpec(version);

    core.info(`Installing ${spec} globally via npm...`);
    const installCode = await exec.exec(npmCmd, [
      "install",
      "--global",
      "--no-fund",
      "--no-audit",
      spec,
    ]);
    if (installCode !== 0) {
      throw new Error(`npm install ${spec} exited with code ${installCode}`);
    }

    const vercelPath = await findVercelBinary();
    if (!vercelPath) {
      throw new Error("vercel binary not found on PATH after install");
    }

    core.addPath(path.dirname(vercelPath));

    const cwd =
      workingDir && fs.existsSync(workingDir) ? workingDir : process.cwd();
    const { stdout, exitCode } = await getExecOutput(
      vercelPath,
      ["--version"],
      { cwd },
    );
    if (exitCode !== 0) {
      throw new Error(`'vercel --version' failed with code ${exitCode}`);
    }

    const installedVersion = stdout.trim().split(/\s+/).pop() ?? stdout.trim();
    core.setOutput("vercel-version", installedVersion);
    core.setOutput("vercel-path", vercelPath);
    core.info(`Vercel CLI ${installedVersion} ready at ${vercelPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setFailed(message);
  }
}

void run();
