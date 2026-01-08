'use client';

import { useState } from 'react';
import {
  AvatarCustomization,
  AVATAR_STYLES,
  AVATAR_ACCESSORIES,
  BODY_COLOR_PRESETS,
  SKIN_COLOR_PRESETS,
} from '@/types/avatar';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentSettings: AvatarCustomization;
  onSave: (settings: AvatarCustomization) => void;
}

export default function SettingsPanel({
  isOpen,
  onClose,
  currentSettings,
  onSave,
}: SettingsPanelProps) {
  const [settings, setSettings] = useState<AvatarCustomization>(currentSettings);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(settings);
      onClose();
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleAccessory = (accessory: string) => {
    setSettings((prev) => ({
      ...prev,
      accessories: prev.accessories.includes(accessory)
        ? prev.accessories.filter((a) => a !== accessory)
        : [...prev.accessories, accessory],
    }));
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 20px 0', fontSize: '24px', fontWeight: 'bold' }}>
          Avatar Settings
        </h2>

        {/* Body Color */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '12px', fontSize: '18px', fontWeight: '600' }}>
            Body Color
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
            {BODY_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setSettings({ ...settings, bodyColor: preset.value })}
                style={{
                  width: '50px',
                  height: '50px',
                  backgroundColor: preset.value,
                  border: settings.bodyColor === preset.value ? '3px solid #000' : '1px solid #ccc',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'transform 0.2s',
                }}
                title={preset.name}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              />
            ))}
          </div>
        </div>

        {/* Skin Color */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '12px', fontSize: '18px', fontWeight: '600' }}>
            Skin Tone
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
            {SKIN_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setSettings({ ...settings, skinColor: preset.value })}
                style={{
                  width: '50px',
                  height: '50px',
                  backgroundColor: preset.value,
                  border: settings.skinColor === preset.value ? '3px solid #000' : '1px solid #ccc',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'transform 0.2s',
                }}
                title={preset.name}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              />
            ))}
          </div>
        </div>

        {/* Style */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '12px', fontSize: '18px', fontWeight: '600' }}>
            Avatar Style
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            {AVATAR_STYLES.map((style) => (
              <button
                key={style}
                onClick={() => setSettings({ ...settings, style })}
                style={{
                  padding: '12px',
                  backgroundColor: settings.style === style ? '#3498db' : '#f0f0f0',
                  color: settings.style === style ? 'white' : '#333',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: '500',
                  textTransform: 'capitalize',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (settings.style !== style) {
                    e.currentTarget.style.backgroundColor = '#e0e0e0';
                  }
                }}
                onMouseLeave={(e) => {
                  if (settings.style !== style) {
                    e.currentTarget.style.backgroundColor = '#f0f0f0';
                  }
                }}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Accessories */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '12px', fontSize: '18px', fontWeight: '600' }}>
            Accessories
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            {AVATAR_ACCESSORIES.map((accessory) => {
              const isSelected = settings.accessories.includes(accessory);
              return (
                <button
                  key={accessory}
                  onClick={() => toggleAccessory(accessory)}
                  style={{
                    padding: '12px',
                    backgroundColor: isSelected ? '#2ecc71' : '#f0f0f0',
                    color: isSelected ? 'white' : '#333',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: '500',
                    textTransform: 'capitalize',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.backgroundColor = '#e0e0e0';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.backgroundColor = '#f0f0f0';
                    }
                  }}
                >
                  {isSelected ? '✓ ' : ''}
                  {accessory}
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
          <button
            onClick={onClose}
            disabled={isSaving}
            style={{
              padding: '12px 24px',
              backgroundColor: '#e0e0e0',
              color: '#333',
              border: 'none',
              borderRadius: '8px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              fontWeight: '500',
              opacity: isSaving ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '12px 24px',
              backgroundColor: '#3498db',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              fontWeight: '500',
              opacity: isSaving ? 0.5 : 1,
            }}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
