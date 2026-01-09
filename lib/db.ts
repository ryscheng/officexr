import "reflect-metadata";
import { DataSource } from "typeorm";
import { User } from "./entities/User";
import { Account } from "./entities/Account";
import { Session } from "./entities/Session";
import { VerificationToken } from "./entities/VerificationToken";
import { Office } from "./entities/Office";
import { OfficeUser } from "./entities/OfficeUser";
import { Invitation } from "./entities/Invitation";

let AppDataSource: DataSource | undefined;
let isInitialized = false;

export async function getDataSource(): Promise<DataSource> {
  if (!AppDataSource) {
    AppDataSource = new DataSource({
      type: "postgres",
      host: process.env.DATABASE_HOST || "localhost",
      port: parseInt(process.env.DATABASE_PORT || "5432"),
      username: process.env.DATABASE_USER || "postgres",
      password: process.env.DATABASE_PASSWORD || "postgres",
      database: process.env.DATABASE_NAME || "officexr",
      synchronize: process.env.NODE_ENV === "development",
      logging: process.env.NODE_ENV === "development",
      entities: [User, Account, Session, VerificationToken, Office, OfficeUser, Invitation],
      subscribers: [],
      migrations: [],
    });
  }

  if (!isInitialized) {
    await AppDataSource.initialize();
    isInitialized = true;
    console.log("Database connection initialized");
  }
  return AppDataSource;
}
