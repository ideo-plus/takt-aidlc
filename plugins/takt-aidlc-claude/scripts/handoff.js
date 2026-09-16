// @bun
// src/handoff/cli.ts
import { spawn as spawn4 } from "child_process";
import { closeSync as closeSync5, openSync as openSync5, realpathSync as realpathSync6 } from "fs";
import { join as join14 } from "path";

// src/handoff/bridge.ts
import { chmodSync as chmodSync2, closeSync as closeSync2, copyFileSync as copyFileSync3, existsSync as existsSync2, mkdirSync as mkdirSync5, openSync as openSync2, readFileSync as readFileSync5, realpathSync as realpathSync3, unlinkSync, writeFileSync as writeFileSync3 } from "fs";
import { dirname as dirname4, join as join5, relative as relative3 } from "path";
import { pathToFileURL } from "url";

// src/handoff/io.ts
import { createHash } from "crypto";
import { openSync, closeSync, writeSync, mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, realpathSync } from "fs";
import { dirname, isAbsolute, join, sep } from "path";
import { spawn } from "child_process";
import { StringDecoder } from "string_decoder";
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + `
`, { mode: 384 });
  renameSync(temporary, path);
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function fileInside(root, path) {
  if (isAbsolute(path) || path.split(/[\\/]/).some((p) => p === ".." || p === "." || !p))
    throw new Error(`\u4E0D\u6B63\u306A\u76F8\u5BFE\u30D1\u30B9: ${path}`);
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new Error(`\u30B7\u30F3\u30DC\u30EA\u30C3\u30AF\u30EA\u30F3\u30AF\u306F\u5BFE\u8C61\u5916: ${path}`);
  }
  const resolved = realpathSync(current);
  if (!resolved.startsWith(realpathSync(root) + sep) || !lstatSync(resolved).isFile())
    throw new Error(`\u901A\u5E38\u30D5\u30A1\u30A4\u30EB\u304C\u5FC5\u8981: ${path}`);
  return resolved;
}
function snapshot(root, paths) {
  return Object.fromEntries([...new Set(paths)].sort().map((path) => [path, digest(readFileSync(fileInside(root, path)))]));
}
function unchanged(root, expected) {
  const actual = snapshot(root, Object.keys(expected));
  if (Object.keys(expected).some((path) => actual[path] !== expected[path]))
    throw new Error("\u5165\u529B\u304C\u5909\u5316\u3057\u307E\u3057\u305F\u3002\u518D\u627F\u8A8D\u5F8C\u306B\u65B0\u3057\u3044\u5F15\u304D\u7D99\u304E\u304C\u5FC5\u8981\u3067\u3059");
}
function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(AIDLC_|AWS_AIDLC_|TAKT_|CLAUDE_PROJECT_DIR$|CLAUDECODE$|GIT_DIR$|GIT_WORK_TREE$|GIT_INDEX_FILE$)/.test(key)));
}
function withoutBedrock(env) {
  const result = { ...env };
  delete result.CLAUDE_CODE_USE_BEDROCK;
  for (const [key, value] of Object.entries(result)) {
    const modelSetting = key === "ANTHROPIC_MODEL" || /^ANTHROPIC_DEFAULT_.+_MODEL$/.test(key);
    if (modelSetting && value && /^(?:[^.\s]+\.)?anthropic\.|^arn:[^:]+:bedrock:/.test(value))
      delete result[key];
  }
  return result;
}
function quote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
async function command(argv, cwd, env, timeoutMs, options = {}) {
  return new Promise((resolve, reject) => {
    let outFd, errFd;
    const stdoutFile = options.outputPrefix ? options.outputPrefix + ".stdout.log" : undefined;
    const stderrFile = options.outputPrefix ? options.outputPrefix + ".stderr.log" : undefined;
    const closeFiles = () => {
      if (outFd !== undefined) {
        closeSync(outFd);
        outFd = undefined;
      }
      if (errFd !== undefined) {
        closeSync(errFd);
        errFd = undefined;
      }
    };
    try {
      if (stdoutFile && stderrFile) {
        mkdirSync(dirname(stdoutFile), { recursive: true });
        outFd = openSync(stdoutFile, "w", 384);
        errFd = openSync(stderrFile, "w", 384);
      }
    } catch (e) {
      closeFiles();
      reject(e);
      return;
    }
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false, outputLimitExceeded = false, outputTruncated = false, bytes = 0;
    const outDecoder = new StringDecoder("utf8"), errDecoder = new StringDecoder("utf8");
    const captureLimit = options.outputPrefix ? 64000 : 2000000;
    const stop = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const capture = (which, value) => {
      try {
        bytes += value.length;
        if (options.outputPrefix && bytes > 1e8) {
          outputLimitExceeded = true;
          stop();
          return;
        }
        const fd = which === "stdout" ? outFd : errFd;
        if (fd !== undefined) {
          let n = 0;
          while (n < value.length)
            n += writeSync(fd, value, n);
        }
        const text = (which === "stdout" ? outDecoder : errDecoder).write(value);
        let buffer = (which === "stdout" ? stdout : stderr) + text;
        if (buffer.length > captureLimit) {
          if (options.outputPrefix) {
            outputTruncated = true;
            buffer = buffer.slice(-captureLimit);
          } else {
            outputLimitExceeded = true;
            buffer = buffer.slice(-captureLimit);
            stop();
          }
        }
        if (which === "stdout")
          stdout = buffer;
        else
          stderr = buffer;
      } catch (e) {
        clearTimeout(timer);
        stop();
        reject(e);
      }
    };
    child.stdout.on("data", (value) => capture("stdout", value));
    child.stderr.on("data", (value) => capture("stderr", value));
    child.on("error", (error) => {
      clearTimeout(timer);
      closeFiles();
      reject(error);
    });
    let closed = false, outEnded = false, errEnded = false, exitCode = null;
    const finish = () => {
      if (!closed || !outEnded || !errEnded)
        return;
      clearTimeout(timer);
      closeFiles();
      stdout += outDecoder.end();
      stderr += errDecoder.end();
      resolve({ code: exitCode, timedOut, stdout, stderr, ...outputLimitExceeded ? { outputLimitExceeded } : {}, ...stdoutFile ? { stdoutFile, stderrFile, outputTruncated } : {} });
    };
    child.stdout.on("end", () => {
      outEnded = true;
      finish();
    });
    child.stderr.on("end", () => {
      errEnded = true;
      finish();
    });
    child.on("close", (code) => {
      closed = true;
      exitCode = code;
      finish();
    });
  });
}
function requireSuccess(result) {
  if (result.code !== 0 || result.timedOut || result.outputLimitExceeded) {
    const reason = result.timedOut ? "\u6642\u9593\u4E0A\u9650" : result.outputLimitExceeded ? "\u51FA\u529B\u4E0A\u9650" : `\u7D42\u4E86\u30B3\u30FC\u30C9 ${result.code}`;
    throw new Error(`\u30B3\u30DE\u30F3\u30C9\u5931\u6557 (${reason}): ${(result.stderr || result.stdout).slice(-8000)}${result.stdoutFile ? `
\u5B8C\u5168\u306A\u30ED\u30B0: ` + result.stdoutFile : ""}`);
  }
}

// src/hosts/harness.ts
function hostHarness(value) {
  if (value === undefined)
    return "claude";
  if (value !== "claude" && value !== "codex")
    throw new Error("hostHarness\u306Fclaude\u307E\u305F\u306Fcodex\u3067\u3059");
  return value;
}
function harnessDirectory(host) {
  return host === "codex" ? ".codex" : ".claude";
}
function delegationScope(config) {
  if (config.delegationScope !== undefined && !["code-generation", "construction"].includes(String(config.delegationScope)))
    throw new Error("delegationScope\u306Fcode-generation\u307E\u305F\u306Fconstruction\u3067\u3059");
  if (config.delegationScope && config.handoffStage && config.delegationScope !== config.handoffStage)
    throw new Error("\u59D4\u8B72\u7BC4\u56F2\u306E\u8A2D\u5B9A\u304C\u7AF6\u5408\u3057\u3066\u3044\u307E\u3059");
  return config.delegationScope ?? config.handoffStage;
}

// src/construction/runtime.ts
import { chmodSync, copyFileSync, mkdirSync as mkdirSync3, readFileSync as readFileSync3 } from "fs";
import { join as join3 } from "path";

// src/construction/construction-gate.ts
import assert from "assert/strict";
import { createHash as createHash2 } from "crypto";
import { existsSync, lstatSync as lstatSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync, realpathSync as realpathSync2, writeFileSync as writeFileSync2 } from "fs";
import { dirname as dirname2, join as join2, relative } from "path";
var hash = (value) => createHash2("sha256").update(value).digest("hex");
function sourceHash(workspace) {
  const files = {};
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join2(dir, entry.name), rel = relative(workspace, path);
      if (/^(?:\.git|\.claude|\.takt|construction|coverage|\.handoff-coverage-[^/]+)(?:\/|$)/.test(rel))
        continue;
      assert.ok(!entry.isSymbolicLink(), `symlink\u306F\u691C\u8A3C\u5BFE\u8C61\u306B\u3067\u304D\u307E\u305B\u3093: ${rel}`);
      if (entry.isDirectory())
        visit(path);
      else if (entry.isFile())
        files[rel] = hash(readFileSync2(path));
    }
  }
  visit(workspace);
  return hash(JSON.stringify(files));
}
if (false) {}

// src/construction/runtime.ts
function prepareConstruction(attempt, workspace, verifyScript, inputs) {
  const control = join3(attempt, "control");
  mkdirSync3(control, { recursive: true });
  const gate = join3(control, "construction-gate.ts");
  copyFileSync(join3(import.meta.dir, "construction-gate.ts"), gate);
  chmodSync(gate, 292);
  writeJson(join3(control, "context.json"), {
    workspace,
    verifyScript,
    verifyHash: digest(readFileSync3(verifyScript)),
    inputs,
    initialSourceHash: sourceHash(workspace)
  });
  return gate;
}

// src/takt/workflow.ts
import { copyFileSync as copyFileSync2, mkdirSync as mkdirSync4, readFileSync as readFileSync4 } from "fs";
import { basename, dirname as dirname3, isAbsolute as isAbsolute2, join as join4, relative as relative2, resolve } from "path";
var sections = ["personas", "policies", "knowledge", "instructions", "report_formats"];
function readWorkflow(root, path) {
  const workflow = Bun.YAML.parse(readFileSync4(fileInside(root, path), "utf8"));
  if (!workflow || typeof workflow !== "object" || !Array.isArray(workflow.steps))
    throw new Error(`TAKT Workflow\u304C\u4E0D\u6B63\u3067\u3059: ${path}`);
  const facets = [];
  for (const section of sections) {
    const declarations = workflow[section];
    if (declarations === undefined)
      continue;
    if (!declarations || typeof declarations !== "object" || Array.isArray(declarations))
      throw new Error(`TAKT\u306E${section}\u5BA3\u8A00\u304C\u4E0D\u6B63\u3067\u3059`);
    for (const [alias, reference] of Object.entries(declarations)) {
      if (typeof reference !== "string")
        throw new Error(`TAKT facet\u306F\u6587\u5B57\u5217\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044: ${section}.${alias}`);
      if (!reference.endsWith(".md") || reference.includes(`
`))
        continue;
      if (isAbsolute2(reference))
        throw new Error(`TAKT facet\u306F\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u5185\u306E\u76F8\u5BFE\u30D1\u30B9\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044: ${reference}`);
      const facetPath = relative2(resolve(root), resolve(root, dirname3(path), reference));
      const body = readFileSync4(fileInside(root, facetPath), "utf8");
      if (/\{(?:include|extends):/.test(body))
        throw new Error(`TAKT facet\u306Finclude/extends\u3092\u5C55\u958B\u3057\u305F\u5358\u4E00\u30D5\u30A1\u30A4\u30EB\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044: ${facetPath}`);
      facets.push({ section, alias, path: facetPath });
    }
  }
  return { workflow, facets };
}
function workflowFiles(root, path) {
  return [...new Set([path, ...readWorkflow(root, path).facets.map((facet) => facet.path)])];
}
function materializeWorkflow(root, path, control) {
  const { workflow, facets } = readWorkflow(root, path);
  const controlFiles = [];
  for (const facet of facets) {
    const target = `facets/${facet.section}/${digest(facet.path).slice(0, 12)}-${basename(facet.path)}`;
    mkdirSync4(dirname3(join4(control, target)), { recursive: true });
    copyFileSync2(fileInside(root, facet.path), join4(control, target));
    workflow[facet.section][facet.alias] = `./${target}`;
    controlFiles.push(target);
  }
  return { workflow, controlFiles: [...new Set(controlFiles)] };
}

// src/handoff/bridge.ts
function storage(project) {
  const native = join5(project, "aidlc/takt-handoff");
  const legacy = join5(project, ".takt-aidlc");
  if (existsSync2(join5(native, "config.json")) && existsSync2(join5(legacy, "config.json")))
    throw new Error("\u9023\u643A\u8A2D\u5B9A\u306E\u4FDD\u5B58\u5148\u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059");
  return existsSync2(join5(native, "config.json")) ? native : legacy;
}
function handoffEnabled(project) {
  const path = join5(storage(project), "config.json");
  return existsSync2(path) && readJson(fileInside(project, relative3(project, path))).enabled === true;
}
function configuration(project) {
  const path = fileInside(project, relative3(project, join5(storage(project), "config.json")));
  const c = readJson(path);
  if (c.enabled !== true || !["mock", "claude"].includes(c.provider) || !Number.isInteger(c.timeoutMs) || c.timeoutMs < 1000 || c.timeoutMs > (c.construction === true ? 3600000 : 300000))
    throw new Error("\u672A\u5BFE\u5FDC\u307E\u305F\u306F\u7121\u52B9\u306A\u8A2D\u5B9A\u3067\u3059");
  if (c.disableBedrock !== undefined && typeof c.disableBedrock !== "boolean")
    throw new Error("disableBedrock\u306Fboolean\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
  if (c.construction !== undefined && typeof c.construction !== "boolean")
    throw new Error("construction\u306Fboolean\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
  for (const paths2 of [c.artifacts, c.sources])
    if (!Array.isArray(paths2) || !paths2.length || paths2.some((p) => typeof p !== "string"))
      throw new Error("\u5165\u529B\u30D5\u30A1\u30A4\u30EB\u4E00\u89A7\u304C\u5FC5\u8981\u3067\u3059");
  if (typeof c.verifyScript !== "string" || !c.verifyScript)
    throw new Error("\u72EC\u7ACB\u3057\u305F\u691C\u8A3C\u30B9\u30AF\u30EA\u30D7\u30C8\u304C\u5FC5\u8981\u3067\u3059");
  for (const path2 of c.sources)
    if (/^(?:\.git|\.claude|\.codex|\.agents|\.takt|\.takt-aidlc|aidlc|input)(?:\/|$)/.test(path2))
      throw new Error(`\u5236\u5FA1\u8A2D\u5B9A\u3092\u30BD\u30FC\u30B9\u3068\u3057\u3066\u30B3\u30D4\u30FC\u3067\u304D\u307E\u305B\u3093: ${path2}`);
  if (c.construction && c.sources.some((path2) => /^(?:construction|coverage|\.handoff-coverage-[^/]+)(?:\/|$)/.test(path2)))
    throw new Error("Construction\u306E\u51FA\u529B\u5148\u3092\u30BD\u30FC\u30B9\u3068\u3057\u3066\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093");
  const paths = [...c.artifacts, ...c.sources, ...workflowFiles(project, c.workflow), c.verifyScript, ...c.mockScenario ? [c.mockScenario] : []];
  const files = snapshot(project, paths);
  return { c, files, configHash: digest(readFileSync5(path)) };
}
function approvalCommand(commandText, project) {
  const tokens = [];
  let offset = 0;
  const token = /\s*(?:'([^']*)'|"([^"$`\\]*)"|([^\s'"\\;&|<>`$()]+))/y;
  while (offset < commandText.trimEnd().length) {
    if (offset > 0 && !/\s/.test(commandText[offset]))
      return false;
    token.lastIndex = offset;
    const match = token.exec(commandText);
    if (!match)
      return false;
    tokens.push(match[1] ?? match[2] ?? match[3]);
    offset = token.lastIndex;
  }
  let args;
  if (tokens.slice(0, 4).join(" ") === "aidlc engine orchestrate report")
    args = tokens.slice(4);
  else if (["bun", process.execPath].includes(tokens[0]) && [".claude/tools/aidlc-orchestrate.ts", join5(project, ".claude/tools/aidlc-orchestrate.ts")].includes(tokens[1]) && tokens[2] === "report")
    args = tokens.slice(3);
  else if (["bun", process.execPath].includes(tokens[0]) && [".claude/tools/aidlc.ts", join5(project, ".claude/tools/aidlc.ts")].includes(tokens[1]) && tokens.slice(2, 5).join(" ") === "engine orchestrate report")
    args = tokens.slice(5);
  else
    return false;
  const flags = new Map;
  for (let i = 0;i < args.length; i += 2) {
    if (!["--stage", "--result", "--user-input", "--project-dir"].includes(args[i]) || args[i + 1] === undefined || flags.has(args[i]))
      return false;
    flags.set(args[i], args[i + 1]);
  }
  if (flags.has("--project-dir") && flags.get("--project-dir") !== project)
    return false;
  return flags.get("--stage") === "delivery-planning" && flags.get("--result") === "approved";
}
function approvalCommandIssue(commandText, project) {
  if (approvalCommand(commandText, project))
    return null;
  const hasApproval = commandText.split(/[;&|\n]/).some((part) => approvalCommand(part.replace(/\s+\d*[<>][\s\S]*$/, "").trim(), project));
  if (!hasApproval)
    return null;
  return 'TAKT\u9023\u643A\u306E\u6700\u7D42\u627F\u8A8D\u306F\u3001aidlc engine orchestrate report --stage delivery-planning --result approved --user-input "Approve" \u306E\u5358\u4E00\u30B3\u30DE\u30F3\u30C9\u3067\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u30EA\u30C0\u30A4\u30EC\u30AF\u30C8\u30FBecho\u30FB\u9023\u7D50\u30B3\u30DE\u30F3\u30C9\u30FB\u8FFD\u52A0\u30AA\u30D7\u30B7\u30E7\u30F3\u306F\u4ED8\u3051\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002\u3053\u306E\u8981\u6C42\u306F\u307E\u3060\u5B9F\u884C\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u540C\u3058\u627F\u8A8D\u306B\u57FA\u3065\u3044\u3066\u30B3\u30DE\u30F3\u30C9\u5F62\u5F0F\u3092\u76F4\u3057\u3001\u518D\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002';
}
async function engineLibrary(project, host = "claude") {
  const version = await import(pathToFileURL(fileInside(project, `${harnessDirectory(host)}/tools/aidlc-version.ts`)).href);
  if (version.AIDLC_VERSION !== "2.8.2")
    throw new Error("\u3053\u306EPoC\u306FAI-DLC v2.8.2\u5C02\u7528\u3067\u3059");
  return import(pathToFileURL(fileInside(project, `${harnessDirectory(host)}/tools/aidlc-lib.ts`)).href);
}
async function approvedBoundary(project, host = "claude") {
  const lib = await engineLibrary(project, host);
  const statePath = lib.stateFilePath(project);
  const state = readFileSync5(statePath, "utf8");
  if (lib.getField(state, "State Version") !== "8")
    throw new Error("AI-DLC v2.8.2\u306EState Version 8\u3060\u3051\u306B\u5BFE\u5FDC\u3057\u3066\u3044\u307E\u3059");
  if (lib.getField(state, "Status") !== "Running")
    throw new Error("\u5B9F\u884C\u4E2D\u306EIntent\u3060\u3051\u3092\u5F15\u304D\u7D99\u3052\u307E\u3059");
  const checks = lib.parseCheckboxes(state);
  const graph = lib.loadStageGraph();
  const inception = graph.filter((s) => s.phase === "inception");
  if (!inception.length || inception.some((s) => !checks.some((c) => c.slug === s.slug && ["completed", "skipped"].includes(c.state))))
    throw new Error("Inception\u306B\u672A\u5B8C\u4E86\u307E\u305F\u306F\u672A\u8A18\u9332\u306E\u5DE5\u7A0B\u304C\u3042\u308A\u307E\u3059");
  if (!checks.some((c) => c.slug === "delivery-planning" && c.state === "completed"))
    throw new Error("Delivery Planning\u306E\u5B8C\u4E86\u304C\u5FC5\u8981\u3067\u3059");
  const construction = new Set(graph.filter((s) => s.phase === "construction").map((s) => s.slug));
  if (checks.some((c) => construction.has(c.slug) && ["completed", "awaiting-approval", "revising"].includes(c.state)))
    throw new Error("Construction\u306E\u4F5C\u696D\u304C\u65E2\u306B\u9032\u3093\u3067\u3044\u307E\u3059");
  const current = lib.getField(state, "Current Stage");
  if (!graph.some((s) => s.slug === current && s.phase === "construction"))
    throw new Error("Construction\u958B\u59CB\u524D\u306E\u5883\u754C\u3067\u306F\u3042\u308A\u307E\u305B\u3093");
  if (lib.getField(state, "Construction Autonomy Mode") === "autonomous")
    throw new Error("AI-DLC\u306E\u81EA\u5F8BConstruction\u306F\u5F15\u304D\u7D99\u3052\u307E\u305B\u3093");
  const rows = lib.readAuditShardEvents(project);
  if (!rows.length)
    throw new Error("\u73FE\u5728\u306EDelivery Planning\u306B\u5BFE\u5FDC\u3059\u308B\u627F\u8A8D\u30FB\u5B8C\u4E86\u8A18\u9332\u304C\u3042\u308A\u307E\u305B\u3093");
  if (new Set(rows.map((r) => r.shard)).size !== 1)
    throw new Error("\u5358\u4E00\u76E3\u67FB\u30B7\u30E3\u30FC\u30C9\u306EIntent\u3060\u3051\u306B\u5BFE\u5FDC\u3057\u3066\u3044\u307E\u3059");
  const relevant = rows.filter((r) => r.event === "WORKFLOW_STARTED" || lib.auditBlockField(r.block, "Stage") === "delivery-planning");
  const completed = relevant.findLast((r) => r.event === "STAGE_COMPLETED");
  const approval = relevant.findLast((r) => ["WORKFLOW_STARTED", "GATE_APPROVED", "GATE_REJECTED", "STAGE_JUMPED", "STAGE_STARTED"].includes(r.event));
  if (!approval || approval.event !== "GATE_APPROVED" || !completed || completed.pos <= approval.pos)
    throw new Error("\u73FE\u5728\u306EDelivery Planning\u306B\u5BFE\u5FDC\u3059\u308B\u627F\u8A8D\u30FB\u5B8C\u4E86\u8A18\u9332\u304C\u3042\u308A\u307E\u305B\u3093");
  return { statePath, record: relative3(project, dirname4(statePath)), approval: digest(approval.block), current };
}
function pendingPath(project, e) {
  if (!e.session_id || !e.tool_use_id)
    throw new Error("session_id\u3068tool_use_id\u304C\u5FC5\u8981\u3067\u3059");
  if (realpathSync3(e.cwd) !== realpathSync3(project))
    throw new Error("\u30A4\u30D9\u30F3\u30C8\u306E\u4F5C\u696D\u9818\u57DF\u304C\u4E00\u81F4\u3057\u307E\u305B\u3093");
  return join5(storage(project), "pending", digest(e.session_id + ":" + e.tool_use_id) + ".json");
}
function withLock(path, fn) {
  mkdirSync5(dirname4(path), { recursive: true });
  const fd = openSync2(path, "wx", 384);
  writeFileSync3(fd, String(process.pid));
  closeSync2(fd);
  return fn().finally(() => unlinkSync(path));
}
function captureApproval(project, e) {
  if (!handoffEnabled(project))
    return false;
  const issue = approvalCommandIssue(e.tool_input.command ?? "", project);
  if (issue)
    throw new Error(issue);
  if (!approvalCommand(e.tool_input.command ?? "", project))
    return false;
  const { files, configHash } = configuration(project);
  writeJson(pendingPath(project, e), { files, configHash });
  return true;
}
async function prepareHandoff(project, e) {
  if (!approvalCommand(e.tool_input.command ?? "", project) || !handoffEnabled(project))
    return null;
  const response = e.tool_response;
  if (response?.interrupted || typeof response?.stdout !== "string")
    throw new Error("\u627F\u8A8D\u30B3\u30DE\u30F3\u30C9\u306Estdout\u304C\u3042\u308A\u307E\u305B\u3093");
  const directive = JSON.parse(response.stdout);
  if (!["done", "run-stage", "load-steering", "parked"].includes(directive.kind))
    throw new Error(`\u627F\u8A8D\u51E6\u7406\u304C\u6210\u529F\u3057\u3066\u3044\u307E\u305B\u3093: ${directive.kind}`);
  const pending = readJson(pendingPath(project, e));
  return withLock(join5(storage(project), "prepare.lock"), async () => {
    const { c, configHash } = configuration(project);
    if (configHash !== pending.configHash)
      throw new Error("\u627F\u8A8D\u4E2D\u306B\u9023\u643A\u8A2D\u5B9A\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
    unchanged(project, pending.files);
    const boundary = await approvedBoundary(project);
    if (c.artifacts.some((p) => !p.startsWith(boundary.record + "/inception/")))
      throw new Error("\u6210\u679C\u7269\u306F\u73FE\u5728\u306EIntent\u306EInception\u5185\u306B\u9650\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
    const id = digest(boundary.record + ":" + boundary.approval).slice(0, 24);
    const run = join5(storage(project), "runs", id);
    const manifestPath = join5(run, "manifest.json");
    if (existsSync2(manifestPath)) {
      const previous = readJson(manifestPath);
      if (previous.configHash !== configHash || JSON.stringify(previous.files) !== JSON.stringify(pending.files))
        throw new Error("\u540C\u3058\u627F\u8A8D\u306B\u5BFE\u3059\u308B\u4F9D\u983C\u5185\u5BB9\u304C\u5909\u308F\u3063\u3066\u3044\u307E\u3059");
    } else {
      mkdirSync5(run, { recursive: true });
      for (const path of Object.keys(pending.files)) {
        const target = join5(run, "snapshot", path);
        mkdirSync5(dirname4(target), { recursive: true });
        copyFileSync3(fileInside(project, path), target);
        chmodSync2(target, 292);
      }
      unchanged(join5(run, "snapshot"), pending.files);
      writeJson(manifestPath, { ...pending, ...boundary, id, config: c });
      writeJson(join5(run, "status.json"), { state: "prepared", attempts: 0 });
    }
    const status = readJson(join5(run, "status.json"));
    if (status.state === "prepared") {
      const env = { ...cleanEnvironment(), AIDLC_PROJECT_DIR: project, CLAUDE_PROJECT_DIR: project };
      const version = await command(["aidlc", "--version"], project, env, 1e4);
      requireSuccess(version);
      if (!/^aidlc 2\.8\.2\b/.test(version.stdout))
        throw new Error("aidlc\u30B3\u30DE\u30F3\u30C9\u30822.8.2\u306B\u305D\u308D\u3048\u3066\u304F\u3060\u3055\u3044");
      const result = await command(["aidlc", "engine", "orchestrate", "park", "--project-dir", project], project, env, 1e4);
      writeJson(join5(run, "park.json"), result);
      requireSuccess(result);
      if (JSON.parse(result.stdout).kind !== "parked")
        throw new Error("park\u304C\u62D2\u5426\u3055\u308C\u307E\u3057\u305F\u3002TAKT\u3092\u8D77\u52D5\u3057\u307E\u305B\u3093");
      status.state = "parked";
      status.parkStateHash = digest(readFileSync5(boundary.statePath));
      writeJson(join5(run, "status.json"), status);
    }
    return { id, run, status: readJson(join5(run, "status.json")) };
  });
}
async function executeHandoff(project, id, retry = false) {
  if (!/^[a-f0-9]{24}$/.test(id))
    throw new Error("\u4E0D\u6B63\u306Arun ID\u3067\u3059");
  const run = join5(storage(project), "runs", id);
  return withLock(join5(run, "execute.lock"), async () => {
    const statusPath = join5(run, "status.json");
    const status = readJson(statusPath);
    if (status.state === "verified")
      return status;
    if (status.state !== "parked" && !(retry && status.state === "failed"))
      throw new Error(`\u5B9F\u884C\u3067\u304D\u306A\u3044\u72B6\u614B\u3067\u3059: ${status.state}`);
    const m = readJson(join5(run, "manifest.json"));
    const c = m.config;
    try {
      const { configHash } = configuration(project);
      if (configHash !== m.configHash)
        throw new Error("\u9023\u643A\u8A2D\u5B9A\u304C\u5909\u66F4\u3055\u308C\u3066\u3044\u307E\u3059");
      unchanged(project, m.files);
      unchanged(join5(run, "snapshot"), m.files);
      const boundary = await approvedBoundary(project);
      if (boundary.approval !== m.approval || boundary.record !== m.record)
        throw new Error("\u627F\u8A8D\u5BFE\u8C61\u304C\u5909\u308F\u3063\u3066\u3044\u307E\u3059");
      if (digest(readFileSync5(boundary.statePath)) !== status.parkStateHash)
        throw new Error("park\u5F8C\u306B\u5143\u306E\u72B6\u614B\u304C\u5909\u5316\u3057\u3066\u3044\u307E\u3059");
      status.state = "running";
      status.attempts++;
      status.pid = process.pid;
      delete status.error;
      const attempt = join5(run, "attempts", String(status.attempts));
      const workspace = join5(attempt, "work");
      status.workspace = workspace;
      writeJson(statusPath, status);
      for (const path of c.sources) {
        const target = join5(workspace, path);
        mkdirSync5(dirname4(target), { recursive: true });
        copyFileSync3(fileInside(join5(run, "snapshot"), path), target);
        chmodSync2(target, 420);
      }
      const input = {};
      for (const path of c.artifacts) {
        const target = join5("input", relative3(m.record, path));
        mkdirSync5(dirname4(join5(workspace, target)), { recursive: true });
        copyFileSync3(fileInside(join5(run, "snapshot"), path), join5(workspace, target));
        chmodSync2(join5(workspace, target), 292);
        input[target] = m.files[path];
      }
      writeJson(join5(workspace, "input/manifest.json"), { id, artifacts: input, sourceHashes: Object.fromEntries(c.sources.map((p) => [p, m.files[p]])) });
      input["input/manifest.json"] = digest(readFileSync5(join5(workspace, "input/manifest.json")));
      const configDir = join5(attempt, "takt-config");
      mkdirSync5(configDir, { recursive: true });
      writeFileSync3(join5(configDir, "config.yaml"), `provider: ${c.provider}
language: ja
${c.construction ? `workflow_command_gates:
  custom_scripts: true
` : ""}`);
      let env = { ...cleanEnvironment(), TAKT_CONFIG_DIR: configDir };
      if (c.provider === "claude" && c.disableBedrock)
        env = withoutBedrock(env);
      if (c.provider === "mock") {
        if (!c.mockScenario)
          throw new Error("mockScenario\u304C\u5FC5\u8981\u3067\u3059");
        env.TAKT_MOCK_SCENARIO = fileInside(join5(run, "snapshot"), c.mockScenario);
      } else {
        const claude = Bun.which("claude");
        if (!claude)
          throw new Error("Claude Code\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
        const wrapper = join5(attempt, "claude.sh");
        writeFileSync3(wrapper, `#!/bin/sh
case "$1" in --help|--version) exec ${quote(claude)} "$@";; esac
exec ${quote(claude)} --setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools Read,Write,Edit --max-turns ${c.construction ? 16 : 8} --max-budget-usd 1 "$@"
`, { mode: 448 });
        env.TAKT_CLAUDE_CLI_PATH = wrapper;
      }
      writeJson(join5(workspace, ".claude/settings.json"), { permissions: { deny: ["Edit(input/**)", "Write(input/**)", "Edit(.claude/**)", "Write(.claude/**)", ...c.construction ? ["Edit(.kiro/**)", "Write(.kiro/**)"] : []] } });
      writeFileSync3(join5(workspace, ".gitignore"), `
.claude/
.takt/
`, { flag: "a" });
      for (const args of [["init", "-q"], ["config", "core.hooksPath", "/dev/null"], ["add", "."], ["-c", "user.name=TAKT handoff", "-c", "user.email=handoff@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "chore: seed handoff workspace"]])
        requireSuccess(await command(["git", ...args], workspace, env, 1e4));
      const gate = c.construction ? prepareConstruction(attempt, workspace, fileInside(join5(run, "snapshot"), c.verifyScript), input) : undefined;
      const controlFiles = gate ? snapshot(dirname4(gate), ["construction-gate.ts", "context.json"]) : undefined;
      const result = await command(["takt", "--pipeline", "--skip-git", "--provider", c.provider, "--workflow", fileInside(join5(run, "snapshot"), c.workflow), "--task", "input/manifest.json\u3068Inception\u6210\u679C\u7269\u3092\u8AAD\u307F\u3001\u6307\u5B9AWorkflow\u3092\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5165\u529B\u306F\u5909\u66F4\u305B\u305A\u3001\u6210\u679C\u7269\u3092\u4F5C\u696D\u9818\u57DF\u306B\u4F5C\u3063\u3066\u304F\u3060\u3055\u3044\u3002"], workspace, env, c.timeoutMs);
      writeJson(join5(attempt, "takt.json"), result);
      if (gate && controlFiles) {
        unchanged(dirname4(gate), controlFiles);
        unchanged(workspace, input);
        unchanged(project, m.files);
        if (digest(readFileSync5(boundary.statePath)) !== status.parkStateHash)
          throw new Error("\u5B9F\u884C\u4E2D\u306B\u5143\u306EAI-DLC\u72B6\u614B\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
        const evidence = await command([process.execPath, gate, "result"], workspace, env, 1e4);
        writeJson(join5(attempt, "construction.json"), evidence);
        if (evidence.code === 0) {
          status.construction = JSON.parse(evidence.stdout);
          if (status.construction?.state === "needs_input" && !result.timedOut) {
            status.state = "needs_input";
            delete status.pid;
            writeJson(statusPath, status);
            return status;
          }
        }
        requireSuccess(result);
        requireSuccess(evidence);
      } else
        requireSuccess(result);
      unchanged(workspace, input);
      unchanged(project, m.files);
      unchanged(join5(run, "snapshot"), m.files);
      if (digest(readFileSync5(boundary.statePath)) !== status.parkStateHash)
        throw new Error("\u5B9F\u884C\u4E2D\u306B\u5143\u306EAI-DLC\u72B6\u614B\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
      const verification = await command([process.execPath, fileInside(join5(run, "snapshot"), c.verifyScript)], workspace, env, 30000);
      writeJson(join5(attempt, "verification.json"), verification);
      requireSuccess(verification);
      unchanged(workspace, input);
      unchanged(project, m.files);
      unchanged(join5(run, "snapshot"), m.files);
      if (digest(readFileSync5(boundary.statePath)) !== status.parkStateHash)
        throw new Error("\u691C\u8A3C\u4E2D\u306B\u5143\u306EAI-DLC\u72B6\u614B\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
      if (gate && controlFiles) {
        unchanged(dirname4(gate), controlFiles);
        requireSuccess(await command([process.execPath, gate, "result"], workspace, env, 1e4));
      }
      status.state = "verified";
      delete status.pid;
    } catch (error) {
      status.state = "failed";
      status.error = String(error);
      delete status.pid;
    }
    writeJson(statusPath, status);
    return status;
  });
}

// src/construction-phase/native-trace.ts
import {
  mkdirSync as mkdirSync6,
  mkdtempSync,
  rmSync,
  writeFileSync as writeFileSync4
} from "fs";
import { dirname as dirname5, join as join6 } from "path";
import { spawnSync } from "child_process";
var nativeTraceSource = join6(import.meta.dir, "native-trace.ts");
function seedTraceProject(project, record, state) {
  const match = record.match(/^aidlc\/spaces\/([\w-]+)\/intents\/([\w-]+)$/);
  if (!match)
    throw new Error("traceability\u306Erecord\u304C\u4E0D\u6B63\u3067\u3059");
  const put = (path, text) => {
    mkdirSync6(dirname5(path), { recursive: true });
    writeFileSync4(path, text);
  };
  put(join6(project, "aidlc/active-space"), match[1] + `
`);
  put(join6(project, `aidlc/spaces/${match[1]}/intents/active-intent`), match[2] + `
`);
  put(join6(project, record, "aidlc-state.md"), state);
  return [
    "aidlc/active-space",
    `aidlc/spaces/${match[1]}/intents/active-intent`,
    `${record}/aidlc-state.md`
  ];
}
function nativeTrace(project, output, stage) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("AIDLC_") && k !== "CLAUDE_PROJECT_DIR"));
  const version = spawnSync("aidlc", ["--version"], {
    encoding: "utf8",
    timeout: 1e4,
    env
  });
  if (version.status !== 0 || !/^aidlc 2\.8\.2\b/.test(version.stdout))
    throw new Error("traceability\u306B\u306Faidlc 2.8.2\u304C\u5FC5\u8981\u3067\u3059");
  const r = spawnSync("aidlc", [
    "engine",
    "sensor-traceability",
    "--output-path",
    output,
    "--stage-slug",
    stage
  ], {
    cwd: project,
    env: { ...env, AIDLC_PROJECT_DIR: project },
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
  if (r.status !== 0)
    throw new Error(`\u672C\u5BB6traceability\u306E\u5B9F\u884C\u5931\u6557: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
function resolveTraceIds(project, record, unit, stage) {
  const base = join6(project, "aidlc/takt-handoff");
  mkdirSync6(base, { recursive: true });
  const dir = mkdtempSync(join6(base, "trace-probe-"));
  try {
    const path = join6(dir, "construction", unit, stage, "traceability.json");
    mkdirSync6(dirname5(path), { recursive: true });
    writeFileSync4(path, JSON.stringify({
      stage,
      upstream_ids: ["__TAKT_PROBE__"],
      coverage: [
        { id: "__TAKT_PROBE__", status: "N/A", target: "read-only ID probe" }
      ]
    }));
    const result = nativeTrace(project, path, stage);
    const expectedPendingRules = `required upstream artifact is missing: ${join6(project, record, "construction", unit, "functional-design/rules.md")}`;
    if (result.reason && !(stage === "functional-design" && result.reason === expectedPendingRules))
      throw new Error(`\u5DE5\u7A0B\u306E\u4E0A\u6D41ID\u3092\u89E3\u6C7A\u3067\u304D\u307E\u305B\u3093: ${result.reason}`);
    const ids = result.missing_from_upstream_ids;
    if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string"))
      throw new Error(`\u5DE5\u7A0B\u306E\u4E0A\u6D41ID\u304C\u7A7A\u3067\u3059: ${stage}`);
    return ids;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// src/construction-phase/runner.ts
import {
  chmodSync as chmodSync5,
  closeSync as closeSync4,
  copyFileSync as copyFileSync6,
  existsSync as existsSync7,
  mkdirSync as mkdirSync12,
  openSync as openSync4,
  readFileSync as readFileSync12,
  unlinkSync as unlinkSync3
} from "fs";
import { dirname as dirname9, join as join13 } from "path";
import { spawn as spawn3 } from "child_process";

// src/code-generation/runner.ts
import { spawn as spawn2 } from "child_process";
import { chmodSync as chmodSync3, closeSync as closeSync3, copyFileSync as copyFileSync4, existsSync as existsSync5, mkdirSync as mkdirSync10, openSync as openSync3, readFileSync as readFileSync9, unlinkSync as unlinkSync2, writeFileSync as writeFileSync8 } from "fs";
import { dirname as dirname7, join as join10 } from "path";
import { pathToFileURL as pathToFileURL2 } from "url";

// src/code-generation/context.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync7, mkdtempSync as mkdtempSync2, readFileSync as readFileSync7, readdirSync as readdirSync2, rmSync as rmSync2, writeFileSync as writeFileSync5 } from "fs";
import { join as join7 } from "path";
import { spawnSync as spawnSync2 } from "child_process";
function intentRecord(project) {
  const space = readFileSync7(join7(project, "aidlc/active-space"), "utf8").trim();
  const intent = readFileSync7(join7(project, "aidlc/spaces", space, "intents/active-intent"), "utf8").trim();
  if (![space, intent].every((s) => /^[\w-]+$/.test(s)))
    throw new Error("\u4E0D\u6B63\u306AAI-DLC\u306E\u9078\u629E\u5B50\u3067\u3059");
  return { space, record: `aidlc/spaces/${space}/intents/${intent}` };
}
function markdownFiles(project, dir) {
  if (!existsSync3(join7(project, dir)))
    return [];
  return readdirSync2(join7(project, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    if (entry.isSymbolicLink())
      throw new Error(`Context\u306Esymlink\u306F\u5BFE\u8C61\u5916\u3067\u3059: ${dir}/${entry.name}`);
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? markdownFiles(project, path) : entry.isFile() && path.endsWith(".md") ? [path] : [];
  });
}
function collectCgContext(project, artifacts, unit, checks = {}, host = "claude") {
  const shell = harnessDirectory(host);
  const { space, record } = intentRecord(project);
  if (unit !== null && !/^[\w-]+$/.test(unit))
    throw new Error("\u4E0D\u6B63\u306AUnit\u3067\u3059");
  if (artifacts.some((path) => !path.startsWith(`${record}/inception/`) && !path.startsWith(`${record}/construction/`)))
    throw new Error("CG\u306E\u6210\u679C\u7269\u5165\u529B\u306F\u73FE\u5728\u306EIntent\u5185\u306B\u9650\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
  const intentFile = `${record}/project-description.json`;
  const stageFile = `${shell}/aidlc-common/stages/construction/code-generation.md`;
  const stageText = readFileSync7(fileInside(project, stageFile), "utf8");
  const front = stageText.match(/^---\n([\s\S]*?)\n---/);
  if (!front)
    throw new Error("CG\u5B9A\u7FA9\u306Efrontmatter\u304C\u3042\u308A\u307E\u305B\u3093");
  const stage = Bun.YAML.parse(front[1]);
  const sensors = (stage.sensors ?? []).map((id) => {
    if (!["required-sections", "linter", "type-check", "traceability"].includes(id))
      throw new Error(`\u672A\u5BFE\u5FDC\u306ECG\u30BB\u30F3\u30B5\u30FC: ${id}`);
    const file = `${shell}/sensors/aidlc-${id}.md`;
    const definition = readFileSync7(fileInside(project, file), "utf8");
    const command2 = definition.match(/^command:\s*(.+)$/m)?.[1];
    if (!command2)
      throw new Error(`\u30BB\u30F3\u30B5\u30FC\u306Ecommand\u304C\u3042\u308A\u307E\u305B\u3093: ${id}`);
    return { id, file, command: command2 };
  });
  if (!sensors.length)
    throw new Error("CG\u306E\u30BB\u30F3\u30B5\u30FC\u5B9A\u7FA9\u304C\u3042\u308A\u307E\u305B\u3093");
  const designRoot = unit ? `${record}/construction/${unit}` : `${record}/construction`;
  const unitDesigns = ["functional-design", "nfr-requirements", "nfr-design", "infrastructure-design"].flatMap((name) => markdownFiles(project, `${designRoot}/${name}`));
  const templates = Object.fromEntries(["code-generation-plan", "unit-test-instructions", "code-summary"].flatMap((name) => {
    const path = `aidlc/spaces/${space}/memory/templates/${name}.md`;
    return existsSync3(join7(project, path)) ? [[`${name}.md`, path]] : [];
  }));
  const common = [
    ...artifacts,
    ...unitDesigns,
    intentFile,
    stageFile,
    ...Object.values(templates),
    ...Object.values(checks),
    ...sensors.map((s) => s.file),
    ...["org", "team", "project"].map((name) => `aidlc/spaces/${space}/memory/${name}.md`),
    ...markdownFiles(project, `${shell}/knowledge/aidlc-shared`),
    ...markdownFiles(project, `aidlc/spaces/${space}/knowledge/aidlc-shared`)
  ];
  const phaseRules = `aidlc/spaces/${space}/memory/phases/construction.md`;
  if (existsSync3(join7(project, phaseRules)))
    common.push(phaseRules);
  const forRole = (role) => [
    `${shell}/agents/${role}.md`,
    ...markdownFiles(project, `${shell}/knowledge/${role}`),
    ...markdownFiles(project, `aidlc/spaces/${space}/knowledge/${role}`)
  ];
  const roles = {
    plan: [...common, ...forRole("aidlc-developer-agent")],
    implement: [...common, ...forRole("aidlc-developer-agent")],
    review: [...common, ...forRole("aidlc-architecture-reviewer-agent"), ...forRole("aidlc-quality-agent")],
    report: [...common, ...forRole("aidlc-developer-agent")]
  };
  const traceabilityTool = `${shell}/tools/aidlc-sensor-traceability.ts`;
  const files = [...new Set([...artifacts, ...Object.values(roles).flat(), traceabilityTool])];
  for (const path of files)
    fileInside(project, path);
  const result = spawnSync2("aidlc", ["engine", "testing-posture", "render", "--project-dir", project], { cwd: project, env: cleanEnvironment(), encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(`Testing Contract\u3092\u89E3\u6C7A\u3067\u304D\u307E\u305B\u3093: ${result.stderr}`);
  const match = result.stdout.match(/```json\s*([\s\S]*?)```/);
  if (!match)
    throw new Error("Testing Contract\u306EJSON\u304C\u3042\u308A\u307E\u305B\u3093");
  const testingContract = JSON.parse(match[1]);
  if (testingContract.methodology !== "test-after")
    throw new Error(`CG\u521D\u7248\u306Ftest-after\u306E\u307F\u5BFE\u5FDC\u3057\u3066\u3044\u307E\u3059\u3002${testingContract.methodology}\u3092\u5225\u306E\u9806\u5E8F\u3078\u5909\u66F4\u3057\u3066\u5B9F\u884C\u3059\u308B\u3053\u3068\u306F\u3067\u304D\u307E\u305B\u3093`);
  const tempRoot = join7(project, "aidlc/takt-handoff");
  mkdirSync7(tempRoot, { recursive: true });
  const probeDir = mkdtempSync2(join7(tempRoot, "trace-probe-"));
  let requirementIds;
  try {
    const outputDir = join7(probeDir, "construction", ...unit ? [unit] : [], "code-generation");
    mkdirSync7(outputDir, { recursive: true });
    const probe = join7(outputDir, "traceability.json");
    writeFileSync5(probe, JSON.stringify({ stage: "code-generation", upstream_ids: ["__TAKT_PROBE__"], coverage: [{ id: "__TAKT_PROBE__", status: "N/A", target: "read-only ID probe" }] }));
    const resolved = spawnSync2(process.execPath, [fileInside(project, traceabilityTool), "--output-path", probe, "--stage-slug", "code-generation"], { cwd: project, env: { ...cleanEnvironment(), AIDLC_PROJECT_DIR: project }, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
    if (resolved.status !== 0)
      throw new Error(`\u672C\u5BB6traceability\u306E\u5165\u529B\u89E3\u6C7A\u306B\u5931\u6557: ${resolved.stderr}`);
    const output = JSON.parse(resolved.stdout);
    if (output.reason)
      throw new Error(`CG\u5165\u529B\u306E\u5BFE\u5FDC\u304C\u672A\u78BA\u5B9A: ${output.reason}`);
    requirementIds = output.missing_from_upstream_ids;
    if (!Array.isArray(requirementIds) || !requirementIds.length || requirementIds.some((id) => typeof id !== "string"))
      throw new Error("\u5BFE\u5FDC\u3092\u8FFD\u8DE1\u3067\u304D\u308B\u8981\u6C42ID\u304C\u3042\u308A\u307E\u305B\u3093");
  } finally {
    rmSync2(probeDir, { recursive: true, force: true });
  }
  return { version: 1, hostHarness: host, record, unit, files, roles, testingContract, testingContractText: result.stdout, requirementIds, intentFile, stageFile, sensors, templates, checks, mode: "hotl" };
}

// takt/facets/policies/cg-hotl.md
var cg_hotl_default = `# AI-DLC CG\u306EHOTL\u5B9F\u884C\u5951\u7D04
TAKT\u304C\u62C5\u3046\u306E\u306FCode Generation\u30B9\u30C6\u30FC\u30B8\u3060\u3051\u3067\u3059\u3002\u8A2D\u8A08\u5DE5\u7A0B\u3084Build and Test\u30B9\u30C6\u30FC\u30B8\u5168\u4F53\u3092\u5B9F\u884C\u3057\u307E\u305B\u3093\u3002
\u4EE5\u4E0B\u306E\u8CC7\u6599\u306F\u56FA\u5B9A\u3057\u305FAI-DLC\u306E\u539F\u6587\u3067\u3059\u3002Intent\u3001\u65E2\u5B58\u8A2D\u8A08\u3001\u958B\u767A\u898F\u7D04\u3001CG\u306E\u5B9F\u88C5\u624B\u9806\u3068\u6210\u679C\u7269\u8981\u4EF6\u306B\u5F93\u3063\u3066\u304F\u3060\u3055\u3044\u3002
\u305F\u3060\u3057\u4EBA\u9593\u306E\u5BFE\u8A71\u627F\u8A8D\u30FB\u30A6\u30A9\u30FC\u30AD\u30F3\u30B0\u30B9\u30B1\u30EB\u30C8\u30F3\u5F8C\u306E\u627F\u8A8D\u30FBAI-DLC\u30A8\u30F3\u30B8\u30F3\u306E\u72B6\u614B\u66F4\u65B0\u306F\u5B9F\u884C\u3057\u307E\u305B\u3093\u3002\u30E6\u30FC\u30B6\u30FC\u306E\u65B9\u91DD\u306B\u3088\u308A\u3001CG\u5185\u306E\u8A08\u753B\u78BA\u8A8D\u3068\u30EC\u30D3\u30E5\u30FC\u306FTAKT\u306E\u81EA\u52D5\u5224\u5B9A\u3078\u7F6E\u304D\u63DB\u3048\u307E\u3059\u3002
\u672C\u5BB6\u306ETask\u59D4\u8B72\u306FTAKT\u306E\u62C5\u5F53\u30B9\u30C6\u30C3\u30D7\u3078\u306E\u59D4\u8B72\u3068\u3057\u3066\u6271\u3044\u307E\u3059\u3002\u30CD\u30A4\u30C6\u30A3\u30D6\u306EPlan Approval receipt\u3084dispatch marker\u306F\u751F\u6210\u30FB\u8981\u6C42\u305B\u305A\u3001\u3053\u3053\u3067\u306F\u56FA\u5B9A\u5165\u529B\u306Ehash\u3001\u8A08\u753B\u306ETesting Contract hash\u3001TAKT\u306E\u8A08\u753B\u30EC\u30D3\u30E5\u30FC\u7D50\u679C\u3092\u751F\u6210\u306E\u524D\u63D0\u306B\u3057\u307E\u3059\u3002
\u30BB\u30F3\u30B5\u30FC\u5B9A\u7FA9\u3082\u958B\u767A\u5951\u7D04\u3067\u3059\u3002\u5B9A\u7FA9\u3055\u308C\u305F\u691C\u67FB\u3092\u5B9F\u884C\u3057\u3001\u305D\u306E\u5B9F\u6E2C\u7D50\u679C\u3092\u6B8B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u305F\u3060\u3057AI-DLC\u306E\u30CD\u30A4\u30C6\u30A3\u30D6\u76E3\u67FB\u8A18\u9332\u3092\u634F\u9020\u305B\u305A\u3001\u4EBA\u9593\u306EApprove Plan\u3092\u5F97\u305F\u3068\u3082\u8A18\u9332\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002\u5143\u306Eaidlc/\u30FB.claude/\u30FB.codex/\u30FB.agents/\u3092\u66F4\u65B0\u305B\u305A\u3001CG\u306E\u5831\u544A\u306FTAKT\u306E\u30EC\u30DD\u30FC\u30C8\u3068cg/\u306B\u4FDD\u5B58\u3057\u307E\u3059\u3002
\u539F\u6587\u306E<record>\u306A\u3069\u306F\u5143\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3067\u306E\u51FA\u5178\u3067\u3059\u3002\u6DFB\u4ED8\u3057\u305F\u56FA\u5B9A\u30B3\u30D4\u30FC\u3068\u4F5C\u696D\u9818\u57DF\u306E\u30BD\u30FC\u30B9\u3092\u53C2\u7167\u3057\u3001\u5143\u306E\u8A18\u9332\u9818\u57DF\u3078\u66F8\u304D\u8FBC\u307E\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002
\u898F\u7D04\u306Fstrict-additive\u3068\u3057\u3066\u8AAD\u307F\u3001\u7A7A\u306E\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u4F8B\u3092\u78BA\u5B9A\u4E8B\u9805\u3068\u898B\u306A\u3055\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002\u4EBA\u304C\u660E\u793A\u3057\u305F\u65E2\u5B58\u306E\u8981\u6C42\u30FB\u4F8B\u5916\u3092\u512A\u5148\u3057\u3001\u4E0D\u660E\u306A\u5224\u65AD\u306F\u634F\u9020\u305B\u305Ablocked\u3068\u3057\u3066\u7D42\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002
Testing Contract\u306E\u65B9\u6CD5\u30FB\u9806\u5E8F\u30FB\u54C1\u8CEA\u76EE\u6A19\u3092\u5F31\u3081\u3066\u306F\u3044\u3051\u307E\u305B\u3093\u3002\u30D3\u30EB\u30C9\u3068\u30C6\u30B9\u30C8\u306E\u4E21\u65B9\u304C\u6210\u529F\u3059\u308B\u307E\u3067CG\u5B8C\u4E86\u3092\u8FD4\u3057\u3066\u306F\u3044\u3051\u307E\u305B\u3093\u3002
AI-DLC\u539F\u6587\u306B\u3042\u308BBash\u7B49\u306E\u6A29\u9650\u306F\u5143\u306E\u62C5\u5F53\u8005\u306E\u8AAC\u660E\u3067\u3059\u3002\u73FE\u5728\u8A31\u53EF\u3055\u308C\u305F\u30C4\u30FC\u30EB\u3060\u3051\u3092\u4F7F\u3063\u3066\u304F\u3060\u3055\u3044\u3002
`;

// src/handoff/provider.ts
import { mkdirSync as mkdirSync8, writeFileSync as writeFileSync6 } from "fs";
import { join as join8 } from "path";
function prepareProvider(attempt, config, scenario) {
  const control = join8(attempt, "control");
  mkdirSync8(control, { recursive: true });
  const configDir = join8(attempt, "takt-config");
  mkdirSync8(configDir, { recursive: true });
  writeFileSync6(join8(configDir, "config.yaml"), Bun.YAML.stringify({
    provider: config.provider,
    language: "ja",
    workflow_command_gates: { custom_scripts: true },
    ...config.model ? { model: config.model } : {},
    ...config.codexReasoningEffort ? {
      provider_options: {
        codex: { reasoning_effort: config.codexReasoningEffort }
      }
    } : {}
  }));
  let env = {
    ...cleanEnvironment(),
    TAKT_CONFIG_DIR: configDir
  };
  if (config.disableBedrock)
    env = withoutBedrock(env);
  if (config.provider === "mock")
    env.TAKT_MOCK_SCENARIO = scenario;
  else if (config.provider === "claude") {
    const claude = Bun.which("claude");
    if (!claude)
      throw new Error("Claude Code\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
    const wrapper = join8(control, "claude.sh");
    writeFileSync6(wrapper, `#!/bin/sh
case "$1" in --help|--version) exec ${quote(claude)} "$@";; esac
exec ${quote(claude)} --setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools Read,Glob,Grep,Write,Edit --max-turns 20 --max-budget-usd 2 "$@"
`, { mode: 448 });
    env.TAKT_CLAUDE_CLI_PATH = wrapper;
  } else {
    const codex = Bun.which("codex");
    if (!codex)
      throw new Error("Codex CLI\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
    env.TAKT_CODEX_CLI_PATH = codex;
  }
  return env;
}

// src/code-generation/cg-gate.ts
import assert2 from "assert/strict";
import { createHash as createHash3 } from "crypto";
import { existsSync as existsSync4, lstatSync as lstatSync3, mkdirSync as mkdirSync9, readFileSync as readFileSync8, readdirSync as readdirSync3, realpathSync as realpathSync4, writeFileSync as writeFileSync7 } from "fs";
import { basename as basename2, dirname as dirname6, join as join9, relative as relative4 } from "path";
var cgGateSource = join9(import.meta.dir, "cg-gate.ts");
var hash2 = (data) => createHash3("sha256").update(data).digest("hex");
function sources(root) {
  const found = {};
  const walk = (dir) => {
    for (const e of readdirSync3(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === "node_modules" || e.name === ".venv")
        continue;
      const path = join9(dir, e.name), rel = relative4(root, path);
      if (/^(?:node_modules|\.venv|\.git|\.claude|\.takt|input|cg|coverage|\.handoff-coverage-[^/]+)(?:\/|$)/.test(rel))
        continue;
      assert2.ok(!e.isSymbolicLink(), `symlink\u306F\u5BFE\u8C61\u5916: ${rel}`);
      if (e.isDirectory())
        walk(path);
      else if (e.isFile())
        found[rel] = hash2(readFileSync8(path));
    }
  };
  walk(root);
  return found;
}
if (false) {}

// src/code-generation/runner.ts
var cgStorage = (project) => join10(project, "aidlc/takt-handoff");
function cgEnabled(project) {
  const p = join10(cgStorage(project), "config.json");
  if (!existsSync5(p))
    return false;
  const c = readJson(p);
  return c.enabled === true && delegationScope(c) === "code-generation";
}
function loadConfig(project) {
  const configPath = fileInside(project, "aidlc/takt-handoff/config.json");
  const c = readJson(configPath);
  hostHarness(c.hostHarness);
  if (!c.enabled || delegationScope(c) !== "code-generation" || !["claude", "codex", "mock"].includes(c.provider))
    throw new Error("CG\u8A2D\u5B9A\u304C\u7121\u52B9\u3067\u3059");
  if (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 1000 || c.timeoutMs > 3600000)
    throw new Error("CG\u306E\u6642\u9593\u4E0A\u9650\u306F1\u79D2\u301C1\u6642\u9593\u3067\u3059");
  if (c.model !== undefined && (typeof c.model !== "string" || !c.model.trim()))
    throw new Error("model\u304C\u4E0D\u6B63\u3067\u3059");
  if (c.codexReasoningEffort !== undefined && (c.provider !== "codex" || typeof c.codexReasoningEffort !== "string" || !c.codexReasoningEffort.trim()))
    throw new Error("codexReasoningEffort\u306FCodex\u7528\u306E\u7A7A\u3067\u306A\u3044\u6587\u5B57\u5217\u3067\u3059");
  if (!Array.isArray(c.artifacts) || !c.artifacts.length || !Array.isArray(c.sources) || !c.sources.length)
    throw new Error("CG\u306E\u5165\u529B\u3068\u30BD\u30FC\u30B9\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
  for (const p of c.sources)
    if (p.split("/").some((name) => name === "node_modules" || name === ".venv") || /^(?:node_modules|\.venv|\.git|\.claude|\.codex|\.agents|\.takt|aidlc|input|cg)(?:\/|$)/.test(p))
      throw new Error(`\u5236\u5FA1\u9818\u57DF\u3092\u30BD\u30FC\u30B9\u306B\u3067\u304D\u307E\u305B\u3093: ${p}`);
  for (const key of ["workflow", "buildScript", "verifyScript"])
    fileInside(project, c[key]);
  for (const id of ["linter", "type-check"]) {
    if (c.sensorScripts?.[id])
      fileInside(project, c.sensorScripts[id]);
    else if (!c.sensorExceptions?.[id]?.reason || !c.sensorExceptions[id]?.source)
      throw new Error(`${id}\u306E\u691C\u67FB\u30B9\u30AF\u30EA\u30D7\u30C8\u3001\u307E\u305F\u306F\u6839\u62E0\u4ED8\u304D\u306E\u9069\u7528\u5916\u8A2D\u5B9A\u304C\u5FC5\u8981\u3067\u3059`);
  }
  return { c, configHash: digest(readFileSync9(configPath)) };
}
function isCgEntryCommand(text, project) {
  const words = [];
  const token = /\s*(?:'([^']*)'|"([^"$`\\]*)"|([^\s'"\\;&|<>`$()]+))/y;
  let pos = 0;
  while (pos < text.trimEnd().length) {
    if (pos && !/\s/.test(text[pos]))
      return false;
    token.lastIndex = pos;
    const m = token.exec(text);
    if (!m)
      return false;
    words.push(m[1] ?? m[2] ?? m[3]);
    pos = token.lastIndex;
  }
  const projects = words.map((word, i) => word === "--project-dir" ? i : -1).filter((i) => i >= 0);
  if (project && (projects.length > 1 || projects.some((i) => words[i + 1] !== project)))
    return false;
  return words.slice(0, 3).join(" ") === "aidlc engine orchestrate" && ["next", "continue"].includes(words[3]) && (words[3] !== "continue" || words.length >= 5);
}
function cgEntryCommandIssue(text, project) {
  return /^\s*aidlc engine orchestrate (?:next|continue)\b/.test(text) && !isCgEntryCommand(text, project) ? "CG\u59D4\u8B72\u3067\u306Fnext/continue\u306EJSON\u5FDC\u7B54\u3092\u4F7F\u3044\u307E\u3059\u3002\u5143\u306Eaidlc\u30B3\u30DE\u30F3\u30C9\u3092\u5358\u72EC\u3067\u5B9F\u884C\u3057\u3001\u30EA\u30C0\u30A4\u30EC\u30AF\u30C8\u30FBecho\u30FB\u30B7\u30A7\u30EB\u9023\u7D50\u306F\u4ED8\u3051\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002\u307E\u3060\u5B9F\u884C\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002" : null;
}
async function prepareCg(project, directive) {
  if (directive?.kind !== "run-stage" || directive.stage !== "code-generation")
    return null;
  if (directive.single)
    throw new Error("\u5358\u72ECrunner\u306EAI-DLC\u72B6\u614B\u306FCG\u81EA\u52D5\u5F15\u304D\u7D99\u304E\u306E\u5BFE\u8C61\u5916\u3067\u3059");
  const { c, configHash } = loadConfig(project);
  const cg = collectCgContext(project, c.artifacts, typeof directive.unit === "string" ? directive.unit : null, { build: c.buildScript, test: c.verifyScript, ...c.sensorScripts }, hostHarness(c.hostHarness));
  const statePath = join10(project, cg.record, "aidlc-state.md");
  const state = readFileSync9(statePath, "utf8");
  if (!/\*\*State Version\*\*:\s*8\b/.test(state) || !/\*\*Current Stage\*\*:\s*code-generation\b/.test(state) || !/\*\*Status\*\*:\s*Running\b/.test(state))
    throw new Error("AI-DLC 2.8.2\u306ECG\u5165\u53E3\u3067\u306F\u3042\u308A\u307E\u305B\u3093");
  if (/\*\*Construction Autonomy Mode\*\*:\s*autonomous\b/.test(state))
    throw new Error("AI-DLC\u81EA\u8EAB\u306E\u81EA\u5F8BCG\u3068\u540C\u6642\u306B\u306F\u5B9F\u884C\u3067\u304D\u307E\u305B\u3093");
  const version = await command(["aidlc", "--version"], project, cleanEnvironment(), 1e4);
  requireSuccess(version);
  if (!/^aidlc 2\.8\.2\b/.test(version.stdout))
    throw new Error("aidlc 2.8.2\u304C\u5FC5\u8981\u3067\u3059");
  const files = snapshot(project, [...cg.files, ...c.sources, ...workflowFiles(project, c.workflow), c.buildScript, c.verifyScript, ...Object.values(c.sensorScripts ?? {}), ...c.mockScenario ? [c.mockScenario] : []]);
  const lib = await import(pathToFileURL2(fileInside(project, `${harnessDirectory(cg.hostHarness)}/tools/aidlc-lib.ts`)).href);
  const rows = lib.readAuditShardEvents(project);
  if (new Set(rows.map((row) => row.shard)).size !== 1)
    throw new Error("CG\u521D\u7248\u306F\u5358\u4E00\u306E\u76E3\u67FB\u30B7\u30E3\u30FC\u30C9\u306E\u307F\u5BFE\u5FDC\u3057\u3066\u3044\u307E\u3059");
  const start = rows.findLast((row) => row.event === "STAGE_STARTED" && lib.auditBlockField(row.block, "Stage") === "code-generation");
  if (!start)
    throw new Error("\u73FE\u5728\u306ECG\u958B\u59CB\u8A18\u9332\u304C\u3042\u308A\u307E\u305B\u3093");
  const entryHash = digest(start.block.trim());
  const id = digest(JSON.stringify({ entryHash, unit: cg.unit, files, configHash })).slice(0, 24);
  const base = join10(cgStorage(project), "cg-runs");
  mkdirSync10(base, { recursive: true });
  const run = join10(base, id);
  mkdirSync10(run, { recursive: true });
  const lock = join10(base, "prepare.lock");
  const fd = openSync3(lock, "wx");
  closeSync3(fd);
  try {
    if (existsSync5(join10(run, "manifest.json"))) {
      const previous = readJson(join10(run, "status.json"));
      if (previous.stateHash !== digest(readFileSync9(statePath)))
        throw new Error("\u65E2\u5B58CG\u5B9F\u884C\u5F8C\u306BAI-DLC\u72B6\u614B\u304C\u5909\u5316\u3057\u3066\u3044\u307E\u3059");
      return { id, run, status: previous };
    }
    for (const path of Object.keys(files)) {
      const target = join10(run, "snapshot", path);
      mkdirSync10(dirname7(target), { recursive: true });
      copyFileSync4(fileInside(project, path), target);
      chmodSync3(target, 292);
    }
    writeJson(join10(run, "manifest.json"), { id, config: c, configHash, files, cg, statePath, entryHash });
    writeJson(join10(run, "directive.json"), directive);
    unchanged(project, files);
    const parked = await command(["aidlc", "engine", "orchestrate", "park", "--project-dir", project], project, cleanEnvironment(), 1e4);
    writeJson(join10(run, "park.json"), parked);
    requireSuccess(parked);
    if (JSON.parse(parked.stdout).kind !== "parked")
      throw new Error("CG\u306Epark\u304C\u62D2\u5426\u3055\u308C\u307E\u3057\u305F");
    const status = { state: "parked", attempts: 0, stateHash: digest(readFileSync9(statePath)) };
    writeJson(join10(run, "status.json"), status);
    return { id, run, status };
  } catch (error) {
    if (existsSync5(join10(run, "manifest.json")) && !existsSync5(join10(run, "status.json"))) {
      writeJson(join10(run, "status.json"), { state: "failed", attempts: 0, stateHash: digest(readFileSync9(statePath)), error: String(error) });
    }
    throw error;
  } finally {
    unlinkSync2(lock);
  }
}
async function executeCg(project, id) {
  if (!/^[a-f0-9]{24}$/.test(id))
    throw new Error("\u4E0D\u6B63\u306ACG run ID\u3067\u3059");
  const run = join10(cgStorage(project), "cg-runs", id);
  const m = readJson(join10(run, "manifest.json"));
  const statusPath = join10(run, "status.json");
  const status = readJson(statusPath);
  if (status.state === "verified")
    return status;
  if (status.state !== "parked")
    throw new Error(`CG\u3092\u958B\u59CB\u3067\u304D\u307E\u305B\u3093: ${status.state}`);
  const lock = join10(run, "execute.lock");
  const fd = openSync3(lock, "wx");
  closeSync3(fd);
  try {
    const verifyOriginal = () => {
      if (loadConfig(project).configHash !== m.configHash)
        throw new Error("CG\u8A2D\u5B9A\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
      unchanged(project, m.files);
      unchanged(join10(run, "snapshot"), m.files);
      if (digest(readFileSync9(m.statePath)) !== status.stateHash)
        throw new Error("AI-DLC\u72B6\u614B\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
    };
    verifyOriginal();
    status.state = "running";
    status.attempts++;
    const attempt = join10(run, "attempts", String(status.attempts));
    status.workspace = join10(attempt, "work");
    writeJson(statusPath, status);
    const result = await executeCgWorkspace({ attempt, snapshotRoot: join10(run, "snapshot"), m, verifyOriginal });
    Object.assign(status, result);
  } catch (error) {
    status.state = "failed";
    status.error = String(error);
  } finally {
    unlinkSync2(lock);
  }
  writeJson(statusPath, status);
  return status;
}
async function executeCgWorkspace({ attempt, snapshotRoot, m, verifyOriginal }) {
  const workspace = join10(attempt, "work"), control = join10(attempt, "control");
  mkdirSync10(control, { recursive: true });
  mkdirSync10(join10(workspace, "cg"), { recursive: true });
  const inputs = {};
  for (const path of m.config.sources) {
    const target = join10(workspace, path);
    mkdirSync10(dirname7(target), { recursive: true });
    copyFileSync4(fileInside(snapshotRoot, path), target);
    chmodSync3(target, 420);
  }
  for (const path of m.cg.files) {
    const rel = `input/project/${path}`, target = join10(workspace, rel);
    mkdirSync10(dirname7(target), { recursive: true });
    copyFileSync4(fileInside(snapshotRoot, path), target);
    chmodSync3(target, 292);
    inputs[rel] = m.files[path];
  }
  writeJson(join10(workspace, "input/context.json"), m.cg);
  inputs["input/context.json"] = digest(readFileSync9(join10(workspace, "input/context.json")));
  writeJson(join10(workspace, "input/manifest.json"), { stage: "code-generation", mode: "hotl", files: inputs, unit: m.cg.unit });
  inputs["input/manifest.json"] = digest(readFileSync9(join10(workspace, "input/manifest.json")));
  const gate = join10(control, "cg-gate.ts");
  copyFileSync4(join10(import.meta.dir, "cg-gate.ts"), gate);
  const frozen = (path) => fileInside(snapshotRoot, path);
  const cgConfig = m.config;
  writeJson(join10(control, "context.json"), {
    workspace,
    inputs,
    cg: m.cg,
    initialSources: sources(workspace),
    buildScript: frozen(cgConfig.buildScript),
    buildHash: m.files[cgConfig.buildScript],
    verifyScript: frozen(cgConfig.verifyScript),
    verifyHash: m.files[cgConfig.verifyScript],
    sensorScripts: Object.fromEntries(Object.entries(cgConfig.sensorScripts ?? {}).map(([name, path]) => [name, { path: frozen(path), hash: m.files[path] }])),
    sensorExceptions: cgConfig.sensorExceptions ?? {}
  });
  const { workflow, controlFiles: facetFiles } = materializeWorkflow(snapshotRoot, cgConfig.workflow, control);
  const roleFor = { plan: "plan", "plan-review": "review", implement: "implement", fix: "implement", "code-review": "review", finish: "report" };
  const injection = {};
  const bundleFiles = [];
  workflow.instructions ??= {};
  for (const [role, rolePaths] of Object.entries(m.cg.roles)) {
    const paths = [...new Set(rolePaths)];
    const originals = paths.map((path) => `
## Original source: ${path}
Copy: input/project/${path}
SHA256: ${m.files[path]}

${readFileSync9(frozen(path), "utf8")}`).join(`
`);
    const content = `${cg_hotl_default}
${originals}
## Frozen Testing Contract
${m.cg.testingContractText}
${cg_hotl_default}`;
    const bundle = `context/${role}.md`;
    mkdirSync10(join10(control, "context"), { recursive: true });
    writeFileSync8(join10(control, bundle), content);
    bundleFiles.push(bundle);
    workflow.instructions[`cg-source-${role}`] = bundle;
  }
  for (const step of workflow.steps) {
    const role = roleFor[step.name];
    if (!role)
      throw new Error(`CG\u5916\u306E\u5DE5\u7A0B: ${step.name}`);
    const paths = [...new Set(m.cg.roles[role])];
    step.instruction = [`cg-source-${role}`, cg_hotl_default, ...[step.instruction].flat()];
    injection[step.name] = { sources: paths.map((path) => ({ path, sha256: m.files[path] })), sourceBundleHash: digest(readFileSync9(join10(control, `context/${role}.md`))) };
  }
  writeFileSync8(join10(control, "workflow.yaml"), Bun.YAML.stringify(workflow));
  writeJson(join10(control, "injection.json"), injection);
  const protectedControl = snapshot(control, ["cg-gate.ts", "context.json", "workflow.yaml", "injection.json", ...bundleFiles, ...facetFiles]);
  const env = prepareProvider(attempt, cgConfig, cgConfig.mockScenario ? frozen(cgConfig.mockScenario) : undefined);
  writeJson(join10(workspace, ".claude/settings.json"), { permissions: { deny: ["Edit(input/**)", "Write(input/**)", "Edit(.claude/**)", "Write(.claude/**)", "Edit(.kiro/**)", "Write(.kiro/**)"] } });
  const ignore = join10(workspace, ".gitignore");
  writeFileSync8(ignore, `${existsSync5(ignore) ? readFileSync9(ignore, "utf8") : ""}
.claude/
.takt/
cg/
`);
  const ctx = readJson(join10(control, "context.json"));
  ctx.initialSources = sources(workspace);
  writeJson(join10(control, "context.json"), ctx);
  protectedControl["context.json"] = digest(readFileSync9(join10(control, "context.json")));
  for (const args of [["init", "-q"], ["config", "core.hooksPath", "/dev/null"], ["add", "."], ["-c", "user.name=TAKT CG", "-c", "user.email=cg@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "chore: seed CG workspace"]])
    requireSuccess(await command(["git", ...args], workspace, env, 1e4));
  const result = await command(["takt", "--pipeline", "--skip-git", "--provider", cgConfig.provider, "--workflow", join10(control, "workflow.yaml"), "--task", "AI-DLC\u306ECG\u5358\u4F53\u3092HOTL\u3067\u5B9F\u884C\u3002input\u306EIntent\u30FB\u8A2D\u8A08\u3068\u3001\u6CE8\u5165\u3055\u308C\u305F\u672C\u5BB6CG/\u77E5\u8B58/\u30BB\u30F3\u30B5\u30FC\u5B9A\u7FA9\u306B\u5F93\u3044\u3001\u30D3\u30EB\u30C9\u30FB\u30C6\u30B9\u30C8\u6210\u529F\u307E\u3067\u5B8C\u4E86\u3057\u306A\u3044\u3053\u3068\u3002"], workspace, env, cgConfig.timeoutMs, { outputPrefix: join10(attempt, "takt-output") });
  writeJson(join10(attempt, "takt.json"), result);
  verifyOriginal();
  unchanged(workspace, inputs);
  unchanged(control, protectedControl);
  const evidence = await command([process.execPath, gate, "result"], workspace, env, 1e4);
  writeJson(join10(attempt, "cg-result.json"), evidence);
  if (evidence.code === 0) {
    const result2 = JSON.parse(evidence.stdout);
    if (result2.state === "blocked")
      return { state: "blocked", workspace, result: result2 };
  }
  requireSuccess(result);
  requireSuccess(evidence);
  for (const [name, script] of [["build", cgConfig.buildScript], ["test", cgConfig.verifyScript]]) {
    const check = await command([process.execPath, frozen(script)], workspace, env, 60000);
    writeJson(join10(attempt, `final-${name}.json`), check);
    requireSuccess(check);
  }
  verifyOriginal();
  unchanged(workspace, inputs);
  unchanged(control, protectedControl);
  requireSuccess(await command([process.execPath, gate, "result"], workspace, env, 1e4));
  return { state: "verified", workspace, result: JSON.parse(evidence.stdout) };
}
function spawnCg(project, id, run, cli) {
  const log = openSync3(join10(run, "worker.log"), "a", 384);
  const child = spawn2(process.execPath, [cli, "cg-work", project, id], { cwd: project, env: cleanEnvironment(), detached: true, stdio: ["ignore", log, log] });
  child.on("error", (error) => console.error(error.message));
  child.unref();
  closeSync3(log);
}

// src/construction-phase/context.ts
import { readFileSync as readFileSync10, readdirSync as readdirSync4, existsSync as existsSync6 } from "fs";
import { join as join11 } from "path";
import { pathToFileURL as pathToFileURL3 } from "url";
var phaseStorage = (project) => join11(project, "aidlc/takt-handoff");
function phaseEnabled(project) {
  const path = join11(phaseStorage(project), "config.json");
  if (!existsSync6(path))
    return false;
  const c = readJson(path);
  return c.enabled === true && delegationScope(c) === "construction";
}
function phaseConfig(project) {
  const path = fileInside(project, "aidlc/takt-handoff/config.json");
  const c = readJson(path);
  hostHarness(c.hostHarness);
  if (!c.enabled || delegationScope(c) !== "construction")
    throw new Error("Construction\u8A2D\u5B9A\u304C\u7121\u52B9\u3067\u3059");
  if (!["mock", "claude", "codex"].includes(c.provider) || !Number.isInteger(c.timeoutMs) || c.timeoutMs < 1000 || c.timeoutMs > 3600000)
    throw new Error("provider\u307E\u305F\u306F\u6642\u9593\u4E0A\u9650\u304C\u4E0D\u6B63\u3067\u3059");
  if (c.model !== undefined && (typeof c.model !== "string" || !c.model.trim()))
    throw new Error("model\u304C\u4E0D\u6B63\u3067\u3059");
  if (c.codexReasoningEffort !== undefined && (c.provider !== "codex" || typeof c.codexReasoningEffort !== "string" || !c.codexReasoningEffort.trim()))
    throw new Error("Codex\u63A8\u8AD6\u5F37\u5EA6\u304C\u4E0D\u6B63\u3067\u3059");
  if (!Array.isArray(c.artifacts) || !c.artifacts.length || !Array.isArray(c.sources) || !c.sources.length)
    throw new Error("\u5165\u529B\u3068\u30BD\u30FC\u30B9\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
  for (const p of [...c.sources, ...c.pipelinePaths ?? []]) {
    if (p.split("/").some((name) => name === "node_modules" || name === ".venv") || /^(?:node_modules|\.venv|\.git|\.claude|\.codex|\.agents|\.takt|aidlc|input|cg|phase)(?:\/|$)/.test(p) || p.startsWith("/") || p.split("/").some((s) => !s || s === "." || s === ".."))
      throw new Error(`\u5236\u5FA1\u9818\u57DF\u307E\u305F\u306F\u4E0D\u6B63\u306A\u30BD\u30FC\u30B9: ${p}`);
  }
  for (const key of [
    "workflow",
    "stageWorkflow",
    "buildScript",
    "verifyScript",
    "phaseBuildScript",
    "phaseVerifyScript"
  ])
    fileInside(project, c[key]);
  return { c, configHash: digest(readFileSync10(path)) };
}
function filesBelow(project, dir) {
  if (!existsSync6(join11(project, dir)))
    return [];
  return readdirSync4(join11(project, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.isSymbolicLink())
      throw new Error(`symlink\u306F\u5BFE\u8C61\u5916: ${dir}/${e.name}`);
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? filesBelow(project, p) : e.isFile() ? [p] : [];
  });
}
async function phaseContext(project, c) {
  const { record, space } = intentRecord(project), shell = harnessDirectory(hostHarness(c.hostHarness));
  const lib = await import(pathToFileURL3(fileInside(project, `${shell}/tools/aidlc-lib.ts`)).href);
  const dependency = `${record}/inception/units-generation/unit-of-work-dependency.md`;
  const dag = lib.parseBoltDag(readFileSync10(fileInside(project, dependency), "utf8"));
  if (!dag.ok)
    throw new Error(`Unit\u4F9D\u5B58\u95A2\u4FC2\u304C\u4E0D\u6B63: ${dag.detail}`);
  if (dag.units.some((u) => !/^[\w-]+$/.test(u.name)))
    throw new Error("Unit\u540D\u304C\u4E0D\u6B63\u3067\u3059");
  const state = readFileSync10(fileInside(project, `${record}/aidlc-state.md`), "utf8");
  const progress = lib.parseCheckboxes(state);
  const testStrategy = lib.getField(state, "Test Strategy").toLowerCase();
  if (!["minimal", "standard", "comprehensive"].includes(testStrategy))
    throw new Error("Test Strategy\u304C\u672A\u78BA\u5B9A\u3067\u3059");
  const known = [
    "functional-design",
    "nfr-requirements",
    "nfr-design",
    "infrastructure-design",
    "code-generation",
    "build-and-test",
    "ci-pipeline"
  ];
  const selected = lib.loadStageGraph().filter((s) => s.phase === "construction");
  if (selected.some((s) => !known.includes(s.slug)))
    throw new Error("\u672A\u5BFE\u5FDC\u306EConstruction\u5DE5\u7A0B\u304C\u3042\u308A\u307E\u3059");
  const skipped = [];
  const stages = [];
  for (const node of selected) {
    const row = progress.find((p) => p.slug === node.slug);
    if (!row)
      throw new Error(`\u5DE5\u7A0B\u306E\u5B9F\u884C\u65B9\u91DD\u304C\u3042\u308A\u307E\u305B\u3093: ${node.slug}`);
    if (row.state === "skipped" || /^SKIP\b/.test(row.suffix)) {
      skipped.push(node.slug);
      continue;
    }
    const file = `${shell}/aidlc-common/stages/construction/${node.slug}.md`;
    const body = readFileSync10(fileInside(project, file), "utf8");
    const definition = Bun.YAML.parse(body.match(/^---\n([\s\S]*?)\n---/)[1]);
    const roles = [
      ...new Set([
        definition.lead_agent,
        ...definition.support_agents ?? [],
        definition.reviewer ?? "aidlc-quality-agent"
      ])
    ];
    const files = [
      file,
      ...roles.flatMap((role) => [
        `${shell}/agents/${role}.md`,
        ...filesBelow(project, `${shell}/knowledge/${role}`).filter((p) => p.endsWith(".md")),
        ...filesBelow(project, `aidlc/spaces/${space}/knowledge/${role}`).filter((p) => p.endsWith(".md"))
      ]),
      ...(definition.sensors ?? []).map((id) => `${shell}/sensors/aidlc-${id}.md`)
    ];
    if ((definition.sensors ?? []).some((id) => ![
      "required-sections",
      "upstream-coverage",
      "traceability",
      "linter",
      "type-check"
    ].includes(id)))
      throw new Error(`\u672A\u5BFE\u5FDC\u30BB\u30F3\u30B5\u30FC: ${node.slug}`);
    const templates = {};
    for (const name of definition.produces ?? []) {
      const path = `aidlc/spaces/${space}/memory/templates/${name}.md`;
      if (existsSync6(join11(project, path))) {
        templates[`${name === "build-test-results" ? "test-results" : name}.md`] = path;
        files.push(path);
      }
    }
    for (const p of files)
      fileInside(project, p);
    stages.push({
      slug: node.slug,
      file,
      produces: node.slug === "build-and-test" ? definition.produces.filter((name) => !([
        "performance-test-instructions",
        "security-test-instructions"
      ].includes(name) && testStrategy !== "comprehensive") && !(name === "integration-test-instructions" && testStrategy === "minimal")) : definition.produces,
      produces_kinds: definition.produces_kinds,
      sensors: definition.sensors ?? [],
      roles,
      templates,
      files
    });
  }
  if (!stages.some((s) => s.slug === "code-generation") || !stages.some((s) => s.slug === "build-and-test"))
    throw new Error("CG\u3068Build and Test\u3092\u542B\u3080Construction\u304C\u5FC5\u8981\u3067\u3059");
  if (stages.some((s) => s.slug === "ci-pipeline") && !c.pipelinePaths?.length)
    throw new Error("CI\u5DE5\u7A0B\u306B\u306F\u751F\u6210\u3059\u308BpipelinePaths\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
  const artifacts = [
    ...new Set([
      ...c.artifacts,
      ...filesBelow(project, `${record}/inception`).filter((p) => /\.(md|json)$/.test(p))
    ])
  ];
  const cg = {};
  for (const unit of dag.units) {
    const checks = c.unitChecks?.[unit.name] ?? c;
    for (const id of ["linter", "type-check"])
      if (!checks.sensorScripts?.[id] && !checks.sensorExceptions?.[id]?.source)
        throw new Error(`${unit.name}: ${id}\u306E\u8A2D\u5B9A\u304C\u3042\u308A\u307E\u305B\u3093`);
    cg[unit.name] = collectCgContext(project, artifacts, unit.name, {
      build: checks.buildScript,
      test: checks.verifyScript,
      ...checks.sensorScripts
    }, hostHarness(c.hostHarness));
  }
  return {
    record,
    testStrategy,
    order: dag.batches.flat(),
    units: dag.units,
    stages,
    skipped,
    cg,
    artifacts
  };
}
function phaseFiles(project, c, ctx) {
  return snapshot(project, [
    ...Object.values(ctx.cg).flatMap((cg) => cg.files),
    ...ctx.stages.flatMap((s) => s.files),
    ...c.sources,
    ...workflowFiles(project, c.workflow),
    ...workflowFiles(project, c.stageWorkflow),
    c.phaseBuildScript,
    c.phaseVerifyScript,
    ...Object.values(c.stageSensorScripts ?? {}),
    ...Object.values(c.stageScenarios ?? {}),
    ...c.mockScenario ? [c.mockScenario] : [],
    ...Object.values(c.unitChecks ?? {}).flatMap((u) => [
      u.buildScript,
      u.verifyScript,
      ...Object.values(u.sensorScripts ?? {}),
      ...u.mockScenario ? [u.mockScenario] : []
    ])
  ]);
}
function stageApplies(stage, kind) {
  return stage.produces.some((name) => !kind || !stage.produces_kinds?.[name] || stage.produces_kinds[name].includes(kind));
}

// src/construction-phase/stage.ts
import {
  chmodSync as chmodSync4,
  copyFileSync as copyFileSync5,
  mkdirSync as mkdirSync11,
  readFileSync as readFileSync11,
  writeFileSync as writeFileSync9
} from "fs";
import { dirname as dirname8, join as join12 } from "path";

// takt/facets/policies/stage-hotl.md
var stage_hotl_default = `# Construction HOTL\u306E\u5B9F\u884C\u5951\u7D04

\u5165\u529B\u306EIntent\u30FB\u672C\u5BB6\u5DE5\u7A0B\u5B9A\u7FA9\u30FB\u898F\u7D04\u30FB\u77E5\u8B58\u30FB\u30BB\u30F3\u30B5\u30FC\u306B\u5F93\u3046\u3002
\u5BFE\u8A71\u627F\u8A8D\u3001\u30A6\u30A9\u30FC\u30AD\u30F3\u30B0\u30B9\u30B1\u30EB\u30C8\u30F3\u5F8C\u306E\u627F\u8A8D\u3001\u5B66\u3073\u306E\u8CEA\u554F\u3001\u30CD\u30A4\u30C6\u30A3\u30D6\u306E\u72B6\u614B\u30FB\u76E3\u67FB\u8A18\u9332\u306E\u66F4\u65B0\u306F\u884C\u308F\u306A\u3044\u3002
\u4EBA\u9593\u306E\u78BA\u8A8D\u306F\u81EA\u52D5\u306E\u6280\u8853\u30EC\u30D3\u30E5\u30FC\u3078\u7F6E\u304D\u63DB\u3048\u3001\u5165\u529B\u304B\u3089\u6C7A\u3081\u3089\u308C\u306A\u3044\u3053\u3068\u306Fblocked\u3068\u3057\u3066\u7406\u7531\u3092\u6B8B\u3059\u3002
\u6210\u679C\u7269\u306E\u5143\u306Erecord\u30D1\u30B9\u306Finput/project\u306E\u56FA\u5B9A\u30B3\u30D4\u30FC\u3078\u5BFE\u5FDC\u3059\u308B\u3002
\u30D5\u30A1\u30A4\u30EB\u306F\u5FDC\u7B54\u306Eartifacts/writes\u304B\u3089\u691C\u8A3C\u30B2\u30FC\u30C8\u304C\u751F\u6210\u3059\u308B\u3002\u76F4\u63A5\u7DE8\u96C6\u3057\u306A\u3044\u3002
\u54C1\u8CEA\u6761\u4EF6\u3092\u5F31\u3081\u305A\u3001\u5B9F\u6E2C\u3057\u3066\u3044\u306A\u3044\u691C\u67FB\u3092\u6210\u529F\u3068\u8A18\u9332\u3057\u306A\u3044\u3002
`;

// src/construction-phase/stage.ts
async function executeStage(args) {
  const {
    attempt,
    store,
    files,
    sourcePaths,
    artifacts,
    stage,
    unit,
    kind,
    cg,
    c,
    verify,
    timeout
  } = args;
  const workspace = join12(attempt, "work"), control = join12(attempt, "control");
  mkdirSync11(control, { recursive: true });
  mkdirSync11(workspace, { recursive: true });
  const copy = (path, target) => {
    mkdirSync11(dirname8(target), { recursive: true });
    copyFileSync5(fileInside(store, path), target);
  };
  for (const path of sourcePaths) {
    copy(path, join12(workspace, path));
    chmodSync4(join12(workspace, path), 420);
  }
  const paths = [
    ...new Set([
      ...cg.files,
      ...stage.files,
      ...artifacts,
      c.phaseBuildScript,
      c.phaseVerifyScript,
      ...Object.values(c.stageSensorScripts ?? {})
    ])
  ];
  const inputs = {};
  for (const path of paths) {
    const rel = `input/project/${path}`;
    copy(path, join12(workspace, rel));
    inputs[rel] = files[path];
  }
  const required = stage.produces.filter((name) => !kind || !stage.produces_kinds?.[name] || stage.produces_kinds[name].includes(kind)).map((name) => name === "traceability" ? "traceability.json" : name === "build-test-results" ? "test-results.md" : `${name}.md`);
  const sensorScripts = Object.fromEntries(Object.entries(c.stageSensorScripts ?? {}).map(([id, p]) => [
    id,
    { path: fileInside(store, p), hash: files[p] }
  ]));
  const checks = Object.fromEntries([
    ["build", c.phaseBuildScript],
    ["test", c.phaseVerifyScript]
  ].map(([id, p]) => [id, { path: fileInside(store, p), hash: files[p] }]));
  const requirementIds = unit && stage.sensors.includes("traceability") ? resolveTraceIds(store, cg.record, unit, stage.slug) : cg.requirementIds;
  const traceProject = join12(control, "trace-project");
  const metadata = seedTraceProject(traceProject, cg.record, readFileSync11(join12(store, cg.record, "aidlc-state.md"), "utf8"));
  const traceInputs = [...metadata];
  const currentStageDir = `${cg.record}/construction/${unit ? unit + "/" : ""}${stage.slug}/`;
  for (const path of artifacts.filter((p) => !p.startsWith(currentStageDir))) {
    copy(path, join12(traceProject, path));
    traceInputs.push(path);
  }
  const data = {
    workspace,
    traceProject,
    record: cg.record,
    inputs,
    initialSources: sources(workspace),
    stage,
    unit,
    required,
    upstreamArtifacts: artifacts,
    requirementIds,
    units: args.units,
    sensorScripts,
    checks,
    pipelinePaths: stage.slug === "ci-pipeline" ? c.pipelinePaths ?? [] : []
  };
  writeJson(join12(workspace, "input/stage-context.json"), {
    stage,
    unit,
    required,
    upstreamArtifacts: artifacts,
    requirementIds,
    units: args.units,
    pipelinePaths: data.pipelinePaths,
    checks: { build: c.phaseBuildScript, test: c.phaseVerifyScript }
  });
  inputs["input/stage-context.json"] = digest(readFileSync11(join12(workspace, "input/stage-context.json")));
  writeJson(join12(control, "stage-context.json"), data);
  copyFileSync5(join12(import.meta.dir, "stage-gate.ts"), join12(control, "stage-gate.ts"));
  copyFileSync5(cgGateSource, join12(control, "cg-gate.ts"));
  copyFileSync5(nativeTraceSource, join12(control, "native-trace.ts"));
  const { workflow, controlFiles: facetFiles } = materializeWorkflow(store, c.stageWorkflow, control);
  const contract = `${stage_hotl_default}
\u73FE\u5728\u306E\u5DE5\u7A0B\u306F${stage.slug}\u3001Unit\u306F${unit ?? "\u5168Unit"}\u3067\u3059\u3002
`;
  const bundlePaths = paths.filter((path) => path !== cg.stageFile && !/^\.(?:claude|codex)\/tools\//.test(path));
  const bundle = contract + bundlePaths.map((p) => `
## Original source: ${p}
SHA256: ${files[p]}
${readFileSync11(fileInside(store, p), "utf8")}
`).join("") + `
${cg.testingContractText}
` + contract;
  writeFileSync9(join12(control, "sources.md"), bundle);
  workflow.instructions = {
    ...workflow.instructions ?? {},
    upstream: "sources.md"
  };
  for (const step of workflow.steps) {
    if (!["draft", "review"].includes(step.name))
      throw new Error("\u5DE5\u7A0BWorkflow\u304C\u4E0D\u6B63\u3067\u3059");
    step.instruction = ["upstream", contract, ...[step.instruction].flat()];
  }
  writeFileSync9(join12(control, "workflow.yaml"), Bun.YAML.stringify(workflow));
  writeJson(join12(control, "injection.json"), bundlePaths.map((path) => ({ path, sha256: files[path] })));
  const protectedFiles = snapshot(control, [
    "stage-context.json",
    "stage-gate.ts",
    "cg-gate.ts",
    "sources.md",
    "workflow.yaml",
    "injection.json",
    "native-trace.ts",
    ...facetFiles,
    ...traceInputs.map((p) => `trace-project/${p}`)
  ]);
  const key = `${unit ?? "all"}/${stage.slug}`;
  const scenario = c.stageScenarios?.[args.repaired ? `${key}-after-repair` : key] ?? c.stageScenarios?.[key];
  if (c.provider === "mock" && !scenario)
    throw new Error(`mock\u5FDC\u7B54\u304C\u3042\u308A\u307E\u305B\u3093: ${key}`);
  const env = prepareProvider(attempt, { ...c, delegationScope: "code-generation" }, scenario ? fileInside(store, scenario) : undefined);
  for (const a of [
    ["init", "-q"],
    ["config", "core.hooksPath", "/dev/null"],
    ["add", "."],
    [
      "-c",
      "user.name=TAKT",
      "-c",
      "user.email=takt@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "chore: seed stage workspace"
    ]
  ])
    requireSuccess(await command(["git", ...a], workspace, env, 1e4));
  verify();
  const run = await command([
    "takt",
    "--pipeline",
    "--skip-git",
    "--provider",
    c.provider,
    "--workflow",
    join12(control, "workflow.yaml"),
    "--task",
    `Construction\u306E${stage.slug}\u3092HOTL\u3067\u5B9F\u884C\u3057\u3001\u6210\u679C\u7269\u3068\u691C\u8A3C\u7D50\u679C\u3092\u6280\u8853\u30EC\u30D3\u30E5\u30FC\u3059\u308B`
  ], workspace, env, timeout, { outputPrefix: join12(attempt, "takt-output") });
  writeJson(join12(attempt, "takt.json"), run);
  verify();
  unchanged(workspace, inputs);
  unchanged(control, protectedFiles);
  const evidence = await command([process.execPath, join12(control, "stage-gate.ts"), "result"], workspace, env, 1e4);
  writeJson(join12(attempt, "result.json"), evidence);
  if (evidence.code !== 0)
    requireSuccess(run);
  requireSuccess(evidence);
  const result = JSON.parse(evidence.stdout);
  if (result.state === "verified")
    requireSuccess(run);
  return { ...result, workspace };
}

// src/construction-phase/runner.ts
function pendingPath2(project, event) {
  if (!event.session_id || !event.tool_use_id || event.cwd !== project)
    throw new Error("Construction\u30A4\u30D9\u30F3\u30C8\u306E\u8B58\u5225\u5B50\u307E\u305F\u306F\u4F5C\u696D\u9818\u57DF\u304C\u4E0D\u6B63\u3067\u3059");
  return join13(phaseStorage(project), "phase-pending", digest(event.session_id + ":" + event.tool_use_id) + ".json");
}
async function capturePhase(project, event) {
  if (!phaseEnabled(project))
    return false;
  const issue = approvalCommandIssue(event.tool_input.command ?? "", project);
  if (issue)
    throw new Error(issue);
  if (!approvalCommand(event.tool_input.command ?? "", project))
    return false;
  const version = await command(["aidlc", "--version"], project, cleanEnvironment(), 1e4);
  requireSuccess(version);
  if (!/^aidlc 2\.8\.2\b/.test(version.stdout))
    throw new Error("aidlc 2.8.2\u304C\u5FC5\u8981\u3067\u3059");
  const { c, configHash } = phaseConfig(project);
  const context = await phaseContext(project, c);
  const files = phaseFiles(project, c, context);
  writeJson(pendingPath2(project, event), {
    configHash,
    files,
    context
  });
  return true;
}
async function preparePhase(project, event) {
  if (!phaseEnabled(project) || !approvalCommand(event.tool_input.command ?? "", project))
    return null;
  if (event.tool_response?.interrupted)
    throw new Error("\u627F\u8A8D\u30B3\u30DE\u30F3\u30C9\u304C\u4E2D\u65AD\u3057\u307E\u3057\u305F");
  const directive = JSON.parse(event.tool_response?.stdout ?? "{}");
  if (!["done", "run-stage", "load-steering", "parked"].includes(directive.kind))
    throw new Error("Inception\u306E\u627F\u8A8D\u51E6\u7406\u304C\u6210\u529F\u3057\u3066\u3044\u307E\u305B\u3093");
  const pending = readJson(pendingPath2(project, event));
  const { c, configHash } = phaseConfig(project);
  if (configHash !== pending.configHash)
    throw new Error("\u627F\u8A8D\u4E2D\u306BConstruction\u8A2D\u5B9A\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
  unchanged(project, pending.files);
  const boundary = await approvedBoundary(project, hostHarness(c.hostHarness));
  const id = digest(`${boundary.record}:${boundary.approval}:construction`).slice(0, 24);
  const base = join13(phaseStorage(project), "phase-runs"), run = join13(base, id);
  mkdirSync12(run, { recursive: true });
  const lock = join13(base, "prepare.lock");
  closeSync4(openSync4(lock, "wx"));
  try {
    if (existsSync7(join13(run, "manifest.json"))) {
      const m = readJson(join13(run, "manifest.json")), status2 = readJson(join13(run, "status.json"));
      if (m.configHash !== configHash || JSON.stringify(m.files) !== JSON.stringify(pending.files) || status2.stateHash !== digest(readFileSync12(boundary.statePath)))
        throw new Error("\u540C\u3058\u627F\u8A8D\u306B\u5BFE\u3059\u308BConstruction\u5165\u529B\u30FB\u72B6\u614B\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
      return { id, run, status: status2 };
    }
    for (const p of Object.keys(pending.files)) {
      const out = join13(run, "snapshot", p);
      mkdirSync12(dirname9(out), { recursive: true });
      copyFileSync6(fileInside(project, p), out);
      chmodSync5(out, 292);
    }
    writeJson(join13(run, "manifest.json"), {
      ...pending,
      ...boundary,
      id,
      config: c
    });
    const parked = await command(["aidlc", "engine", "orchestrate", "park", "--project-dir", project], project, cleanEnvironment(), 1e4);
    writeJson(join13(run, "park.json"), parked);
    requireSuccess(parked);
    if (JSON.parse(parked.stdout).kind !== "parked")
      throw new Error("Construction\u306Epark\u304C\u62D2\u5426\u3055\u308C\u307E\u3057\u305F");
    const status = {
      state: "parked",
      attempts: 0,
      stateHash: digest(readFileSync12(boundary.statePath))
    };
    writeJson(join13(run, "status.json"), status);
    return { id, run, status };
  } catch (e) {
    if (!existsSync7(join13(run, "status.json")))
      writeJson(join13(run, "status.json"), {
        state: "failed",
        attempts: 0,
        stateHash: digest(readFileSync12(boundary.statePath)),
        reason: String(e)
      });
    throw e;
  } finally {
    unlinkSync3(lock);
  }
}
async function executePhase(project, id) {
  if (!/^[a-f0-9]{24}$/.test(id))
    throw new Error("Construction run ID\u304C\u4E0D\u6B63\u3067\u3059");
  const run = join13(phaseStorage(project), "phase-runs", id), statusPath = join13(run, "status.json");
  const lock = join13(run, "execute.lock");
  closeSync4(openSync4(lock, "wx"));
  try {
    const m = readJson(join13(run, "manifest.json")), status = readJson(statusPath);
    if (status.state === "verified")
      return status;
    if (status.state !== "parked")
      throw new Error(`Construction\u3092\u958B\u59CB\u3067\u304D\u307E\u305B\u3093: ${status.state}`);
    const deadline = Date.now() + m.config.timeoutMs;
    const remaining = () => {
      const n = deadline - Date.now();
      if (n <= 0)
        throw new Error("Construction\u306E\u6642\u9593\u4E0A\u9650\u306B\u5230\u9054\u3057\u307E\u3057\u305F");
      return n;
    };
    const base = join13(run, "attempts", "1"), store = join13(base, "store");
    mkdirSync12(store, { recursive: true });
    const files = { ...m.files };
    const verify = () => {
      remaining();
      if (phaseConfig(project).configHash !== m.configHash)
        throw new Error("Construction\u8A2D\u5B9A\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
      unchanged(project, m.files);
      unchanged(join13(run, "snapshot"), m.files);
      unchanged(store, files);
      if (digest(readFileSync12(m.statePath)) !== status.stateHash)
        throw new Error("\u5143\u306EAI-DLC\u72B6\u614B\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
    };
    try {
      for (const p of Object.keys(files)) {
        const out = join13(store, p);
        mkdirSync12(dirname9(out), { recursive: true });
        copyFileSync6(fileInside(join13(run, "snapshot"), p), out);
      }
      const metadata = seedTraceProject(store, m.record, readFileSync12(m.statePath, "utf8"));
      for (const p of metadata)
        files[p] = digest(readFileSync12(join13(store, p)));
      verify();
      status.state = "running";
      status.attempts = 1;
      status.steps = [];
      writeJson(statusPath, status);
      let sourcePaths = [...m.config.sources], artifacts = [...m.context.artifacts];
      const publish = (root, p, target) => {
        const out = join13(store, target);
        mkdirSync12(dirname9(out), { recursive: true });
        if (existsSync7(out))
          chmodSync5(out, 420);
        copyFileSync6(fileInside(root, p), out);
        chmodSync5(out, 292);
        files[target] = digest(readFileSync12(out));
      };
      let repairRequest;
      const stageRun = async (stage, unit, repaired = false) => {
        const key = unit ?? "all", attempt = join13(base, `${status.steps.length + 1}-${key}-${stage.slug}`);
        const cg = unit ? m.context.cg[unit] : {
          ...m.context.cg[m.context.order[0]],
          unit: null,
          requirementIds: [
            ...new Set(Object.values(m.context.cg).flatMap((cg2) => cg2.requirementIds))
          ]
        };
        const result = await executeStage({
          attempt,
          store,
          files,
          sourcePaths,
          artifacts,
          stage,
          unit,
          kind: m.context.units.find((u) => u.name === unit)?.kind,
          cg,
          c: m.config,
          verify,
          timeout: remaining(),
          units: m.context.order,
          repaired
        });
        status.steps.push({
          unit,
          stage: stage.slug,
          state: result.state,
          attempt
        });
        writeJson(statusPath, status);
        if (result.state === "repair_required") {
          repairRequest = result;
          return false;
        }
        if (result.state === "blocked") {
          status.state = "blocked";
          status.reason = result.reason;
          return false;
        }
        for (const name of Object.keys(result.artifacts)) {
          const target = `${m.record}/construction/${unit ? unit + "/" : ""}${stage.slug}/${name}`;
          publish(result.artifactDir, name, target);
          if (!artifacts.includes(target))
            artifacts.push(target);
        }
        for (const p of result.writes) {
          publish(result.workspace, p, p);
          if (!sourcePaths.includes(p))
            sourcePaths.push(p);
        }
        return true;
      };
      const cgRun = async (unit, repair = false) => {
        const attempt = join13(base, `${status.steps.length + 1}-${unit}-code-generation`);
        const nativeCg = m.context.cg[unit], cg = {
          ...nativeCg,
          requirementIds: resolveTraceIds(store, m.record, unit, "code-generation"),
          files: [
            ...new Set([
              ...nativeCg.files,
              ...artifacts,
              m.config.phaseBuildScript,
              m.config.phaseVerifyScript
            ])
          ],
          roles: Object.fromEntries(Object.entries(nativeCg.roles).map(([role, paths]) => [
            role,
            [
              ...new Set([
                ...paths,
                ...artifacts,
                m.config.phaseBuildScript,
                m.config.phaseVerifyScript
              ])
            ]
          ]))
        };
        const check = m.config.unitChecks?.[unit] ?? m.config;
        const config = {
          ...m.config,
          ...check,
          delegationScope: "code-generation",
          sources: sourcePaths,
          timeoutMs: remaining(),
          ...repair && m.config.stageScenarios?.[`${unit}/code-generation-repair`] ? {
            mockScenario: m.config.stageScenarios[`${unit}/code-generation-repair`]
          } : {}
        };
        const result = await executeCgWorkspace({
          attempt,
          snapshotRoot: store,
          m: { config, files, cg },
          verifyOriginal: verify
        });
        status.steps.push({
          unit,
          stage: "code-generation",
          state: result.state,
          attempt
        });
        status.workspace = result.workspace;
        if (result.state === "blocked") {
          status.state = "blocked";
          status.reason = result.result.reason;
          writeJson(statusPath, status);
          return false;
        }
        const next = sources(result.workspace);
        for (const p of sourcePaths)
          if (!(p in next)) {
            delete files[p];
            unlinkSync3(join13(store, p));
          }
        for (const p of Object.keys(next))
          publish(result.workspace, p, p);
        sourcePaths = Object.keys(next);
        for (const name of [
          "code-generation-plan.md",
          "unit-test-instructions.md",
          "code-summary.md",
          "traceability.json",
          "source-manifest.json",
          "sensors.json",
          "build.json",
          "test.json"
        ]) {
          const target = `${m.record}/construction/${unit}/code-generation/${name}`;
          publish(result.workspace, `cg/${name}`, target);
          if (!artifacts.includes(target))
            artifacts.push(target);
        }
        writeJson(statusPath, status);
        return true;
      };
      for (const unit of m.context.order) {
        for (const stage of m.context.stages.filter((s) => !["code-generation", "build-and-test", "ci-pipeline"].includes(s.slug)).filter((s) => stageApplies(s, m.context.units.find((u) => u.name === unit)?.kind)))
          if (!await stageRun(stage, unit)) {
            writeJson(statusPath, status);
            return status;
          }
        if (!await cgRun(unit)) {
          writeJson(statusPath, status);
          return status;
        }
      }
      for (const stage of m.context.stages.filter((s) => ["build-and-test", "ci-pipeline"].includes(s.slug))) {
        if (!await stageRun(stage, null)) {
          if (!repairRequest) {
            writeJson(statusPath, status);
            return status;
          }
          const request = repairRequest;
          repairRequest = undefined;
          const path = `${m.record}/construction/build-and-test/repair-request.json`;
          writeJson(join13(store, path), request);
          files[path] = digest(readFileSync12(join13(store, path)));
          artifacts.push(path);
          if (!await cgRun(request.unit, true)) {
            writeJson(statusPath, status);
            return status;
          }
          if (!await stageRun(stage, null, true)) {
            if (repairRequest)
              throw new Error("\u5168\u4F53\u691C\u8A3C\u304B\u3089\u306ECG\u4FEE\u6B63\u4E0A\u9650\u306B\u5230\u9054\u3057\u307E\u3057\u305F");
            writeJson(statusPath, status);
            return status;
          }
        }
      }
      const workspace = join13(base, "result");
      mkdirSync12(workspace, { recursive: true });
      for (const p of sourcePaths) {
        const out = join13(workspace, p);
        mkdirSync12(dirname9(out), { recursive: true });
        copyFileSync6(fileInside(store, p), out);
      }
      const finalBefore = sources(workspace);
      const unitChecks = {};
      for (const unit of m.context.order) {
        const check = m.config.unitChecks?.[unit] ?? m.config;
        const checks = {};
        for (const [name, p] of [
          ["build", check.buildScript],
          ["test", check.verifyScript],
          ...Object.entries(check.sensorScripts ?? {})
        ]) {
          const r = await command([process.execPath, fileInside(store, p)], workspace, cleanEnvironment(), Math.min(60000, remaining()));
          checks[name] = r;
          unitChecks[unit] = checks;
          writeJson(join13(base, "final-unit-checks.json"), unitChecks);
          requireSuccess(r);
          if (name === "linter" || name === "type-check") {
            if (JSON.parse(r.stdout).pass !== true)
              throw new Error(`${unit}: \u6700\u7D42${name}\u304C\u4E0D\u5408\u683C\u3067\u3059`);
          }
        }
      }
      for (const [name, p] of [
        ["build", m.config.phaseBuildScript],
        ["test", m.config.phaseVerifyScript]
      ]) {
        const r = await command([process.execPath, fileInside(store, p)], workspace, cleanEnvironment(), Math.min(60000, remaining()));
        writeJson(join13(base, `final-${name}.json`), r);
        requireSuccess(r);
      }
      if (JSON.stringify(sources(workspace)) !== JSON.stringify(finalBefore))
        throw new Error("\u6700\u7D42\u691C\u8A3C\u4E2D\u306B\u30BD\u30FC\u30B9\u304C\u5909\u5316\u3057\u307E\u3057\u305F");
      verify();
      status.state = "verified";
      status.workspace = workspace;
      writeJson(join13(base, "result.json"), {
        scope: "construction",
        mode: "hotl",
        units: m.context.order,
        skipped: m.context.skipped,
        steps: status.steps,
        sourceHashes: finalBefore,
        artifacts: Object.fromEntries(artifacts.map((p) => [p, files[p]]))
      });
    } catch (e) {
      status.state = "failed";
      status.reason = String(e);
    }
    writeJson(statusPath, status);
    return status;
  } finally {
    unlinkSync3(lock);
  }
}
function spawnPhase(project, id, run, cli) {
  const log = openSync4(join13(run, "worker.log"), "a", 384);
  const child = spawn3(process.execPath, [cli, "phase-work", project, id], {
    cwd: project,
    env: cleanEnvironment(),
    detached: true,
    stdio: ["ignore", log, log]
  });
  child.on("error", (e) => console.error(e.message));
  child.unref();
  closeSync4(log);
}

// src/hosts/codex.ts
function codexCommand(command2, sessionId) {
  if (!command2.startsWith("export AIDLC_SESSION_OVERRIDE="))
    return command2;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId))
    throw new Error("Codex\u306Esession_id\u304C\u4E0D\u6B63\u3067\u3059");
  const prefix = `export AIDLC_SESSION_OVERRIDE='${sessionId}' AIDLC_SESSION_OVERRIDE_SOURCE='payload'; `;
  if (!command2.startsWith(prefix))
    throw new Error("AI-DLC\u306E\u30B3\u30DE\u30F3\u30C9\u524D\u7F6E\u304D\u3068Codex\u30BB\u30C3\u30B7\u30E7\u30F3\u304C\u4E00\u81F4\u3057\u307E\u305B\u3093");
  return command2.slice(prefix.length);
}
function codexEvent(raw) {
  if (raw.tool_name !== "Bash")
    return raw;
  return { ...raw, tool_input: { ...raw.tool_input, command: codexCommand(raw.tool_input?.command ?? "", raw.session_id) } };
}
function codexStdout(response) {
  if (typeof response === "string")
    return response;
  if (response && typeof response === "object") {
    const r = response;
    if (r.interrupted || r.session_id || r.exit_code !== 0 || typeof r.stdout !== "string")
      throw new Error("Codex\u306EBash\u304C\u6B63\u5E38\u5B8C\u4E86\u3057\u3066\u3044\u307E\u305B\u3093");
    return r.stdout;
  }
  throw new Error("Codex\u306EBash\u51FA\u529B\u5F62\u5F0F\u304C\u672A\u5BFE\u5FDC\u3067\u3059");
}
function codexDirective(response) {
  const output = codexStdout(response).trim();
  try {
    return JSON.parse(output);
  } catch {}
  const lines = output.split(`
`).filter((line) => line.trim());
  const payload = lines.filter((line) => !line.startsWith("aidlc-orchestrate: "));
  if (payload.length !== 1)
    throw new Error("Codex\u306EAI-DLC\u5FDC\u7B54\u3092\u4E00\u610F\u306B\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093");
  return JSON.parse(payload[0]);
}

// src/handoff/cli.ts
var [mode, projectArgument, id] = process.argv.slice(2);
var isCodex = mode === "codex-hook" || mode === "codex-session";
try {
  const raw = isCodex ? JSON.parse(await Bun.stdin.text()) : null;
  const project = realpathSync6(projectArgument || (isCodex ? raw.cwd : process.cwd()));
  if (isCodex && (typeof raw.cwd !== "string" || realpathSync6(raw.cwd) !== realpathSync6(process.cwd()) || realpathSync6(raw.cwd) !== project))
    throw new Error("Codex\u30A4\u30D9\u30F3\u30C8\u306E\u4F5C\u696D\u9818\u57DF\u304C\u4E00\u81F4\u3057\u307E\u305B\u3093");
  if (["session", "hook", "plugin-hook", "codex-session", "codex-hook"].includes(mode) && (cgEnabled(project) || phaseEnabled(project))) {
    const configuredHost = hostHarness(readJson(join14(cgStorage(project), "config.json")).hostHarness);
    if (configuredHost !== (isCodex ? "codex" : "claude"))
      process.exit(0);
  }
  if (mode === "session" || mode === "codex-session") {
    if (phaseEnabled(project))
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "takt-aidlc\u306FConstruction\u5168\u4F53\u306EHOTL\u59D4\u8B72\u304C\u6709\u52B9\u3067\u3059\u3002Inception\u3092\u901A\u5E38\u3069\u304A\u308A\u9032\u3081\u3001\u4EBA\u9593\u306B\u3088\u308BDelivery Planning\u6700\u7D42\u627F\u8A8D\u3092\u5F97\u3066\u304B\u3089\u3001\u5358\u4E00\u306Eaidlc engine orchestrate report --stage delivery-planning --result approved\u3067\u8A18\u9332\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u30D5\u30C3\u30AF\u304C\u539F\u6587\u3068Unit\u4F9D\u5B58\u95A2\u4FC2\u3092\u56FA\u5B9A\u3057\u3001park\u3057\u3066TAKT\u3078\u8A2D\u8A08\u30FBCG\u30FB\u5168\u4F53\u691C\u8A3C\u3092\u59D4\u8B72\u3057\u307E\u3059\u3002\u59D4\u8B72\u5F8C\u306F\u30BF\u30FC\u30F3\u3092\u7D42\u4E86\u3057\u3001Construction\u3092\u91CD\u8907\u5B9F\u884C\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002TAKT\u5185\u306B\u4EBA\u9593\u627F\u8A8D\u5F85\u3061\u306F\u306A\u304F\u3001\u30CD\u30A4\u30C6\u30A3\u30D6\u306E\u627F\u8A8D\u30FB\u5B8C\u4E86\u8A18\u9332\u3092\u4F5C\u308A\u307E\u305B\u3093\u3002" } }));
    else if (cgEnabled(project))
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "takt-aidlc\u306FCG\u5358\u4F53\u306EHOTL\u59D4\u8B72\u304C\u6709\u52B9\u3067\u3059\u3002AI-DLC\u306ECG\u524D\u5DE5\u7A0B\u3092\u901A\u5E38\u3069\u304A\u308A\u9032\u3081\u3066\u304F\u3060\u3055\u3044\u3002\u5358\u4E00\u306Eaidlc engine orchestrate next/continue\u304Ccode-generation\u306Erun-stage\u3092\u8FD4\u3059\u3068\u3001\u30D5\u30C3\u30AF\u304CIntent\u30FB\u8A2D\u8A08\u30FB\u672C\u5BB6CG/\u77E5\u8B58/\u30BB\u30F3\u30B5\u30FC\u5B9A\u7FA9\u3092\u56FA\u5B9A\u3057park\u3057\u3066TAKT\u3078\u59D4\u8B72\u3057\u307E\u3059\u3002TAKT\u5185\u3067\u5BFE\u8A71\u627F\u8A8D\u3092\u6C42\u3081\u305A\u3001\u81EA\u52D5\u8A08\u753B\u30EC\u30D3\u30E5\u30FC\u30FB\u5B9F\u88C5\u30FB\u30D3\u30EB\u30C9\u30FB\u30C6\u30B9\u30C8\u30FB\u30BB\u30F3\u30B5\u30FC\u691C\u8A3C\u30FB\u30B3\u30FC\u30C9\u4FEE\u6B63\u3092\u884C\u3044\u307E\u3059\u3002\u30D5\u30C3\u30AF\u306E\u59D4\u8B72\u901A\u77E5\u5F8C\u306FCG\u3092\u91CD\u8907\u5B9F\u884C\u305B\u305A\u3001\u3053\u306E\u30BF\u30FC\u30F3\u3092\u7D42\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002AI-DLC\u306E\u627F\u8A8D\u30FB\u5B8C\u4E86\u30FB\u30BB\u30F3\u30B5\u30FC\u76E3\u67FB\u8A18\u9332\u3092\u507D\u9020\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002" } }));
    else if (handoffEnabled(project))
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "takt-aidlc\u9023\u643A\u8A2D\u5B9A\u304C\u3042\u308A\u307E\u3059\u3002\u73FE\u5728\u306E\u63A8\u5968\u306FhandoffStage: code-generation\u3067\u3059\u3002inception-legacy\u3092\u660E\u793A\u3057\u305F\u5834\u5408\u3060\u3051\u3001\u65E7\u5B9F\u9A13\u306EInception\u6700\u7D42\u627F\u8A8D\u5F8C\u306E\u5F15\u304D\u7D99\u304E\u3092\u6709\u52B9\u306B\u3057\u307E\u3059\u3002" } }));
  } else if (mode === "hooks") {
    const hook = { matcher: "Bash", hooks: [{ type: "command", command: `${quote(process.execPath)} ${quote(import.meta.path)} hook ${quote(project)}`, timeout: 30 }] };
    console.log(JSON.stringify({ hooks: { PreToolUse: [hook], PostToolUse: [hook] } }, null, 2));
  } else if (mode === "hook" || mode === "plugin-hook" || mode === "codex-hook") {
    if (mode === "hook" && process.env.TAKT_AIDLC_PLUGIN_ONLY === "1")
      process.exit(0);
    if (isCodex && !handoffEnabled(project))
      process.exit(0);
    const event = isCodex ? codexEvent(raw) : JSON.parse(await Bun.stdin.text());
    if (event.tool_name !== "Bash")
      process.exit(0);
    if (cgEnabled(project)) {
      const issue = event.hook_event_name === "PreToolUse" && cgEntryCommandIssue(event.tool_input.command ?? "", project);
      if (issue) {
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: issue } }));
        process.exit(0);
      }
      if (event.hook_event_name === "PostToolUse" && isCgEntryCommand(event.tool_input.command ?? "", project) && !event.tool_response?.interrupted) {
        if (typeof event.cwd !== "string" || realpathSync6(event.cwd) !== project)
          throw new Error("CG\u30A4\u30D9\u30F3\u30C8\u306E\u4F5C\u696D\u9818\u57DF\u304C\u4E00\u81F4\u3057\u307E\u305B\u3093");
        const directive = isCodex ? codexDirective(raw.tool_response) : JSON.parse(event.tool_response?.stdout ?? "{}");
        const handoff = await prepareCg(project, directive);
        if (handoff) {
          if (handoff.status.state === "parked")
            spawnCg(project, handoff.id, handoff.run, import.meta.path);
          console.log(JSON.stringify({ ...isCodex ? { continue: false, stopReason: "CG\u306FTAKT\u3078\u59D4\u8B72\u6E08\u307F\u3067\u3059\u3002\u5143\u306ECG\u6307\u793A\u3092\u5B9F\u884C\u305B\u305A\u3001\u3053\u306E\u30BF\u30FC\u30F3\u3092\u7D42\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002" } : {}, hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `CG\u5358\u4F53\u3092TAKT\u3078\u59D4\u8B72\u3057AI-DLC\u306Fpark\u6E08\u307F\u3067\u3059\u3002CG run ID: ${handoff.id}\u3002\u3053\u306E\u30BF\u30FC\u30F3\u3092\u7D42\u4E86\u3057\u3001CG\u3092\u91CD\u8907\u5B9F\u884C\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002\u7D50\u679C: ${join14(handoff.run, "status.json")}\u3002TAKT\u306E\u5B8C\u4E86\u306FAI-DLC\u5074\u306E\u5B8C\u4E86\u8A18\u9332\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002\u5F8C\u7D9A\u5DE5\u7A0B\u3078\u306E\u53D7\u3051\u5165\u308C\u306FAI-DLC\u5074\u3067\u6271\u3063\u3066\u304F\u3060\u3055\u3044\u3002` } }));
        }
      }
      process.exit(0);
    }
    if (phaseEnabled(project)) {
      const issue = event.hook_event_name === "PreToolUse" && approvalCommandIssue(event.tool_input.command ?? "", project);
      if (issue) {
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: issue } }));
        process.exit(0);
      }
      if (event.hook_event_name === "PreToolUse")
        await capturePhase(project, event);
      else if (event.hook_event_name === "PostToolUse") {
        if (!approvalCommand(event.tool_input.command ?? "", project))
          process.exit(0);
        const normalized = isCodex ? { ...event, tool_response: { stdout: JSON.stringify(codexDirective(raw.tool_response)) } } : event;
        const handoff = await preparePhase(project, normalized);
        if (handoff) {
          if (handoff.status.state === "parked")
            spawnPhase(project, handoff.id, handoff.run, import.meta.path);
          console.log(JSON.stringify({ ...isCodex ? { continue: false, stopReason: "Construction\u306FTAKT\u3078\u59D4\u8B72\u6E08\u307F\u3067\u3059\u3002\u30BF\u30FC\u30F3\u3092\u7D42\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002" } : {}, hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `Construction\u5168\u4F53\u3092TAKT\u3078\u59D4\u8B72\u3057AI-DLC\u306Fpark\u6E08\u307F\u3067\u3059\u3002run ID: ${handoff.id}\u3002\u3053\u306E\u30BF\u30FC\u30F3\u3092\u7D42\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u7D50\u679C: ${join14(handoff.run, "status.json")}\u3002\u30CD\u30A4\u30C6\u30A3\u30D6\u306E\u5DE5\u7A0B\u5B8C\u4E86\u3084\u627F\u8A8D\u8A18\u9332\u306F\u4F5C\u6210\u3057\u307E\u305B\u3093\u3002` } }));
        }
      }
      process.exit(0);
    }
    if (isCodex) {
      if (handoffEnabled(project))
        throw new Error("Codex\u30DB\u30B9\u30C8\u306F\u73FE\u5728handoffStage: code-generation\u306E\u307F\u5BFE\u5FDC\u3057\u3066\u3044\u307E\u3059");
      process.exit(0);
    }
    if (handoffEnabled(project) && readJson(join14(storage(project), "config.json")).handoffStage !== "inception-legacy")
      process.exit(0);
    if (event.hook_event_name === "PreToolUse") {
      const issue = handoffEnabled(project) && approvalCommandIssue(event.tool_input.command ?? "", project);
      if (issue) {
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: issue } }));
        process.exit(0);
      }
      captureApproval(project, event);
    } else if (event.hook_event_name === "PostToolUse") {
      const handoff = await prepareHandoff(project, event);
      if (handoff) {
        if (handoff.status.state === "parked") {
          const log = openSync5(join14(handoff.run, "worker.log"), "a", 384);
          const worker = spawn4(process.execPath, [import.meta.path, "work", project, handoff.id], { cwd: project, env: cleanEnvironment(), detached: true, stdio: ["ignore", log, log] });
          worker.on("error", (error) => console.error("TAKT worker\u3092\u8D77\u52D5\u3067\u304D\u307E\u305B\u3093:", error.message));
          worker.unref();
          closeSync5(log);
        }
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `AI-DLC\u306Fpark\u6E08\u307F\u3067\u3059\u3002TAKT\u3078\u306E\u5F15\u304D\u7D99\u304EID: ${handoff.id}\u3002\u627F\u8A8D\u30B3\u30DE\u30F3\u30C9\u304C\u8FD4\u3057\u305F\u53E4\u3044\u6B21\u5DE5\u7A0B\u306E\u6307\u793A\u306F\u5B9F\u884C\u305B\u305A\u3001\u3053\u306E\u30BF\u30FC\u30F3\u3092\u7D42\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u7D50\u679C\u306F ${join14(handoff.run, "status.json")} \u3067\u78BA\u8A8D\u3067\u304D\u307E\u3059\u3002` } }));
      }
    }
  } else if (mode === "phase-work") {
    const result = await executePhase(project, id);
    console.log(JSON.stringify(result));
    if (result.state !== "verified")
      process.exitCode = 1;
  } else if (mode === "phase-status") {
    if (!/^[a-f0-9]{24}$/.test(id ?? ""))
      throw new Error("Construction run ID\u304C\u5FC5\u8981\u3067\u3059");
    console.log(JSON.stringify(readJson(join14(phaseStorage(project), "phase-runs", id, "status.json")), null, 2));
  } else if (mode === "cg-work") {
    const result = await executeCg(project, id);
    console.log(JSON.stringify(result));
    if (result.state !== "verified")
      process.exitCode = 1;
  } else if (mode === "cg-status") {
    if (!/^[a-f0-9]{24}$/.test(id ?? ""))
      throw new Error("CG run ID\u304C\u5FC5\u8981\u3067\u3059");
    console.log(JSON.stringify(readJson(join14(cgStorage(project), "cg-runs", id, "status.json")), null, 2));
  } else if (mode === "work" || mode === "retry") {
    const result = await executeHandoff(project, id, mode === "retry");
    console.log(JSON.stringify(result));
    if (result.state !== "verified")
      process.exitCode = 1;
  } else if (mode === "status") {
    if (!/^[a-f0-9]{24}$/.test(id ?? ""))
      throw new Error("run ID\u304C\u5FC5\u8981\u3067\u3059");
    console.log(JSON.stringify(readJson(join14(storage(project), "runs", id, "status.json")), null, 2));
  } else {
    throw new Error("usage: bun handoff.js session|hooks|hook|plugin-hook|codex-session|codex-hook|cg-work|cg-status|phase-work|phase-status|work|retry|status <project> [id]");
  }
} catch (error) {
  console.error(`\u81EA\u52D5\u5F15\u304D\u7D99\u304E\u3092\u505C\u6B62\u3057\u307E\u3057\u305F: ${String(error)}`);
  if (mode === "hook" || mode === "plugin-hook" || mode === "codex-hook")
    console.error("\u5FA9\u65E7\u304C\u5B8C\u4E86\u3059\u308B\u307E\u3067Construction\u3092\u9032\u3081\u305A\u3001\u3053\u306E\u30BF\u30FC\u30F3\u3092\u7D42\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  process.exitCode = 2;
}
