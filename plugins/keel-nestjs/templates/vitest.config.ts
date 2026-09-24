// Keel (keel-nestjs) test preset. A focused, empty or assertion-less test fails the run, and
// SWC emits the decorator metadata NestJS needs. Changes go through /keel:amend.
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const layer = (percent: number) => ({ lines: percent, branches: percent, functions: percent, statements: percent });

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ['apps/**/*.{test,spec}.ts', 'libs/**/*.{test,spec}.ts'],
    allowOnly: false,
    passWithNoTests: false,
    expect: { requireAssertions: true },
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**/*.ts', 'libs/*/src/**/*.ts'],
      exclude: ['**/*.{test,spec}.ts', '**/index.ts', '**/main.ts'],
      thresholds: {
        'libs/*/src/domain/**': layer(90),
        'libs/*/src/application/**': layer(80),
      },
    },
  },
});
