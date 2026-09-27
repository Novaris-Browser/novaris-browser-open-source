// Pure helpers behind the vertical tab strip.
//
// Everything here is a plain function over plain data so the behaviour of
// grouping, drag and drop, and search can be tested without a browser. The strip
// component only decides what to draw; this file decides what the result is.
//
// The model is a three level tree: a workspace holds groups, a group holds tabs,
// and a tab may sit directly in a workspace with no group at all. Ungrouped tabs
// are a normal state rather than an error, which is why almost every function
// here tolerates a missing group or workspace id.

export const UNGROUPED = '';

function byId(list, id) {
  return (list || []).find((item) => item?.id === id) || null;
}

/** Tabs belonging to a workspace, whether grouped or not. */
export function tabsInWorkspace(tabs = [], workspaceId) {
  return tabs.filter((tab) => (tab.workspaceId || UNGROUPED) === (workspaceId || UNGROUPED));
}

/** Groups belonging to a workspace, in the order they were created. */
export function groupsInWorkspace(groups = [], workspaceId) {
  return groups.filter((group) => (group.workspaceId || UNGROUPED) === (workspaceId || UNGROUPED));
}

/**
 * Builds the ordered rows the vertical strip renders: one row per group holding
 * its tabs, then any loose tabs as an implicit trailing group.
 *
 * Pinned tabs sort to the top within their group, which is what makes a pinned
 * tab behave the way people expect in a vertical list.
 */
export function buildStripRows({ tabs = [], groups = [], workspaceId } = {}) {
  const scoped = tabsInWorkspace(tabs, workspaceId);
  const scopedGroups = groupsInWorkspace(groups, workspaceId);
  const rows = [];

  for (const group of scopedGroups) {
    const members = sortPinnedFirst(scoped.filter((tab) => (tab.groupId || UNGROUPED) === group.id));
    rows.push({ kind: 'group', group, tabs: members, collapsed: group.collapsed === true });
  }

  const loose = sortPinnedFirst(scoped.filter((tab) => !tab.groupId));
  if (loose.length || !scopedGroups.length) {
    rows.push({ kind: 'loose', group: null, tabs: loose, collapsed: false });
  }

  return rows;
}

function sortPinnedFirst(tabs) {
  return [...tabs].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return 0;
  });
}

/**
 * Moves a tab to a new position, optionally into a different group, and returns
 * a new array rather than mutating.
 *
 * Dropping onto a tab inserts before it; dropping onto a group header or the
 * empty area of a group appends. The move is a no-op when the target is the
 * tab's current position, so a drag that lands where it started does nothing.
 */
export function moveTab(tabs, { tabId, targetTabId, groupId } = {}) {
  const list = Array.isArray(tabs) ? tabs : [];
  const index = list.findIndex((tab) => tab.id === tabId);
  if (index < 0) return tabs;
  const tab = tabs[index];
  const nextGroup = groupId === undefined ? tab.groupId : groupId;
  const remaining = tabs.filter((item) => item.id !== tabId);

  let insertAt;
  if (targetTabId && targetTabId !== tabId) {
    // Dropping onto a tab inserts before it. The target is looked up in the
    // array with the dragged tab already removed, so no index shifting is needed.
    const targetIndex = remaining.findIndex((item) => item.id === targetTabId);
    insertAt = targetIndex >= 0 ? targetIndex : remaining.length;
  } else if ((nextGroup || UNGROUPED) !== (tab.groupId || UNGROUPED)) {
    // Moving between groups lands after the last tab already in the target
    // group, so the tab does not jump to the top of an unrelated list.
    let lastInGroup = -1;
    remaining.forEach((item, position) => {
      if ((item.groupId || UNGROUPED) === (nextGroup || UNGROUPED)) lastInGroup = position;
    });
    insertAt = lastInGroup >= 0 ? lastInGroup + 1 : remaining.length;
  } else {
    // No target and no group change: leave the tab where it is.
    insertAt = index;
  }

  const result = [...remaining];
  result.splice(Math.min(insertAt, result.length), 0, { ...tab, groupId: nextGroup });
  return result;
}

/** Assigns a tab to a group, or clears its group when given an empty id. */
export function assignGroup(tabs, tabId, groupId) {
  return (Array.isArray(tabs) ? tabs : []).map((tab) => (tab.id === tabId ? { ...tab, groupId: groupId || UNGROUPED } : tab));
}

/**
 * Searches open tabs by title and address. An empty query returns the input
 * untouched, so the strip does not flicker while the user is still typing.
 */
export function searchTabs(tabs, query) {
  const list = Array.isArray(tabs) ? tabs : [];
  const text = String(query || '').trim().toLowerCase();
  if (!text) return list;
  const terms = text.split(/\s+/);
  return list.filter((tab) => {
    const haystack = `${tab?.title || ''} ${tab?.url || ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * The rows to draw while a search is active. Groups that end up with no matches
 * are dropped entirely, because an empty group header during a search is noise.
 */
export function buildSearchRows({ tabs = [], groups = [], workspaceId, query } = {}) {
  const matches = searchTabs(tabsInWorkspace(tabs, workspaceId), query);
  const matchingIds = new Set(matches.map((tab) => tab.id));
  const rows = buildStripRows({ tabs: matches, groups, workspaceId });

  return rows
    .map((row) => ({
      ...row,
      // Force open, since a collapsed group would hide the matches the user
      // just searched for.
      collapsed: false,
      tabs: row.tabs.filter((tab) => matchingIds.has(tab.id)),
    }))
    .filter((row) => row.tabs.length > 0);
}

/** Total tab count for a workspace, used for the badge on the workspace switcher. */
export function workspaceTabCount(tabs = [], workspaceId) {
  return tabsInWorkspace(tabs, workspaceId).length;
}

/** Every distinct workspace referenced by tabs, groups, or the active selection. */
export function referencedWorkspaces({ tabs = [], groups = [], activeWorkspaceId } = {}) {
  const ids = new Set();
  for (const tab of tabs) ids.add(tab.workspaceId || UNGROUPED);
  for (const group of groups) ids.add(group.workspaceId || UNGROUPED);
  if (activeWorkspaceId !== undefined) ids.add(activeWorkspaceId || UNGROUPED);
  return [...ids];
}

/**
 * Workspaces a new tab should open into. Falls back to the active workspace so a
 * tab opened from the keyboard lands where the user is working.
 */
export function targetWorkspaceFor({ workspaces = [], activeWorkspaceId, requested } = {}) {
  if (requested && (requested === UNGROUPED || workspaces.some((w) => w.id === requested))) return requested;
  if (activeWorkspaceId !== undefined && (activeWorkspaceId === UNGROUPED || workspaces.some((w) => w.id === activeWorkspaceId))) {
    return activeWorkspaceId;
  }
  return workspaces[0]?.id || UNGROUPED;
}

/** Removes a group and detaches its tabs rather than deleting them. */
export function deleteGroup(groups = [], tabs = [], groupId) {
  return {
    groups: groups.filter((group) => group.id !== groupId),
    tabs: tabs.map((tab) => (tab.groupId === groupId ? { ...tab, groupId: UNGROUPED } : tab)),
  };
}

/** Deletes a workspace, moving its groups and tabs up to the ungrouped level. */
export function deleteWorkspace({ workspaces = [], groups = [], tabs = [], workspaceId } = {}) {
  return {
    workspaces: workspaces.filter((item) => item.id !== workspaceId),
    groups: groups.map((group) => (group.workspaceId === workspaceId ? { ...group, workspaceId: UNGROUPED } : group)),
    tabs: tabs.map((tab) => (tab.workspaceId === workspaceId ? { ...tab, workspaceId: UNGROUPED, groupId: UNGROUPED } : tab)),
  };
}

/** The tab that should become active after the current one closes. */
export function nextActiveTabAfterClose(tabs = [], closingId, activeTabId) {
  if (!tabs.length) return null;
  if (closingId !== activeTabId) {
    return tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0].id;
  }
  const index = tabs.findIndex((tab) => tab.id === closingId);
  const remaining = tabs.filter((tab) => tab.id !== closingId);
  if (!remaining.length) return null;
  return remaining[Math.min(index, remaining.length - 1)].id;
}

export { byId, UNGROUPED as UNGROUPED_ID };
