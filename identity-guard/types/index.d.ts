/** One line naming the off-list identity in the current repo, or null when all is well. */
export type IdentityProblem = string | null

declare module 'claude-code' {
  interface PluginState {
    'identity-guard': { problem: IdentityProblem }
  }
}
