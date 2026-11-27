import { writeFile } from "node:fs/promises";

// Loads every module's routes, which register their paths in the registry.
import "../src/app/create-app.js";
import { createOpenApiDocument } from "../src/shared/http/openapi.js";

await writeFile(
  "openapi.json",
  `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`,
  "utf8",
);
