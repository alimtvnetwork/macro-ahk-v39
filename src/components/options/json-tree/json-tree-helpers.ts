import type { JsonValue, JsonObject, JsonArray } from "./json-tree-types";
import { logError } from "../options-logger";

/** Safely parse a JSON string, returning null on failure. */
export function safeParse(str: string): JsonValue {
  try {
    return JSON.parse(str);
  } catch (parseError: unknown) {
    return null;
  }
}

/** Check if a value is a plain JSON object (not array, not null). */
export function isObject(val: JsonValue): val is JsonObject {
  const isNonNull = val !== null;
  const isObjType = typeof val === "object";
  const isNotArray = !Array.isArray(val);

  return isNonNull && isObjType && isNotArray;
}

/** Check if a value is a JSON primitive (string, number, boolean, null). */
export function isPrimitive(val: JsonValue): val is string | number | boolean | null {
  const isObj = isObject(val);
  const isArr = Array.isArray(val);
  return !isObj && !isArr;
}

/** Format a primitive value for display. */
export function formatPrimitive(val: JsonValue): string {
  const isNull = val === null;
  if (isNull) return "null";

  const isString = typeof val === "string";
  if (isString) {
    const isEmpty = val === "";
    return isEmpty ? '""' : `"${val}"`;
  }

  return String(val);
}

/** Parse user input string into the appropriate JSON value type. */
export function parseInputValue(input: string): JsonValue {
  const trimmed = input.trim();

  const isTrue = trimmed === "true";
  if (isTrue) return true;

  const isFalse = trimmed === "false";
  if (isFalse) return false;

  const isNullLiteral = trimmed === "null";
  if (isNullLiteral) return null;

  const asNum = Number(trimmed);
  const isNonEmpty = trimmed !== "";
  const isValidNumber = !isNaN(asNum);
  const isNumeric = isNonEmpty && isValidNumber;
  if (isNumeric) return asNum;

  return parseAsJsonOrString(trimmed);
}

/** Attempt JSON parse for objects/arrays, fall back to plain string. */
function parseAsJsonOrString(trimmed: string): JsonValue {
  try {
    const parsed = JSON.parse(trimmed);
    const isComplex = typeof parsed === "object";
    if (isComplex) return parsed;
  } catch (jsonParseError: unknown) {
    logError("jsonTreeHelpers.parseAsJsonOrString", "JSON.parse failed — treating value as plain string (expected for non-JSON cell values)", jsonParseError);
  }

  return trimmed;
}

/** Set a value at a nested path within a JSON object. */
export function setNestedValue(
  root: JsonObject,
  path: string[],
  value: JsonValue,
): JsonObject {
  const isTopLevel = path.length === 1;
  if (isTopLevel) {
    return { ...root, [path[0]]: value };
  }

  const [head, ...rest] = path;
  const child = root[head];

  return setNestedChild(root, head, child, rest, value);
}

/** Handle setting a value on a child node (object or array). */
function setNestedChild(
  root: JsonObject,
  head: string,
  child: JsonValue,
  rest: string[],
  value: JsonValue,
): JsonObject {
  const isChildObject = isObject(child);
  if (isChildObject) {
    return { ...root, [head]: setNestedValue(child, rest, value) };
  }

  const isChildArray = Array.isArray(child);
  if (isChildArray) {
    return { ...root, [head]: setArrayChild(child, rest, value) };
  }

  return { ...root, [head]: value };
}

/** Set a value within an array child at a given index path. */
function setArrayChild(
  child: JsonArray,
  rest: string[],
  value: JsonValue,
): JsonArray {
  const idx = parseInt(rest[0], 10);
  const isDirectChild = rest.length === 1;
  const newArr = [...child];

  if (isDirectChild) {
    newArr[idx] = value;
    return newArr;
  }

  const item = newArr[idx];
  const isItemObject = isObject(item);

  if (isItemObject) {
    newArr[idx] = setNestedValue(item, rest.slice(1), value);
  }

  return newArr;
}

/** Delete a key at a nested path within a JSON object. */
export function deleteNestedKey(
  root: JsonObject,
  path: string[],
): JsonObject {
  const isTopLevel = path.length === 1;

  if (isTopLevel) {
    const { [path[0]]: _, ...rest } = root;
    return rest;
  }

  const [head, ...restPath] = path;
  const child = root[head];

  return deleteNestedChild(root, head, child, restPath);
}

/** Handle deleting a key from a child node (object or array). */
function deleteNestedChild(
  root: JsonObject,
  head: string,
  child: JsonValue,
  restPath: string[],
): JsonObject {
  const isChildObject = isObject(child);
  if (isChildObject) {
    return { ...root, [head]: deleteNestedKey(child, restPath) };
  }

  const isChildArray = Array.isArray(child);
  if (isChildArray) {
    return { ...root, [head]: deleteArrayChild(child, restPath) };
  }

  return root;
}

/** Delete an item or nested key within an array child. */
function deleteArrayChild(
  child: JsonArray,
  restPath: string[],
): JsonArray {
  const idx = parseInt(restPath[0], 10);
  const isDirectChild = restPath.length === 1;

  if (isDirectChild) {
    return child.filter((_, i) => i !== idx);
  }

  const newArr = [...child];
  const item = newArr[idx];
  const isItemObject = isObject(item);

  if (isItemObject) {
    newArr[idx] = deleteNestedKey(item, restPath.slice(1));
  }

  return newArr;
}

/** Rename a key at a nested path, preserving property order. */
export function renameNestedKey(
  root: JsonObject,
  path: string[],
  newKey: string,
): JsonObject {
  const isTopLevel = path.length === 1;

  if (isTopLevel) {
    return renameTopLevelKey(root, path[0], newKey);
  }

  const [head, ...rest] = path;
  const child = root[head];
  const isChildObject = isObject(child);

  if (isChildObject) {
    return { ...root, [head]: renameNestedKey(child, rest, newKey) };
  }

  return root;
}

/** Rename a top-level key while preserving entry order. */
function renameTopLevelKey(
  root: JsonObject,
  oldKey: string,
  newKey: string,
): JsonObject {
  const entries = Object.entries(root).map(([k, v]) => {
    const isTarget = k === oldKey;
    return isTarget
      ? [newKey, v] as [string, JsonValue]
      : [k, v] as [string, JsonValue];
  });

  return Object.fromEntries(entries);
}

/** Generate a unique key name within an object by appending a counter. */
export function generateUniqueKey(obj: JsonObject, base: string): string {
  const isKeyAvailable = !(base in obj);
  if (isKeyAvailable) return base;

  let counter = 1;
  let candidate = `${base}${counter}`;

  while (candidate in obj) {
    counter++;
    candidate = `${base}${counter}`;
  }

  return candidate;
}
