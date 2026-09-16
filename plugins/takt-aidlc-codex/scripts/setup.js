// @bun
// src/setup/cli.ts
import { resolve } from "path";
import { parseArgs } from "util";

// src/setup/project.ts
import { constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
function existing(path, kind) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat)
    return false;
  if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`\u901A\u5E38\u306E${kind === "file" ? "\u30D5\u30A1\u30A4\u30EB" : "\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA"}\u304C\u5FC5\u8981\u3067\u3059: ${path}`);
  }
  return true;
}
function checkBundle(root) {
  if (!existing(root, "directory"))
    throw new Error(`\u540C\u68B1TAKT\u5B9A\u7FA9\u304C\u3042\u308A\u307E\u305B\u3093: ${root}`);
  for (const name of readdirSync(root)) {
    const path = join(root, name), stat = lstatSync(path);
    if (stat.isDirectory())
      checkBundle(path);
    else
      existing(path, "file");
  }
}
function pluginHost(pluginRoot) {
  const codex = existsSync(join(pluginRoot, ".codex-plugin/plugin.json"));
  const claude = existsSync(join(pluginRoot, ".claude-plugin/plugin.json"));
  if (codex === claude)
    throw new Error("\u30DB\u30B9\u30C8\u3092\u7279\u5B9A\u3067\u304D\u307E\u305B\u3093\u3002\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB\u6E08\u307F\u30D7\u30E9\u30B0\u30A4\u30F3\u306Esetup.js\u3092\u4F7F\u3063\u3066\u304F\u3060\u3055\u3044");
  return codex ? "codex" : "claude";
}
function setupProject(projectPath, pluginRoot, options) {
  const project = realpathSync(projectPath);
  if (!existing(project, "directory"))
    throw new Error("\u5BFE\u8C61\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u304C\u3042\u308A\u307E\u305B\u3093");
  const hostHarness = pluginHost(pluginRoot);
  if (!["ja", "en"].includes(options.language) || !["code-generation", "construction"].includes(options.scope) || !["claude", "codex"].includes(options.provider)) {
    throw new Error("language\u30FBscope\u30FBprovider\u306E\u6307\u5B9A\u304C\u4E0D\u6B63\u3067\u3059");
  }
  const source = join(pluginRoot, "takt");
  checkBundle(source);
  for (const language of ["ja", "en"])
    for (const name of ["aidlc-code-generation-stage", "aidlc-construction-phase"]) {
      if (!existing(join(source, language, "workflows", `${name}.yaml`), "file"))
        throw new Error("\u540C\u68B1Workflow\u304C\u4E0D\u8DB3\u3057\u3066\u3044\u307E\u3059");
    }
  const aidlc = join(project, "aidlc"), base = join(aidlc, "takt-handoff");
  existing(aidlc, "directory");
  existing(base, "directory");
  const target = join(base, "takt"), configPath = join(base, "config.json");
  existing(target, "directory");
  existing(configPath, "file");
  mkdirSync(base, { recursive: true });
  const lock = join(base, ".setup.lock");
  mkdirSync(lock);
  let temporary;
  try {
    const keepTakt = existing(target, "directory"), keepConfig = existing(configPath, "file");
    const prefix = "aidlc/takt-handoff";
    const config = {
      enabled: false,
      hostHarness,
      language: options.language,
      delegationScope: options.scope,
      provider: options.provider,
      artifacts: [],
      sources: [],
      workflow: `${prefix}/takt/${options.language}/workflows/aidlc-code-generation-stage.yaml`,
      buildScript: `${prefix}/build.ts`,
      verifyScript: `${prefix}/test.ts`,
      sensorScripts: { "type-check": `${prefix}/typecheck.ts`, linter: `${prefix}/lint.ts` },
      timeoutMs: 1800000,
      ...options.scope === "construction" ? {
        constructionWorkflow: `${prefix}/takt/${options.language}/workflows/aidlc-construction-phase.yaml`,
        phaseBuildScript: `${prefix}/phase-build.ts`,
        phaseVerifyScript: `${prefix}/phase-test.ts`
      } : {}
    };
    temporary = mkdtempSync(join(base, ".setup-"));
    if (!keepTakt) {
      cpSync(source, join(temporary, "takt"), { recursive: true, errorOnExist: true, force: false });
      renameSync(join(temporary, "takt"), target);
    }
    if (!keepConfig) {
      writeFileSync(join(temporary, "config.json"), JSON.stringify(config, null, 2) + `
`);
      copyFileSync(join(temporary, "config.json"), configPath, constants.COPYFILE_EXCL);
    }
    return {
      project,
      takt: { path: target, action: keepTakt ? "preserved" : "created" },
      config: { path: configPath, action: keepConfig ? "preserved" : "created" },
      next: options.language === "ja" ? "\u65E2\u5B58\u30D5\u30A1\u30A4\u30EB\u306F\u4FDD\u6301\u3057\u307E\u3057\u305F\u3002config.json\u306E\u5165\u529B\u30FB\u30BD\u30FC\u30B9\u30FB\u30D3\u30EB\u30C9\uFF0F\u30C6\u30B9\u30C8\u30FB\u30BB\u30F3\u30B5\u30FC\u3092\u6574\u3048\u3001Workflow\u30D1\u30B9\u3068\u8A00\u8A9E\u3092\u78BA\u8A8D\u3057\u3066\u304B\u3089enabled\u3092true\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u521D\u671F\u8A2D\u5B9A\u306F\u65E2\u5B58TAKT\u5B9A\u7FA9\u306E\u66F4\u65B0\u3084\u65E2\u5B58\u8A2D\u5B9A\u306E\u5207\u66FF\u3092\u884C\u3044\u307E\u305B\u3093\u3002" : "Existing files are preserved. Configure inputs, sources, build/test scripts, and sensors; check workflow paths and language before setting enabled to true. Setup does not upgrade existing TAKT definitions or switch existing settings."
    };
  } finally {
    if (temporary)
      rmSync(temporary, { recursive: true, force: true });
    rmSync(lock, { recursive: true });
  }
}

// src/setup/cli.ts
try {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: false,
    options: {
      project: { type: "string", default: "." },
      language: { type: "string", default: "ja" },
      scope: { type: "string", default: "code-generation" },
      provider: { type: "string" },
      help: { type: "boolean", default: false }
    }
  });
  if (values.help) {
    console.log(`Usage: bun <plugin>/scripts/setup.js [--project PATH] [--language ja|en] [--scope code-generation|construction] [--provider claude|codex]

Defaults: current project, ja, code-generation; provider matches the installed host.
Copies bundled TAKT definitions and creates a disabled config. Existing definitions and config are preserved.`);
  } else {
    const pluginRoot = resolve(import.meta.dir, "..");
    const result = setupProject(values.project, pluginRoot, {
      language: values.language,
      scope: values.scope,
      provider: values.provider ?? pluginHost(pluginRoot)
    });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(String(error));
  process.exitCode = 2;
}
