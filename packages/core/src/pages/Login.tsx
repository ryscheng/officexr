import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, signInWithGoogle } from '@/hooks/useAuth';

export default function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate('/', { replace: true });
    }
  }, [user, loading, navigate]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: '#0d0d1a',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      {/* Left panel — branding */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px',
        background: 'linear-gradient(135deg, #0f0f23 0%, #1a1040 50%, #0d1a2e 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Decorative glow circles */}
        <div style={{
          position: 'absolute', width: '500px', height: '500px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
          top: '-100px', left: '-100px', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', width: '400px', height: '400px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
          bottom: '0', right: '60px', pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', maxWidth: '480px' }}>
          {/* Logo mark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '48px' }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '12px',
              background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '22px',
            }}>
              🌐
            </div>
            <span style={{ fontSize: '22px', fontWeight: '700', color: 'white', letterSpacing: '-0.3px' }}>
              OfficeXR
            </span>
          </div>

          <h1 style={{
            fontSize: '44px', fontWeight: '800', color: 'white',
            lineHeight: 1.15, margin: '0 0 20px 0', letterSpacing: '-1px',
          }}>
            Your virtual<br />
            <span style={{
              background: 'linear-gradient(90deg, #818cf8, #60a5fa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              office awaits
            </span>
          </h1>

          <p style={{ fontSize: '17px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: 0 }}>
            Meet colleagues, hold meetings, and collaborate
            in immersive 3D rooms — from any device.
          </p>

          {/* Feature list */}
          <div style={{ marginTop: '48px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              ['🏢', 'Private rooms with unique share links'],
              ['🎙', 'Proximity-based spatial voice chat'],
              ['🥽', 'WebXR support for VR & AR headsets'],
            ].map(([icon, text]) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.07)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '18px', flexShrink: 0,
                }}>
                  {icon}
                </div>
                <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — sign in form */}
      <div style={{
        width: '420px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px 48px',
        background: '#111827',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '26px', fontWeight: '700', color: 'white', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>
            Sign in
          </h2>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', margin: 0 }}>
            Access your private rooms and lobby
          </p>
        </div>

        {/* Google button */}
        <button
          onClick={() => signInWithGoogle()}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '12px', padding: '13px 20px',
            background: 'white', color: '#1f2937',
            border: 'none', borderRadius: '10px', cursor: 'pointer',
            fontSize: '15px', fontWeight: '600',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.2)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 6px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.25)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.2)';
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <div style={{
          margin: '28px 0',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)', whiteSpace: 'nowrap' }}>
            or explore as a guest
          </span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
        </div>

        <button
          onClick={() => navigate('/')}
          style={{
            width: '100%', padding: '13px 20px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px', cursor: 'pointer',
            fontSize: '15px', fontWeight: '500', color: 'rgba(255,255,255,0.7)',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.09)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.18)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.1)';
          }}
        >
          Continue as Guest
        </button>

        <p style={{
          marginTop: '32px', fontSize: '12px',
          color: 'rgba(255,255,255,0.25)', textAlign: 'center', lineHeight: 1.6,
        }}>
          Guest access is limited to the public global lobby.
          Sign in to create and join rooms.
        </p>
      </div>
    </div>
  );
}
