// Starts the fake Azure DevOps server and the desktop app pointed at it.
//
//   pnpm tauri:fake [-- options]
//
// Options:
//   --scenario <name>          scenario under scenarios/ (default: inbox)
//   --port <n>                 server port (default: 8787)
//   --org <name>               organization name to add in Settings (default: fake)
//   --data-dir <path>          DevDeck data folder (default: %LOCALAPPDATA%\DevDeck-fake\<scenario>)
//   --fresh                    delete that data folder first (only under a DevDeck-fake folder)
//   --many-prs                 add 105 review PRs, past the Inbox scan cap
//   --reject-recent-mentions   reject @RecentMentions WIQL like an older server
//   --ui-port <n>              Vite port of this app (default: 1430, so a normal
//                              `pnpm tauri dev` on 1420 can keep running)
//   --server-only              start only the server (for `pnpm tauri dev` run by hand)

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { startFakeAdo } from "./server.mjs";

const { values } = parseArgs({
  options: {
    scenario: { type: "string", default: "inbox" },
    port: { type: "string", default: "8787" },
    org: { type: "string", default: "fake" },
    "data-dir": { type: "string" },
    fresh: { type: "boolean", default: false },
    "many-prs": { type: "boolean", default: false },
    "reject-recent-mentions": { type: "boolean", default: false },
    "ui-port": { type: "string", default: "1430" },
    "server-only": { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const here = path.dirname(fileURLToPath(import.meta.url));
const scenario = await import(pathToFileURL(path.join(here, "scenarios", `${values.scenario}.mjs`)).href);
const port = Number(values.port);
const baseUrl = `http://127.0.0.1:${port}`;
const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const dataDir = path.resolve(values["data-dir"] ?? path.join(localAppData, "DevDeck-fake", values.scenario));

// Only ever delete a folder under DevDeck-fake, never the real app data.
if (values.fresh) {
  if (!dataDir.split(path.sep).includes("DevDeck-fake")) {
    throw new Error(`refusing to delete ${dataDir}`);
  }
  rmSync(dataDir, { recursive: true, force: true });
}

const server = await startFakeAdo({
  scenario,
  org: values.org,
  port,
  options: { manyPrs: values["many-prs"], rejectRecentMentions: values["reject-recent-mentions"] },
});

console.log(`[fake-ado] ${values.scenario} scenario at ${baseUrl}/${values.org}`);
console.log(`[fake-ado] data folder: ${dataDir}`);
console.log(`[fake-ado] first run: Settings -> add organization "${values.org}" with PAT auth (any PAT text).`);
console.log(`[fake-ado] next stage: pnpm fake-ado:next   (then Sync now)`);

if (values["server-only"]) {
  console.log(`[fake-ado] set DEVDECK_ADO_BASE_URL=${baseUrl} and DEVDECK_DATA_DIR=${dataDir} for the app.`);
} else {
  const uiPort = values["ui-port"];
  // Passed as a file: inline JSON does not survive the Windows shell quoting.
  const configPath = path.join(dataDir, "tauri.fake.conf.json");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      build: { devUrl: `http://127.0.0.1:${uiPort}`, beforeDevCommand: `pnpm dev --port ${uiPort} --strictPort` },
    }),
  );
  const app = spawn("pnpm", ["tauri", "dev", "--config", `"${configPath}"`], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DEVDECK_ADO_BASE_URL: baseUrl, DEVDECK_DATA_DIR: dataDir },
  });
  app.on("exit", (code) => {
    server.close();
    process.exit(code ?? 0);
  });
}
