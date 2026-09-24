---
name: new-context
description: Scaffold a new bounded context (libs/<name>) — package, public index, composition module and a module test — through Keel's edit gates. Needs an approved T2 plan.
argument-hint: "<context name in kebab-case>"
disable-model-invocation: true
allowed-tools: Bash(keel status) Bash(keel task *) Bash(pnpm install) Bash(pnpm -s *) Read Glob Write
---
# New bounded context: $ARGUMENTS

A new context is heavy work (T2). `keel status` must show an approved spec and plan whose
tasks declare `libs/<name>/**`; if not, stop and use `/keel:start`.

1. **Names.** `<name>` in kebab-case (`order-history`), `<Name>` in PascalCase
   (`OrderHistory`), `<package>` = the scope the other libs use (read one
   `libs/*/package.json`) plus `/<name>`, and `<nestVersion>` and `<reflectVersion>` = the
   `@nestjs/common` and `reflect-metadata` versions the other packages use.
2. **Red.** `keel task T-n red`, then write `libs/<name>/src/<name>.module.test.ts` from this
   skill's `templates/module.test.ts`. Run `pnpm -s test`: it fails because the module is
   missing.
3. **Green.** `keel task T-n green`, then write, from `templates/`, with the Write tool (never
   a script), replacing `{{name}}`, `{{Name}}`, `{{package}}`, `{{nestVersion}}` and
   `{{reflectVersion}}`:
   - `libs/<name>/package.json` ← `package.json`
   - `libs/<name>/src/index.ts` ← `index.ts`
   - `libs/<name>/src/<name>.module.ts` ← `module.ts`
4. **Link and check.** `pnpm install`, then `pnpm -s typecheck`, `pnpm -s test`,
   `pnpm -s arch` and `pnpm -s lint` must pass.
5. Layers (`domain/`, `application/commands|queries/`, `infrastructure/`, `interface/`) are
   created by the tasks that need them: no empty folders, no speculative files. Registering
   the module in an app is a task of the plan too.
