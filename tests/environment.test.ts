import { expect, test } from 'bun:test';
import { withoutBedrock } from '../src/handoff/io';

test('Bedrock指定とBedrock形式のモデル値だけを子プロセスから除く', () => {
  const original = {
    CLAUDE_CODE_USE_BEDROCK: '1',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'global.anthropic.claude-opus-example',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-normal',
    ANTHROPIC_MODEL: 'arn:aws:bedrock:region:000000000000:inference-profile/example',
    AWS_PROFILE: 'existing-profile', PATH: '/bin',
  };
  const result = withoutBedrock(original);
  expect(result.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
  expect(result.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
  expect(result.ANTHROPIC_MODEL).toBeUndefined();
  expect(result.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-normal');
  expect(result.AWS_PROFILE).toBe('existing-profile');
  expect(result.PATH).toBe('/bin');
  expect(original.CLAUDE_CODE_USE_BEDROCK).toBe('1');
});
