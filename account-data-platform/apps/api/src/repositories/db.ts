import { createDb } from "@pkg/db";
import { config } from "../config";

export const db = createDb(config.databaseUrl);
