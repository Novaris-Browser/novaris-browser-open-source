import { useState } from 'react';
import { Check, FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react';

export default function TabGroupsPanel({ groups, tabs, onCreateGroup, onRenameGroup, onDeleteGroup, onAssignTabToGroup }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const create = (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    onCreateGroup(name.trim());
    setName('');
  };
  const beginEdit = (group) => {
    setEditing(group.id);
    setDraft(group.name);
  };
  const saveEdit = (event) => {
    event.preventDefault();
    if (draft.trim()) onRenameGroup(editing, { name: draft.trim() });
    setEditing(null);
  };
  return (
    <div className="tab-groups-panel">
      <form className="tab-group-create" onSubmit={create}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="New group name" aria-label="New tab group name" /><button className="tiny-action" type="submit" aria-label="Create tab group"><Plus size={14} /></button></form>
      {groups.length === 0 && <div className="tab-group-empty"><FolderPlus size={15} /><span>Group related tabs together.</span></div>}
      {groups.map((group) => <div className="tab-group-summary" key={group.id}>{editing === group.id ? <form className="tab-group-edit" onSubmit={saveEdit}><input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`Rename ${group.name}`} autoFocus /><button type="submit" aria-label="Save group name"><Check size={12} /></button><button type="button" onClick={() => setEditing(null)} aria-label="Cancel group rename"><X size={12} /></button></form> : <><span className="group-color" style={{ background: group.color }} /><strong>{group.name}</strong><small>{tabs.filter((tab) => tab.groupId === group.id).length} tabs</small><button className="row-action" type="button" onClick={() => beginEdit(group)} aria-label={`Rename ${group.name}`} title="Rename group"><Pencil size={12} /></button><button className="row-action" type="button" onClick={() => onDeleteGroup(group.id)} aria-label={`Delete ${group.name}`} title="Delete group"><Trash2 size={12} /></button></>}</div>)}
      {tabs.length > 0 && <div className="tab-group-assignment">{tabs.map((tab) => <label key={tab.id}><span>{tab.title || 'Untitled'}</span><select value={tab.groupId || ''} onChange={(event) => onAssignTabToGroup(tab.id, event.target.value)} aria-label={`Group for ${tab.title || 'tab'}`}><option value="">No group</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>)}</div>}
    </div>
  );
}
