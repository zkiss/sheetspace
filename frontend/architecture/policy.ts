import type { ArchitecturePolicy, Owner } from './analyzer';

const workbook = ['workbook/core', 'workbook/read', 'workbook/formula', 'workbook/mutations'];
const read = workbook.slice(0, 2);
const formula = workbook.slice(0, 3);
const gridModels = 'cellInteraction|cellInteractionContracts|gridAxisMetrics|gridAxisProjection|gridGeometry|sheetGridModel';
const workspaceModels = 'workspaceContracts|workspaceGeometry|workspaceFrameVirtualization';

// A package owns direct children only. New subtrees require an explicit policy decision.
function production(name: string, directory: string, mayImport: readonly string[], external: readonly string[] = [], selection = '[^/]+'): Owner {
  return { name, files: new RegExp(`^src/${directory}/(?![^/]*\\.test\\.tsx?$)${selection}$`), role: 'production', mayImport, external };
}

const packages: Owner[] = [
  production('workbook/core', 'workbook/core', []),
  production('workbook/read', 'workbook/read', ['workbook/core']),
  production('workbook/formula', 'workbook/formula', read),
  production('workbook/mutations', 'workbook/mutations', formula),
  production('calculation', 'calculation', formula),
  production('application/core', 'application/core', ['calculation', ...workbook]),
  production('infrastructure/persistence', 'infrastructure/persistence', ['application/core', ...read]),
  production('application/react', 'application/react', ['infrastructure/persistence', 'application/core', 'calculation', ...workbook], ['react']),
  production('workspace/model', 'workspace', ['application/core', ...read, 'shared/styles'], [], `(?:${workspaceModels})\\.ts`),
  production('workspace/ui', 'workspace', ['workspace/model', 'application/core', ...read, 'shared/styles'], ['react'], `(?!(?:${workspaceModels})\\.ts$)[^/]+`),
  production('grid/model', 'grid', ['application/core', 'calculation', ...formula, 'workspace/model', 'shared/styles'], [], `(?:${gridModels})\\.ts`),
  production('grid/ui', 'grid', ['grid/model', 'application/core', 'calculation', ...formula, 'workspace/model', 'shared/styles'], ['react', '@tanstack/react-virtual'], `(?!(?:${gridModels})\\.ts$)[^/]+`),
  production('reference-navigation', 'reference-navigation', ['grid/model', 'workspace/model', ...formula, 'shared/styles'], ['react']),
  production('shared/styles', 'shared/styles', []),
];
const productionNames = [...packages.map(({ name }) => name), 'app', 'app/bootstrap'];
packages.push(
  production('app', 'app', productionNames.filter((name) => name !== 'app/bootstrap'), ['react'], '(?!main\\.tsx$|global\\.css$)[^/]+'),
  production('app/bootstrap', 'app', ['app'], ['react', 'react-dom'], '(?:main\\.tsx|global\\.css)'),
);

const testingExternal = ['vitest', 'react', '@testing-library/react', '@testing-library/user-event', '@testing-library/jest-dom'];
const testDirectories = ['app', 'workbook/core', 'workbook/read', 'workbook/formula', 'workbook/mutations', 'calculation', 'application/core', 'application/react', 'infrastructure/persistence', 'grid', 'workspace', 'reference-navigation', 'shared/styles'];

export const frontendPolicy: ArchitecturePolicy = {
  excludedDirectories: ['node_modules', 'dist', 'coverage'],
  owners: [
    ...packages,
    // Tests may arrange scenarios through any production package, but cannot import other tests or tooling.
    ...testDirectories.map((directory): Owner => ({
      name: `${directory}/tests`, files: new RegExp(`^src/${directory}/[^/]+\\.test\\.tsx?$`), role: 'test',
      mayImport: [...productionNames, 'test-support'], external: testingExternal,
    })),
    { name: 'test-support', files: /^src\/test-support\/(?![^/]*\.test\.tsx?$)[^/]+$/, role: 'test-support', mayImport: productionNames, external: testingExternal },
    { name: 'architecture', files: /^architecture\/[^/]+$/, role: 'tooling', mayImport: ['configuration'], external: ['node:fs', 'node:os', 'node:path', 'typescript', 'vitest', '@csstools/css-tokenizer'] },
    { name: 'configuration', files: /^(?:package(?:-lock)?\.json|tsconfig(?:\.node)?\.json|vite\.config\.ts)$/, role: 'tooling', external: ['vite', '@vitejs/plugin-react'] },
  ],
  exactTestData: [{ file: '../test-fixtures/workbook-read-contract.json', importers: ['src/infrastructure/persistence/workbookApi.test.ts'] }],
  forbiddenFiles: ['src/workbook.ts', 'src/workbook.tsx', 'src/appTypes.ts', 'src/index.ts', 'src/index.tsx'],
  styles: [
    { files: /^src\/app\/global\.css$/, kind: 'global', importers: ['src/app/main.tsx'] },
    { files: /^src\/(?:app\/(?!global\.css$)|grid\/|workspace\/|reference-navigation\/)[^/]+\.css$/, kind: 'scoped' },
  ],
};
