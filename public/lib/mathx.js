// Numeric conversion, a safe expression evaluator, unit conversion, and the
// small calculators developers reach for.

/* ---------------------------------------------------------------- bases -- */

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

export function parseInBase(value, base) {
  const text = value.trim().toLowerCase().replace(/[\s_]/g, "").replace(/^(0x|0b|0o)/, "");
  if (!text) throw new Error("Enter a number");
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  let result = 0n;
  const radix = BigInt(base);
  for (const character of digits) {
    const digit = DIGITS.indexOf(character);
    if (digit === -1 || digit >= base) throw new Error(`"${character}" is not a valid digit in base ${base}`);
    result = result * radix + BigInt(digit);
  }
  return negative ? -result : result;
}

export function formatInBase(value, base) {
  if (base < 2 || base > 36) throw new Error("The base must be between 2 and 36");
  const negative = value < 0n;
  let remaining = negative ? -value : value;
  const radix = BigInt(base);
  let output = "";
  do {
    output = DIGITS[Number(remaining % radix)] + output;
    remaining /= radix;
  } while (remaining > 0n);
  return negative ? `-${output}` : output;
}

export function convertBase(value, from, to) {
  return formatInBase(parseInBase(value, from), to);
}

export function baseReport(value, from) {
  const number = parseInBase(value, from);
  const rows = [
    ["Binary (2)", formatInBase(number, 2)],
    ["Octal (8)", formatInBase(number, 8)],
    ["Decimal (10)", formatInBase(number, 10)],
    ["Hex (16)", formatInBase(number, 16).toUpperCase()],
    ["Base32", formatInBase(number, 32)],
    ["Base36", formatInBase(number, 36)],
  ];
  if (number >= 0n && number <= 0xffffffffffffffffn) {
    rows.push(["Bit length", String(formatInBase(number, 2).replace("-", "").length)]);
    if (number <= 0xffffffffn) rows.push(["As bytes", formatInBase(number, 16).padStart(8, "0").match(/../g).join(" ")]);
  }
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, item]) => `${label.padEnd(width)}  ${item}`).join("\n");
}

/* ---------------------------------------------------------------- roman -- */

const ROMAN = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

export function toRoman(value) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number < 1 || number > 3999) throw new Error("Roman numerals cover 1 to 3999");
  let remaining = number;
  let output = "";
  for (const [amount, symbol] of ROMAN) {
    while (remaining >= amount) { output += symbol; remaining -= amount; }
  }
  return output;
}

export function fromRoman(value) {
  const text = value.trim().toUpperCase();
  if (!/^[MDCLXVI]+$/.test(text)) throw new Error("Roman numerals only use M, D, C, L, X, V, and I");
  const values = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
  let total = 0;
  for (let index = 0; index < text.length; index++) {
    const current = values[text[index]];
    const next = values[text[index + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  if (toRoman(total) !== text) throw new Error(`"${text}" is not a canonical Roman numeral — did you mean ${toRoman(total)}?`);
  return String(total);
}

export function convertRoman(input) {
  const trimmed = input.trim();
  return /^\d+$/.test(trimmed) ? toRoman(trimmed) : fromRoman(trimmed);
}

/* ----------------------------------------------------------- expressions - */

const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign,
  ln: Math.log, log: Math.log10, log2: Math.log2, log10: Math.log10, exp: Math.exp,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot, atan2: Math.atan2,
  deg: (radians) => (radians * 180) / Math.PI, rad: (degrees) => (degrees * Math.PI) / 180,
  fact: factorial, gcd, lcm,
};

const CONSTANTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2, inf: Infinity };

function factorial(value) {
  if (value < 0 || !Number.isInteger(value)) throw new Error("Factorial needs a non-negative whole number");
  if (value > 170) return Infinity;
  let result = 1;
  for (let index = 2; index <= value; index++) result *= index;
  return result;
}

function gcd(a, b) {
  let [x, y] = [Math.abs(Math.trunc(a)), Math.abs(Math.trunc(b))];
  while (y) [x, y] = [y, x % y];
  return x;
}

function lcm(a, b) {
  return Math.abs(Math.trunc(a) * Math.trunc(b)) / (gcd(a, b) || 1);
}

function tokenize(expression) {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const character = expression[index];
    if (/\s/.test(character)) { index++; continue; }
    if (/[\d.]/.test(character)) {
      const match = /^(0x[0-9a-f]+|0b[01]+|\d*\.?\d+(?:[eE][+-]?\d+)?)/i.exec(expression.slice(index));
      if (!match) throw new Error(`Unexpected number near position ${index}`);
      const raw = match[0];
      tokens.push({ type: "number", value: /^0x/i.test(raw) ? Number.parseInt(raw, 16) : /^0b/i.test(raw) ? Number.parseInt(raw.slice(2), 2) : Number(raw) });
      index += raw.length;
      continue;
    }
    if (/[a-z_]/i.test(character)) {
      const match = /^[a-z_]\w*/i.exec(expression.slice(index));
      tokens.push({ type: "name", value: match[0].toLowerCase() });
      index += match[0].length;
      continue;
    }
    if ("+-*/%^(),!".includes(character)) {
      if (character === "*" && expression[index + 1] === "*") { tokens.push({ type: "operator", value: "^" }); index += 2; continue; }
      tokens.push({ type: character === "(" || character === ")" ? "paren" : character === "," ? "comma" : "operator", value: character });
      index++;
      continue;
    }
    throw new Error(`"${character}" is not valid in an expression`);
  }
  return tokens;
}

const PRECEDENCE = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 4, "u-": 3 };
const RIGHT_ASSOCIATIVE = new Set(["^", "u-"]);

export function evaluateExpression(expression) {
  const tokens = tokenize(expression);
  if (!tokens.length) throw new Error("Enter an expression");
  const output = [];
  const operators = [];
  const argumentCounts = [];
  let previous = null;

  const applyOperator = (operator) => {
    if (operator === "u-") {
      const value = output.pop();
      if (value === undefined) throw new Error("A minus sign is missing its operand");
      output.push(-value);
      return;
    }
    const right = output.pop();
    const left = output.pop();
    if (left === undefined || right === undefined) throw new Error(`The "${operator}" operator is missing an operand`);
    const operations = {
      "+": left + right, "-": left - right, "*": left * right,
      "/": right === 0 ? (() => { throw new Error("Division by zero"); })() : left / right,
      "%": right === 0 ? (() => { throw new Error("Modulo by zero"); })() : left % right,
      "^": left ** right,
    };
    output.push(operations[operator]);
  };

  for (const token of tokens) {
    if (token.type === "number") { output.push(token.value); previous = token; continue; }
    if (token.type === "name") {
      if (token.value in CONSTANTS) { output.push(CONSTANTS[token.value]); previous = token; continue; }
      if (token.value in FUNCTIONS) { operators.push({ type: "function", value: token.value }); previous = token; continue; }
      throw new Error(`"${token.value}" is not a known function or constant`);
    }
    if (token.type === "comma") {
      while (operators.length && operators.at(-1).value !== "(") applyOperator(operators.pop().value);
      if (!argumentCounts.length) throw new Error("A comma can only appear inside a function call");
      argumentCounts[argumentCounts.length - 1]++;
      previous = token;
      continue;
    }
    if (token.type === "paren") {
      if (token.value === "(") {
        operators.push({ type: "paren", value: "(" });
        argumentCounts.push(1);
        previous = token;
        continue;
      }
      while (operators.length && operators.at(-1).value !== "(") applyOperator(operators.pop().value);
      if (!operators.length) throw new Error("There is a closing parenthesis without a matching opening one");
      operators.pop();
      const count = argumentCounts.pop();
      if (operators.length && operators.at(-1).type === "function") {
        const name = operators.pop().value;
        const args = output.splice(output.length - count, count);
        if (args.length !== count || args.some((value) => value === undefined)) throw new Error(`${name}() is missing arguments`);
        output.push(FUNCTIONS[name](...args));
      }
      previous = token;
      continue;
    }
    if (token.value === "!") {
      const value = output.pop();
      if (value === undefined) throw new Error("The factorial operator is missing its operand");
      output.push(factorial(value));
      previous = token;
      continue;
    }
    const unary = token.value === "-" && (previous === null || previous.type === "operator" || previous.type === "comma" || (previous.type === "paren" && previous.value === "("));
    const operator = unary ? "u-" : token.value;
    while (operators.length) {
      const top = operators.at(-1);
      if (top.value === "(") break;
      if (top.type === "function") { applyOperator(operators.pop().value); continue; }
      const topPrecedence = PRECEDENCE[top.value] ?? 0;
      const current = PRECEDENCE[operator];
      if (topPrecedence > current || (topPrecedence === current && !RIGHT_ASSOCIATIVE.has(operator))) applyOperator(operators.pop().value);
      else break;
    }
    operators.push({ type: "operator", value: operator });
    previous = token;
  }

  while (operators.length) {
    const top = operators.pop();
    if (top.value === "(") throw new Error("There is an unclosed parenthesis");
    applyOperator(top.value);
  }
  if (output.length !== 1) throw new Error("The expression is incomplete");
  const result = output[0];
  if (Number.isNaN(result)) throw new Error("The expression does not produce a number");
  return result;
}

export function evaluateLines(input) {
  return input.split("\n").map((line) => {
    if (!line.trim() || line.trim().startsWith("#")) return line;
    const value = evaluateExpression(line);
    const exact = Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
    return `${line.trim()} = ${exact}`;
  }).join("\n");
}

/* ----------------------------------------------------------------- units - */

export const UNITS = {
  length: { meter: 1, kilometer: 1000, centimeter: 0.01, millimeter: 0.001, micrometer: 1e-6, nanometer: 1e-9, mile: 1609.344, yard: 0.9144, foot: 0.3048, inch: 0.0254, "nautical mile": 1852, "light year": 9.4607304725808e15, parsec: 3.0856775814913673e16 },
  mass: { kilogram: 1, gram: 0.001, milligram: 1e-6, tonne: 1000, pound: 0.45359237, ounce: 0.028349523125, stone: 6.35029318, "us ton": 907.18474, "imperial ton": 1016.0469088, carat: 0.0002 },
  "data size": { byte: 1, bit: 0.125, kilobyte: 1000, kibibyte: 1024, megabyte: 1e6, mebibyte: 1048576, gigabyte: 1e9, gibibyte: 1073741824, terabyte: 1e12, tebibyte: 1099511627776, petabyte: 1e15, pebibyte: 1125899906842624 },
  time: { second: 1, millisecond: 0.001, microsecond: 1e-6, nanosecond: 1e-9, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629746, year: 31556952 },
  speed: { "meter per second": 1, "kilometer per hour": 0.2777777777777778, "mile per hour": 0.44704, knot: 0.5144444444444445, "foot per second": 0.3048, mach: 340.29 },
  area: { "square meter": 1, "square kilometer": 1e6, "square centimeter": 0.0001, hectare: 10000, acre: 4046.8564224, "square mile": 2589988.110336, "square foot": 0.09290304, "square inch": 0.00064516, "square yard": 0.83612736 },
  volume: { liter: 1, milliliter: 0.001, "cubic meter": 1000, "cubic centimeter": 0.001, "us gallon": 3.785411784, "imperial gallon": 4.54609, "us quart": 0.946352946, "us pint": 0.473176473, "us cup": 0.2365882365, "us fluid ounce": 0.0295735295625, tablespoon: 0.01478676478125, teaspoon: 0.00492892159375 },
  pressure: { pascal: 1, kilopascal: 1000, bar: 100000, "pound per square inch": 6894.757293168, atmosphere: 101325, torr: 133.32236842105263, millibar: 100 },
  energy: { joule: 1, kilojoule: 1000, calorie: 4.184, kilocalorie: 4184, "watt hour": 3600, "kilowatt hour": 3600000, electronvolt: 1.602176634e-19, "british thermal unit": 1055.05585262 },
  angle: { degree: 1, radian: 57.29577951308232, gradian: 0.9, turn: 360, arcminute: 1 / 60, arcsecond: 1 / 3600 },
};

const TEMPERATURES = {
  celsius: { toKelvin: (value) => value + 273.15, fromKelvin: (value) => value - 273.15 },
  fahrenheit: { toKelvin: (value) => (value - 32) * (5 / 9) + 273.15, fromKelvin: (value) => (value - 273.15) * (9 / 5) + 32 },
  kelvin: { toKelvin: (value) => value, fromKelvin: (value) => value },
  rankine: { toKelvin: (value) => value * (5 / 9), fromKelvin: (value) => value * (9 / 5) },
};

export function convertUnit(value, category, from, to) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Enter a number to convert");
  if (category === "temperature") {
    const source = TEMPERATURES[from];
    const target = TEMPERATURES[to];
    if (!source || !target) throw new Error("Pick a temperature scale");
    return target.fromKelvin(source.toKelvin(amount));
  }
  const table = UNITS[category];
  if (!table) throw new Error(`Unknown unit category "${category}"`);
  if (!(from in table) || !(to in table)) throw new Error(`Pick units from the ${category} category`);
  return (amount * table[from]) / table[to];
}

export function unitReport(value, category, from) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Enter a number to convert");
  const names = category === "temperature" ? Object.keys(TEMPERATURES) : Object.keys(UNITS[category] ?? {});
  if (!names.length) throw new Error(`Unknown unit category "${category}"`);
  if (!names.includes(from)) throw new Error(`"${from}" is not a ${category} unit`);
  const width = Math.max(...names.map((name) => name.length));
  return names.map((name) => {
    const converted = convertUnit(amount, category, from, name);
    return `${name.padEnd(width)}  ${formatNumber(converted)}`;
  }).join("\n");
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  if (value !== 0 && (Math.abs(value) < 1e-6 || Math.abs(value) >= 1e15)) return value.toExponential(6);
  const rounded = Number(value.toPrecision(12));
  return Number.isInteger(rounded) ? rounded.toLocaleString("en-US") : rounded.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

/* ---------------------------------------------------------------- chmod -- */

export function chmodReport(input) {
  const trimmed = input.trim();
  let octal;
  if (/^[0-7]{3,4}$/.test(trimmed)) octal = trimmed.padStart(4, "0");
  else if (/^[-dlbcps]?([rwxsStT-]{9})$/.test(trimmed)) octal = symbolicToOctal(trimmed.slice(-9));
  else if (/^[rwxsStT-]{9}$/.test(trimmed)) octal = symbolicToOctal(trimmed);
  else throw new Error('Enter a mode like "755" or "rwxr-xr-x"');
  const special = Number(octal[0]);
  const bits = octal.slice(1).split("").map(Number);
  const labels = ["Owner", "Group", "Other"];
  const symbolic = bits.map((bit, index) => {
    let text = `${bit & 4 ? "r" : "-"}${bit & 2 ? "w" : "-"}`;
    const executable = Boolean(bit & 1);
    if (index === 0 && special & 4) text += executable ? "s" : "S";
    else if (index === 1 && special & 2) text += executable ? "s" : "S";
    else if (index === 2 && special & 1) text += executable ? "t" : "T";
    else text += executable ? "x" : "-";
    return text;
  }).join("");
  const rows = [
    ["Octal", octal[0] === "0" ? octal.slice(1) : octal],
    ["Full octal", octal],
    ["Symbolic", symbolic],
    ["chmod command", `chmod ${octal[0] === "0" ? octal.slice(1) : octal} path`],
    ["", ""],
  ];
  const detail = labels.map((label, index) => {
    const bit = bits[index];
    const permissions = [bit & 4 ? "read" : null, bit & 2 ? "write" : null, bit & 1 ? "execute" : null].filter(Boolean);
    return `${label.padEnd(6)} ${bit}  ${permissions.length ? permissions.join(", ") : "no access"}`;
  });
  const specials = [special & 4 ? "setuid" : null, special & 2 ? "setgid" : null, special & 1 ? "sticky bit" : null].filter(Boolean);
  const width = Math.max(...rows.map(([label]) => label.length));
  return [
    ...rows.filter(([label]) => label).map(([label, item]) => `${label.padEnd(width)}  ${item}`),
    "",
    ...detail,
    "",
    `Special  ${special}  ${specials.length ? specials.join(", ") : "none"}`,
  ].join("\n");
}

function symbolicToOctal(symbolic) {
  let special = 0;
  const digits = [0, 1, 2].map((group) => {
    const chunk = symbolic.slice(group * 3, group * 3 + 3);
    let value = 0;
    if (chunk[0] === "r") value += 4;
    if (chunk[1] === "w") value += 2;
    if ("xst".includes(chunk[2])) value += 1;
    if (chunk[2] === "s" || chunk[2] === "S") special += group === 0 ? 4 : 2;
    if (chunk[2] === "t" || chunk[2] === "T") special += 1;
    return value;
  });
  return `${special}${digits.join("")}`;
}

/* ----------------------------------------------------------- percentage -- */

export function percentageReport(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Enter two numbers");
  const rows = [
    [`${x}% of ${y}`, formatNumber((x / 100) * y)],
    [`${x} is what % of ${y}`, y === 0 ? "undefined (division by zero)" : `${formatNumber((x / y) * 100)}%`],
    [`${x} → ${y} change`, x === 0 ? "undefined (division by zero)" : `${formatNumber(((y - x) / Math.abs(x)) * 100)}%`],
    [`${x} increased by ${y}%`, formatNumber(x * (1 + y / 100))],
    [`${x} decreased by ${y}%`, formatNumber(x * (1 - y / 100))],
    [`${x} after removing ${y}% tax`, formatNumber(x / (1 + y / 100))],
    [`Difference of ${x} and ${y}`, (x + y) === 0 ? "undefined" : `${formatNumber((Math.abs(x - y) / ((x + y) / 2)) * 100)}%`],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, item]) => `${label.padEnd(width)}  ${item}`).join("\n");
}
