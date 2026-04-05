import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  AvatarCustomization,
  AVATAR_STYLES,
  AVATAR_ACCESSORIES,
  BODY_COLOR_PRESETS,
  SKIN_COLOR_PRESETS,
  MARIO_PRESETS,
} from '@/types/avatar';

type EnvironmentType = 'corporate' | 'cabin' | 'coffeeshop';

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
  margin: '0 0 14px 0', fontSize: '17px', fontWeight: '600',
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
}: SettingsPanelProps) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AvatarCustomization>(currentSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Access section state
  const [linkAccess, setLinkAccess] = useState<boolean | null>(null);
  const [linkAccessSaving, setLinkAccessSaving] = useState(false);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [removeLoadingId, setRemoveLoadingId] = useState<string | null>(null);

  // Load access settings whenever the panel opens
  useEffect(() => {
    if (!isOpen || !officeId) return;

    // Fetch link_access from offices
    supabase.from('offices').select('link_access').eq('id', officeId).single()
      .then(({ data }) => { if (data) setLinkAccess(data.link_access); });

    // Fetch members joined with profiles
    setMembersLoading(true);
    supabase
      .from('office_members')
      .select('id, user_id, role, profiles(name, email)')
      .eq('office_id', officeId)
      .then(({ data }) => {
        if (data) {
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

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!officeId || !user || !inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteMessage(null);
    try {
      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from('invitations').insert({
        office_id: officeId,
        inviter_id: user.id,
        email: inviteEmail.trim().toLowerCase(),
        role: 'member',
        token,
        status: 'pending',
        expires_at: expires,
      });
      if (error) throw error;
      setInviteEmail('');
      setInviteMessage({ type: 'ok', text: `Invitation sent to ${inviteEmail.trim()}` });
    } catch {
      setInviteMessage({ type: 'err', text: 'Failed to send invitation.' });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRemoveMember = async (memberId: string, memberUserId: string) => {
    if (!officeId || memberUserId === user?.id) return;
    setRemoveLoadingId(memberId);
    await supabase.from('office_members').delete().eq('id', memberId);
    setMembers(prev => prev.filter(m => m.memberId !== memberId));
    setRemoveLoadingId(null);
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
    <div style={panelStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 20px 0', fontSize: '22px', fontWeight: 'bold' }}>Settings</h2>

        {/* ── Access ── */}
        {officeId && (
          <div style={sectionStyle}>
            <h3 style={sectionTitle}>Access</h3>

            {/* Link access toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '500' }}>Link access</div>
                <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
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

            {/* Invite by email (owners only) */}
            {currentUserRole === 'owner' && (
              <form onSubmit={handleInvite} style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>Invite by email</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.com"
                    required
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: '6px',
                      border: '1px solid #ccc', fontSize: '13px',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={inviteLoading || !inviteEmail.trim()}
                    style={{
                      ...btnBase, padding: '8px 14px', fontSize: '13px',
                      background: inviteLoading ? '#aaa' : '#3b82f6', color: 'white',
                    }}
                  >
                    {inviteLoading ? '…' : 'Invite'}
                  </button>
                </div>
                {inviteMessage && (
                  <div style={{
                    marginTop: '6px', fontSize: '12px',
                    color: inviteMessage.type === 'ok' ? '#16a34a' : '#dc2626',
                  }}>
                    {inviteMessage.text}
                  </div>
                )}
              </form>
            )}

            {/* Member list */}
            <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>Members</div>
            {membersLoading ? (
              <div style={{ fontSize: '13px', color: '#888' }}>Loading…</div>
            ) : members.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#888' }}>No members found.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {members.map(m => (
                  <div key={m.memberId} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: '6px', background: '#f5f5f5',
                  }}>
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontSize: '13px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {m.name ?? m.email ?? m.userId}
                        {m.userId === user?.id && (
                          <span style={{ marginLeft: '6px', fontSize: '11px', color: '#888' }}>(you)</span>
                        )}
                      </div>
                      {m.name && m.email && (
                        <div style={{ fontSize: '11px', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {m.email}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span style={{
                        fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: '500',
                        background: m.role === 'owner' ? '#fef3c7' : '#e0f2fe',
                        color: m.role === 'owner' ? '#92400e' : '#0369a1',
                        textTransform: 'capitalize',
                      }}>
                        {m.role}
                      </span>
                      {currentUserRole === 'owner' && m.userId !== user?.id && (
                        <button
                          onClick={() => handleRemoveMember(m.memberId, m.userId)}
                          disabled={removeLoadingId === m.memberId}
                          title="Remove from room"
                          style={{
                            ...btnBase, padding: '3px 8px', fontSize: '12px',
                            background: '#fee2e2', color: '#dc2626',
                            opacity: removeLoadingId === m.memberId ? 0.5 : 1,
                          }}
                        >
                          {removeLoadingId === m.memberId ? '…' : 'Remove'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Environment ── */}
        {onEnvironmentChange && (
          <div style={sectionStyle}>
            <h3 style={sectionTitle}>Office Environment</h3>
            <div style={{ display: 'grid', gap: '10px' }}>
              {([
                ['corporate',  '🏢 Corporate Office',      'Modern skyscraper with city views'],
                ['cabin',      '🏔️ Cabin in the Woods',    'Cozy cabin near a lake with fireplace'],
                ['coffeeshop', '☕ Coffee Shop',            'Trendy third wave coffee shop'],
              ] as const).map(([val, label, desc]) => (
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
                  <div style={{ fontSize: '13px', opacity: 0.8 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Avatar (authenticated users only) ── */}
        {onSave && (
          <>
            {/* Character presets */}
            <div style={sectionStyle}>
              <h3 style={sectionTitle}>Choose Character</h3>

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
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
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
