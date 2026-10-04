export function demoBranchPolicies() {
  return [
    { id: 1, name: "Minimum number of reviewers", isEnabled: true, isBlocking: true, detail: "2 approvers" },
    { id: 2, name: "Build", isEnabled: true, isBlocking: true, detail: "CI build" },
    { id: 3, name: "Work item linking", isEnabled: true, isBlocking: false, detail: null },
    { id: 4, name: "Comment requirements", isEnabled: false, isBlocking: true, detail: null },
  ];
}
