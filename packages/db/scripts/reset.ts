import { resetSchema, runMigrations, runSeeds, withClient } from "./lib";

await withClient(async (client) => {
  await resetSchema(client);
  await runMigrations(client);
  await runSeeds(client);
});
