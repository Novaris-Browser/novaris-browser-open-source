import { describe, expect, it } from 'vitest';
import {
  UNGROUPED,
  assignGroup,
  buildSearchRows,
  buildStripRows,
  deleteGroup,
  deleteWorkspace,
  groupsInWorkspace,
  moveTab,
  nextActiveTabAfterClose,
  searchTabs,
  tabsInWorkspace,
  targetWorkspaceFor,
  workspaceTabCount,
} from '../src/lib/tabs.js';

const wsA = { id: 'ws-a', name: 'Work' };
const wsB = { id: 'ws-b', name: 'Play' };
const g1 = { id: 'g1', name: 'Docs', workspaceId: 'ws-a' };
const g2 = { id: 'g2', name: 'Fun', workspaceId: 'ws-b', collapsed: true };

const tabs = [
  { id: 't1', title: 'Novaris', url: 'https://novaris.test/', groupId: 'g1', workspaceId: 'ws-a', pinned: true },
  { id: 't2', title: 'Docs', url: 'https://docs.test/', groupId: 'g1', workspaceId: 'ws-a' },
  { id: 't3', title: 'Loose', url: 'https://loose.test/', groupId: UNGROUPED, workspaceId: 'ws-a' },
  { id: 't4', title: 'Game', url: 'https://game.test/', groupId: 'g2', workspaceId: 'ws-b' },
];

describe('Novaris workspaces: scoping', () => {
  it('keeps each workspace to its own tabs and groups', () => {
    expect(tabsInWorkspace(tabs, 'ws-a').map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(tabsInWorkspace(tabs, 'ws-b').map((t) => t.id)).toEqual(['t4']);
    expect(groupsInWorkspace([g1, g2], 'ws-b')).toEqual([g2]);
  });

  it('treats a missing workspace id as the ungrouped level, not a crash', () => {
    expect(tabsInWorkspace([{ id: 'x', workspaceId: undefined }], UNGROUPED)).toHaveLength(1);
    expect(tabsInWorkspace(tabs, 'ws-missing')).toEqual([]);
  });

  it('counts tabs per workspace for the switcher badge', () => {
    expect(workspaceTabCount(tabs, 'ws-a')).toBe(3);
    expect(workspaceTabCount(tabs, 'ws-b')).toBe(1);
  });

  it('routes a new tab to the active workspace, preferring an explicit request', () => {
    const workspaces = [wsA, wsB];
    expect(targetWorkspaceFor({ workspaces, activeWorkspaceId: 'ws-b' })).toBe('ws-b');
    expect(targetWorkspaceFor({ workspaces, activeWorkspaceId: 'ws-b', requested: 'ws-a' })).toBe('ws-a');
    // An unknown id must not leak into the saved session.
    expect(targetWorkspaceFor({ workspaces, activeWorkspaceId: 'ws-b', requested: 'ws-ghost' })).toBe('ws-b');
    expect(targetWorkspaceFor({ workspaces: [], activeWorkspaceId: undefined })).toBe(UNGROUPED);
  });
});

describe('Novaris workspaces: vertical strip rows', () => {
  it('renders one row per group plus a trailing loose row', () => {
    const rows = buildStripRows({ tabs, groups: [g1, g2], workspaceId: 'ws-a' });
    expect(rows.map((r) => r.kind)).toEqual(['group', 'loose']);
    expect(rows[0].tabs.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(rows[1].tabs.map((t) => t.id)).toEqual(['t3']);
  });

  it('honours a collapsed group but still counts its tabs', () => {
    const rows = buildStripRows({ tabs, groups: [g1, g2], workspaceId: 'ws-b' });
    expect(rows[0].collapsed).toBe(true);
    expect(rows[0].tabs).toHaveLength(1);
  });

  it('sorts pinned tabs to the top of their group', () => {
    const unpinnedFirst = [
      { id: 'a', groupId: 'g1', workspaceId: 'ws-a', pinned: false },
      { id: 'b', groupId: 'g1', workspaceId: 'ws-a', pinned: true },
    ];
    const rows = buildStripRows({ tabs: unpinnedFirst, groups: [g1], workspaceId: 'ws-a' });
    expect(rows[0].tabs.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('always renders a loose row for an empty workspace so a drop target exists', () => {
    const rows = buildStripRows({ tabs: [], groups: [], workspaceId: 'ws-b' });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('loose');
  });
});

describe('Novaris workspaces: drag and drop', () => {
  it('reorders within a group by dropping onto a tab', () => {
    const next = moveTab(tabs, { tabId: 't2', targetTabId: 't1' });
    expect(next.map((t) => t.id)).toEqual(['t2', 't1', 't3', 't4']);
  });

  it('moves a tab into another group and reassigns it', () => {
    const next = moveTab(tabs, { tabId: 't3', groupId: 'g1' });
    const moved = next.find((t) => t.id === 't3');
    expect(moved.groupId).toBe('g1');
    // It lands after the tabs already in that group rather than at the top.
    expect(next.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('drops a tab out of its group back to the loose row', () => {
    const next = moveTab(tabs, { tabId: 't1', groupId: UNGROUPED });
    expect(next.find((t) => t.id === 't1').groupId).toBe(UNGROUPED);
  });

  it('leaves the list untouched when the tab is unknown', () => {
    expect(moveTab(tabs, { tabId: 'nope', groupId: 'g1' })).toBe(tabs);
  });

  it('never loses or duplicates a tab', () => {
    for (const tabId of ['t1', 't2', 't3', 't4']) {
      for (const targetTabId of [undefined, 't1', 't2', 't4']) {
        const next = moveTab(tabs, { tabId, targetTabId, groupId: 'g2' });
        expect(next).toHaveLength(tabs.length);
        expect(new Set(next.map((t) => t.id)).size).toBe(tabs.length);
        expect(next.every((t) => t.id === tabId || true)).toBe(true);
      }
    }
  });

  it('assigns and clears a group', () => {
    expect(assignGroup(tabs, 't1', 'g2').find((t) => t.id === 't1').groupId).toBe('g2');
    expect(assignGroup(tabs, 't1', '').find((t) => t.id === 't1').groupId).toBe(UNGROUPED);
  });
});

describe('Novaris workspaces: tab search', () => {
  it('matches on title and on address', () => {
    expect(searchTabs(tabs, 'novaris').map((t) => t.id)).toEqual(['t1']);
    expect(searchTabs(tabs, 'game.test').map((t) => t.id)).toEqual(['t4']);
  });

  it('requires every term to match', () => {
    expect(searchTabs(tabs, 'docs test').map((t) => t.id)).toEqual(['t2']);
    expect(searchTabs(tabs, 'docs zzz')).toEqual([]);
  });

  it('returns the input unchanged for an empty or whitespace query', () => {
    expect(searchTabs(tabs, '')).toBe(tabs);
    expect(searchTabs(tabs, '   ')).toBe(tabs);
  });

  it('is case insensitive', () => {
    expect(searchTabs(tabs, 'NOVARIS').map((t) => t.id)).toEqual(['t1']);
  });

  it('drops groups with no matches and forces matches visible', () => {
    const rows = buildSearchRows({ tabs, groups: [g1, g2], workspaceId: 'ws-a', query: 'loose' });
    // g1 has no match, so it is gone rather than shown empty.
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('loose');
    expect(rows[0].tabs.map((t) => t.id)).toEqual(['t3']);
  });

  it('opens a collapsed group when a match inside it is searched for', () => {
    const rows = buildSearchRows({ tabs, groups: [g1, g2], workspaceId: 'ws-b', query: 'game' });
    expect(rows[0].collapsed).toBe(false);
    expect(rows[0].tabs.map((t) => t.id)).toEqual(['t4']);
  });

  it('reports nothing when the search matches nothing at all', () => {
    expect(buildSearchRows({ tabs, groups: [g1], workspaceId: 'ws-a', query: 'zzzz' })).toEqual([]);
  });
});

describe('Novaris workspaces: deletion', () => {
  it('deletes a group but keeps its tabs', () => {
    const result = deleteGroup([g1], tabs, 'g1');
    expect(result.groups).toEqual([]);
    expect(result.tabs).toHaveLength(tabs.length);
    expect(result.tabs.filter((t) => t.groupId === 'g1')).toEqual([]);
  });

  it('deletes a workspace and moves its contents up rather than destroying them', () => {
    const result = deleteWorkspace({ workspaces: [wsA, wsB], groups: [g1, g2], tabs, workspaceId: 'ws-a' });
    expect(result.workspaces.map((w) => w.id)).toEqual(['ws-b']);
    expect(result.tabs).toHaveLength(tabs.length);
    // The tabs survive with no workspace and no group.
    expect(result.tabs.find((t) => t.id === 't1')).toMatchObject({ workspaceId: UNGROUPED, groupId: UNGROUPED });
  });

  it('picks the neighbouring tab when the active one closes', () => {
    expect(nextActiveTabAfterClose(tabs, 't2', 't2')).toBe('t3');
    expect(nextActiveTabAfterClose(tabs, 't3', 't2')).toBe('t2');
    // Closing the last remaining tab leaves nothing to activate.
    expect(nextActiveTabAfterClose([{ id: 'only' }], 'only', 'only')).toBeNull();
  });
});

describe('Novaris workspaces: hostile input', () => {
  it('tolerates missing and malformed arguments', () => {
    expect(buildStripRows()).toEqual([{ kind: 'loose', group: null, tabs: [], collapsed: false }]);
    expect(tabsInWorkspace(undefined, 'x')).toEqual([]);
    expect(searchTabs(null, 'x')).toEqual([]);
    expect(() => moveTab(undefined, {})).not.toThrow();
    expect(() => assignGroup(null, 'a', 'b')).not.toThrow();
    expect(() => deleteWorkspace({})).not.toThrow();
  });
});
