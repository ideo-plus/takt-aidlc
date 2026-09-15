import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
const run = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !existsSync(join(run, "manifest.json")))
  throw new Error("Construction runのディレクトリを指定してください");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const status = read(join(run, "status.json")),
  manifest = read(join(run, "manifest.json"));
const base = join(run, "attempts/1");
const progress = existsSync(base)
  ? readdirSync(base)
      .filter((n) => /^\d+-/.test(n))
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map((name) => {
        const work = join(base, name, "work"),
          takt = join(work, ".takt/runs");
        if (!existsSync(takt)) return { name };
        const logDir = join(takt, readdirSync(takt)[0], "logs");
        const log = readdirSync(logDir).find((n) => n.endsWith(".jsonl"));
        const events = log
          ? readFileSync(join(logDir, log), "utf8")
              .trim()
              .split("\n")
              .flatMap((line) => {
                try {
                  return [JSON.parse(line)];
                } catch {
                  return [];
                }
              })
          : [];
        const last = events.at(-1),
          started = events.find((e) => e.type === "workflow_start");
        const gates = join(work, ".takt/quality-gates/logs");
        const failures = existsSync(gates) ? readdirSync(gates) : [];
        return {
          name,
          lastEvent: last?.type,
          step: last?.step,
          phase: last?.phase,
          iteration: last?.iteration,
          startedAt: started?.startTime,
          logUpdatedAt: log
            ? statSync(join(logDir, log)).mtime.toISOString()
            : null,
          qualityGateLogs: failures.length,
        };
      })
  : [];
console.log(
  JSON.stringify(
    {
      run,
      state: status.state,
      reason: status.reason,
      provider: manifest.config.provider,
      model: manifest.config.model,
      reasoningEffort: manifest.config.codexReasoningEffort,
      completed: status.steps?.map((s: any) => ({
        stage: s.stage,
        state: s.state,
      })),
      progress,
    },
    null,
    2,
  ),
);
