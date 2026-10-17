import { z } from "zod";
import { invokeCommand } from "./runtime";

/** Whether DevDeck is registered to start at sign-in, as the OS reports it. */
export async function getAutostartEnabled(): Promise<boolean> {
  const result = await invokeCommand("get_autostart_enabled", {});
  return z.boolean().parse(result);
}

/** Registers or removes the sign-in startup entry; resolves to the OS state afterwards. */
export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  const result = await invokeCommand("set_autostart_enabled", { enabled });
  return z.boolean().parse(result);
}
