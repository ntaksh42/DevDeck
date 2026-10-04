export function demoProjectTeams() {
  return {
    truncated: false,
    teams: [
      {
        id: "team-1",
        name: "Demo Project Team",
        description: "The default team for the project.",
        members: [
          { displayName: "Demo User", uniqueName: "demo.user@contoso.com", isTeamAdmin: true },
          { displayName: "Alex Reviewer", uniqueName: "alex.reviewer@contoso.com", isTeamAdmin: false },
          { displayName: "Sam Developer", uniqueName: "sam.developer@contoso.com", isTeamAdmin: false },
        ],
      },
      {
        id: "team-2",
        name: "Platform",
        description: null,
        members: [{ displayName: "Alex Reviewer", uniqueName: "alex.reviewer@contoso.com", isTeamAdmin: true }],
      },
    ],
  };
}

export function demoServiceConnections() {
  return [
    { id: "sc-1", name: "Azure prod", endpointType: "azurerm", description: "Production subscription", isReady: true, isShared: false },
    { id: "sc-2", name: "GitHub", endpointType: "github", description: null, isReady: true, isShared: true },
    { id: "sc-3", name: "Legacy registry", endpointType: "dockerregistry", description: null, isReady: false, isShared: false },
  ];
}

export function demoServiceHooks() {
  return [
    { id: "hook-1", status: "enabled", publisher: "tfs", eventType: "build.complete", consumer: "slack", consumerAction: "postMessageToChannel" },
    { id: "hook-2", status: "disabledBySystem", publisher: "tfs", eventType: "git.pullrequest.created", consumer: "webHooks", consumerAction: "httpRequest" },
  ];
}
