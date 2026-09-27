import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, Image as ImageIcon, Mail, Plus, Trash2, Users, X } from 'lucide-react'
import type { Memory } from './App'
import {
  acceptInvitation, cancelGroupInvitation, changeMemberRole, createGroup, createPerson, declineInvitation, deleteGroup,
  deletePerson, inviteToGroup, loadGroupInvitations, loadGroupMembers, loadGroups, loadInvitations,
  loadPeople, removeGroupMember, updateGroup, updatePerson,
  type CommunityGroup, type GroupInvitation, type GroupMember, type PersonProfile,
} from './utils/supabase/community'

type User = { id: string; name: string; email: string }
type Tab = 'people' | 'groups'

export default function CommunityPanel({ user, memories, initialTab = 'people', initialGroupId, initialPersonId, onClose, onChanged, onAddMemory }: {
  user: User
  memories: Memory[]
  initialTab?: Tab
  initialGroupId?: string
  initialPersonId?: string
  onClose: () => void
  onChanged: (people: PersonProfile[], groups: CommunityGroup[]) => void
  onAddMemory: (groupId?: string) => void
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [people, setPeople] = useState<PersonProfile[]>([])
  const [groups, setGroups] = useState<CommunityGroup[]>([])
  const [selectedPerson, setSelectedPerson] = useState<PersonProfile | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<CommunityGroup | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [incoming, setIncoming] = useState<GroupInvitation[]>([])
  const [outgoing, setOutgoing] = useState<GroupInvitation[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [personForm, setPersonForm] = useState(false)
  const [groupForm, setGroupForm] = useState(false)
  const [photo, setPhoto] = useState<File>()
  const [groupPhoto, setGroupPhoto] = useState<File>()
  const [personDraft, setPersonDraft] = useState({ name: '', relationship: '', description: '', birthday: '', notes: '' })
  const [groupDraft, setGroupDraft] = useState({ name: '', description: '', group_type: '' })
  const [inviteEmail, setInviteEmail] = useState('')

  const refresh = async () => {
    const [nextPeople, nextGroups, nextIncoming] = await Promise.all([
      loadPeople(user.id), loadGroups(user.id), loadInvitations(),
    ])
    setPeople(nextPeople); setGroups(nextGroups); setIncoming(nextIncoming)
    onChanged(nextPeople, nextGroups)
    if (initialPersonId) { setTab('people'); setSelectedPerson(nextPeople.find((person) => person.id === initialPersonId) ?? null) }
    if (initialGroupId) { setTab('groups'); setSelectedGroup(nextGroups.find((group) => group.id === initialGroupId) ?? null) }
    if (selectedGroup) {
      const refreshedGroup = nextGroups.find((group) => group.id === selectedGroup.id) ?? null
      setSelectedGroup(refreshedGroup)
      if (refreshedGroup) {
        const [nextMembers, nextOutgoing] = await Promise.all([loadGroupMembers(refreshedGroup.id), loadGroupInvitations(refreshedGroup.id)])
        setMembers(nextMembers); setOutgoing(nextOutgoing)
      }
    }
  }
  useEffect(() => { void refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load people and groups.')) }, [user.id, initialGroupId, initialPersonId])
  useEffect(() => {
    if (!selectedGroup) { setMembers([]); setOutgoing([]); return }
    Promise.all([loadGroupMembers(selectedGroup.id), loadGroupInvitations(selectedGroup.id)])
      .then(([nextMembers, nextInvitations]) => { setMembers(nextMembers); setOutgoing(nextInvitations) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load this group.'))
  }, [selectedGroup?.id])

  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true); setError(''); setMessage('')
    try { await action(); await refresh(); if (success) setMessage(success) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save changes.') }
    finally { setBusy(false) }
  }

  const savePerson = () => run(async () => {
    if (!personDraft.name.trim()) throw new Error('Enter a name.')
    const values = { ...personDraft, birthday: personDraft.birthday || null }
    if (selectedPerson) await updatePerson(selectedPerson.id, values, photo, user.id)
    else await createPerson({ ...values, image: photo }, user.id)
    setPersonForm(false); setSelectedPerson(null); setPhoto(undefined)
    setPersonDraft({ name: '', relationship: '', description: '', birthday: '', notes: '' })
  }, selectedPerson ? 'Person details updated.' : 'Person added.')

  const editPerson = (person: PersonProfile) => {
    setSelectedPerson(person); setPersonDraft({ name: person.name, relationship: person.relationship ?? '', description: person.description ?? '', birthday: person.birthday ?? '', notes: person.notes ?? '' }); setPhoto(undefined); setPersonForm(true)
  }

  const saveGroup = () => run(async () => {
    if (!groupDraft.name.trim()) throw new Error('Enter a group name.')
    if (selectedGroup && (selectedGroup.role === 'owner' || selectedGroup.role === 'admin')) await updateGroup(selectedGroup.id, groupDraft, groupPhoto, selectedGroup.image_url)
    else await createGroup({ ...groupDraft, image: groupPhoto }, user.id)
    setGroupForm(false); setGroupDraft({ name: '', description: '', group_type: '' })
    setGroupPhoto(undefined)
  }, selectedGroup ? 'Group updated.' : 'Group created. You are its owner.')

  const invite = () => run(async () => {
    if (!selectedGroup) return
    const email = inviteEmail.trim().toLowerCase()
    if (email === user.email.toLowerCase()) throw new Error('You are already a member of this group.')
    const result = await inviteToGroup(selectedGroup.id, email, user.id)
    setInviteEmail('')
    setMessage(result.delivery === 'invite_email' ? `Invitation email sent to ${email}.` : `Sign-in link sent to ${email}.`)
  })

  return <div className="community-overlay" role="dialog" aria-modal="true" aria-label="People and groups">
    <section className="community-panel">
      <header className="community-header">
        <div><p className="eyebrow"><Users size={14} />Your community</p><h2>{selectedGroup ? selectedGroup.name : tab === 'people' ? 'People in Memories' : 'Groups'}</h2></div>
        <button className="community-return" onClick={onClose}><ArrowLeft size={15} />Back to Our Space</button>
      </header>
      <nav className="community-tabs"><button className={tab === 'people' ? 'active' : ''} onClick={() => { setTab('people'); setSelectedGroup(null) }}>People <span>{people.length}</span></button><button className={tab === 'groups' ? 'active' : ''} onClick={() => { setTab('groups'); setSelectedPerson(null) }}>Groups <span>{groups.length}</span></button></nav>
      {error && <p className="community-feedback error" role="alert">{error}</p>}{message && <p className="community-feedback success" role="status">{message}</p>}
      {tab === 'people' && <div className="community-body">
        {personForm ? <form className="community-form" onSubmit={(e) => { e.preventDefault(); savePerson() }}>
          <button type="button" className="community-back" onClick={() => { setPersonForm(false); setSelectedPerson(null) }}><ArrowLeft size={14} />Back to people</button>
          <h3>{selectedPerson ? 'Edit person' : 'Add a person'}</h3>
          <p className="community-hint">People in your memories don't need an account. They are simply people you tag in your memories.</p>
          <label>Name<input required maxLength={120} value={personDraft.name} onChange={(e) => setPersonDraft({ ...personDraft, name: e.target.value })} placeholder="Grandma" /></label>
          <label>Relationship<input value={personDraft.relationship} onChange={(e) => setPersonDraft({ ...personDraft, relationship: e.target.value })} placeholder="Grandmother" /></label>
          <label>Description<textarea value={personDraft.description} onChange={(e) => setPersonDraft({ ...personDraft, description: e.target.value })} placeholder="A little about them" /></label>
          <label>Birthday<input type="date" value={personDraft.birthday} onChange={(e) => setPersonDraft({ ...personDraft, birthday: e.target.value })} /></label>
          <label>Notes<textarea value={personDraft.notes} onChange={(e) => setPersonDraft({ ...personDraft, notes: e.target.value })} placeholder="Private notes" /></label>
          <label className="community-file"><ImageIcon size={15} />Person photo (optional)<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setPhoto(e.target.files?.[0])} /></label>
          <button className="community-primary" disabled={busy}>{busy ? 'Savingâ€¦' : selectedPerson ? 'Save profile' : 'Add person'}</button>
        </form> : selectedPerson ? <div className="person-profile">
          <button className="community-back" onClick={() => setSelectedPerson(null)}><ArrowLeft size={14} />All people</button>
          {selectedPerson.imageUrl ? <img className="profile-photo" src={selectedPerson.imageUrl} alt={selectedPerson.name} /> : <span className="profile-photo profile-placeholder">{selectedPerson.name.slice(0, 1).toUpperCase()}</span>}
          <h3>{selectedPerson.name}</h3><p className="profile-relation">{selectedPerson.relationship || 'Person'}</p>{selectedPerson.description && <p>{selectedPerson.description}</p>}
          {selectedPerson.birthday && <p className="profile-fact"><CalendarDays size={14} />{selectedPerson.birthday}</p>}{selectedPerson.notes && <p className="profile-notes">{selectedPerson.notes}</p>}
          <p className="profile-count">{memories.filter((memory) => memory.personIds?.includes(selectedPerson.id) || memory.people.includes(selectedPerson.name)).length} memories Â· {new Set(memories.filter((memory) => memory.people.includes(selectedPerson.name)).flatMap((memory) => memory.groupIds ?? [])).size} groups sharing memories</p>
          <div className="profile-memories">{memories.filter((memory) => memory.personIds?.includes(selectedPerson.id) || memory.people.includes(selectedPerson.name)).map((memory) => <article key={memory.id}><img src={memory.image} alt="" /><span><strong>{memory.title}</strong><small>{memory.year} Â· {memory.location}</small></span></article>)}</div>
          <div className="community-actions"><button onClick={() => editPerson(selectedPerson)}>Edit person</button><button className="danger" onClick={() => { if (confirm(`Delete ${selectedPerson.name}?`)) void run(async () => { await deletePerson(selectedPerson, user.id); setSelectedPerson(null) }, 'Person deleted.') }}><Trash2 size={14} />Delete</button></div>
        </div> : <>
          <div className="community-toolbar"><p>People in your memories don't need an account. They are simply people you tag in your memories.</p><button className="community-primary" onClick={() => { setSelectedPerson(null); setPersonForm(true) }}><Plus size={15} />Add person</button></div>
          {!people.length ? <div className="community-empty"><Users size={22} /><strong>You haven't added anyone yet.</strong><p>Add family members and friends to connect them with your memories.</p></div> : <div className="community-cards">{people.map((person) => <button className="person-card" key={person.id} onClick={() => setSelectedPerson(person)}>{person.imageUrl ? <img src={person.imageUrl} alt="" /> : <span className="profile-placeholder">{person.name.slice(0, 1).toUpperCase()}</span>}<span><strong>{person.name}</strong><small>{person.relationship || 'Person'}</small></span><ArrowRight size={15} /></button>)}</div>}
        </>}
      </div>}
      {tab === 'groups' && <div className="community-body">
        {groupForm ? <form className="community-form" onSubmit={(e) => { e.preventDefault(); saveGroup() }}><button type="button" className="community-back" onClick={() => setGroupForm(false)}><ArrowLeft size={14} />Back to groups</button><h3>{selectedGroup ? 'Edit group' : 'Create a group'}</h3><label>Group name<input required maxLength={120} value={groupDraft.name} onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })} placeholder="Family" /></label><label>Description<textarea value={groupDraft.description} onChange={(e) => setGroupDraft({ ...groupDraft, description: e.target.value })} placeholder="A place to share memories" /></label><label>Group type<input value={groupDraft.group_type} onChange={(e) => setGroupDraft({ ...groupDraft, group_type: e.target.value })} placeholder="Family, friends, trip…" /></label><label className="community-file"><ImageIcon size={15} />Group image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setGroupPhoto(e.target.files?.[0])} /></label><button className="community-primary" disabled={busy}>{busy ? 'Saving…' : selectedGroup ? 'Save group' : 'Create group'}</button></form> : selectedGroup ? <div className="group-detail">
          <button className="community-back" onClick={() => setSelectedGroup(null)}><ArrowLeft size={14} />All groups</button>
          {selectedGroup.imageUrl && <img className="group-cover" src={selectedGroup.imageUrl} alt="" />}
          <p>{selectedGroup.description || 'A private place to share memories.'}</p><p className="profile-count">{members.length} members Â· {memories.filter((memory) => memory.groupIds?.includes(selectedGroup.id)).length} shared memories</p>
          <section className="group-section"><h3>Members</h3>{members.length ? members.map((member) => <div className="group-member" key={member.user_id}>{member.imageUrl ? <img className="member-avatar group-profile-avatar" src={member.imageUrl} alt="" /> : <span className="member-avatar">{member.display_name.slice(0, 1).toUpperCase()}</span>}<span><strong>{member.display_name}</strong><small>{member.username ? `@${member.username} · ${member.role}` : member.role}</small></span>{member.role !== 'owner' && (selectedGroup.role === 'owner' || selectedGroup.role === 'admin') && <select aria-label={`Role for ${member.display_name}`} value={member.role} onChange={(e) => void run(async () => changeMemberRole(selectedGroup.id, member.user_id, e.target.value as 'admin' | 'member'))}><option value="member">Member</option><option value="admin">Admin</option></select>}{member.role !== 'owner' && (selectedGroup.role === 'owner' || selectedGroup.role === 'admin' || member.user_id === user.id) && <button className="icon-button" aria-label={`Remove ${member.display_name}`} onClick={() => void run(async () => removeGroupMember(selectedGroup.id, member.user_id))}><X size={14} /></button>}</div>) : <p className="community-empty compact">No members yet. Invite people to start sharing memories.</p>}</section>
          {(selectedGroup.role === 'owner' || selectedGroup.role === 'admin') && <section className="group-section"><h3>Invite members</h3><form className="invite-form" onSubmit={(e) => { e.preventDefault(); invite() }}><input required type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="friend@example.com" /><button disabled={busy}><Mail size={14} />Invite</button></form><p className="community-hint">Invitations are private. The recipient must sign in with the invited email and accept to join.</p>{outgoing.map((invite) => <div className="invite-row" key={invite.id}><span>{invite.invited_email}<small>Pending</small></span><button onClick={() => void run(async () => cancelGroupInvitation(invite.id))}>Cancel</button></div>)}</section>}
          <section className="group-section"><div className="community-toolbar"><h3>Shared memories</h3><button className="community-primary" onClick={() => onAddMemory(selectedGroup.id)}><Plus size={14} />Add memory</button></div>{memories.filter((memory) => memory.groupIds?.includes(selectedGroup.id)).map((memory) => <article className="shared-memory" key={memory.id}><img src={memory.image} alt="" /><span><strong>{memory.title}</strong><small>{memory.year} Â· {memory.location}</small></span></article>)}</section>
          {(selectedGroup.role === 'owner' || selectedGroup.role === 'admin') && <div className="community-actions"><button onClick={() => { setGroupDraft({ name: selectedGroup.name, description: selectedGroup.description ?? '', group_type: selectedGroup.group_type ?? '' }); setGroupPhoto(undefined); setGroupForm(true) }}>Edit group</button>{selectedGroup.role === 'owner' && <button className="danger" onClick={() => { if (confirm(`Delete ${selectedGroup.name} and its memberships?`)) void run(async () => { await deleteGroup(selectedGroup.id, selectedGroup.image_url); setSelectedGroup(null) }, 'Group deleted.') }}><Trash2 size={14} />Delete group</button>}</div>}
        </div> : <>
          <div className="community-toolbar"><p>Share memories with people who belong to these groups.</p><button className="community-primary" onClick={() => { setSelectedGroup(null); setGroupForm(true) }}><Plus size={15} />Create group</button></div>
          {incoming.length > 0 && <section className="group-section"><h3>Invitations for you</h3>{incoming.map((invitation) => <div className="invite-row" key={invitation.id}><span>{invitation.group_name}<small>Invited by {invitation.invited_by_name} · {invitation.invited_email}</small></span><button onClick={() => void run(async () => { await acceptInvitation(invitation.id); setIncoming((items) => items.filter((item) => item.id !== invitation.id)) }, 'You joined the group.') }><Check size={14} />Accept</button><button onClick={() => void run(async () => { await declineInvitation(invitation.id); setIncoming((items) => items.filter((item) => item.id !== invitation.id)) }, 'Invitation declined.')}>Decline</button></div>)}</section>}
          {!groups.length ? <div className="community-empty"><Users size={22} /><strong>You don't have any groups yet.</strong><p>Create a group to share memories with family and friends.</p></div> : <div className="community-cards">{groups.map((group) => <button className="group-card" key={group.id} onClick={() => setSelectedGroup(group)}>{group.imageUrl ? <img src={group.imageUrl} alt="" /> : <span className="group-icon"><Users size={19} /></span>}<span><strong>{group.name}</strong><small>{group.group_type || group.role}</small></span><ArrowRight size={15} /></button>)}</div>}
        </>}
      </div>}
    </section>
  </div>
}

