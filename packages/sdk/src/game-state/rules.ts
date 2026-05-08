import type { Bus } from './bus.ts';
import type { OfficeState } from './types.ts';

export type Rule = (state: OfficeState, prev: OfficeState, bus: Bus) => void;

export interface RuleRegistry {
  addRule(rule: Rule): () => void;
  tick(state: OfficeState, prev: OfficeState, bus: Bus): void;
}

export function createRuleRegistry(): RuleRegistry {
  const rules: Rule[] = [];
  return {
    addRule(rule) {
      rules.push(rule);
      return () => {
        const i = rules.indexOf(rule);
        if (i >= 0) rules.splice(i, 1);
      };
    },
    tick(state, prev, bus) {
      for (const rule of rules.slice()) {
        try {
          rule(state, prev, bus);
        } catch (err) {
          console.error('[rules] rule threw during tick:', err);
        }
      }
    },
  };
}
