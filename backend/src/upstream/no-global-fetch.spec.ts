import 'reflect-metadata';
import * as path from 'node:path';
import * as ts from 'typescript';

type GlobalFetchGateOptions = {
  allowedFile: string;
  excludedSegments: readonly string[];
};

describe('production global fetch architecture gate', () => {
  it('rejects a local alias while ignoring project methods', () => {
    const fixtureFile = path.resolve('__no_global_fetch_fixture.ts');
    const program = createInMemoryProgram(
      fixtureFile,
      `const alias = fetch;
class Api { fetch(_url: string): void {} }
const api = new Api();
function bad() { alias('https://example.test'); api.fetch('https://example.test'); }
`,
    );

    const violations = collectGlobalFetchCalls(program, program.getTypeChecker(), {
      allowedFile: path.resolve('src/upstream/upstream-fetch.ts'),
      excludedSegments: [`${path.sep}playwright${path.sep}`],
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('alias');
    expect(violations[0]).not.toContain('api.fetch');
  });

  it('finds no direct global fetch outside timedFetch in production', () => {
    const sourceRoot = path.resolve('src');
    const files = ts.sys
      .readDirectory(sourceRoot, ['.ts'])
      .filter((fileName) => isProductionFile(fileName, [`${path.sep}playwright${path.sep}`]));
    const configPath = path.resolve('tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new Error(formatDiagnostic(config.error));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    const program = ts.createProgram(files, { ...parsed.options, noEmit: true });

    const violations = collectGlobalFetchCalls(program, program.getTypeChecker(), {
      allowedFile: path.resolve('src/upstream/upstream-fetch.ts'),
      excludedSegments: [`${path.sep}playwright${path.sep}`],
    });

    expect(violations).toEqual([]);
  });
});

function collectGlobalFetchCalls(
  program: ts.Program,
  checker: ts.TypeChecker,
  options: GlobalFetchGateOptions,
): string[] {
  const productionFiles = new Set(
    program
      .getRootFileNames()
      .filter((fileName) => isProductionFile(fileName, options.excludedSegments))
      .map((fileName) => path.normalize(fileName)),
  );
  const sourceFile = program
    .getSourceFiles()
    .find((candidate) => productionFiles.has(path.normalize(candidate.fileName)));
  if (!sourceFile) throw new Error('No production source files were added to the program');

  const globalFetch = checker
    .getSymbolsInScope(sourceFile, ts.SymbolFlags.Value)
    .find(
      (symbol) =>
        symbol.name === 'fetch' &&
        symbol.declarations?.some((declaration) => declaration.getSourceFile().isDeclarationFile),
    );
  if (!globalFetch) throw new Error('Could not resolve the global fetch symbol');

  const violations: string[] = [];
  for (const candidate of program.getSourceFiles()) {
    if (!productionFiles.has(path.normalize(candidate.fileName))) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const symbol = resolveCallSymbol(node.expression, checker);
        if (symbol === globalFetch && !isInsideTimedFetch(node, options.allowedFile)) {
          const position = candidate.getLineAndCharacterOfPosition(node.getStart(candidate));
          violations.push(
            `${path.relative(process.cwd(), candidate.fileName)}:${position.line + 1}:${position.character + 1} ${node.expression.getText(candidate)}`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(candidate, visit);
  }
  return violations;
}

function resolveCallSymbol(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(expression);
  if (!symbol || seen.has(symbol)) return symbol;
  return resolveSymbol(symbol, checker, seen);
}

function resolveSymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  seen: Set<ts.Symbol>,
): ts.Symbol {
  if (seen.has(symbol)) return symbol;
  seen.add(symbol);
  if (symbol.flags & ts.SymbolFlags.Alias) {
    return resolveSymbol(checker.getAliasedSymbol(symbol), checker, seen);
  }

  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (
    declaration &&
    (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) &&
    declaration.initializer
  ) {
    const initializerSymbol = checker.getSymbolAtLocation(declaration.initializer);
    if (initializerSymbol) return resolveSymbol(initializerSymbol, checker, seen);
  }
  return symbol;
}

function isInsideTimedFetch(node: ts.Node, allowedFile: string): boolean {
  if (path.normalize(node.getSourceFile().fileName) !== path.normalize(allowedFile)) return false;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent) && parent.name?.getText() === 'timedFetch') return true;
  }
  return false;
}

function isProductionFile(fileName: string, excludedSegments: readonly string[]): boolean {
  const normalized = path.normalize(fileName);
  return (
    normalized.endsWith('.ts') &&
    !normalized.endsWith('.spec.ts') &&
    !excludedSegments.some((segment) => normalized.includes(segment))
  );
}

function createInMemoryProgram(fileName: string, sourceText: string): ts.Program {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.getSourceFile = (requestedFileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    requestedFileName === fileName
      ? sourceFile
      : originalGetSourceFile(requestedFileName, languageVersion, onError, shouldCreateNewSourceFile);
  host.fileExists = (requestedFileName) =>
    requestedFileName === fileName || originalFileExists(requestedFileName);
  host.readFile = (requestedFileName) =>
    requestedFileName === fileName ? sourceText : originalReadFile(requestedFileName);
  return ts.createProgram([fileName], compilerOptions, host);
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}
