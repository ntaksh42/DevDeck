import { configure } from "@testing-library/react";

// The App integration tests render the whole application and chain several
// asynchronous queries. They run in parallel across vitest workers, so under
// load the default 1000ms `findBy*` timeout can be exceeded on slower machines.
// Raise the async utility timeout to keep these heavy renders from flaking.
configure({ asyncUtilTimeout: 15000 });
