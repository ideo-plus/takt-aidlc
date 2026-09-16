import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { digest, readJson, writeJson } from "../../src/handoff/io";

export function liveReport(run: string) {
  const m = readJson<any>(join(run, "manifest.json")),
    status = readJson<any>(join(run, "status.json")),
    base = join(run, "attempts/1");
  const steps = existsSync(base)
    ? readdirSync(base)
        .filter((n) => /^\d+-/.test(n))
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map((name) => {
          const path = join(base, name, "takt.json");
          const r = existsSync(path) ? readJson<any>(path) : null;
          const q = join(base, name, "work/.takt/quality-gates/logs");
          const runs = join(base, name, "work/.takt/runs");
          let events: any[] = [];
          if (existsSync(runs)) {
            const dir = join(runs, readdirSync(runs)[0], "logs");
            const file = readdirSync(dir).find((n) => n.endsWith(".jsonl"));
            if (file)
              events = readFileSync(join(dir, file), "utf8")
                .trim()
                .split("\n")
                .flatMap((line) => {
                  try {
                    return [JSON.parse(line)];
                  } catch {
                    return [];
                  }
                });
          }
          const startedAt = events.find(
            (e) => e.type === "workflow_start",
          )?.startTime;
          const endedAt =
            events.findLast((e) => e.type === "workflow_complete")?.endTime ??
            (r ? statSync(path).mtime.toISOString() : null);
          const ledger = join(base, name, "control/construction-ledger.json");
          const reviews = existsSync(ledger)
            ? readJson<any[]>(ledger)
                .filter((r) => r.phase === "review")
                .map((r) => r.verdict)
            : [];
          return {
            startedAt,
            endedAt,
            elapsedSeconds:
              startedAt && endedAt
                ? (Date.parse(endedAt) - Date.parse(startedAt)) / 1000
                : null,
            reviews,
            name,
            code: r?.code,
            timedOut: r?.timedOut ?? false,
            outputLimitExceeded: r?.outputLimitExceeded ?? false,
            outputTruncated: r?.outputTruncated ?? false,
            stdoutBytes:
              r?.stdoutFile && existsSync(r.stdoutFile)
                ? statSync(r.stdoutFile).size
                : Buffer.byteLength(r?.stdout ?? ""),
            qualityGateFailures: existsSync(q) ? readdirSync(q).length : 0,
          };
        })
    : [];
  const unitPath = join(base, "final-unit-checks.json");
  const unitChecks = existsSync(unitPath) ? readJson<any>(unitPath) : {};
  const tests = Object.fromEntries(
    Object.entries(unitChecks).map(([unit, data]: [string, any]) => {
      const log = (
        (data.test?.stdout ?? "") +
        "\n" +
        (data.test?.stderr ?? "")
      ).replace(/\x1b\[[0-9;]*m/g, "");
      return [
        unit,
        {
          code: data.test?.code,
          passed: Number(log.match(/^\s*(\d+) pass\s*$/m)?.[1] ?? NaN),
          typeCheck: data["type-check"]
            ? JSON.parse(data["type-check"].stdout).pass
            : null,
        },
      ];
    }),
  );
  const sourceProject = resolve(
    m.statePath,
    ...Array(m.context.record.split("/").length + 1).fill(".."),
  );
  const unchanged = Object.entries(m.files).every(
    ([p, h]) =>
      existsSync(join(sourceProject, p)) &&
      digest(readFileSync(join(sourceProject, p))) === h,
  );
  return {
    observedAt: new Date().toISOString(),
    runId: m.id,
    scope: "Construction full phase",
    input: "synthetic Inception and approval boundary",
    provider: m.config.provider,
    model: m.config.model,
    reasoningEffort: m.config.codexReasoningEffort,
    state: status.state,
    reason: status.reason,
    completedSteps: (status.steps ?? [])
      .filter((s: any) => s.state === "verified")
      .map((s: any) => ({ unit: s.unit, stage: s.stage })),
    steps,
    tests,
    originalInputsUnchanged: unchanged,
    fullLiveCompletion:
      status.state === "verified" &&
      m.config.provider === "codex" &&
      m.config.model === "gpt-5.6-luna" &&
      m.config.codexReasoningEffort === "max" &&
      unchanged &&
      Object.keys(tests).length === m.context.order.length &&
      Object.values(tests).every(
        (t: any) => t.code === 0 && t.passed === 5 && t.typeCheck === true,
      ),
    limitations: [
      "This does not verify a fresh native Inception or host approval session.",
      "Generated CI jobs are not executed on GitHub by this experiment.",
    ],
  };
}
if (import.meta.main) {
  const run = resolve(process.argv[2] ?? "");
  if (!process.argv[2]) throw new Error("runディレクトリが必要です");
  const result = liveReport(run);
  writeJson(join(run, "live-report.json"), result);
  console.log(JSON.stringify(result, null, 2));
}
