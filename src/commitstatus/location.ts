export interface URLState {
  includeGood: boolean;
  commits: string[];
  grouped: string[];
  ungrouped: string[];
  removed: string[];
}

export const setURL = (s: URLState) => {
  const params = new URLSearchParams({});
  if (s.includeGood) params.set("includeGood", "1");
  if (s.commits.length) params.set("commits", s.commits.join(","));
  if (s.grouped.length) params.set("grouped", s.grouped.join(","));
  if (s.ungrouped.length) params.set("ungrouped", s.ungrouped.join(","));
  if (s.removed.length) params.set("removed", s.removed.join(","));
  const u = new URL(window.location.href);
  u.search = u.toString();
  window.history.pushState({}, "", u);
};

export const getState = () => {
  const searchParams = new URL(window.location.href).searchParams;
  const commits = (searchParams.get("commits") || "").split(",");
  const includeGood = !!searchParams.get("includeGood");
  const grouped = (searchParams.get("grouped") || "").split(",");
  const ungrouped = (searchParams.get("ungrouped") || "").split(",");
  const removed = (searchParams.get("removed") || "").split(",");

  return { commits, includeGood, grouped, ungrouped, removed };
};
