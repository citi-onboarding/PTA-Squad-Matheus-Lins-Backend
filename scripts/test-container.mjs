import { execFileSync } from "node:child_process";

const image = "distrilux:smoke";
const migrationImage = "distrilux:migration-smoke";
const network = "distrilux-smoke";
const databaseContainer = "distrilux-smoke-db";
const apiContainer = "distrilux-smoke-api";

function docker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: options.quiet ? "ignore" : "inherit",
  });
}

function cleanup() {
  for (const container of [apiContainer, databaseContainer]) {
    try {
      docker(["rm", "--force", container], { quiet: true });
    } catch {
      // The container may not exist during idempotent cleanup.
    }
  }
  try {
    docker(["network", "rm", network], { quiet: true });
  } catch {
    // The network may not exist during idempotent cleanup.
  }
}

cleanup();
try {
  docker(["build", "--tag", image, "."]);
  docker(["build", "--target", "migration", "--tag", migrationImage, "."]);
  docker(["network", "create", network]);
  docker([
    "run",
    "--detach",
    "--name",
    databaseContainer,
    "--network",
    network,
    "--env",
    "POSTGRES_PASSWORD=postgres",
    "--env",
    "POSTGRES_DB=distrilux",
    "postgres:17-alpine",
  ]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      docker(
        [
          "exec",
          databaseContainer,
          "pg_isready",
          "-U",
          "postgres",
          "-d",
          "distrilux",
        ],
        { quiet: true },
      );
      break;
    } catch {
      if (attempt === 29) throw new Error("PostgreSQL did not become ready.");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  const databaseUrl = `postgresql://postgres:postgres@${databaseContainer}:5432/distrilux`;
  docker([
    "run",
    "--rm",
    "--network",
    network,
    "--env",
    `DATABASE_URL=${databaseUrl}`,
    migrationImage,
  ]);
  docker([
    "run",
    "--detach",
    "--name",
    apiContainer,
    "--network",
    network,
    "--publish",
    "3001:3001",
    "--env",
    `DATABASE_URL=${databaseUrl}`,
    "--env",
    "CORS_ORIGINS=http://localhost:5173",
    // Required at startup; the container test never calls the ERP (ADR-0003).
    "--env",
    "ERP_BASE_URL=https://pta-erp-api.onrender.com",
    "--env",
    "ERP_API_KEY=not-configured",
    // The placeholder key would only record failed ERP sync runs (ADR 0006).
    "--env",
    "SYNC_ENABLED=false",
    image,
  ]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:3001/health/ready");
      if (response.ok) break;
    } catch {
      // Retry until the API is ready or the bounded loop expires.
    }
    if (attempt === 29) throw new Error("API did not become ready.");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  for (const path of [
    "/health/live",
    "/health/ready",
    "/openapi.json",
    "/docs/",
  ]) {
    const response = await fetch(`http://127.0.0.1:3001${path}`);
    if (!response.ok) throw new Error(`${path} returned ${response.status}.`);
  }
  console.log("Production container smoke test passed.");
} finally {
  cleanup();
}
