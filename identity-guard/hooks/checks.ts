// The three questions identity-guard asks, each answered from git alone.
import {
  type Run,
  baselineIdentity,
  commitIdentity,
  fixFacts,
  isIdentityAllowed,
  isInsideRepo,
  unpushedCommits,
} from './git'
import { type GitCall, type Ident, commitMessage, identityOverrides, isAllowed, offences, pushedRefs, pushMessage } from './rules'

export type Block = { deny: string; toast: string }

export const checkCommit = async (run: Run, call: GitCall, allowList: readonly Ident[]): Promise<Block | null> => {
  const found = await commitIdentity(run, call)
  if (isIdentityAllowed(found, allowList)) return null

  const overrides = identityOverrides(call)
  const facts = await fixFacts(run, call.prefix, allowList, overrides.length > 0 ? undefined : found)
  return {
    deny: commitMessage({ found, allowList, overrides, ...facts }),
    toast: `Identity guard: commit blocked, ${offences(found, allowList)[0]} is not on the allow-list`,
  }
}

export const checkPush = async (run: Run, call: GitCall, allowList: readonly Ident[]): Promise<Block | null> => {
  const refs = pushedRefs(call.args)
  if (refs === null) return null
  const unpushed = await unpushedCommits(run, call.prefix, refs)
  const bad = unpushed.filter(c => !isAllowed(c.author, allowList) || !isAllowed(c.committer, allowList))
  if (bad.length === 0) return null

  const { isBaselineAllowed, isGlobalAllowed } = await fixFacts(run, call.prefix, allowList)
  return {
    deny: pushMessage({ unpushed, bad, allowList, isIdentityAllowed: isBaselineAllowed, isGlobalAllowed }),
    toast: `Identity guard: push blocked, ${bad.length} unpushed commit${bad.length === 1 ? '' : 's'} off the allow-list`,
  }
}

// One line for the band, or null when all is well or this is not a repo.
export const currentProblem = async (run: Run, allowList: readonly Ident[]): Promise<string | null> => {
  const [isRepo, found] = await Promise.all([isInsideRepo(run), baselineIdentity(run, [])])
  if (!isRepo) return null
  return isIdentityAllowed(found, allowList) ? null : `✗ Git identity is not on the allow-list: ${offences(found, allowList).join(' and ')}`
}
