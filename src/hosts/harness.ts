export type HostHarness = 'claude' | 'codex';

export function hostHarness(value: unknown): HostHarness {
  if (value === undefined) return 'claude';
  if (value !== 'claude' && value !== 'codex') throw new Error('hostHarnessはclaudeまたはcodexです');
  return value;
}
export function harnessDirectory(host: HostHarness) { return host === 'codex' ? '.codex' : '.claude'; }

export function delegationScope(config: { delegationScope?: unknown; handoffStage?: unknown }) {
  if (config.delegationScope !== undefined && !['code-generation', 'construction'].includes(String(config.delegationScope))) throw new Error('delegationScopeはcode-generationまたはconstructionです');
  if (config.delegationScope && config.handoffStage && config.delegationScope !== config.handoffStage) throw new Error('委譲範囲の設定が競合しています');
  return config.delegationScope ?? config.handoffStage;
}
