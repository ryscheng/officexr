import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import AvatarPreview from './AvatarPreview';
import {
  AvatarCustomization,
  AVATAR_STYLES,
  AVATAR_ACCESSORIES,
  BODY_COLOR_PRESETS,
  SKIN_COLOR_PRESETS,
  MARIO_PRESETS,
  BubblePreferences,
  loadBubblePrefs,
  saveBubblePrefs,
} from '@/types/avatar';

type EnvironmentType = string;

interface RoomMember {
  memberId: string;  // office_members.id
  userId: string;
  name: string | null;
  email: string | null;
  role: 'owner' | 'admin' | 'member';
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentSettings: AvatarCustomization;
  onSave?: (settings: AvatarCustomization) => void;
  currentEnvironment?: EnvironmentType;
  onEnvironmentChange?: (env: EnvironmentType) => void;
  officeId?: string;
  currentUserRole?: 'owner' | 'admin' | 'member';
  onBubblePrefsChange?: (prefs: BubblePreferences) => void;
}

const panelStyle: React.CSSProperties = {
  position: 'fixed', inset: 0,
  backgroundColor: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000,
};

const cardStyle: React.CSSProperties = {
  backgroundColor: 'white', borderRadius: '12px',
  padding: '24px', maxWidth: '620px', width: '90%',
  maxHeight: '85vh', overflowY: 'auto',
  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '24px', paddingBottom: '24px',
  borderBottom: '1px solid #e0e0e0',
};

const sectionTitle: React.CSSProperties = {
  margin: '0 0 14px 0', fontSize: '17px', fontWeight: '600', color: '#111',
};

const btnBase: React.CSSProperties = {
  border: 'none', borderRadius: '8px', cursor: 'pointer',
  fontWeight: '500', transition: 'all 0.15s',
};

export default function SettingsPanel({
  isOpen,
  onClose,
  currentSettings,
  onSave,
  currentEnvironment = 'corporate',
  onEnvironmentChange,
  officeId,
  currentUserRole,
  onBubblePrefsChange,
}: SettingsPanelProps) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AvatarCustomization>(currentSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bubblePrefs, setBubblePrefs] = useState<BubblePreferences>(loadBubblePrefs);

  // Access section state
  const [linkAccess, setLinkAccess] = useState<boolean | null>(null);
  const [linkAccessSaving, setLinkAccessSaving] = useState(false);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [removeLoadingId, setRemoveLoadingId] = useState<string | null>(null);
  const [roleLoadingId, setRoleLoadingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Room skins state
  const [roomSkins, setRoomSkins] = useState<{ id: string; name: string; model_url: string; uploaded_by: string | null }[]>([]);
  const [skinUploading, setSkinUploading] = useState(false);
  const [skinUploadError, setSkinUploadError] = useState<string | null>(null);
  const [skinName, setSkinName] = useState('');
  const [showSkinUpload, setShowSkinUpload] = useState(false);
  const roomSkinFileInputRef = useRef<HTMLInputElement>(null);

  // Load access settings whenever the panel opens
  useEffect(() => {
    if (!isOpen || !officeId) return;

    // Fetch link_access from offices
    supabase.from('offices').select('link_access').eq('id', officeId).single()
      .then(({ data }) => { if (data) setLinkAccess(data.link_access); });

    // Fetch room skins
    supabase
      .from('office_skins')
      .select('id, name, model_url, uploaded_by')
      .eq('office_id', officeId)
      .then(({ data }) => { if (data) setRoomSkins(data); });

    // Fetch members joined with profiles
    setMembersLoading(true);
    supabase
      .from('office_members')
      .select('id, user_id, role, profiles(name, email)')
      .eq('office_id', officeId)
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to fetch members:', error);
        } else if (data) {
          setMembers((data as any[]).map(m => ({
            memberId: m.id,
            userId: m.user_id,
            name: m.profiles?.name ?? null,
            email: m.profiles?.email ?? null,
            role: m.role,
          })));
        }
        setMembersLoading(false);
      });
  }, [isOpen, officeId]);

  const handleToggleLinkAccess = async () => {
    if (!officeId || linkAccess === null) return;
    setLinkAccessSaving(true);
    const next = !linkAccess;
    await supabase.from('offices').update({ link_access: next }).eq('id', officeId);
    setLinkAccess(next);
    setLinkAccessSaving(false);
  };

  const handleRemoveMember = async (memberId: string, memberUserId: string) => {
    if (!officeId || memberUserId === user?.id) return;
    setRemoveLoadingId(memberId);
    await supabase.from('office_members').delete().eq('id', memberId);
    setMembers(prev => prev.filter(m => m.memberId !== memberId));
    setRemoveLoadingId(null);
  };

  const handleChangeRole = async (memberId: string, newRole: 'admin' | 'member') => {
    setOpenMenuId(null);
    setRoleLoadingId(memberId);
    await supabase.from('office_members').update({ role: newRole }).eq('id', memberId);
    setMembers(prev => prev.map(m => m.memberId === memberId ? { ...m, role: newRole } : m));
    setRoleLoadingId(null);
  };

  const handleRoomSkinUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !officeId) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'glb' && ext !== 'gltf') {
      setSkinUploadError('Only .glb and .gltf files are supported.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setSkinUploadError('File must be under 20 MB.');
      return;
    }
    if (!skinName.trim()) {
      setSkinUploadError('Please enter a name for this skin.');
      return;
    }

    setSkinUploadError(null);
    setSkinUploading(true);
    try {
      const fileId = crypto.randomUUID();
      const path = `${officeId}/${fileId}.${ext}`;
      const { data: storageData, error: storageError } = await supabase.storage
        .from('room-skins')
        .upload(path, file, { upsert: false, contentType: 'model/gltf-binary' });

      if (storageError) throw storageError;

      const { data: { publicUrl } } = supabase.storage
        .from('room-skins')
        .getPublicUrl(storageData.path);

      const { data: skinData, error: dbError } = await supabase
        .from('office_skins')
        .insert({ office_id: officeId, name: skinName.trim(), model_url: publicUrl, uploaded_by: user.id })
        .select('id, name, model_url, uploaded_by')
        .single();

      if (dbError) throw dbError;

      setRoomSkins(prev => [...prev, skinData]);
      setSkinName('');
      setShowSkinUpload(false);
    } catch (err) {
      console.error(err);
      setSkinUploadError('Upload failed. Please try again.');
    } finally {
      setSkinUploading(false);
      if (roomSkinFileInputRef.current) roomSkinFileInputRef.current.value = '';
    }
  };

  const handleDeleteRoomSkin = async (skinId: string, modelUrl: string) => {
    if (!officeId) return;
    // Extract storage path from the public URL: everything after /room-skins/
    const marker = '/room-skins/';
    const idx = modelUrl.indexOf(marker);
    if (idx !== -1) {
      const storagePath = modelUrl.slice(idx + marker.length);
      await supabase.storage.from('room-skins').remove([storagePath]);
    }
    await supabase.from('office_skins').delete().eq('id', skinId);
    setRoomSkins(prev => prev.filter(s => s.id !== skinId));
    // If the deleted skin was the active model, clear it
    if (settings.modelUrl === modelUrl) {
      setSettings(prev => ({ ...prev, modelUrl: null }));
    }
  };

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave(settings);
      onClose();
    } catch {
      alert('Failed to save settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const selectPreset = (presetId: string) => {
    const preset = MARIO_PRESETS.find(p => p.id === presetId);
    if (preset) setSettings({ ...preset.customization, modelUrl: null });
  };

  const clearPreset = () =>
    setSettings(prev => ({ ...prev, presetId: null, modelUrl: null }));

  const toggleAccessory = (acc: string) =>
    setSettings(prev => ({
      ...prev,
      accessories: prev.accessories.includes(acc)
        ? prev.accessories.filter(a => a !== acc)
        : [...prev.accessories, acc],
    }));

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'glb' && ext !== 'gltf') {
      setUploadError('Only .glb and .gltf files are supported.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setUploadError('File must be under 20 MB.');
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      const path = `${user.id}/avatar.${ext}`;
      const { data, error } = await supabase.storage
        .from('avatar-models')
        .upload(path, file, { upsert: true, contentType: 'model/gltf-binary' });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('avatar-models')
        .getPublicUrl(data.path);

      setSettings(prev => ({ ...prev, presetId: null, modelUrl: publicUrl }));
    } catch (err) {
      console.error(err);
      setUploadError('Upload failed. Make sure the avatar-models storage bucket exists in Supabase.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const isPresetActive = (id: string) => settings.presetId === id && !settings.modelUrl;
  const isCustomModel = !!settings.modelUrl;
  const isCustomAvatar = !settings.presetId && !settings.modelUrl;

  return (
    <div style={panelStyle} onClick={() => { setOpenMenuId(null); onClose(); }}>
      <div style={cardStyle} onClick={e => { e.stopPropagation(); setOpenMenuId(null); }}>
        <h2 style={{ margin: '0 0 20px 0', fontSize: '22px', fontWeight: 'bold', color: '#111' }}>Settings</h2>

        {/* ── Access ── */}
        {officeId && (
          <div style={sectionStyle}>
            <h3 style={sectionTitle}>Access</h3>

            {/* Link access toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '500', color: '#111' }}>Link access</div>
                <div style={{ fontSize: '12px', color: '#333', marginTop: '2px' }}>
                  Anyone with the room link can join
                </div>
              </div>
              <button
                onClick={handleToggleLinkAccess}
                disabled={linkAccessSaving || currentUserRole !== 'owner' || linkAccess === null}
                style={{
                  ...btnBase,
                  padding: '7px 16px', fontSize: '13px',
                  background: linkAccess ? '#16a34a' : '#6b7280',
                  color: 'white',
                  opacity: (linkAccessSaving || currentUserRole !== 'owner') ? 0.6 : 1,
                  minWidth: '80px',
                }}
              >
                {linkAccess ? 'On' : 'Off'}
              </button>
            </div>

            {/* Member list */}
            <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#111' }}>Members</div>
            {membersLoading ? (
              <div style={{ fontSize: '13px', color: '#333' }}>Loading…</div>
            ) : members.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#333' }}>No members found.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {members.map(m => {
                  const isSelf = m.userId === user?.id;
                  const displayName = m.name ?? (isSelf ? user?.name : null) ?? m.email ?? (isSelf ? user?.email : null) ?? m.userId;
                  const displayEmail = m.email ?? (isSelf ? user?.email : null);
                  const canManage = (currentUserRole === 'owner' || currentUserRole === 'admin') && !isSelf && m.role !== 'owner';
                  const isMenuOpen = openMenuId === m.memberId;
                  const isLoading = roleLoadingId === m.memberId || removeLoadingId === m.memberId;
                  return (
                    <div key={m.memberId} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 10px', borderRadius: '6px', background: '#f5f5f5',
                      position: 'relative',
                    }}>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {displayName}
                          {isSelf && (
                            <span style={{ marginLeft: '6px', fontSize: '11px', color: '#555' }}>(you)</span>
                          )}
                        </div>
                        {(m.name ?? (isSelf ? user?.name : null)) && displayEmail && (
                          <div style={{ fontSize: '11px', color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {displayEmail}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{
                          fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: '500',
                          background: m.role === 'owner' ? '#fef3c7' : m.role === 'admin' ? '#ede9fe' : '#e0f2fe',
                          color: m.role === 'owner' ? '#92400e' : m.role === 'admin' ? '#6d28d9' : '#0369a1',
                          textTransform: 'capitalize',
                        }}>
                          {m.role}
                        </span>
                        {canManage && (
                          <div style={{ position: 'relative' }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : m.memberId); }}
                              disabled={isLoading}
                              title="Member options"
                              style={{
                                ...btnBase, padding: '2px 7px', fontSize: '14px', lineHeight: 1,
                                background: '#e5e7eb', color: '#374151',
                                opacity: isLoading ? 0.5 : 1,
                              }}
                            >
                              {isLoading ? '…' : '⋯'}
                            </button>
                            {isMenuOpen && (
                              <div style={{
                                position: 'absolute', right: 0, top: '100%', marginTop: '4px',
                                background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 10,
                                minWidth: '150px', overflow: 'hidden',
                              }}>
                                {m.role === 'member' && (
                                  <button
                                    onClick={() => handleChangeRole(m.memberId, 'admin')}
                                    style={{
                                      display: 'block', width: '100%', textAlign: 'left',
                                      padding: '8px 12px', fontSize: '13px', border: 'none',
                                      background: 'none', cursor: 'pointer', color: '#374151',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    Promote to admin
                                  </button>
                                )}
                                {m.role === 'admin' && (
                                  <button
                                    onClick={() => handleChangeRole(m.memberId, 'member')}
                                    style={{
                                      display: 'block', width: '100%', textAlign: 'left',
                                      padding: '8px 12px', fontSize: '13px', border: 'none',
                                      background: 'none', cursor: 'pointer', color: '#374151',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    Demote to member
                                  </button>
                                )}
                                {currentUserRole === 'owner' && (
                                  <button
                                    onClick={() => handleRemoveMember(m.memberId, m.userId)}
                                    style={{
                                      display: 'block', width: '100%', textAlign: 'left',
                                      padding: '8px 12px', fontSize: '13px', border: 'none',
                                      background: 'none', cursor: 'pointer', color: '#dc2626',
                                      borderTop: '1px solid #f3f4f6',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    Remove from room
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Speech Bubble ── */}
        <div style={sectionStyle}>
          <h3 style={sectionTitle}>Speech Bubble</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#333' }}>
              <span style={{ minWidth: '60px' }}>Radius</span>
              <input
                type="range"
                min={1} max={8} step={0.5}
                value={bubblePrefs.radius}
                onChange={e => {
                  const next = { ...bubblePrefs, radius: parseFloat(e.target.value) };
                  setBubblePrefs(next);
                  saveBubblePrefs(next);
                  onBubblePrefsChange?.(next);
                }}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: '30px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{bubblePrefs.radius}</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#333' }}>
              <span style={{ minWidth: '60px' }}>Color</span>
              <input
                type="color"
                value={bubblePrefs.idleColor}
                onChange={e => {
                  const next = { ...bubblePrefs, idleColor: e.target.value };
                  setBubblePrefs(next);
                  saveBubblePrefs(next);
                  onBubblePrefsChange?.(next);
                }}
                style={{ width: '40px', height: '32px', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
              />
              <span style={{ fontSize: '12px', color: '#888' }}>{bubblePrefs.idleColor}</span>
            </label>
          </div>
        </div>

        {/* ── Environment ── */}
        {onEnvironmentChange && (
          <div style={sectionStyle}>
            <h3 style={sectionTitle}>Office Environment</h3>
            <div style={{ display: 'grid', gap: '10px' }}>
              {([
                ['corporate',  '🏢 Corporate Office',      'Modern skyscraper with city views'],
                ['cabin',      '🏔️ Cabin in the Woods',    'Cozy cabin near a lake with fireplace'],
                ['coffeeshop', '☕ Coffee Shop',            'Trendy third wave coffee shop'],
              ] as [string, string, string][]).map(([val, label, desc]) => (
                <button
                  key={val}
                  onClick={() => onEnvironmentChange(val)}
                  style={{
                    ...btnBase, padding: '14px', textAlign: 'left',
                    backgroundColor: currentEnvironment === val ? '#3498db' : '#f0f0f0',
                    color: currentEnvironment === val ? 'white' : '#333',
                  }}
                >
                  <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>{label}</div>
                  <div style={{ fontSize: '13px', opacity: 1 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Avatar (authenticated users only) ── */}
        {onSave && (
          <>
            {/* Avatar preview */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <AvatarPreview customization={settings} />
            </div>

            {/* Character presets */}
            <div style={sectionStyle}>
              <h3 style={sectionTitle}>Choose Character</h3>

              {/* ── Room skins ── */}
              {officeId && (
                <div style={{ marginBottom: '18px' }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#555', marginBottom: '8px' }}>
                    Room Characters
                  </div>

                  {roomSkins.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px' }}>
                      {roomSkins.map(skin => {
                        const isActive = settings.modelUrl === skin.model_url;
                        const canDelete = skin.uploaded_by === user?.id || currentUserRole === 'owner' || currentUserRole === 'admin';
                        return (
                          <div key={skin.id} style={{ position: 'relative' }}>
                            <button
                              onClick={() => setSettings(prev => ({ ...prev, presetId: null, modelUrl: skin.model_url }))}
                              style={{
                                ...btnBase, padding: '10px 6px', width: '100%',
                                backgroundColor: isActive ? '#3498db' : '#f5f5f5',
                                color: isActive ? 'white' : '#333',
                                border: `2px solid ${isActive ? '#2980b9' : 'transparent'}`,
                                fontSize: '12px',
                              }}
                            >
                              <div style={{ fontSize: '20px', marginBottom: '4px' }}>🧍</div>
                              <div style={{ fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skin.name}</div>
                            </button>
                            {canDelete && (
                              <button
                                onClick={() => handleDeleteRoomSkin(skin.id, skin.model_url)}
                                title="Delete skin"
                                style={{
                                  position: 'absolute', top: '2px', right: '2px',
                                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                                  background: 'rgba(220,38,38,0.85)', color: 'white',
                                  fontSize: '10px', padding: '1px 4px', lineHeight: 1.4,
                                }}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add skin toggle */}
                  {!showSkinUpload ? (
                    <button
                      onClick={() => { setShowSkinUpload(true); setSkinUploadError(null); }}
                      style={{ ...btnBase, padding: '7px 14px', fontSize: '13px', background: '#e0e0e0', color: '#333' }}
                    >
                      + Add room skin
                    </button>
                  ) : (
                    <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#fafafa' }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>Upload Room Skin (.glb / .gltf)</div>
                      <input
                        type="text"
                        placeholder="Skin name…"
                        value={skinName}
                        onChange={e => setSkinName(e.target.value)}
                        style={{
                          display: 'block', width: '100%', marginBottom: '8px',
                          padding: '6px 10px', borderRadius: '6px', border: '1px solid #ccc',
                          fontSize: '13px', boxSizing: 'border-box',
                        }}
                      />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => roomSkinFileInputRef.current?.click()}
                          disabled={skinUploading}
                          style={{
                            ...btnBase, padding: '7px 14px', fontSize: '13px',
                            background: skinUploading ? '#aaa' : '#555', color: 'white',
                          }}
                        >
                          {skinUploading ? 'Uploading…' : '📁 Choose file'}
                        </button>
                        <button
                          onClick={() => { setShowSkinUpload(false); setSkinName(''); setSkinUploadError(null); }}
                          style={{ ...btnBase, padding: '7px 14px', fontSize: '13px', background: '#e0e0e0', color: '#333' }}
                        >
                          Cancel
                        </button>
                      </div>
                      <input
                        ref={roomSkinFileInputRef}
                        type="file"
                        accept=".glb,.gltf"
                        style={{ display: 'none' }}
                        onChange={handleRoomSkinUpload}
                      />
                      {skinUploadError && (
                        <div style={{ marginTop: '6px', fontSize: '12px', color: '#e74c3c' }}>{skinUploadError}</div>
                      )}
                      <div style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>
                        Max 20 MB · visible to all room members
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Built-in presets ── */}
              <div style={{ fontSize: '14px', fontWeight: '600', color: '#555', marginBottom: '8px' }}>
                Built-in Characters
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
                {MARIO_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => selectPreset(preset.id)}
                    style={{
                      ...btnBase, padding: '10px 6px',
                      backgroundColor: isPresetActive(preset.id) ? '#3498db' : '#f5f5f5',
                      color: isPresetActive(preset.id) ? 'white' : '#333',
                      border: `2px solid ${isPresetActive(preset.id) ? '#2980b9' : 'transparent'}`,
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ fontSize: '22px', marginBottom: '4px' }}>{preset.emoji}</div>
                    <div style={{ fontWeight: '600' }}>{preset.name}</div>
                  </button>
                ))}

                <button
                  onClick={clearPreset}
                  style={{
                    ...btnBase, padding: '10px 6px',
                    backgroundColor: isCustomAvatar ? '#3498db' : '#f5f5f5',
                    color: isCustomAvatar ? 'white' : '#333',
                    border: `2px solid ${isCustomAvatar ? '#2980b9' : 'transparent'}`,
                    fontSize: '13px',
                  }}
                >
                  <div style={{ fontSize: '22px', marginBottom: '4px' }}>🎨</div>
                  <div style={{ fontWeight: '600' }}>Custom</div>
                </button>
              </div>

              {/* glTF upload */}
              <div style={{
                padding: '14px', borderRadius: '8px',
                border: `2px dashed ${isCustomModel ? '#2e8b34' : '#ccc'}`,
                background: isCustomModel ? '#f0fff4' : '#fafafa',
              }}>
                <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                  Upload Custom 3D Model (.glb / .gltf)
                </div>

                {isCustomModel ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '13px', color: '#2e8b34', flexGrow: 1 }}>
                      ✓ Custom model active
                    </span>
                    <button
                      onClick={() => setSettings(prev => ({ ...prev, modelUrl: null }))}
                      style={{ ...btnBase, padding: '5px 12px', background: '#e74c3c', color: 'white', fontSize: '13px' }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    style={{
                      ...btnBase, padding: '8px 16px', fontSize: '13px',
                      background: uploading ? '#aaa' : '#555', color: 'white',
                    }}
                  >
                    {uploading ? 'Uploading…' : '📁 Choose file'}
                  </button>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".glb,.gltf"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />

                {uploadError && (
                  <div style={{ marginTop: '8px', fontSize: '13px', color: '#e74c3c' }}>{uploadError}</div>
                )}
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#333' }}>
                  Max 20 MB · auto-scaled to avatar height · visible to all users in the room
                </div>
              </div>
            </div>

            {/* Color & style (hidden when a custom glTF is active) */}
            {!isCustomModel && (
              <>
                <div style={sectionStyle}>
                  <h3 style={sectionTitle}>Body Color</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                    {BODY_COLOR_PRESETS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => setSettings(s => ({ ...s, bodyColor: p.value }))}
                        title={p.name}
                        style={{
                          width: '50px', height: '50px', borderRadius: '8px', cursor: 'pointer',
                          backgroundColor: p.value,
                          border: settings.bodyColor === p.value ? '3px solid #000' : '1px solid #ccc',
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div style={sectionStyle}>
                  <h3 style={sectionTitle}>Skin Tone</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
                    {SKIN_COLOR_PRESETS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => setSettings(s => ({ ...s, skinColor: p.value }))}
                        title={p.name}
                        style={{
                          width: '50px', height: '50px', borderRadius: '8px', cursor: 'pointer',
                          backgroundColor: p.value,
                          border: settings.skinColor === p.value ? '3px solid #000' : '1px solid #ccc',
                        }}
                      />
                    ))}
                  </div>
                </div>

                {isCustomAvatar && (
                  <>
                    <div style={sectionStyle}>
                      <h3 style={sectionTitle}>Avatar Style</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                        {AVATAR_STYLES.map(style => (
                          <button
                            key={style}
                            onClick={() => setSettings(s => ({ ...s, style }))}
                            style={{
                              ...btnBase, padding: '12px',
                              backgroundColor: settings.style === style ? '#3498db' : '#f0f0f0',
                              color: settings.style === style ? 'white' : '#333',
                              fontSize: '15px', textTransform: 'capitalize',
                            }}
                          >
                            {style}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginBottom: '24px' }}>
                      <h3 style={sectionTitle}>Accessories</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                        {AVATAR_ACCESSORIES.map(acc => {
                          const on = settings.accessories.includes(acc);
                          return (
                            <button
                              key={acc}
                              onClick={() => toggleAccessory(acc)}
                              style={{
                                ...btnBase, padding: '12px',
                                backgroundColor: on ? '#2ecc71' : '#f0f0f0',
                                color: on ? 'white' : '#333',
                                fontSize: '15px', textTransform: 'capitalize',
                              }}
                            >
                              {on ? '✓ ' : ''}{acc}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                onClick={onClose} disabled={isSaving}
                style={{ ...btnBase, padding: '12px 24px', background: '#e0e0e0', color: '#333', fontSize: '16px', opacity: isSaving ? 0.5 : 1 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave} disabled={isSaving}
                style={{ ...btnBase, padding: '12px 24px', background: '#3498db', color: 'white', fontSize: '16px', opacity: isSaving ? 0.5 : 1 }}
              >
                {isSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </>
        )}

        {!onSave && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
            <button
              onClick={onClose}
              style={{ ...btnBase, padding: '12px 24px', background: '#3498db', color: 'white', fontSize: '16px' }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
