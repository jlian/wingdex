/**
 * semantic-release plugin that wraps commit-analyzer and release-notes-generator
 * to exclude iOS-only commits from the root (web) release.
 *
 * A commit is excluded when:
 *   1. Its conventional-commit scope is "iOS" or "ios-release", OR
 *   2. Every file it touches lives under ios/
 */
const { execFileSync } = require('child_process');

const IOS_SCOPES = new Set(['iOS', 'ios-release']);

function isIosOnlyByPath(hash) {
  if (!/^[0-9a-f]+$/i.test(hash)) return false;
  try {
    const out = execFileSync(
      'git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', hash],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    if (!out) return false;
    return out.split('\n').every((f) => f.startsWith('ios/'));
  } catch {
    return false;
  }
}

function filterCommits(commits) {
  return commits.filter((c) => {
    if (IOS_SCOPES.has(c.scope)) return false;
    if (c.hash && isIosOnlyByPath(c.hash)) return false;
    return true;
  });
}

function wrap(pluginName, fnName) {
  const plugin = require(pluginName);
  const fn = plugin[fnName] ?? plugin;
  return (pluginConfig, context) =>
    fn(pluginConfig, { ...context, commits: filterCommits(context.commits) });
}

module.exports = {
  analyzeCommits: wrap('@semantic-release/commit-analyzer', 'analyzeCommits'),
  generateNotes: wrap(
    '@semantic-release/release-notes-generator',
    'generateNotes',
  ),
};
