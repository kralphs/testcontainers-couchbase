/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
export default {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    transform: {},
    extensionsToTreatAsEsm: ['.ts'],
    globals: {
        'ts-jest': {
            useESM: true,
        },
    },
    moduleNameMapper: {
        '^(\\.{1,2}.*)\\.js$': '$1',
    },
    testPathIgnorePatterns: ['node_modules', 'dist'],
    coverageReporters: ['json', 'html', 'text'],
    collectCoverageFrom: [
        'src/*.ts',
        '!**/node_modules/**',
        '!src/clock.ts',
        '!src/retry-strategy.ts',
        '!src/logger.ts',
    ],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80,
        },
    },
};
