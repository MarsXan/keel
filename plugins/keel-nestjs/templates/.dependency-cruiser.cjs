// Keel (keel-nestjs) architecture rules — the authority for layers and bounded contexts.
// Every rule has a canary in the pack (canaries/<rule>/) that proves it still fires.
// Changes go through /keel:amend.
// Resolved into node_modules, or left unresolved: either way the name decides.
const FRAMEWORK = '(^|(^|/)node_modules/)(@nestjs|@prisma|prisma|typeorm|mongoose|ioredis|redis|express|fastify|socket\\.io|axios|bullmq|kafkajs|nats)(/|$)';
const TESTS = '\\.(test|spec)\\.ts$';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-no-framework',
      comment: 'Domain and kernel code is plain TypeScript: no framework, database, queue, transport or HTTP client.',
      severity: 'error',
      from: { path: '^libs/([^/]+/src/domain/|kernel/)' },
      to: { path: FRAMEWORK },
    },
    {
      name: 'domain-no-outer-layers',
      comment: "Domain code imports only its own context's domain (and the kernel). Tests may use adapters as fakes.",
      severity: 'error',
      from: { path: '^libs/([^/]+)/src/domain/', pathNot: TESTS },
      to: { path: '^libs/$1/src/', pathNot: '^libs/$1/src/domain/' },
    },
    {
      name: 'application-no-outer-layers',
      comment: 'Application code depends on the domain and on ports, never on adapters, transports or wiring. Tests may use adapters as fakes.',
      severity: 'error',
      from: { path: '^libs/([^/]+)/src/application/', pathNot: TESTS },
      to: { path: '^libs/$1/src/', pathNot: '^libs/$1/src/(domain|application)/' },
    },
    {
      name: 'infrastructure-no-interface',
      comment: 'Adapters do not reach transports; the module wires them together.',
      severity: 'error',
      from: { path: '^libs/([^/]+)/src/infrastructure/', pathNot: TESTS },
      to: { path: '^libs/$1/src/interface/' },
    },
    {
      name: 'interface-no-infrastructure',
      comment: 'Transports call application handlers, never adapters directly.',
      severity: 'error',
      from: { path: '^libs/([^/]+)/src/interface/', pathNot: TESTS },
      to: { path: '^libs/$1/src/infrastructure/' },
    },
    {
      name: 'domain-no-other-contexts',
      comment: 'A domain knows no other bounded context; only the shared kernel.',
      severity: 'error',
      from: { path: '^libs/([^/]+)/src/domain/' },
      to: { path: '^libs/', pathNot: '^libs/($1|kernel)/' },
    },
    {
      name: 'no-cross-context-internals',
      comment: "Another context is reached only through its package's public src/index.ts.",
      severity: 'error',
      from: { path: '^libs/([^/]+)/' },
      to: { path: '^libs/', pathNot: ['^libs/$1/', '^libs/[^/]+/src/index\\.ts$'] },
    },
    {
      name: 'apps-only-public-api',
      comment: 'Apps are thin transport shells: they import libraries through their public index only.',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^libs/', pathNot: '^libs/[^/]+/src/index\\.ts$' },
    },
    {
      name: 'no-circular',
      comment: 'No import cycles.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: "Every import resolves; deep imports into another package are unresolvable because each package exports only its index.",
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Production code does not import development dependencies.',
      severity: 'error',
      from: { path: '^(apps|libs)/', pathNot: TESTS },
      to: { dependencyTypes: ['npm-dev'], pathNot: '(^|/)node_modules/@types/' },
    },
  ],
  options: {
    doNotFollow: { path: '(^|/)node_modules/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    combinedDependencies: true,
    moduleSystems: ['es6', 'cjs'],
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.json'],
    },
    skipAnalysisNotInRules: true,
  },
};
