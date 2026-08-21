/**
 * Jest configuration for the library's unit tests. These cover the pure,
 * dependency-free logic (store, truncation, serialization, JSON flattening,
 * persistence adapters, network helpers) — no React Native rendering — so a plain
 * node environment is enough and fast.
 *
 * ts-jest transpiles each file in isolation (no cross-file type-checking) and
 * emits CommonJS so Jest can require it, independent of the library's ESM build
 * config and the example app's React Native Babel setup.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // RN's entry point is Flow-typed ESM that this node-environment setup can't
  // parse, and pure logic under test still reaches it through the TurboModule
  // specs. See the stub for what it provides and why it returns a null module.
  moduleNameMapper: {
    '^react-native$': '<rootDir>/src/__mocks__/react-native.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          ignoreDeprecations: '6.0',
          verbatimModuleSyntax: false,
          esModuleInterop: true,
          jsx: 'react-jsx',
          noUnusedLocals: false,
          noUnusedParameters: false,
        },
      },
    ],
  },
};
