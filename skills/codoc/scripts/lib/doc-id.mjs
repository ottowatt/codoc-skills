import { usage } from "./output.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseDocumentId(value) {
  if (typeof value === "string" && UUID.test(value)) return value.toLowerCase();
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/");
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (parts[index] === "d" && UUID.test(parts[index + 1])) return parts[index + 1].toLowerCase();
    }
  } catch {
    // Only an actual URL or bare UUID is an address; guessing from arbitrary text is unsafe.
  }
  throw usage(`${String(value)} is not a document id.`);
}
