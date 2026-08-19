import { Pool } from "pg";

const connectionString = process.env.OPENMMP_APP_DATABASE_URL;
if (!connectionString) throw new Error("OPENMMP_APP_DATABASE_URL is required");

const pool = new Pool({ connectionString, max: 2 });
await pool.query("SELECT 1");
console.log("Open MMP worker connected to PostgreSQL");

const interval = Number(process.env.OPENMMP_WORKER_POLL_MS ?? "5000");
const timer = setInterval(() => undefined, interval);

async function stop(): Promise<void> {
  clearInterval(timer);
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
