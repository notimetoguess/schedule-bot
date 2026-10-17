import { readFile } from "node:fs/promises";

export type WebappAsset = "auth.html" | "auth.css" | "auth.js";

export function readWebappAsset(asset: WebappAsset): Promise<string> {
  return readFile(new URL(`./webapp/${asset}`, import.meta.url), "utf8");
}
