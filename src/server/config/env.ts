import "server-only";
import { validateServerEnvironment } from "./schema";
export const serverEnv = () => validateServerEnvironment(process.env);
