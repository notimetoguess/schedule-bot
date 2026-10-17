import { copyFile, cp, mkdir } from "node:fs/promises";

const sourceDirectory = new URL("../src/webapp/", import.meta.url);
const outputDirectory = new URL("../dist/src/webapp/", import.meta.url);
const assets = ["auth.html", "auth.css", "auth.js"];

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  assets.map((asset) => copyFile(new URL(asset, sourceDirectory), new URL(asset, outputDirectory))),
);

await cp(new URL("../src/assets/", import.meta.url), new URL("../dist/src/assets/", import.meta.url), { recursive: true });
