// Keel (keel-nestjs) lint rules: strict typed TypeScript, code-health caps, domain purity,
// test integrity and an editor mirror of the architecture (dependency-cruiser is the
// authority). Every rule named here has a canary in the pack. Changes go through /keel:amend.
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import vitest from '@vitest/eslint-plugin';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const SOURCE = ['apps/**/*.ts', 'libs/**/*.ts'];
const DOMAIN = ['libs/*/src/domain/**/*.ts', 'libs/kernel/**/*.ts'];
const TESTS = ['**/*.test.ts', '**/*.spec.ts'];
const FRAMEWORK = ['@nestjs/*', '@prisma/*', 'prisma', 'typeorm', 'mongoose', 'ioredis', 'redis', 'express', 'fastify', 'socket.io', 'axios', 'bullmq', 'kafkajs', 'nats'];
/** Rules nobody may switch off with an inline comment. */
const PROTECTED = ['boundaries/*', '@typescript-eslint/no-explicit-any', '@typescript-eslint/ban-ts-comment', 'max-lines', 'max-lines-per-function', 'complexity', 'max-params', 'no-restricted-syntax', 'no-restricted-globals', 'vitest/*'];

const same = (type) => ({ element: { type, captured: { context: '{{ from.element.captured.context }}' } } });
const any = (...types) => ({ element: { types: { anyOf: types } } });

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '*.config.*', '.dependency-cruiser.cjs'] },
  {
    files: SOURCE,
    extends: [...tseslint.configs.strictTypeChecked, comments.recommended],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      'boundaries/elements': [
        { type: 'kernel', pattern: 'libs/kernel', partialMatch: false },
        { type: 'contracts', pattern: 'libs/contracts', partialMatch: false },
        { type: 'domain', pattern: 'libs/*/src/domain', partialMatch: false, capture: ['context'] },
        { type: 'application', pattern: 'libs/*/src/application', partialMatch: false, capture: ['context'] },
        { type: 'infrastructure', pattern: 'libs/*/src/infrastructure', partialMatch: false, capture: ['context'] },
        { type: 'interface', pattern: 'libs/*/src/interface', partialMatch: false, capture: ['context'] },
        { type: 'context', pattern: 'libs/*/src', partialMatch: false, capture: ['context'] },
        { type: 'app', pattern: 'apps/*', partialMatch: false, capture: ['app'] },
      ],
      'boundaries/files': [{ category: 'test', pattern: TESTS }],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 }],
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      'max-lines': ['error', { max: 300 }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
      'max-params': ['error', 6],
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      '@eslint-community/eslint-comments/no-restricted-disable': ['error', ...PROTECTED],
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          checkAllOrigins: true,
          policies: [
            { allow: { to: { module: { origin: ['external', 'core'] } } } },
            { from: any('kernel'), allow: { to: any('kernel') } },
            { from: any('contracts'), allow: { to: any('contracts') } },
            { from: any('domain'), allow: { to: [same('domain'), any('kernel')] } },
            { from: any('application'), allow: { to: [same('domain'), same('application'), any('kernel', 'contracts', 'context')] } },
            { from: any('infrastructure'), allow: { to: [same('domain'), same('application'), same('infrastructure'), any('kernel', 'contracts')] } },
            { from: any('interface'), allow: { to: [same('application'), same('domain'), same('interface'), any('kernel', 'contracts')] } },
            { from: any('context'), allow: { to: [same('domain'), same('application'), same('infrastructure'), same('interface'), any('kernel', 'contracts', 'context')] } },
            { from: any('app'), allow: { to: [{ element: { type: 'app', captured: { app: '{{ from.element.captured.app }}' } } }, any('kernel', 'contracts', 'context')] } },
            // Tests may use their own context's adapters as fakes.
            { from: { file: { categories: 'test' } }, allow: { to: { element: { captured: { context: '{{ from.element.captured.context }}' } } } } },
            { from: any('domain', 'kernel'), disallow: { to: { module: { origin: 'external', source: FRAMEWORK } } } },
          ],
        },
      ],
    },
  },
  {
    files: DOMAIN,
    linterOptions: { noInlineConfig: true },
    rules: {
      'max-lines': ['error', { max: 200 }],
      '@eslint-community/eslint-comments/no-use': 'error',
      'no-restricted-globals': [
        'error',
        ...['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'queueMicrotask'].map((name) => ({
          name,
          message: 'Domain code has no timers: schedule work from the application layer through a port.',
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: ['timers', 'timers/promises', 'node:timers', 'node:timers/promises'].map((name) => ({
            name,
            message: 'Domain code has no timers: schedule work from the application layer through a port.',
          })),
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[object.name='globalThis'][property.name=/^(Date|Math|setTimeout|setInterval|setImmediate|queueMicrotask)$/]", message: 'Reaching the clock, randomness or timers through globalThis is still reaching them: inject a port.' },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Inject the Clock port instead of calling Date.now() in domain code.' },
        { selector: "NewExpression[callee.name='Date']", message: 'Inject the Clock port instead of new Date() in domain code.' },
        { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: 'Inject a random source instead of Math.random() in domain code.' },
      ],
    },
  },
  {
    files: TESTS,
    extends: [vitest.configs.recommended],
    rules: {
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/expect-expect': 'error',
      'max-lines': ['error', { max: 600 }],
      'max-lines-per-function': 'off',
    },
  },
);
