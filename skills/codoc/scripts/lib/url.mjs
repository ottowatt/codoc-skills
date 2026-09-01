import { usage } from "./output.mjs";

export function normalizeBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw usage(`--base is not a valid URL: ${raw}`);
  }
  if (!/^https?:$/u.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
    throw usage("--base must be an HTTP(S) origin without a path, query, or fragment.");
  }
  return raw.replace(/\/+$/u, "");
}

export function queryPath(pathname, entries) {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== undefined) params.append(key, String(value));
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
