import { readFile } from "node:fs/promises";

// Loads every module's routes, which register their paths in the registry.
import "../src/app/create-app.js";
import { createOpenApiDocument } from "../src/shared/http/openapi.js";

const expected = `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`;
const current = await readFile("openapi.json", "utf8");

if (current !== expected) {
  throw new Error(
    "openapi.json is stale. Run pnpm openapi:generate and commit the result.",
  );
}
