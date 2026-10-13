import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";
import { closeAgentPanel } from "@/components/agent/agentPanelStore";

// The App integration tests render the whole application and chain several
// asynchronous queries. They run in parallel across vitest workers, so under
// load the default 1000ms `findBy*` timeout can be exceeded on slower machines.
// Raise the async utility timeout to keep these heavy renders from flaking.
configure({ asyncUtilTimeout: 15000 });

// jsdom has no ResizeObserver; dockview (DockableWorkspace) requires one to size
// its panels, so tests rendering it need at least a no-op stub.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// The Agent panel store is app-wide; each test starts with it closed.
beforeEach(() => closeAgentPanel());
