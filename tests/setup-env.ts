process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/distrilux_test";
process.env.CORS_ORIGINS ??= "http://localhost:5173";
process.env.LOG_LEVEL ??= "silent";
