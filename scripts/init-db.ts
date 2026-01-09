import "reflect-metadata";
import { getDataSource } from "../lib/db";

async function initializeDatabase() {
  try {
    console.log("Initializing database connection...");
    const dataSource = await getDataSource();
    console.log("Database connection initialized successfully!");

    console.log("Running synchronization...");
    await dataSource.synchronize();
    console.log("Database synchronized successfully!");

    console.log("\nDatabase is ready to use.");
    process.exit(0);
  } catch (error) {
    console.error("Error initializing database:", error);
    process.exit(1);
  }
}

initializeDatabase();
