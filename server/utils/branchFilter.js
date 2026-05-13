// Branch filter — tiny glob matcher for an allow-list.
//
// Pattern syntax:
//   exact name          "main"          → matches only "main"
//   trailing wildcard   "release/*"     → matches "release/v1", "release/2026"
//   leading wildcard    "*-prod"        → matches "blue-prod", "release-prod"
//   bare wildcard       "*"             → matches anything
//
// Why a hand-rolled matcher instead of minimatch:
//   - this is the only place we need globbing
//   - 6 lines vs. a 300KB dependency
//   - precise control over the corner cases

const compile = (pattern) => {
  // Escape regex specials, then turn '*' into '.*'
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${re}$`);
};

export const branchAllowed = (branch, patterns) => {
  if (!patterns || patterns.length === 0) return true;        // empty list = allow all
  if (!branch) return false;                                  // can't match if we don't know the branch
  return patterns.some((p) => compile(p).test(branch));
};
