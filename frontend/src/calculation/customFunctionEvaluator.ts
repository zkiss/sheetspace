import type { ModelColumnType, Workbook } from '@workbook/core/model';
import type { CalculationSheet } from '@workbook/read/calculationProjection';
import type { FormulaExpression, FunctionFormula } from '@workbook/formula/syntax';
import { analyzeFunctionBody } from '@workbook/formula/functionBodyAnalysis';
import { diagnosticError, formulaScalarValue, matchesModelColumnType, type FormulaScalarValue, type FormulaValue } from './formulaValue';
import type { FormulaReferenceArgumentResult } from './formulaFunctions';

type Binding = { value: () => FormulaValue; type: ModelColumnType; expression: FormulaExpression; sheet: CalculationSheet; environment: Environment; active: readonly string[] };
type Environment = ReadonlyMap<string, Binding>;

export class CustomFunctionEvaluator {
  private environment: Environment = new Map();
  private active: readonly string[] = [];

  constructor(
    private readonly workbook: Workbook | undefined,
    private readonly evaluate: (expression: FormulaExpression, sheet: CalculationSheet) => FormulaValue,
  ) {}

  parameter(name: string): FormulaValue {
    return this.environment.get(name.toUpperCase())?.value() ?? diagnosticError('#NAME!', 'Unbound parameter.');
  }

  evaluateCell<T>(run: () => T): T {
    return this.withContext(new Map(), [], run);
  }

  resolveSyntax(expression: FormulaExpression): FormulaExpression {
    if (expression.kind === 'group') return { ...expression, expression: this.resolveSyntax(expression.expression) };
    if (expression.kind !== 'parameter') return expression;
    const binding = this.environment.get(expression.name.toUpperCase());
    return binding ? this.withContext(binding.environment, binding.active, () => this.resolveSyntax(binding.expression)) : expression;
  }

  reference(expression: FormulaExpression, sheet: CalculationSheet, evaluate: (expression: FormulaExpression, sheet: CalculationSheet) => FormulaReferenceArgumentResult): FormulaReferenceArgumentResult {
    if (expression.kind === 'group') return this.reference(expression.expression, sheet, evaluate);
    if (expression.kind !== 'parameter') return evaluate(expression, sheet);
    const binding = this.environment.get(expression.name.toUpperCase());
    if (!binding) return { ok: false, error: '#NAME!', message: 'Unbound parameter.' };
    const result = this.withContext(binding.environment, binding.active, () => this.reference(binding.expression, binding.sheet, evaluate));
    if (!result.ok) return result;
    const values = result.value.values;
    const type = binding.type;
    return { ok: true, value: { ...result.value, values: { *[Symbol.iterator]() {
      for (const value of values) yield checkedType(value, type);
    } } } };
  }

  call(expression: FunctionFormula, sheet: CalculationSheet): FormulaValue {
    const name = expression.functionName.toUpperCase();
    const definition = this.workbook?.functions?.find((item) => item.name.toUpperCase() === name);
    if (!definition || !this.workbook) return diagnosticError('#NAME!', `Unknown function ${name}.`);
    if (expression.arguments.length !== definition.parameters.length) return diagnosticError('#VALUE!', `${name} expected ${definition.parameters.length} arguments, got ${expression.arguments.length}.`);
    if (this.active.includes(name)) return diagnosticError('#CYCLE!', 'Recursive function call.');
    const analysis = analyzeFunctionBody(definition, this.workbook, sheet.id);
    const parsed = analysis.bound?.result;
    if (!parsed || parsed.kind !== 'formula') return diagnosticError(parsed?.kind === 'error' ? parsed.error : analysis.diagnostics[0]?.code ?? '#PARSE!', 'Could not parse function body.');
    const outerEnvironment = this.environment;
    const outerActive = this.active;
    const bindings = new Map<string, Binding>();
    definition.parameters.forEach((parameter, index) => {
      const argument = expression.arguments[index];
      bindings.set(parameter.name.toUpperCase(), { expression: argument, type: parameter.type, sheet, environment: outerEnvironment, active: outerActive, value: () => this.withContext(outerEnvironment, outerActive, () => {
        const value = formulaScalarValue(this.evaluate(argument, sheet));
        return checkedType(value, parameter.type);
      }) });
    });
    return this.withContext(bindings, [...outerActive, name], () => this.evaluate(parsed.expression, sheet));
  }

  private withContext<T>(environment: Environment, active: readonly string[], run: () => T): T {
    const previousEnvironment = this.environment;
    const previousActive = this.active;
    this.environment = environment;
    this.active = active;
    try { return run(); } finally {
      this.environment = previousEnvironment;
      this.active = previousActive;
    }
  }
}

function checkedType(value: FormulaScalarValue, type: ModelColumnType): FormulaScalarValue {
  return matchesModelColumnType(value, type) ? value : diagnosticError('#VALUE!', `Expected ${type}.`);
}
