import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import * as fs from "node:fs";

type ExecResult = { stdout: string; stderr: string; exitCode: number };

async function execCapture(
  command: string,
  args: string[],
  options: exec.ExecOptions = {},
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  const exitCode = await exec.exec(command, args, {
    ...options,
    listeners: {
      stdout: (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        process.stdout.write(chunk);
      },
      stderr: (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        process.stderr.write(chunk);
      },
    },
    ignoreReturnCode: true,
    silent: true,
  });
  return { stdout, stderr, exitCode };
}

function parseBool(value: string, fallback: boolean): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}

function parseExtraArgs(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractDeploymentUrl(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const match = line.match(/https?:\/\/[^\s]+\.vercel\.app[^\s]*/);
    if (match) return match[0];
  }
  return null;
}

function extractInspectUrl(stderr: string): string | null {
  const match = stderr.match(/Inspect:\s+(https?:\/\/[^\s]+)/);
  return match ? match[1] : null;
}

function extractDeploymentId(inspectUrl: string | null): string | null {
  if (!inspectUrl) return null;
  const match = inspectUrl.match(/\/([a-zA-Z0-9]{20,})(?:[/?]|$)/);
  return match ? match[1] : null;
}

async function run(): Promise<void> {
  try {
    const token = core.getInput("vercel-token", { required: true });
    const orgId = core.getInput("vercel-org-id");
    const projectId = core.getInput("vercel-project-id");
    const isProd = parseBool(core.getInput("prod"), false);
    const usePrebuilt = parseBool(core.getInput("prebuilt"), true);
    const workingDirInput = core.getInput("working-directory");
    const envInput = core.getInput("environment").trim().toLowerCase();
    const scope = core.getInput("scope").trim();
    const buildExtra = parseExtraArgs(core.getInput("build-args"));
    const deployExtra = parseExtraArgs(core.getInput("deploy-args"));

    const cwd =
      workingDirInput && fs.existsSync(workingDirInput)
        ? workingDirInput
        : process.cwd();

    const vercelPath = await io.which("vercel", true).catch(() => {
      throw new Error(
        "Vercel CLI not found on PATH. Run 'metarsit/vercel-action@v1' before this step.",
      );
    });

    core.setSecret(token);

    const env: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    env.VERCEL_TOKEN = token;
    if (orgId) env.VERCEL_ORG_ID = orgId;
    if (projectId) env.VERCEL_PROJECT_ID = projectId;

    const sharedFlags = ["--token", token];
    if (scope) sharedFlags.push("--scope", scope);

    const environment = envInput || (isProd ? "production" : "preview");
    if (!["production", "preview", "development"].includes(environment)) {
      throw new Error(
        `Invalid environment '${environment}'. Use production, preview, or development.`,
      );
    }

    core.startGroup(`vercel pull (${environment})`);
    const pull = await execCapture(
      vercelPath,
      ["pull", "--yes", `--environment=${environment}`, ...sharedFlags],
      { cwd, env },
    );
    core.endGroup();
    if (pull.exitCode !== 0)
      throw new Error(`vercel pull failed (exit ${pull.exitCode})`);

    if (usePrebuilt) {
      core.startGroup("vercel build");
      const buildArgs = [
        "build",
        ...(isProd ? ["--prod"] : []),
        ...sharedFlags,
        ...buildExtra,
      ];
      const build = await execCapture(vercelPath, buildArgs, { cwd, env });
      core.endGroup();
      if (build.exitCode !== 0)
        throw new Error(`vercel build failed (exit ${build.exitCode})`);
    }

    core.startGroup("vercel deploy");
    const deployArgs = [
      "deploy",
      ...(usePrebuilt ? ["--prebuilt"] : []),
      ...(isProd ? ["--prod"] : []),
      ...sharedFlags,
      ...deployExtra,
    ];
    const deploy = await execCapture(vercelPath, deployArgs, { cwd, env });
    core.endGroup();
    if (deploy.exitCode !== 0)
      throw new Error(`vercel deploy failed (exit ${deploy.exitCode})`);

    const url = extractDeploymentUrl(deploy.stdout);
    const inspectUrl = extractInspectUrl(deploy.stderr);
    const deploymentId = extractDeploymentId(inspectUrl);

    if (!url) {
      core.warning("Could not parse deployment URL from CLI output.");
    }

    core.setOutput("preview-url", url ?? "");
    core.setOutput("inspect-url", inspectUrl ?? "");
    core.setOutput("deployment-id", deploymentId ?? "");

    if (url) core.info(`Deployment URL: ${url}`);
    if (inspectUrl) core.info(`Inspect URL: ${inspectUrl}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setFailed(message);
  }
}

void run();
