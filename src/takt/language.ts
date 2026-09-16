import codeGenerationJa from '../../takt/ja/facets/policies/code-generation-hotl.md' with { type: 'text' };
import codeGenerationEn from '../../takt/en/facets/policies/code-generation-hotl.md' with { type: 'text' };
import constructionJa from '../../takt/ja/facets/policies/construction-hotl.md' with { type: 'text' };
import constructionEn from '../../takt/en/facets/policies/construction-hotl.md' with { type: 'text' };
import supervisionJa from '../../takt/ja/facets/policies/aidlc-supervision.md' with { type: 'text' };
import supervisionEn from '../../takt/en/facets/policies/aidlc-supervision.md' with { type: 'text' };

export type TaktLanguage = 'ja' | 'en';

export function taktLanguage(value?: unknown): TaktLanguage {
  if (value === undefined) return 'ja';
  if (value === 'ja' || value === 'en') return value;
  throw new Error('languageはjaまたはenを指定してください');
}

const policies = {
  ja: { codeGeneration: codeGenerationJa, construction: constructionJa, supervision: supervisionJa },
  en: { codeGeneration: codeGenerationEn, construction: constructionEn, supervision: supervisionEn },
};

export const runtimePolicies = (language?: TaktLanguage) => policies[taktLanguage(language)];
