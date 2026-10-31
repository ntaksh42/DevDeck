// Moves the running fake Azure DevOps scenario to its next stage.
//   pnpm fake-ado:next [-- --port <n>]
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { port: { type: "string", default: "8787" } } });
const response = await fetch(`http://127.0.0.1:${values.port}/_fake/next`, { method: "POST" });
const body = await response.json();
console.log(body.changed ? `${body.changed}\nRun "Sync now" in DevDeck to pick it up.` : "Already at the last stage.");
