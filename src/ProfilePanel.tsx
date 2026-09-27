import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, Camera, LockKeyhole, MapPin, Trash2, Users, X } from 'lucide-react'
import type { Memory } from './App'
import { type CommunityGroup, type PersonProfile } from './utils/supabase/community'
import { loadAccountProfile, saveAccountProfile, type AccountProfile } from './utils/supabase/profile'

export type ProfileSection = 'profile' | 'edit' | 'memories' | 'settings'
type User = { id: string; name: string; email: string; createdAt: string; userMetadata?: Record<string, unknown> }

export default function ProfilePanel({ user, profile, memories, groups, people, initialSection, onClose, onProfileUpdated, onOpenMemory, onUpdateMemory, onDeleteMemory, onDeleteAccount, onLogout }: {
  user: User
  profile: AccountProfile
  memories: Memory[]
  groups: CommunityGroup[]
  people: PersonProfile[]
  initialSection: ProfileSection
  onClose: () => void
  onProfileUpdated: (profile: AccountProfile) => void
  onOpenMemory: (memory: Memory) => void
  onUpdateMemory: (memory: Memory, patch: { title: string; year: string; location: string; story: string }) => Promise<void>
  onDeleteMemory: (memory: Memory) => Promise<void>
  onDeleteAccount: () => Promise<void>
  onLogout: () => void
}) {
  const [section, setSection] = useState<ProfileSection>(initialSection)
  const [editingProfile, setEditingProfile] = useState(initialSection === 'edit' || initialSection === 'settings')
  const [name, setName] = useState(profile.display_name)
  const [username, setUsername] = useState(profile.username ?? '')
  const [bio, setBio] = useState(profile.bio ?? '')
  const [birthday, setBirthday] = useState(profile.birthday ?? '')
  const [location, setLocation] = useState(profile.location ?? '')
  const [visibility, setVisibility] = useState<AccountProfile['profile_visibility']>(profile.profile_visibility ?? 'private')
  const [photo, setPhoto] = useState<File>()
  const [removePhoto, setRemovePhoto] = useState(false)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null)
  const [memoryDraft, setMemoryDraft] = useState({ title: '', year: '', location: '', story: '' })
  const ownMemories = useMemo(() => memories.filter((memory) => memory.ownerId === user.id), [memories, user.id])

  useEffect(() => {
    setName(profile.display_name); setUsername(profile.username ?? ''); setBio(profile.bio ?? '')
    setBirthday(profile.birthday ?? ''); setLocation(profile.location ?? ''); setVisibility(profile.profile_visibility ?? 'private')
  }, [profile])
  useEffect(() => {
    if (!photo) { setPreview(''); return }
    const url = URL.createObjectURL(photo); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])
  const runSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true)
    try {
      const normalizedUsername = username.trim().replace(/^@/, '')
      if (normalizedUsername && !/^[A-Za-z0-9_]{3,24}$/.test(normalizedUsername)) throw new Error('Username must be 3–24 characters using letters, numbers, or underscores.')
      await saveAccountProfile(user.id, { display_name: name, username: normalizedUsername, bio, birthday, location, profile_visibility: visibility }, photo, removePhoto)
      const fresh = await loadAccountProfile({ id: user.id, email: user.email, user_metadata: { name } })
      onProfileUpdated(fresh); setPhoto(undefined); setRemovePhoto(false); setEditingProfile(false); setNotice('Profile saved.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update your profile. Please try again.') }
    finally { setBusy(false) }
  }
  const cancelProfileEdit = () => {
    setName(profile.display_name); setUsername(profile.username ?? ''); setBio(profile.bio ?? '')
    setBirthday(profile.birthday ?? ''); setLocation(profile.location ?? ''); setVisibility(profile.profile_visibility ?? 'private')
    setPhoto(undefined); setRemovePhoto(false); setError(''); setEditingProfile(false)
    if (section === 'edit') setSection('profile')
  }

  const startEditMemory = (memory: Memory) => {
    setEditingMemory(memory); setMemoryDraft({ title: memory.title, year: memory.year, location: memory.location, story: memory.story }); setError('')
  }
  const saveMemoryEdit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!editingMemory) return
    setBusy(true); setError('')
    try { await onUpdateMemory(editingMemory, memoryDraft); setEditingMemory(null); setNotice('Memory updated.') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update this memory.') }
    finally { setBusy(false) }
  }
  const deleteAccount = async () => {
    if (!confirm('Delete your account permanently? This may permanently delete your memories, people, groups you own, and memberships. This cannot be undone.')) return
    setBusy(true); setError('')
    try { await onDeleteAccount() } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to delete your account.') } finally { setBusy(false) }
  }

  const tabs: Array<[ProfileSection, string]> = [['profile', 'Profile'], ['memories', 'My Memories'], ['settings', 'Settings']]
  const image = preview || (!removePhoto ? profile.imageUrl : '')
  return <div className="account-profile-overlay" role="dialog" aria-modal="true" aria-label="Your profile">
    <section className="account-profile-panel">
      <header className="account-profile-header"><div><p className="eyebrow"><Users size={14} />Your account</p><h2>{section === 'profile' ? (profile.display_name || 'Your Profile') : tabs.find(([id]) => id === section)?.[1]}</h2></div><button className="close-button" onClick={onClose} aria-label="Close profile"><X size={19} /></button></header>
      <nav className="account-profile-tabs">{tabs.map(([id, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => { setSection(id); setEditingProfile(id === 'settings'); setEditingMemory(null); setError(''); setNotice('') }}>{label}</button>)}</nav>
      {error && <p className="community-feedback error" role="alert">{error}</p>}{notice && <p className="community-feedback success" role="status">{notice}</p>}
      <div className="account-profile-body">
        {section === 'profile' && !editingProfile && <div className="account-profile-summary">
          {image ? <img className="account-profile-avatar" src={image} alt={`${profile.display_name} profile`} /> : <span className="account-profile-avatar profile-placeholder">{(profile.display_name || user.email).slice(0, 1).toUpperCase()}</span>}
          <h3>{profile.display_name || 'Let’s set up your profile.'}</h3>{profile.username && <p className="account-username">@{profile.username}</p>}
          {profile.bio && <p className="account-bio">{profile.bio}</p>}
          {profile.birthday && <p className="account-fact"><CalendarDays size={14} />{profile.birthday}</p>}{profile.location && <p className="account-fact"><MapPin size={14} />{profile.location}</p>}
          <p className="account-email">{user.email}</p><p className="account-created">Member since {new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</p>
          <div className="account-stats"><span><strong>{ownMemories.length}</strong>Memories</span><span><strong>{groups.length}</strong>Groups</span><span><strong>{people.length}</strong>People</span></div>
          <button className="community-primary" onClick={() => { setEditingProfile(true); setSection('edit') }}>Edit Profile</button>
        </div>}
        {(section === 'edit' || section === 'settings' || (section === 'profile' && editingProfile)) && <form className="account-profile-form" onSubmit={runSaveProfile}>
          <div className="account-image-edit">{image ? <img src={image} alt="Profile preview" /> : <span className="profile-placeholder">{(name || user.email).slice(0, 1).toUpperCase()}</span>}<label className="account-upload"><Camera size={15} />{image ? 'Change picture' : 'Upload picture'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setPhoto(event.target.files?.[0]); setRemovePhoto(false) }} /></label>{(profile.profile_image_url || photo) && <button type="button" className="account-remove-photo" onClick={() => { setPhoto(undefined); setRemovePhoto(true) }}><Trash2 size={13} />Remove picture</button>}<small>JPG, PNG, or WebP · 5 MB maximum</small></div>
          <label>Full name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Username<input maxLength={25} value={username} onChange={(event) => setUsername(event.target.value.replace(/^@/, ''))} placeholder="optional_username" /><small>3–24 letters, numbers, or underscores. Leave blank to skip.</small></label>
          <label>About me<textarea maxLength={280} rows={3} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="A short introduction" /></label>
          <div className="account-form-row"><label>Birthday<input type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} /></label><label>Location<input maxLength={120} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Optional" /></label></div>
          <label>Profile visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value as AccountProfile['profile_visibility'])}><option value="private">Private</option><option value="groups">Group members</option><option value="public">Public</option></select><small>Birthday, location, email, and bio stay private. Group members may see your name; username and picture follow this setting.</small></label>
          <p className="account-email"><LockKeyhole size={14} />Email · {user.email} <small>Email changes are managed by Supabase authentication.</small></p>
          <div className="community-actions"><button type="button" onClick={cancelProfileEdit}>Cancel</button><button className="community-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button></div>
          {section === 'settings' && <section className="account-danger-zone"><h3>Account actions</h3><p>Deleting your account permanently removes your profile and account-owned data. Group memberships are also removed.</p><button type="button" className="danger-account-button" disabled={busy} onClick={() => void deleteAccount()}>Delete account</button><button type="button" className="account-logout" onClick={onLogout}>Log out</button></section>}
        </form>}
        {section === 'memories' && (editingMemory ? <form className="account-profile-form" onSubmit={saveMemoryEdit}><button type="button" className="community-back" onClick={() => setEditingMemory(null)}><ArrowLeft size={14} />Back to my memories</button><h3>Edit memory</h3><label>Title<input required value={memoryDraft.title} onChange={(event) => setMemoryDraft({ ...memoryDraft, title: event.target.value })} /></label><label>Year<input value={memoryDraft.year} onChange={(event) => setMemoryDraft({ ...memoryDraft, year: event.target.value })} /></label><label>Location<input value={memoryDraft.location} onChange={(event) => setMemoryDraft({ ...memoryDraft, location: event.target.value })} /></label><label>Story<textarea rows={5} value={memoryDraft.story} onChange={(event) => setMemoryDraft({ ...memoryDraft, story: event.target.value })} /></label><button className="community-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</button></form> : ownMemories.length ? <div className="account-list">{ownMemories.map((memory) => <article className="account-memory-card" key={memory.id}><button className="account-memory-open" onClick={() => onOpenMemory(memory)}><img src={memory.image} alt="" /><span><strong>{memory.title}</strong><small>{memory.year} · {memory.location}</small></span></button><div><button onClick={() => startEditMemory(memory)}>Edit</button><button className="danger" onClick={() => { if (confirm(`Delete “${memory.title}” permanently?`)) void onDeleteMemory(memory).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Unable to delete this memory.')) }}><Trash2 size={14} /></button></div></article>)}</div> : <p className="community-empty">You have not added any memories yet.</p>)}
      </div>
    </section>
  </div>
}
