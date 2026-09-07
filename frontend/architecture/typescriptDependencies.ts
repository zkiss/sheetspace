import ts from 'typescript';

export type ModuleRequest =
  | { kind: 'import' | 'reexport'; specifier: string }
  | { kind: 'dynamic-nonliteral' }
  | { kind: 'glob' };

type ImportOrigin = { specifier: string; binding: string };
// Unmock methods reference the module registry without loading a module. Their
// targets still obey dependency boundaries, like the loading and mocking APIs.
const vitestModuleMethods = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock']);
const vitestObjects = new Set(['vi', 'vitest']);

export function typescriptDependencies(file: string, text: string): ModuleRequest[] {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  // Bind only this file: local symbols preserve lexical scope and immediate
  // import origins without following aliases through (and hiding) other barrels.
  const options: ts.CompilerOptions = { noResolve: true, noLib: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => name === file ? ast : undefined;
  const checker = ts.createProgram([file], options, host).getTypeChecker();
  const requests = new Map<string, ModuleRequest>();
  const add = (request: ModuleRequest) => requests.set(JSON.stringify(request), request);
  const originAt = (node: ts.Node) => importOrigin(checker.getSymbolAtLocation(node));
  const isVitestObject = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const origin = importOrigin(symbol);
      return origin ? origin.specifier === 'vitest' && vitestObjects.has(origin.binding)
        : !symbol && vitestObjects.has(node.text);
    }
    const member = staticMember(node);
    if (!member || !vitestObjects.has(member.name)) return false;
    const origin = originAt(member.object);
    return origin?.specifier === 'vitest' && origin.binding === '*';
  };
  const exportOrigin = (symbol: ts.Symbol | undefined) => {
    const origin = importOrigin(symbol);
    if (origin) add({ kind: 'reexport', specifier: origin.specifier });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        add({ kind: ts.isExportDeclaration(node) ? 'reexport' : 'import', specifier: node.moduleSpecifier.text });
      } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const item of node.exportClause.elements) exportOrigin(checker.getExportSpecifierLocalTargetSymbol(item));
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const origin = importOrigin(checker.getSymbolAtLocation(node.name));
      if (origin) add({ kind: node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ? 'reexport' : 'import', specifier: origin.specifier });
    } else if (ts.isExportAssignment(node)) {
      exportOrigin(checker.getSymbolAtLocation(unwrap(node.expression)));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      add({ kind: 'import', specifier: node.argument.literal.text });
    } else if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      const value = argument && ts.isStringLiteralLike(argument) ? argument.text : undefined;
      const member = staticMember(node.expression);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(value !== undefined ? { kind: 'import', specifier: value } : { kind: 'dynamic-nonliteral' });
      } else if (member?.name === 'glob' && ts.isMetaProperty(member.object) && member.object.keywordToken === ts.SyntaxKind.ImportKeyword) {
        add({ kind: 'glob' });
      } else if (value !== undefined && (
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        || (member && vitestModuleMethods.has(member.name) && isVitestObject(member.object))
      )) add({ kind: 'import', specifier: value });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...requests.values()];
}

function importOrigin(symbol: ts.Symbol | undefined): ImportOrigin | undefined {
  for (const declaration of symbol?.declarations ?? []) {
    let binding: string;
    if (ts.isImportSpecifier(declaration)) binding = (declaration.propertyName ?? declaration.name).text;
    else if (ts.isImportClause(declaration)) binding = 'default';
    else if (ts.isNamespaceImport(declaration)) binding = '*';
    else if (ts.isImportEqualsDeclaration(declaration)) {
      const reference = declaration.moduleReference;
      if (ts.isExternalModuleReference(reference) && reference.expression && ts.isStringLiteralLike(reference.expression)) {
        return { specifier: reference.expression.text, binding: '*' };
      }
      continue;
    } else continue;
    let parent: ts.Node = declaration;
    while (!ts.isImportDeclaration(parent)) parent = parent.parent;
    if (ts.isStringLiteralLike(parent.moduleSpecifier)) return { specifier: parent.moduleSpecifier.text, binding };
  }
  return undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}

function staticMember(node: ts.Expression): { object: ts.Expression; name: string } | undefined {
  node = unwrap(node);
  if (ts.isPropertyAccessExpression(node)) return { object: unwrap(node.expression), name: node.name.text };
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return { object: unwrap(node.expression), name: node.argumentExpression.text };
  return undefined;
}
