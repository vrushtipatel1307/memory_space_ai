import { Canvas, useFrame } from '@react-three/fiber'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Brain, CalendarDays, Check, ChevronDown, CircleHelp, Compass, Eye, EyeOff, Image as ImageIcon, LockKeyhole, MapPin, MessageCircle, Mic, Pause, Play, Plus, Send, Sparkles, UploadCloud, Users, WandSparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { supabase } from './utils/supabase/client'
import { deleteMemoryRecord, getProfileName, loadMemories, saveMemoryRecord, updateMemoryRecord } from './utils/supabase/memories'
import CommunityPanel from './CommunityPanel'
import { loadGroups, loadPeople, type CommunityGroup, type PersonProfile } from './utils/supabase/community'
import ProfilePanel, { type ProfileSection } from './ProfilePanel'
import { loadAccountProfile, removeAccount, type AccountProfile } from './utils/supabase/profile'

export type Memory = {
  id: string
  year: string
  title: string
  location: string
  image: string
  people: string[]
  story: string
  position: { left: string; top: string }
  size: 'small' | 'medium' | 'large'
  voice?: { title: string; duration: string; transcript?: string; audioUrl?: string; audioFile?: File }
  transcript?: string
  ai?: StructuredMemory
  aiStatus?: 'idle' | 'organizing' | 'ready' | 'unavailable'
  imagePath?: string
  imageFile?: File
  ownerId?: string
  personIds?: string[]
  groupIds?: string[]
}

export type StructuredMemory = {
  title: string
  summary: string
  date: { value: string; certainty: 'known' | 'possible' | 'unknown'; source: string }
  location: { value: string; certainty: 'known' | 'possible' | 'unknown'; source: string }
  people: Array<{ name: string; certainty: 'known' | 'possible'; source: string }>
  events: string[]
  sources: string[]
  uncertainties: string[]
  mood?: string[]
  tags?: string[]
  objects?: string[]
  keywords?: string[]
}

type Person = {
  id: string
  name: string
  relation: string
  image: string
  position: { left: string; top: string }
  color: string
  profileId?: string
}

type AuthUser = { id: string; name: string; email: string; createdAt: string; userMetadata?: Record<string, unknown> }

function Stars() {
  const points = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const values = new Float32Array(500 * 3)
    for (let i = 0; i < 500; i += 1) {
      values[i * 3] = (Math.random() - 0.5) * 13
      values[i * 3 + 1] = (Math.random() - 0.5) * 8
      values[i * 3 + 2] = (Math.random() - 0.5) * 4 - 2
    }
    return values
  }, [])
  useFrame((_, delta) => {
    if (points.current) points.current.rotation.y += delta * 0.008
  })
  return <points ref={points}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} count={positions.length / 3} array={positions} itemSize={3} /></bufferGeometry><pointsMaterial size={0.018} color="#d5e6ff" transparent opacity={0.65} sizeAttenuation /></points>
}

function StarField() {
  return <div className="star-field"><Canvas camera={{ position: [0, 0, 5], fov: 55 }} dpr={[1, 2]}><Stars /></Canvas></div>
}

function Connector({ from, to, active }: { from: Person; to: Person; active: boolean }) {
  const x1 = parseFloat(from.position.left)
  const y1 = parseFloat(from.position.top)
  const x2 = parseFloat(to.position.left)
  const y2 = parseFloat(to.position.top)
  const midX = (x1 + x2) / 2
  const curve = Math.abs(x2 - x1) * 0.18 + 4
  return <path d={`M ${x1} ${y1} Q ${midX} ${Math.min(y1, y2) - curve} ${x2} ${y2}`} className={active ? 'connection active' : 'connection'} />
}

function PersonNode({ person, selected, onSelect }: { person: Person; selected: boolean; onSelect: () => void }) {
  return <button className={`person-node ${selected ? 'selected' : ''}`} style={{ left: person.position.left, top: person.position.top, '--node-color': person.color } as React.CSSProperties} onClick={onSelect}>
    <span className="node-ring" />{person.image ? <img src={person.image} alt={person.name} /> : <span className="person-avatar">{person.name.slice(0, 1).toUpperCase()}</span>}<span className="person-label"><strong>{person.name}</strong><small>{person.relation}</small></span>
  </button>
}

function MemoryOrb({ memory, dimmed, onOpen }: { memory: Memory; dimmed: boolean; onOpen: () => void }) {
  return <motion.button className={`memory-orb ${memory.size} ${dimmed ? 'dimmed' : ''}`} style={{ left: memory.position.left, top: memory.position.top }} onClick={onOpen} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: Math.random() * 0.15 }} whileHover={{ scale: 1.12, zIndex: 10 }}>
    <span className="orb-image"><img src={memory.image} alt="" /></span><span className="orb-meta"><small>{memory.year}</small><strong>{memory.title}</strong></span><span className="orbit-dot" />
  </motion.button>
}

function Header({ onJourney, onAddMemory, onAskMemory, onPeople, onGroups, onLogout, onOpenProfile, hasMemories, userName, profileImage }: { onJourney: () => void; onAddMemory: () => void; onAskMemory: () => void; onPeople: () => void; onGroups: () => void; onLogout: () => void; onOpenProfile: (section: ProfileSection) => void; hasMemories: boolean; userName: string; profileImage?: string }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = (section: ProfileSection) => { setMenuOpen(false); onOpenProfile(section) }
  return <header className="topbar"><a className="brand" href="#top"><span className="brand-mark"><Sparkles size={15} /></span><span>memory<span>space</span></span></a><nav><a className="ask-header-button" href="#space" aria-current="page"><Sparkles size={15} />Our space</a><button className="community-nav-button" onClick={onPeople}><Users size={15} />People</button><button className="community-nav-button" onClick={onGroups}><Users size={15} />Groups</button><button className="add-memory-button" onClick={onAddMemory}><Plus size={15} />Add Memory</button><button className="ask-header-button" onClick={onAskMemory} disabled={!hasMemories}><MessageCircle size={15} />Ask Memories</button><button className="journey-button" onClick={onJourney}><Compass size={16} />Memory Journey</button><button className="icon-button" aria-label="Help"><CircleHelp size={18} /></button><div className="profile-menu-anchor"><button className="profile-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label={`Open ${userName}'s profile menu`}>{profileImage ? <img className="nav-profile-image" src={profileImage} alt="" /> : <span className="person-avatar">{userName.slice(0, 1).toUpperCase()}</span>}<ChevronDown size={13} /></button>{menuOpen && <div className="profile-menu" role="menu"><p>{userName}</p>{([['profile', 'Profile'], ['edit', 'Edit Profile'], ['memories', 'My Memories'], ['settings', 'Settings']] as Array<[ProfileSection, string]>).map(([section, label]) => <button key={section} role="menuitem" onClick={() => menu(section)}>{label}</button>)}<button role="menuitem" className="profile-menu-logout" onClick={() => { setMenuOpen(false); onLogout() }}>Log Out</button></div>}</div></nav></header>
}

type UploadDraft = { title: string; year: string; location: string; story: string; people: string[]; groups: string[] }

function UploadMemoryForm({ onClose, onSave, onVoiceSave, people, ownerName }: { onClose: () => void; onSave: (memory: Memory) => void; onVoiceSave: (voice: Memory['voice']) => void; people: Person[]; ownerName: string }) {
  const [files, setFiles] = useState<File[]>([])
  const [draft, setDraft] = useState<UploadDraft>(() => ({ title: '', year: '', location: '', story: '', people: [], groups: [] }))
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const previews = files.map((file) => URL.createObjectURL(file))
  const addFiles = (incoming: FileList | File[]) => setFiles((current) => [...current, ...Array.from(incoming).filter((file) => file.type.startsWith('image/'))].slice(0, 6))
  const setField = (field: keyof UploadDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }))
  const save = () => {
    if (!files[0] || !draft.title.trim()) return
    const imageFile = files[0]
    if (!imageFile) return
    onSave({ id: crypto.randomUUID(), title: draft.title, year: draft.year || 'Unknown', location: draft.location || 'Location unknown', image: previews[0], imageFile, people: draft.people, story: draft.story, position: { left: '50%', top: '50%' }, size: 'large' })
  }
  return <motion.div className="upload-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section className="upload-panel" initial={{ y: 35, scale: .98 }} animate={{ y: 0, scale: 1 }}><button className="close-button" onClick={onClose} aria-label="Close upload"><X size={20} /></button><div className="upload-intro"><p className="eyebrow"><Sparkles size={13} />A new story enters the space</p><h2>Keep this moment<br /><em>close.</em></h2><p>Start with a photo. The rest will find its way.</p></div><div className="upload-content"><div className={`drop-zone ${dragging ? 'dragging' : ''} ${files.length ? 'has-files' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files) }} onClick={() => inputRef.current?.click()}><input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => event.target.files && addFiles(event.target.files)} />{files.length ? <div className="preview-strip">{previews.map((preview, index) => <img src={preview} alt="Memory preview" key={preview + index} />)}<span className="add-photo"><Plus size={17} /></span></div> : <><span className="upload-icon"><UploadCloud size={21} /></span><strong>Drop a photo here</strong><span>or choose from your photos</span></>}</div><div className="upload-form"><label><span>What should we call this moment?</span><input value={draft.title} onChange={(event) => setField('title', event.target.value)} placeholder="Grandma's birthday" autoFocus /></label><div className="form-row"><label><span>When</span><input value={draft.year} onChange={(event) => setField('year', event.target.value)} placeholder="2004" /></label><label><span>Where</span><input value={draft.location} onChange={(event) => setField('location', event.target.value)} placeholder="Portland, Oregon" /></label></div><label><span>Who was there?</span><div className="member-picker">{people.filter((person) => person.profileId).map((person) => <button type="button" className={draft.people.includes(person.profileId!) ? 'chosen' : ''} onClick={() => setDraft((current) => ({ ...current, people: current.people.includes(person.profileId!) ? current.people.filter((id) => id !== person.profileId) : [...current.people, person.profileId!] }))} key={person.id}>{person.image ? <img src={person.image} alt="" /> : <span className="member-avatar">{person.name.slice(0, 1).toUpperCase()}</span>}{person.name}{draft.people.includes(person.name) && <Check size={12} />}</button>)}</div></label><label><span>Tell the story <small>Optional</small></span><textarea value={draft.story} onChange={(event) => setField('story', event.target.value)} placeholder="Everyone came together..." rows={2} /></label><div className="upload-actions"><button className="quiet-button" onClick={onClose}>Not yet</button><button className="save-memory" disabled={!files.length || !draft.title.trim()} onClick={save}><Sparkles size={15} />Let it join the universe</button></div></div></div></motion.section></motion.div>
}

function VoiceCapture({ onSave, onBack, onSkip }: { onSave: (voice: NonNullable<Memory['voice']>) => void; onBack: () => void; onSkip: () => void }) {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [saved, setSaved] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string>()
  const [audioFile, setAudioFile] = useState<File>()
  const [playing, setPlaying] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => { if (recording && !paused) { const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer) } return undefined }, [recording, paused])
  const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
  const start = async () => {
    setSeconds(0); chunks.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const nextRecorder = new MediaRecorder(stream)
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      nextRecorder.onstop = () => { const blob = new Blob(chunks.current, { type: 'audio/webm' }); const url = URL.createObjectURL(blob); setAudioUrl(url); setAudioFile(new File([blob], 'voice-memory.webm', { type: blob.type })); setSaved(true); stream.getTracks().forEach((track) => track.stop()) }
      recorder.current = nextRecorder; nextRecorder.start(); setRecording(true)
    } catch (error) { setRecording(false); console.error('[Voice] Microphone access failed.', error) }
  }
  const stop = () => { recorder.current?.stop(); setRecording(false); setPaused(false) }
  const play = () => { if (!audio.current) return; if (playing) audio.current.pause(); else void audio.current.play(); setPlaying((value) => !value) }
  const save = () => onSave({ title: 'Your story', duration: format(seconds || 1), audioUrl, audioFile })
  return <div className="voice-step"><button className="flow-back" onClick={onBack}><ArrowLeft size={15} />Back to memory details</button>{!recording && !saved && <div className="voice-welcome"><div className="big-mic"><Mic size={34} /></div><h2>Tell the story<br /><em>your way.</em></h2><p>Tell us what you remember about this moment.</p><blockquote>“Your recording will be saved with this memory.”</blockquote><button className="start-recording" onClick={start}><Mic size={16} />Start Recording</button><button className="skip-voice" onClick={onSkip}>Skip Voice</button></div>}{recording && <div className="recording-state"><div className="recording-label"><i />Recording...</div><strong>{format(seconds)}</strong><div className="waveform large-waveform">{Array.from({ length: 42 }, (_, index) => <i style={{ animationDelay: `${index * -0.06}s`, height: `${16 + (index * 19) % 34}px` }} key={index} />)}</div><div className="recording-actions"><button onClick={() => setPaused((value) => !value)}>{paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Resume' : 'Pause'}</button><button onClick={stop}><span className="stop-square" />Stop</button></div></div>}{saved && <div className="recording-saved"><div className="saved-check"><Check size={22} /></div><p className="eyebrow">Your memory recording</p><h2>Voice memory<br /><em>saved.</em></h2><div className="saved-recording"><Mic size={16} /><strong>{format(seconds)}</strong><div className="saved-wave">{Array.from({ length: 20 }, (_, index) => <i style={{ height: `${8 + (index * 13) % 18}px` }} key={index} />)}</div><button onClick={play}>{playing ? <Pause size={14} /> : <Play size={14} fill="currentColor" />} {playing ? 'Pause' : 'Play'}</button></div><audio ref={audio} src={audioUrl} onEnded={() => setPlaying(false)} /><div className="saved-actions"><button className="record-again" onClick={() => { setSaved(false); setAudioUrl(undefined); setSeconds(0) }}>↻ Record Again</button><button className="continue-saving" onClick={save}>Continue <ArrowRight size={15} /> Save Memory</button></div><button className="skip-voice" onClick={onSkip}>Skip Voice</button></div>}</div>
}

function MemoryCreationFlow({ onClose, onSave, people, ownerName, groups, initialGroupIds }: { onClose: () => void; onSave: (memory: Memory) => void; people: Person[]; ownerName: string; groups: CommunityGroup[]; initialGroupIds: string[] }) {
  const [step, setStep] = useState<1 | 2>(1)
  const [files, setFiles] = useState<File[]>([])
  const [voice, setVoice] = useState<Memory['voice']>()
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<UploadDraft>(() => ({ title: '', year: '', location: '', story: '', people: [], groups: initialGroupIds }))
  const previews = files.map((file) => URL.createObjectURL(file))
  const setField = (field: keyof UploadDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }))
  const buildMemory = (memoryVoice?: Memory['voice']): Memory => {
    const selectedPeople = people.filter((person) => person.profileId && draft.people.includes(person.profileId))
    return { id: crypto.randomUUID(), title: draft.title, year: draft.year || 'Unknown', location: draft.location || 'Location unknown', image: previews[0], imageFile: files[0], people: selectedPeople.map((person) => person.name), personIds: selectedPeople.flatMap((person) => person.profileId ? [person.profileId] : []), groupIds: draft.groups, story: draft.story, position: { left: '50%', top: '50%' }, size: 'large', voice: memoryVoice }
  }
  const finish = (memoryVoice?: Memory['voice']) => { setSaving(true); window.setTimeout(() => onSave(buildMemory(memoryVoice)), 1300) }
  const addFiles = (incoming: FileList | File[]) => setFiles(Array.from(incoming).filter((file) => file.type.startsWith('image/')).slice(0, 6))
  if (saving) return <motion.div className="creation-saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Sparkles size={25} /><p>Your memory is becoming part<br />of your family's story...</p><div className="saving-orbit" /></motion.div>
  return <motion.div className="creation-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><section className="creation-panel"><button className="close-button" onClick={onClose} aria-label="Close Add Memory"><X size={20} /></button><div className="flow-progress"><span className="active">① Memory Details</span><i /><span className={step === 2 ? 'active' : ''}>② Voice Story</span></div>{step === 1 ? <div className="creation-step"><div className="creation-heading"><p className="eyebrow">A new story enters the space</p><h1>01 — Create the<br /><em>Memory</em></h1><p>Start with a photo. Tell us what you remember.</p></div><div className="creation-grid"><label className="creation-drop"><input type="file" accept="image/*" multiple hidden onChange={(event) => event.target.files && addFiles(event.target.files)} />{previews[0] ? <img src={previews[0]} alt="Memory preview" /> : <><UploadCloud size={26} /><strong>Drop a photo here</strong><span>or choose from your photos</span></>}</label><div className="creation-details"><label><span>What should we call this moment?</span><input value={draft.title} onChange={(event) => setField('title', event.target.value)} placeholder="Grandma's birthday" autoFocus /></label><div className="form-row"><label><span>When</span><input value={draft.year} onChange={(event) => setField('year', event.target.value)} placeholder="2004" /></label><label><span>Where</span><input value={draft.location} onChange={(event) => setField('location', event.target.value)} placeholder="Portland, Oregon" /></label></div><label><span>Who was there?</span><div className="member-picker">{people.map((person) => <button type="button" className={draft.people.includes(person.name) ? 'chosen' : ''} onClick={() => setDraft((current) => ({ ...current, people: current.people.includes(person.name) ? current.people.filter((name) => name !== person.name) : [...current.people, person.name] }))} key={person.id}>{person.image ? <img src={person.image} alt="" /> : <span className="member-avatar">{person.name.slice(0, 1).toUpperCase()}</span>}{person.name}{draft.people.includes(person.name) && <Check size={12} />}</button>)}</div></label><label><span>Who can see this memory?</span><div className="member-picker"><button type="button" className={!draft.groups.length ? 'chosen' : ''} onClick={() => setDraft((current) => ({ ...current, groups: [] }))}>Only Me{!draft.groups.length && <Check size={12} />}</button>{groups.map((group) => <button type="button" className={draft.groups.includes(group.id) ? 'chosen' : ''} onClick={() => setDraft((current) => ({ ...current, groups: current.groups.includes(group.id) ? current.groups.filter((id) => id !== group.id) : [...current.groups, group.id] }))} key={group.id}>{group.name}{draft.groups.includes(group.id) && <Check size={12} />}</button>)}</div></label><label><span>Tell the story <small>Optional</small></span><textarea value={draft.story} onChange={(event) => setField('story', event.target.value)} placeholder="Everyone came together..." rows={3} /></label><div className="creation-actions"><button className="save-without-voice" disabled={!files.length || !draft.title.trim()} onClick={() => finish()}>Save without voice</button><button className="continue-button" disabled={!files.length || !draft.title.trim()} onClick={() => setStep(2)}>Continue <ArrowRight size={15} /> Tell the Story</button></div></div></div></div> : <div className="creation-step"><div className="creation-heading voice-heading-copy"><p className="eyebrow">Some memories are better heard than written.</p><h1>02 — Tell the<br /><em>Story</em></h1>{previews[0] && <img src={previews[0]} alt="Uploaded memory" />}</div><VoiceCapture onBack={() => setStep(1)} onSkip={() => finish()} onSave={(savedVoice) => { setVoice(savedVoice); finish(savedVoice) }} /></div>}</section></motion.div>
}

function UploadMemory({ onClose, onSave, people, ownerName }: { onClose: () => void; onSave: (memory: Memory) => void; people: Person[]; ownerName: string }) {
  const [voice, setVoice] = useState<Memory['voice']>()
  const [voiceOpen, setVoiceOpen] = useState(false)
  return <div className="upload-page"><UploadMemoryForm onClose={onClose} onSave={(memory) => onSave({ ...memory, voice })} onVoiceSave={setVoice} people={people} ownerName={ownerName} /><div className="upload-voice-dock"><span className="memory-step-label">STEP 2 · VOICE MEMORY</span>{!voiceOpen && <button className="open-voice-button" onClick={() => setVoiceOpen(true)}><Mic size={15} />Record voice memory</button>}{voiceOpen && <VoiceMemory onSave={setVoice} />}</div></div>
}

function VoiceMemory({ voice, onSave }: { voice?: Memory['voice']; onSave: (voice: { title: string; duration: string; transcript?: string; audioUrl?: string }) => void }) {
  const [recording, setRecording] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [seconds, setSeconds] = useState(voice ? 84 : 0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  useEffect(() => { if (recording || playing) timer.current = window.setInterval(() => setSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer.current) }, [recording, playing])
  const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
  const toggleRecord = async () => {
    if (recording) { recorder.current?.stop(); setRecording(false); return }
    setPlaying(false); setSeconds(0); setAudioBlob(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const nextRecorder = new MediaRecorder(stream)
      chunks.current = []
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      nextRecorder.onstop = () => { setAudioBlob(new Blob(chunks.current, { type: 'audio/webm' })); stream.getTracks().forEach((track) => track.stop()) }
      recorder.current = nextRecorder; nextRecorder.start(); setRecording(true)
    } catch (error) { setRecording(false); console.error('[Voice] Microphone access failed.', error) }
  }
  const save = async () => {
    let transcript: string | undefined
    if (audioBlob) {
      setTranscribing(true)
      try {
        const buffer = await audioBlob.arrayBuffer()
        let binary = ''; new Uint8Array(buffer).forEach((byte) => { binary += String.fromCharCode(byte) })
        const response = await fetch('/api/transcribe-voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioBase64: btoa(binary), filename: 'family-memory.webm' }) })
        if (response.ok) transcript = (await response.json()).transcript
      } finally { setTranscribing(false) }
    }
    onSave({ title: 'Your story', duration: format(seconds || 1), transcript, audioUrl: audioBlob ? URL.createObjectURL(audioBlob) : undefined })
  }
  return <div className={`voice-memory ${recording ? 'recording' : ''}`}><div className="voice-heading"><span className="voice-icon"><Mic size={15} /></span><div><strong>{voice ? voice.title : 'Add Voice Memory'}</strong><small>{voice ? `A voice kept with this memory · ${voice.duration}` : 'Say what the picture cannot'}</small></div></div>{recording || playing ? <div className="waveform">{Array.from({ length: 34 }, (_, index) => <i style={{ animationDelay: `${index * -0.07}s`, height: `${12 + (index * 17) % 25}px` }} key={index} />)}</div> : voice ? <div className="saved-wave"><span />{Array.from({ length: 18 }, (_, index) => <i style={{ height: `${8 + (index * 13) % 18}px` }} key={index} />)}<span /></div> : null}{voice?.transcript && <p className="voice-transcript"><small>Transcript</small>“{voice.transcript}”</p>}<div className="voice-controls">{voice ? <button className="voice-play" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />} {playing ? 'Pause' : 'Play'} <small>{voice.duration}</small></button> : <button className="record-button" onClick={toggleRecord}><span />{recording ? 'Stop recording' : 'Start recording'} {recording && <small>{format(seconds)}</small>}</button>}{recording && <button className="voice-save" disabled={transcribing} onClick={() => { setRecording(false); save() }}>{transcribing ? 'Transcribing...' : 'Save this story'}</button>}{voice && <button className="re-record" onClick={() => { setSeconds(0); setPlaying(false); setRecording(true) }}>Re-record</button>}</div></div>
}

function VoicePlayback({ voice }: { voice: Memory['voice'] }) {
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const toggle = () => {
    if (audio.current) {
      if (playing) audio.current.pause()
      else void audio.current.play()
    }
    setPlaying((value) => !value)
  }
  return <div className="voice-memory voice-playback"><div className="voice-heading"><span className="voice-icon"><Mic size={15} /></span><div><strong>{voice?.title ?? 'Voice memory'}</strong><small>Family voice · {voice?.duration ?? '00:00'}</small></div></div><div className="saved-wave"><span />{Array.from({ length: 18 }, (_, index) => <i style={{ height: `${8 + (index * 13) % 18}px` }} key={index} />)}<span /></div><div className="voice-controls"><button className="voice-play" onClick={toggle}>{playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />} {playing ? 'Pause' : 'Play'} <small>{voice?.duration ?? '00:00'}</small></button></div>{voice?.audioUrl && <audio ref={audio} src={voice.audioUrl} onEnded={() => setPlaying(false)} />}{voice?.transcript && <p className="voice-transcript"><small>Transcript</small>“{voice.transcript}”</p>}</div>
}

function AIOrganizedCard({ ai }: { ai: StructuredMemory }) {
  return <div className="ai-organized-card"><div className="ai-card-heading"><span><Brain size={14} />AI organized from family-provided information</span><small>{ai.sources.length} sources</small></div><p>{ai.summary}</p><div className="evidence-grid"><span><CalendarDays size={13} />{ai.date.value}<small className={ai.date.certainty}>{ai.date.certainty === 'known' ? 'Confirmed' : ai.date.certainty === 'possible' ? 'Possible' : 'Unknown'} · {ai.date.source}</small></span><span><MapPin size={13} />{ai.location.value}<small className={ai.location.certainty}>{ai.location.certainty === 'known' ? 'Confirmed' : ai.location.certainty === 'possible' ? 'Possible' : 'Unknown'} · {ai.location.source}</small></span></div>{ai.people.length > 0 && <div className="ai-people"><small>People found</small><div>{ai.people.map((person) => <span className={person.certainty} key={person.name}><i />{person.name}<em>{person.certainty === 'known' ? 'confirmed' : 'possible'}</em></span>)}</div></div>}{ai.uncertainties.length > 0 && <div className="uncertainties">{ai.uncertainties.map((item) => <span key={item}>Possible · {item}</span>)}</div>}</div>
}

function AskMemory({ memory, familyMemories, onClose, onOpenMemory }: { memory: Memory; familyMemories: Memory[]; onClose: () => void; onOpenMemory: (memory: Memory) => void }) {
  const suggestions = ['Who is in this memory?', 'Where was this taken?', 'What year was this?', 'What else do we know about this moment?']
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<{ text: string; sources: string[] } | null>(null)
  const [references, setReferences] = useState<Memory[]>([])
  const [loading, setLoading] = useState(false)
  const ask = async (value = question) => {
    if (!value.trim()) return
    setQuestion(value); setLoading(true)
    try {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session?.access_token) throw new Error('Sign in again to ask about your memories.')
      const response = await fetch('/api/ask-memory', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ question: value }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Memory search failed.')
      setAnswer({ text: data.answer ?? 'I don\'t have enough information from your family\'s memories to answer that.', sources: data.sources ?? [] })
      const referenceIds = new Set<string>((data.memories ?? []).map((item: { id?: string }) => item.id).filter((id: string | undefined): id is string => Boolean(id))); setReferences(familyMemories.filter((item) => referenceIds.has(item.id)))
    } catch (error) { setAnswer({ text: error instanceof Error ? error.message : 'The memory space could not reach its organizer right now.', sources: [] }) }
    finally { setLoading(false) }
  }
   return <motion.div className="ask-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section className="ask-panel" initial={{ y: 30 }} animate={{ y: 0 }}><button className="close-button" onClick={onClose} aria-label="Close memory questions"><X size={20} /></button><p className="eyebrow"><MessageCircle size={13} />Ask about memories</p><h2>What would you like<br /><em>to remember?</em></h2><p className="ask-context"><img src={memory.image} alt="" />Answers use only your saved family memories.</p>{answer ? <div className="answer-block"><span className="answer-label"><Sparkles size={13} />From your family's memories</span><p>{loading ? 'Searching your memory space...' : answer.text}</p>{references.length > 0 && <div className="answer-references"><small>Referenced memories</small>{references.map((item) => <button key={item.id} onClick={() => { onClose(); onOpenMemory(item) }}><img src={item.image} alt="" /><span><strong>{item.title}</strong><em>{item.year} · {item.location}</em></span><ArrowRight size={13} /></button>)}</div>}{answer.sources.length > 0 && <div className="answer-sources"><small>Sources</small>{answer.sources.map((source) => <span key={source}><ImageIcon size={12} />{source}</span>)}</div>}<button className="ask-again" onClick={() => { setAnswer(null); setReferences([]) }}>Ask another question</button></div> : <div className="question-area"><div className="suggestions">{suggestions.map((suggestion) => <button onClick={() => ask(suggestion)} key={suggestion}>{suggestion}<ArrowRight size={13} /></button>)}</div><div className="question-input"><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && ask()} placeholder="Ask something about your memories..." /><button onClick={() => ask()} disabled={loading || !question.trim()} aria-label="Ask question"><Send size={15} /></button></div></div>}</motion.section></motion.div>
}

function Reconstruction({ memory, ai, loading, error, onRetry, onClose }: { memory: Memory; ai?: StructuredMemory; loading: boolean; error: string; onRetry: () => void; onClose: () => void }) {
  return <motion.div className="reconstruct-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="reconstruct-stars" /><button className="journey-close" onClick={onClose}><X size={20} /><span>Return to memory</span></button><div className="reconstruct-content"><p className="eyebrow"><WandSparkles size={14} />The memory space is listening</p>{loading ? <div className="reconstruction-steps"><div className="current"><span><Sparkles size={13} /></span><strong>Organizing the saved details for “{memory.title}”</strong><i /></div></div> : error ? <div className="reconstructed-result"><h2>Could not<br /><em>organize this memory.</em></h2><p>{error}</p><button className="back-memory" onClick={onRetry}>Try again <ArrowRight size={14} /></button></div> : ai ? <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="reconstructed-result"><div className="reconstructed-mark"><Sparkles size={22} /></div><h2>Memory<br /><em>organized.</em></h2><p>{ai.summary}</p><AIOrganizedCard ai={ai} /><button className="back-memory" onClick={onClose}>Return to this memory <ArrowRight size={14} /></button></motion.div> : <div className="reconstructed-result"><h2>No organizer<br /><em>result yet.</em></h2><p>Run the organizer to create a summary from this saved memory.</p><button className="back-memory" onClick={onRetry}>Organize memory <ArrowRight size={14} /></button></div>}</div></motion.div>
}


function MemoryDetail({ memory, familyMemories, onClose, onOpenMemory, onReconstruct }: { memory: Memory; familyMemories: Memory[]; onClose: () => void; onOpenMemory: (memory: Memory) => void; onVoiceSave?: (voice: { title: string; duration: string }) => void; onReconstruct: () => void }) {
  const [askOpen, setAskOpen] = useState(false)
  return <motion.div className="memory-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section className="memory-detail" initial={{ y: 50, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 50, scale: 0.97 }} transition={{ type: 'spring', stiffness: 180, damping: 24 }}>
    <button className="close-button" onClick={onClose} aria-label="Close memory"><X size={20} /></button><div className="detail-photo"><img src={memory.image} alt={memory.title} /><span className="photo-year">{memory.year}</span></div><div className="detail-copy"><p className="eyebrow"><ImageIcon size={13} />A memory held close</p><h2>{memory.title}</h2><div className="detail-facts"><span><MapPin size={15} />{memory.location}</span><span><CalendarDays size={15} />{memory.year}</span></div><div className="people-row"><Users size={15} /><span>{memory.people.map((person) => <span key={person}>{person}</span>)}</span></div><p className="story">{memory.story}</p>{memory.ai && <AIOrganizedCard ai={memory.ai} />}{memory.voice && <VoicePlayback voice={memory.voice} />}<div className="ai-actions"><button onClick={() => setAskOpen(true)}><MessageCircle size={14} />Ask About This Memory</button><button onClick={onReconstruct}><WandSparkles size={14} />Reconstruct Memory</button></div></div>
  </motion.section>{askOpen && <AskMemory memory={memory} familyMemories={familyMemories} onClose={() => setAskOpen(false)} onOpenMemory={onOpenMemory} />}</motion.div>
}

function Journey({ memories, onClose }: { memories: Memory[]; onClose: () => void }) {
  return <motion.div className="journey-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="journey-stars" /><button className="journey-close" onClick={onClose}><X size={20} /><span>Return to space</span></button><div className="journey-heading"><p className="eyebrow"><Compass size={14} />A path through time</p><h2>Memory Journey</h2><p>Follow the moments that made us who we are.</p></div><div className="timeline">{memories.slice(0, 4).map((memory, index) => <motion.div className={`timeline-item ${index % 2 ? 'right' : 'left'}`} key={memory.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.15 }}><div className="timeline-line"><span>{memory.year}</span></div><div className="timeline-card"><img src={memory.image} alt={memory.title} /><div><small>{memory.location}</small><h3>{memory.title}</h3></div></div></motion.div>)}</div>{!memories.length && <p className="empty-memories">Your saved memories will appear here.</p>}<div className="journey-footer"><span><Sparkles size={14} />Your family's story, still unfolding</span><button onClick={onClose}>Back to our space <ArrowRight size={15} /></button></div></motion.div>
}

type AuthMode = 'login' | 'signup' | 'forgot' | 'reset'

function AuthScreen({ initialMode = 'login', onAuthenticated }: { initialMode?: AuthMode; onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setMessage('')
    if (!supabase) return setError('Supabase is not configured. Add the VITE_SUPABASE variables and restart the dev server.')
    if (mode === 'signup' && password !== confirm) return setError('Passwords do not match.')
    if (mode === 'signup' && !agreed) return setError('Please agree to the privacy terms.')
    if ((mode === 'signup' || mode === 'reset') && (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z\d]/.test(password))) return setError('Use at least 8 characters with a letter, number, and symbol.')
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } })
        if (signUpError) throw signUpError
        console.info('[Supabase] Sign-up request completed.')
        if (data.session && data.user) onAuthenticated({ id: data.user.id, name: name.trim() || email.trim(), email: data.user.email ?? email.trim(), createdAt: data.user.created_at, userMetadata: data.user.user_metadata })
        else { setMode('login'); setMessage('Check your email to confirm your account, then log in.') }
      } else if (mode === 'login') {
        const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (loginError) throw loginError
        if (!data.user || !data.session) throw new Error('Supabase did not return an authenticated session.')
        const { data: verified, error: verifyError } = await supabase.auth.getUser()
        if (verifyError || !verified.user) throw verifyError ?? new Error('Could not verify the Supabase session.')
        const displayName = await getProfileName(verified.user)
        console.info(`[Supabase] Authentication successful for user ${verified.user.id}.`)
        onAuthenticated({ id: verified.user.id, name: displayName, email: verified.user.email ?? email.trim(), createdAt: verified.user.created_at, userMetadata: verified.user.user_metadata })
      } else if (mode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
        if (resetError) throw resetError
        setMessage('If an account exists for this email, password reset instructions have been sent.')
      } else {
        const { data, error: updateError } = await supabase.auth.updateUser({ password })
        if (updateError) throw updateError
        setMode('login'); setPassword(''); setMessage('Your password was updated. You can log in now.')
        if (data.user) await supabase.auth.signOut()
      }
    } catch (caught) {
      console.error('[Supabase] Authentication request failed.', caught)
      setError(caught instanceof Error ? caught.message : 'Authentication failed. Please try again.')
    } finally { setBusy(false) }
  }

  const title = mode === 'login' ? 'Welcome back to your memories.' : mode === 'signup' ? 'Begin your memory space.' : mode === 'forgot' ? 'Find your way back.' : 'Choose a new password.'
  return <main className="auth-shell"><div className="auth-stars" /><div className="auth-orbit orbit-a" /><div className="auth-orbit orbit-b" /><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><Sparkles size={15} /></span><strong>memory<span>space</span></strong></div><p className="eyebrow"><Sparkles size={13} />A private place for family stories</p><h1>{title}</h1><p className="auth-subtitle">{mode === 'login' ? 'Your memories are waiting for you.' : mode === 'signup' ? 'Make a home for the moments you never want to lose.' : 'We will help you return to the moments that matter.'}</p>{error && <div className="auth-message error">{error}</div>}{message && <div className="auth-message success">{message}</div>}<form onSubmit={submit}>{mode === 'signup' && <label><span>Your name</span><input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Your name" /></label>}{mode !== 'reset' && <label><span>Email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" /></label>}{mode === 'forgot' && <button className="auth-submit" disabled={busy}>{busy ? 'Sending...' : 'Send reset instructions'}</button>}{mode === 'reset' && <><label><span>New password</span><div className="password-field"><input required type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Show password">{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label><button className="auth-submit" disabled={busy}>{busy ? 'Updating...' : 'Reset password'}</button></>}{(mode === 'login' || mode === 'signup') && <><label><span>Password</span><div className="password-field"><input required type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Your password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Show password">{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>{mode === 'signup' && <><label><span>Confirm password</span><input required type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" placeholder="Enter your password again" /></label><div className="password-hint">Use at least 8 characters with letters, numbers, and symbols.</div><label className="terms"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed((value) => !value)} /><span>I agree to the privacy terms.</span></label><div className="privacy-note"><LockKeyhole size={14} /><span><strong>Your memories are private.</strong><small>Your photos and stories are associated with your account.</small></span></div></>}{mode === 'login' && <button type="button" className="auth-link forgot-link" onClick={() => setMode('forgot')}>Forgot password?</button>}<button className="auth-submit" disabled={busy}>{busy ? 'Opening your space...' : mode === 'login' ? 'Log In' : 'Create Account'}</button></>}</form><div className="auth-switch">{mode === 'login' && <>Don't have an account? <button type="button" onClick={() => { setError(''); setMessage(''); setMode('signup') }}>Sign Up</button></>}{mode === 'signup' && <>Already have an account? <button type="button" onClick={() => { setError(''); setMessage(''); setMode('login') }}>Log In</button></>}{(mode === 'forgot' || mode === 'reset') && <button type="button" onClick={() => { setError(''); setMessage(''); setMode('login') }}>Back to Login</button>}</div></section></main>
}

function App() {
  const [memoryList, setMemoryList] = useState<Memory[]>([])
  const [openMemory, setOpenMemory] = useState<Memory | null>(null)
  const [journeyOpen, setJourneyOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [reconstructionOpen, setReconstructionOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null)
  const [profileLoadError, setProfileLoadError] = useState('')
  const [profileReload, setProfileReload] = useState(0)
  const [profileSection, setProfileSection] = useState<ProfileSection | null>(null)
  const [peopleProfiles, setPeopleProfiles] = useState<PersonProfile[]>([])
  const [communityGroups, setCommunityGroups] = useState<CommunityGroup[]>([])
  const [communityTab, setCommunityTab] = useState<'people' | 'groups' | null>(null)
  const [initialGroupIds, setInitialGroupIds] = useState<string[]>([])
  const [initialGroupId, setInitialGroupId] = useState<string>()
  const [initialPersonId, setInitialPersonId] = useState<string>()
  const [authChecked, setAuthChecked] = useState(false)
  const [memoriesLoading, setMemoriesLoading] = useState(false)
  const [appError, setAppError] = useState('')
  const [authError, setAuthError] = useState('')
  const [reconstructionLoading, setReconstructionLoading] = useState(false)
  const [reconstructionError, setReconstructionError] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState('')
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const client = supabase
    if (!client) { setAuthError('Supabase configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then restart the dev server.'); setAuthChecked(true); return }
    console.info('[Supabase] Client initialized.')
    let active = true
    const applySession = async (userId: string) => {
      const { data, error } = await client.auth.getUser()
      if (!active) return
      if (error || !data.user || data.user.id !== userId) { setAuthUser(null); setAuthError(error?.message ?? 'Supabase session could not be verified.'); return }
      try {
        const name = await getProfileName(data.user)
        if (!active) return
        setAuthUser({ id: data.user.id, name, email: data.user.email ?? '', createdAt: data.user.created_at, userMetadata: data.user.user_metadata })
        setAuthError('')
        console.info(`[Supabase] Session verified for user ${data.user.id}.`)
      } catch (error) {
        console.error('[Supabase] Profile query failed.', error)
        setAuthError(error instanceof Error ? error.message : 'Could not load your profile. Apply the Supabase migration and try again.')
      }
    }
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setResetMode(true)
      if (event === 'SIGNED_OUT') { setAuthUser(null); setAccountProfile(null); setMemoryList([]); setResetMode(false); return }
      if (session) window.setTimeout(() => { void applySession(session.user.id) }, 0)
    })
    void client.auth.getSession().then(async ({ data, error }) => {
      if (!active) return
      if (error) setAuthError(error.message)
      else if (data.session) await applySession(data.session.user.id)
      setAuthChecked(true)
    }).catch((error: unknown) => { if (active) { setAuthError(error instanceof Error ? error.message : 'Could not check the Supabase session.'); setAuthChecked(true) } })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!authUser || !supabase) { setAccountProfile(null); setProfileLoadError(''); return }
    let active = true
    setProfileLoadError('')
    void supabase.auth.getUser().then(async ({ data, error }) => {
      if (error) throw error
      const profile = await loadAccountProfile({ id: authUser.id, email: authUser.email, user_metadata: data.user?.user_metadata ?? authUser.userMetadata })
      if (active) setAccountProfile(profile)
    }).catch((error: unknown) => {
      if (active) { console.error('[Supabase] Account profile load failed.', error); setProfileLoadError(error instanceof Error ? error.message : 'Could not load your profile.') }
    })
    return () => { active = false }
  }, [authUser?.id, profileReload])

  useEffect(() => {
    if (!authUser) return
    const url = new URL(window.location.href)
    if (!url.searchParams.has('group_invitation')) return
    setCommunityTab('groups')
    url.searchParams.delete('group_invitation')
    window.history.replaceState(null, '', url)
  }, [authUser?.id])

  const refreshMemories = async (userId: string) => {
    setMemoriesLoading(true); setAppError('')
    try {
      const saved = await loadMemories(userId)
      setMemoryList(saved)
      console.info(`[Supabase] Memory query successful. Memories returned: ${saved.length}.`)
      return saved
    } catch (error) {
      console.error('[Supabase] Memory query failed.', error)
      setMemoryList([])
      setAppError(error instanceof Error ? error.message : 'Could not load memories from Supabase.')
      return []
    } finally { setMemoriesLoading(false) }
  }

  useEffect(() => { if (authUser) void refreshMemories(authUser.id); else setMemoryList([]) }, [authUser?.id])

  useEffect(() => {
    if (!authUser) { setPeopleProfiles([]); setCommunityGroups([]); return }
    Promise.all([loadPeople(authUser.id), loadGroups(authUser.id)])
      .then(([nextPeople, nextGroups]) => { setPeopleProfiles(nextPeople); setCommunityGroups(nextGroups) })
      .catch((error: unknown) => { console.error('[Supabase] People and groups query failed.', error); setAppError(error instanceof Error ? error.message : 'Could not load people and groups.') })
  }, [authUser?.id])

  const people = useMemo<Person[]>(() => {
    if (!authUser) return []
    const profiles = peopleProfiles.filter((profile) => profile.name.toLocaleLowerCase() !== authUser.name.toLocaleLowerCase())
    const nodes = [{ id: authUser.id, name: accountProfile?.display_name || authUser.name, relation: 'You', image: accountProfile?.imageUrl || '', profileId: undefined as string | undefined }, ...profiles.map((profile) => ({ id: profile.id, name: profile.name, relation: profile.relationship || 'Person', image: profile.imageUrl || '', profileId: profile.id }))]
    const colors = ['#8bceb5', '#efad73', '#7ab8da', '#b5a7dc', '#e7a2ba']
    return nodes.map((node, index) => {
      const angle = (index / Math.max(nodes.length, 2)) * Math.PI * 2 - Math.PI / 2
      return { ...node, position: { left: `${50 + Math.cos(angle) * 29}%`, top: `${50 + Math.sin(angle) * 29}%` }, color: colors[index % colors.length] }
    })
  }, [authUser, accountProfile, peopleProfiles])
  const selected = people.find((person) => person.id === selectedPerson) ?? people[0]
  const links = people.slice(1).map((person) => [people[0]?.id ?? '', person.id] as [string, string])
  useEffect(() => { if (people.length && !people.some((person) => person.id === selectedPerson)) setSelectedPerson(people[0].id) }, [people, selectedPerson])

  const logout = async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) { console.error('[Supabase] Sign-out failed.', error); setAppError(error.message) }
  }

  const saveMemory = async (memory: Memory) => {
    const imageFile = memory.imageFile
    if (!authUser || !imageFile) { setAppError('Choose a photo before saving this memory.'); return }
    setAppError('')
    let ai: StructuredMemory | undefined
    let aiStatus: Memory['aiStatus'] = 'unavailable'
    try {
      const response = await fetch('/api/organize-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: memory.title, year: memory.year, location: memory.location, description: memory.story, people: memory.people }) })
      if (!response.ok) throw new Error((await response.json()).error ?? 'Memory organizer unavailable.')
      ai = await response.json() as StructuredMemory
      aiStatus = 'ready'
    } catch (error) { console.error('[AI] Memory organizer failed; saving the original memory.', error) }
    const record = { ...memory, ai, aiStatus }
    try {
      await saveMemoryRecord({ ...record, imageFile }, authUser.id)
      const saved = await refreshMemories(authUser.id)
      setOpenMemory(saved.find((item) => item.id === record.id) ?? null)
      setUploadOpen(false)
      console.info('[Supabase] Memory saved for authenticated user.')
    } catch (error) {
      console.error('[Supabase] Memory save failed.', error)
      setAppError(error instanceof Error ? error.message : 'Could not save this memory to Supabase.')
    }
  }

  const saveVoice = async (voice: { title: string; duration: string; transcript?: string; audioUrl?: string }) => {
    if (!openMemory || !authUser) return
    const persistedVoice = { title: voice.title, duration: voice.duration, transcript: voice.transcript }
    const updated = { ...openMemory, voice: persistedVoice }
    setAppError('')
    try {
      let ai = updated.ai
      if (voice.transcript) {
        const response = await fetch('/api/organize-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: updated.title, year: updated.year, location: updated.location, description: updated.story, people: updated.people, transcript: voice.transcript }) })
        if (response.ok) ai = await response.json() as StructuredMemory
        else console.error('[AI] Voice transcript organization failed.', await response.text())
      }
      await updateMemoryRecord(updated.id, authUser.id, { voice: persistedVoice, transcript: voice.transcript, ai })
      const saved = await refreshMemories(authUser.id)
      const refreshed = saved.find((memory) => memory.id === updated.id)
      if (refreshed) setOpenMemory(refreshed)
    } catch (error) {
      console.error('[Supabase] Memory update failed.', error)
      setAppError(error instanceof Error ? error.message : 'Could not update this memory in Supabase.')
    }
  }

  const reconstructMemory = async () => {
    if (!openMemory || !authUser) return
    setReconstructionOpen(true); setReconstructionLoading(true); setReconstructionError('')
    try {
      const response = await fetch('/api/organize-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: openMemory.title, year: openMemory.year, location: openMemory.location, description: openMemory.story, people: openMemory.people, transcript: openMemory.voice?.transcript }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Memory organizer unavailable.')
      const ai = result as StructuredMemory
      await updateMemoryRecord(openMemory.id, authUser.id, { ai })
      const updated = { ...openMemory, ai, aiStatus: 'ready' as const }
      setOpenMemory(updated)
      setMemoryList((current) => current.map((memory) => memory.id === updated.id ? updated : memory))
      console.info('[Supabase] Organizer result saved to the memory record.')
    } catch (error) {
      console.error('[AI] Memory reconstruction failed.', error)
      setReconstructionError(error instanceof Error ? error.message : 'Could not organize this memory.')
    } finally { setReconstructionLoading(false) }
  }

  const persistProfileMemory = async (memory: Memory, patch: { title: string; year: string; location: string; story: string }) => {
    if (!authUser) throw new Error('Sign in to edit memories.')
    await updateMemoryRecord(memory.id, authUser.id, patch)
    const updated = { ...memory, ...patch }
    setMemoryList((current) => current.map((item) => item.id === memory.id ? updated : item))
    setOpenMemory((current) => current?.id === memory.id ? updated : current)
  }
  const removeProfileMemory = async (memory: Memory) => {
    if (!authUser) throw new Error('Sign in to delete memories.')
    await deleteMemoryRecord(memory.id, authUser.id)
    setMemoryList((current) => current.filter((item) => item.id !== memory.id))
    setOpenMemory((current) => current?.id === memory.id ? null : current)
  }
  const showCommunityGroup = (groupId?: string) => {
    setProfileSection(null); setInitialPersonId(undefined); setInitialGroupId(groupId); setCommunityTab('groups')
  }
  const showCommunityPerson = (personId?: string) => {
    setProfileSection(null); setInitialGroupId(undefined); setInitialPersonId(personId); setCommunityTab('people')
  }
  const deleteAccount = async () => { if (authUser) await removeAccount(authUser.id) }

  if (!authChecked) return <main className="auth-loading"><Sparkles size={24} /></main>
  if (authError) return <main className="auth-shell"><section className="auth-card"><h1>Supabase connection issue</h1><p className="auth-message error">{authError}</p><p className="auth-subtitle">Check the Vite environment variables and apply the Supabase migration.</p><button className="auth-submit" onClick={() => window.location.reload()}>Retry connection</button></section></main>
  if (!authUser || resetMode) return <AuthScreen key={resetMode ? 'password-recovery' : 'login'} initialMode={resetMode ? 'reset' : 'login'} onAuthenticated={(user) => { setAuthUser(user); setResetMode(false) }} />
  if (!selected) return <main className="auth-loading"><Sparkles size={24} /></main>

  return <main id="top"><StarField /><div className="ambient-glow glow-one" /><div className="ambient-glow glow-two" /><Header onJourney={() => setJourneyOpen(true)} onPeople={() => showCommunityPerson()} onGroups={() => showCommunityGroup()} onAddMemory={() => { setInitialGroupIds([]); setUploadOpen(true) }} onAskMemory={() => setAskOpen(true)} onLogout={() => { void logout() }} onOpenProfile={(section) => { setProfileSection(section); setCommunityTab(null) }} hasMemories={memoryList.length > 0} userName={accountProfile?.display_name || authUser.name} profileImage={accountProfile?.imageUrl} /><section className="hero" id="space"><div className="hero-copy"><motion.p className="eyebrow" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}><Sparkles size={14} />Your family's universe</motion.p><motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>The stories that<br /><em>made us.</em></motion.h1><motion.p className="hero-description" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>A living constellation of the people, places, and moments you never want to lose.</motion.p></div><div className="space-controls"><span className="space-status"><i />Live memory space</span><div className="zoom-control"><button onClick={() => setZoom(Math.max(0.8, zoom - 0.1))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(Math.min(1.2, zoom + 0.1))}>+</button></div></div></section>{appError && <div className="app-error" role="alert">{appError}<button onClick={() => void refreshMemories(authUser.id)}>Retry</button></div>}<section className="galaxy-wrap"><div className="galaxy" style={{ transform: `scale(${zoom})` }}><svg className="connections" viewBox="0 0 100 100" preserveAspectRatio="none">{links.map(([a, b]) => { const from = people.find((person) => person.id === a); const to = people.find((person) => person.id === b); return from && to ? <Connector active={a === selectedPerson || b === selectedPerson} from={from} to={to} key={`${a}-${b}`} /> : null })}</svg><div className="core-halo" />{memoryList.map((memory) => <MemoryOrb memory={memory} dimmed={Boolean(selected && !memory.people.includes(selected.name))} onOpen={() => setOpenMemory(memory)} key={memory.id} />)}{people.map((person) => <PersonNode person={person} selected={person.id === selectedPerson} onSelect={() => setSelectedPerson(person.id)} key={person.id} />)}</div>{memoriesLoading && <div className="empty-memories">Loading your memories…</div>}{!memoriesLoading && !appError && memoryList.length === 0 && <div className="empty-memories">No memories yet. Add your first family memory.</div>}<div className="galaxy-caption"><span className="caption-line" /><div><strong>Explore your space</strong><span>Choose a person to bring their memories closer</span></div></div></section><aside className="selected-person"><span className="person-avatar">{selected.name.slice(0, 1).toUpperCase()}</span><div><span>Currently exploring</span><strong>{selected.name}'s memories</strong></div><button aria-label="View selected person"><ArrowRight size={17} /></button></aside><AnimatePresence>{openMemory && <MemoryDetail memory={openMemory} familyMemories={memoryList} onClose={() => setOpenMemory(null)} onOpenMemory={setOpenMemory} onVoiceSave={saveVoice} onReconstruct={() => { void reconstructMemory() }} />}{askOpen && memoryList[0] && <AskMemory memory={memoryList[0]} familyMemories={memoryList} onClose={() => setAskOpen(false)} onOpenMemory={(item) => { setAskOpen(false); setOpenMemory(item) }} />}{uploadOpen && <MemoryCreationFlow onClose={() => setUploadOpen(false)} onSave={saveMemory} people={people} ownerName={authUser.name} groups={communityGroups} initialGroupIds={initialGroupIds} />}{journeyOpen && <Journey memories={memoryList} onClose={() => setJourneyOpen(false)} />}{reconstructionOpen && openMemory && <Reconstruction memory={openMemory} ai={openMemory.ai} loading={reconstructionLoading} error={reconstructionError} onRetry={() => { void reconstructMemory() }} onClose={() => setReconstructionOpen(false)} />}</AnimatePresence>{communityTab && <CommunityPanel user={authUser} memories={memoryList} initialTab={communityTab} initialGroupId={initialGroupId} initialPersonId={initialPersonId} onClose={() => { setCommunityTab(null); setInitialGroupId(undefined); setInitialPersonId(undefined) }} onChanged={(nextPeople, nextGroups) => { setPeopleProfiles(nextPeople); setCommunityGroups(nextGroups) }} onAddMemory={(groupId) => { setCommunityTab(null); setInitialGroupIds(groupId ? [groupId] : []); setUploadOpen(true) }} />}{profileSection && accountProfile && <ProfilePanel user={authUser} profile={accountProfile} memories={memoryList} groups={communityGroups} people={peopleProfiles} initialSection={profileSection} onClose={() => setProfileSection(null)} onProfileUpdated={(updated) => { setAccountProfile(updated); setAuthUser((current) => current ? { ...current, name: updated.display_name } : current) }} onOpenMemory={(memory) => { setProfileSection(null); setOpenMemory(memory) }} onUpdateMemory={persistProfileMemory} onDeleteMemory={removeProfileMemory} onDeleteAccount={deleteAccount} onLogout={() => { setProfileSection(null); void logout() }} />}{profileSection && !accountProfile && (profileLoadError ? <div className="profile-loading-overlay"><section className="profile-load-error" role="alert"><p>Unable to load your profile. Check the account profile migration and try again.</p><small>{profileLoadError}</small><button onClick={() => setProfileReload((value) => value + 1)}>Retry</button><button onClick={() => setProfileSection(null)}>Close</button></section></div> : <div className="profile-loading-overlay" role="status">Loading profile...</div>)}</main>
}

export default App
