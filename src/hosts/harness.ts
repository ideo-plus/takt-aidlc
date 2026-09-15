export type HostHarness = 'claude' | 'codex';

export function hostHarness(value: unknown): HostHarness {
  if (value === undefined) return 'claude';
  if (value !== 'claude' && value !== 'codex') throw new Error('hostHarnessはclaudeまたはcodexです');
  return value;
}
export function harnessDirectory(host: HostHarness) { return host === 'codex' ? '.codex' : '.claude'; }
