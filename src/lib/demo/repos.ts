import type { RepositoryOption } from "@/lib/azdoCommands";

export function demoRepositories(): RepositoryOption[] {
  return [
    {
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
    },
    {
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
    },
    {
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
    },
    {
      projectId: "infrastructure",
      projectName: "Infrastructure",
      repositoryId: "terraform-aws",
      repositoryName: "terraform-aws",
    },
  ];
}

// Demo branches. `main` is the default and sorts first.
export function demoRepoBranches() {
  return [
    { name: "main", isDefault: true },
    { name: "develop", isDefault: false },
    { name: "feature/dashboard", isDefault: false },
  ];
}
