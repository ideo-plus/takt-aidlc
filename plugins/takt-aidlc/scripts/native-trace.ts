// センサー専用の投影先を使い、元のAI-DLCの状態・監査記録は操作しない。
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
export const nativeTraceSource = join(import.meta.dir, "native-trace.ts");
export function seedTraceProject(
  project: string,
  record: string,
  state: string,
) {
  const match = record.match(/^aidlc\/spaces\/([\w-]+)\/intents\/([\w-]+)$/);
  if (!match) throw new Error("traceabilityのrecordが不正です");
  const put = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  put(join(project, "aidlc/active-space"), match[1] + "\n");
  put(
    join(project, `aidlc/spaces/${match[1]}/intents/active-intent`),
    match[2] + "\n",
  );
  // 実際のpark状態のコピー。CGへ進めたり承認を生成したりしない。
  put(join(project, record, "aidlc-state.md"), state);
  return [
    "aidlc/active-space",
    `aidlc/spaces/${match[1]}/intents/active-intent`,
    `${record}/aidlc-state.md`,
  ];
}
export function nativeTrace(
  project: string,
  output: string,
  stage: string,
): any {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith("AIDLC_") && k !== "CLAUDE_PROJECT_DIR",
    ),
  );
  const version = spawnSync("aidlc", ["--version"], {
    encoding: "utf8",
    timeout: 10000,
    env,
  });
  if (version.status !== 0 || !/^aidlc 2\.8\.2\b/.test(version.stdout))
    throw new Error("traceabilityにはaidlc 2.8.2が必要です");
  const r = spawnSync(
    "aidlc",
    [
      "engine",
      "sensor-traceability",
      "--output-path",
      output,
      "--stage-slug",
      stage,
    ],
    {
      cwd: project,
      env: { ...env, AIDLC_PROJECT_DIR: project },
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (r.status !== 0)
    throw new Error(`本家traceabilityの実行失敗: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
export function resolveTraceIds(
  project: string,
  record: string,
  unit: string,
  stage: string,
): string[] {
  const base = join(project, "aidlc/takt-handoff");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "trace-probe-"));
  try {
    const path = join(dir, "construction", unit, stage, "traceability.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        stage,
        upstream_ids: ["__TAKT_PROBE__"],
        coverage: [
          { id: "__TAKT_PROBE__", status: "N/A", target: "read-only ID probe" },
        ],
      }),
    );
    const result = nativeTrace(project, path, stage);
    const expectedPendingRules = `required upstream artifact is missing: ${join(project, record, "construction", unit, "functional-design/rules.md")}`;
    if (
      result.reason &&
      !(stage === "functional-design" && result.reason === expectedPendingRules)
    )
      throw new Error(`工程の上流IDを解決できません: ${result.reason}`);
    const ids = result.missing_from_upstream_ids;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.some((id: unknown) => typeof id !== "string")
    )
      throw new Error(`工程の上流IDが空です: ${stage}`);
    return ids;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
