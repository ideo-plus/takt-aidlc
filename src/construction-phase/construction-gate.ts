import { nativeTrace, resolveTraceIds } from "./native-trace";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { hash, sources } from "./code-generation-gate";
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const save = (p: string, v: unknown) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
};
export function stageGate(control: string, phase: string) {
  const ctx = read(join(control, "construction-context.json")),
    root = ctx.workspace;
  assert.equal(realpathSync(process.cwd()), realpathSync(root));
  for (const [p, h] of Object.entries(ctx.inputs))
    assert.equal(hash(readFileSync(join(root, p))), h, `固定入力が変化: ${p}`);
  const runs = readdirSync(join(root, ".takt/runs"));
  assert.equal(runs.length, 1);
  const reports = join(root, ".takt/runs", runs[0], "reports");
  const draftPath = join(reports, "01-construction-draft.json"),
    reviewPath = join(reports, "02-construction-review.json");
  const ledgerPath = join(control, "construction-ledger.json"),
    ledger: any[] = existsSync(ledgerPath) ? read(ledgerPath) : [];
  const latest = (p: string) => ledger.findLast((r) => r.phase === p);
  const codeHash = () => hash(JSON.stringify(sources(root)));
  const artifactDir = join(root, "input/construction-output");
  const draft = read(draftPath);
  const verifyDraft = () => {
    assert.equal(
      latest("draft")?.reportHash,
      hash(readFileSync(draftPath)),
      "レビュー対象の成果物が変化",
    );
    for (const [p, h] of Object.entries(latest("draft").artifacts))
      assert.equal(hash(readFileSync(join(artifactDir, p))), h, "成果物が変化");
    assert.equal(
      codeHash(),
      latest("draft").codeHash,
      "成果物生成後にソースが変化",
    );
  };
  const repair = () => {
    assert.equal(ctx.stage.slug, "build-and-test");
    assert.ok(ctx.units.includes(draft.repairUnit) && draft.reason?.trim());
    const failed = latest("failed-check");
    assert.ok(
      failed && failed.codeHash === codeHash(),
      "修正要求に対応する検証失敗がない",
    );
    return {
      state: "repair_required",
      unit: draft.repairUnit,
      reason: draft.reason,
      checks: failed.checks,
    };
  };
  if (phase === "result") {
    if (draft.verdict === "repair_required") return repair();
    if (draft.verdict === "blocked")
      return { state: "blocked", reason: draft.reason };
    const review = read(reviewPath);
    if (review.verdict === "blocked")
      return { state: "blocked", reason: review.reason };
    verifyDraft();
    assert.equal(latest("review")?.verdict, "approved");
    assert.equal(latest("review").reportHash, hash(readFileSync(reviewPath)));
    return {
      state: "verified",
      artifactDir,
      artifacts: latest("draft").artifacts,
      writes: Object.keys(draft.writes ?? {}),
      reports,
      codeHash: codeHash(),
    };
  }
  const r = phase === "draft" ? draft : read(reviewPath);
  if (phase === "draft" && r.verdict === "repair_required") {
    repair();
    return { state: "checked", verdict: "repair_required" };
  }
  if (r.verdict === "blocked") {
    assert.ok(r.reason?.trim());
    ledger.push({ phase, verdict: "blocked" });
    save(ledgerPath, ledger);
    return { state: "checked", verdict: "blocked" };
  }
  if (phase === "draft") {
    // 修正時は前回の生成したCIファイルのみ変化を認める。
    const allowed = new Set<string>(ctx.pipelinePaths);
    const actual = sources(root);
    for (const p of new Set([
      ...Object.keys(ctx.initialSources),
      ...Object.keys(actual),
    ]))
      if (!allowed.has(p))
        assert.equal(
          actual[p],
          ctx.initialSources[p],
          `設計中のソース変更: ${p}`,
        );
    assert.equal(r.verdict, "ready");
    assert.ok(r.artifacts && typeof r.artifacts === "object");
    assert.deepEqual(
      [...r.upstream].sort(),
      [...ctx.upstreamArtifacts].sort(),
      "上流成果物の確認漏れ",
    );
    assert.ok(
      r.appliedRules?.some(
        (x: any) =>
          typeof x.source === "string" &&
          x.source.replace(`${root}/`, "").replace(/^input\/project\//, "") ===
            ctx.stage.file &&
          x.rule?.trim() &&
          x.application?.trim(),
      ),
      "本家工程定義への対応がない",
    );
    const names = Object.keys(r.artifacts);
    assert.ok(
      ctx.required.every((p: string) => names.includes(p)),
      `必須成果物不足: ${ctx.required.join(", ")}`,
    );
    rmSync(artifactDir, { recursive: true, force: true });
    mkdirSync(artifactDir, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const [p, content] of Object.entries(r.artifacts)) {
      assert.ok(
        /^[\w-]+\.(md|json)$/.test(p) &&
          typeof content === "string" &&
          content.trim(),
      );
      if (p.endsWith(".md")) {
        const headings: string[] = content.match(/^##\s+.+$/gm) ?? [];
        assert.ok(headings.length >= 2, `required-sections: ${p}`);
        const template = ctx.stage.templates?.[p];
        if (template) {
          const required: string[] =
            readFileSync(join(root, "input/project", template), "utf8").match(
              /^##\s+.+$/gm,
            ) ?? [];
          assert.ok(
            required.every((h) => headings.includes(h)),
            `テンプレート違反: ${p}`,
          );
        }
      }
      writeFileSync(join(artifactDir, p), content as string);
      hashes[p] = hash(content as string);
    }
    if (ctx.stage.sensors.includes("traceability")) {
      const trace = read(join(artifactDir, "traceability.json"));
      assert.equal(trace.stage, ctx.stage.slug);
      assert.deepEqual(
        [...trace.upstream_ids].sort(),
        [...ctx.requirementIds].sort(),
      );
      const targetDir = join(
        ctx.traceProject,
        ctx.record,
        "construction",
        ctx.unit,
        ctx.stage.slug,
      );
      rmSync(targetDir, { recursive: true, force: true });
      mkdirSync(targetDir, { recursive: true });
      for (const name of names)
        writeFileSync(
          join(targetDir, name),
          readFileSync(join(artifactDir, name)),
        );
      const result = nativeTrace(
        ctx.traceProject,
        join(targetDir, "traceability.json"),
        ctx.stage.slug,
      );
      save(join(root, "input/traceability-check.json"), result);
      assert.equal(
        result.pass,
        true,
        `本家traceability不合格: ${JSON.stringify(result)}`,
      );
      if (ctx.stage.slug === "nfr-requirements")
        resolveTraceIds(ctx.traceProject, ctx.record, ctx.unit, "nfr-design");
      if (ctx.stage.slug === "nfr-design")
        resolveTraceIds(
          ctx.traceProject,
          ctx.record,
          ctx.unit,
          "infrastructure-design",
        );
    }
    const writes = r.writes ?? {};
    for (const [p, content] of Object.entries(writes)) {
      assert.ok(
        allowed.has(p) && typeof content === "string",
        `許可されていないCIファイル: ${p}`,
      );
      if (/\.ya?ml$/.test(p)) {
        const yaml = Bun.YAML.parse(content as string);
        assert.ok(
          yaml && typeof yaml === "object" && !Array.isArray(yaml),
          `CIのYAMLが不正: ${p}`,
        );
      }
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), content as string);
    }
    if (ctx.stage.slug === "ci-pipeline")
      assert.deepEqual(
        Object.keys(writes).sort(),
        [...ctx.pipelinePaths].sort(),
        "CI設定が未生成",
      );
    const sensors: Record<string, unknown> = {
      "required-sections": { status: "passed" },
      "upstream-coverage": { status: "passed" },
    };
    for (const id of ctx.stage.sensors.filter(
      (s: string) => s === "linter" || s === "type-check",
    )) {
      const script = ctx.sensorScripts[id];
      const snippets = Object.values(r.artifacts).some((s: any) =>
        /```(?:typescript|javascript|tsx|jsx|ts|js)\b/.test(s),
      );
      if (!script) {
        assert.ok(
          !snippets,
          `${id}: TS/JSのコード例を検査するstageSensorScriptsが必要`,
        );
        sensors[id] = {
          status: "not_applicable",
          reason: "検査対象のTS/JSコード例がない",
        };
        continue;
      }
      assert.equal(hash(readFileSync(script.path)), script.hash);
      const result = spawnSync(process.execPath, [script.path], {
        cwd: root,
        env: { ...process.env, AIDLC_ARTIFACTS_DIR: artifactDir },
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 256 * 1024,
      });
      assert.equal(result.status, 0);
      const output = JSON.parse(result.stdout);
      assert.equal(output.pass, true, `${id}不合格`);
      sensors[id] = { status: "passed", output };
    }
    if (ctx.stage.sensors.includes("traceability"))
      sensors.traceability = { status: "passed" };
    // Build and Test/CIは同じソースに対する固定の全体検証を必須にする。
    const checks: Record<string, unknown> = {};
    if (["build-and-test", "ci-pipeline"].includes(ctx.stage.slug))
      for (const [name, script] of Object.entries(ctx.checks) as [
        string,
        any,
      ][]) {
        assert.equal(hash(readFileSync(script.path)), script.hash);
        const result = spawnSync(process.execPath, [script.path], {
          cwd: root,
          encoding: "utf8",
          timeout: 60000,
          maxBuffer: 256 * 1024,
        });
        checks[name] = {
          code: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        };
        save(join(root, "input/phase-checks.json"), checks);
        if (result.status !== 0) {
          ledger.push({ phase: "failed-check", checks, codeHash: codeHash() });
          save(ledgerPath, ledger);
        }
        assert.equal(
          result.status,
          0,
          `${name}失敗。input/phase-checks.jsonを確認すること`,
        );
      }
    ledger.push({
      phase,
      verdict: "ready",
      reportHash: hash(readFileSync(draftPath)),
      artifacts: hashes,
      codeHash: codeHash(),
      sensors,
      checks,
    });
  } else {
    verifyDraft();
    assert.ok(["approved", "changes_requested"].includes(r.verdict));
    assert.ok(Array.isArray(r.findings));
    for (const k of [
      "intent",
      "stageDefinition",
      "conventions",
      "testingContract",
    ])
      assert.ok(r.alignment?.[k]?.trim());
    if (r.verdict === "approved") assert.equal(r.findings.length, 0);
    ledger.push({
      phase,
      verdict: r.verdict,
      reportHash: hash(readFileSync(reviewPath)),
    });
  }
  save(ledgerPath, ledger);
  return { state: "checked", verdict: r.verdict };
}
if (import.meta.main) {
  try {
    console.log(
      JSON.stringify(
        stageGate(dirname(realpathSync(import.meta.path)), process.argv[2]),
      ),
    );
  } catch (e) {
    console.error(String(e));
    process.exitCode = 1;
  }
}
