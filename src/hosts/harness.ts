export type HostHarness = 'claude' | 'codex';

export function hostHarness(value: unknown): HostHarness {
  if (value === undefined) return 'claude';
  if (value !== 'claude' && value !== 'codex') throw new Error('hostHarnessはclaudeまたはcodexです');
  return value;
}
export function harnessDirectory(host: HostHarness) { return host === 'codex' ? '.codex' : '.claude'; }

export function delegationScope(config: { delegationScope?: unknown }) {
  const scope = config.delegationScope;
  if (scope !== 'code-generation' && scope !== 'construction') throw new Error('delegationScopeはcode-generationまたはconstructionが必要です');
  return scope;
}
