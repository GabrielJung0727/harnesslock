import { version } from "../package.json";

/** Read from package.json at build time, so `npm version` is the single source of truth. */
export const VERSION: string = version;
