import { usage } from "./output.mjs";

export function parseArgs(argv, specification = {}) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const flag = equals < 0 ? token : token.slice(0, equals);
    const inlineValue = equals < 0 ? undefined : token.slice(equals + 1);
    const kind = specification[flag];
    if (!kind) throw usage(`Unknown flag: ${flag}`);
    const name = flag.slice(2);
    if (kind === "boolean") {
      if (inlineValue !== undefined) throw usage(`${flag} does not take a value.`);
      options[name] = true;
      continue;
    }
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
      throw usage(`${flag} requires a value; use ${flag}=<value> when it begins with --.`);
    }
    if (inlineValue === undefined) index += 1;
    if (kind === "repeat") {
      (options[name] ??= []).push(value);
    } else {
      if (options[name] !== undefined) throw usage(`${flag} may only be supplied once.`);
      options[name] = value;
    }
  }
  return { options, positional };
}

export function required(value, label) {
  if (value === undefined || value === "") throw usage(`Missing ${label}.`);
  return value;
}

export function integer(value, flag, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^-?\d+$/u.test(String(value))) throw usage(`${flag} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw usage(`${flag} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

export function number(value, flag, { min = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) throw usage(`${flag} must be at least ${min}.`);
  return parsed;
}

export function oneOf(value, flag, values) {
  if (!values.includes(value)) throw usage(`${flag} must be one of: ${values.join(", ")}.`);
  return value;
}

export function noExtraPositionals(positional, expected) {
  if (positional.length > expected) throw usage(`Unexpected argument: ${positional[expected]}`);
}
