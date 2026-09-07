import { tokenize, TokenType, type CSSToken } from '@csstools/css-tokenizer';

interface Component {
  token: CSSToken;
  children?: Component[];
}

export interface CssDependencies {
  imports: number;
  urls: string[];
  errors: string[];
}

const closingTokens = new Map([
  [TokenType.Function, TokenType.CloseParen],
  [TokenType.OpenParen, TokenType.CloseParen],
  [TokenType.OpenSquare, TokenType.CloseSquare],
  [TokenType.OpenCurly, TokenType.CloseCurly],
]);
const closers = new Set(closingTokens.values());
const asciiLower = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** Extract dependencies from decoded component values, never from comments or string contents. */
export function cssDependencies(css: string): CssDependencies {
  const result: CssDependencies = { imports: 0, urls: [], errors: [] };
  const tokens = tokenize({ css }, { onParseError: (error) => result.errors.push(error.message) });
  let index = 0;
  const components = (closing?: TokenType): Component[] => {
    const values: Component[] = [];
    while (index < tokens.length) {
      const token = tokens[index++]!;
      if (token[0] === TokenType.EOF) break;
      if (token[0] === closing) return values;
      if (closers.has(token[0])) {
        result.errors.push(`Unexpected closing token at ${token[2]}`);
        continue;
      }
      if (token[0] === TokenType.Comment || token[0] === TokenType.Whitespace) continue;
      const end = closingTokens.get(token[0]);
      values.push({ token, ...(end ? { children: components(end) } : {}) });
    }
    if (closing) result.errors.push(`Missing ${closing}`);
    return values;
  };

  const visit = (values: Component[]): void => {
    for (const { token, children } of values) {
      if (token[0] === TokenType.BadURL || token[0] === TokenType.BadString) result.errors.push(`Malformed ${token[0]} at ${token[2]}`);
      if (token[0] === TokenType.AtKeyword && asciiLower(token[4].value) === 'import') result.imports++;
      if (token[0] === TokenType.URL) result.urls.push(token[4].value);
      if (token[0] === TokenType.Function) {
        const name = asciiLower(token[4].value);
        if (name === 'url') {
          const argument = children?.[0]?.token;
          if (children?.length === 1 && argument?.[0] === TokenType.String) result.urls.push(argument[4].value);
          else result.errors.push(`Expected a single string in url() at ${token[2]}`);
        } else if (name === 'image-set' || name === '-webkit-image-set') {
          // Only the first component of each candidate can be a string image.
          // Strings nested in type() are descriptors, not asset references.
          let candidateStart = true;
          for (const child of children ?? []) {
            if (candidateStart && child.token[0] !== TokenType.String && child.token[0] !== TokenType.URL && child.token[0] !== TokenType.Function) {
              result.errors.push(`Expected an image-set candidate at ${child.token[2]}`);
            }
            if (candidateStart && child.token[0] === TokenType.Function && ['var', 'env', 'attr'].includes(asciiLower(child.token[4].value))) {
              result.errors.push(`Dynamic image-set candidates are unsupported at ${child.token[2]}`);
            }
            if (child.token[0] === TokenType.String) {
              if (candidateStart) result.urls.push(child.token[4].value);
              else result.errors.push(`Unexpected image-set string at ${child.token[2]}`);
            }
            candidateStart = child.token[0] === TokenType.Comma;
          }
          if (candidateStart) result.errors.push(`Missing image-set candidate at ${token[2]}`);
        }
      }
      if (children) visit(children);
    }
  };
  visit(components());
  return result;
}
