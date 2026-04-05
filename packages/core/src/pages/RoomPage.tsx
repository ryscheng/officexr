import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import RoomScene from '@/components/RoomScene';

type PageState = 'checking' | 'ready' | 'denied' | 'not-found';

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>('checking');

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Redirect to login; after auth the user will return to this URL
      navigate('/login', { replace: true });
      return;
    }
    checkAccess();
  }, [user, loading]);

  const checkAccess = async () => {
    if (!user || !id) return;
    const { data, error } = await supabase.rpc('join_office_if_allowed', { p_office_id: id });
    setState(error ? 'not-found' : (data ?? 'not-found'));
  };

  if (loading || state === 'checking') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0d0d1a', color: 'white', fontFamily: 'monospace',
      }}>
        Loading…
      </div>
    );
  }

  if (state === 'ready') {
    return (
      <RoomScene
        officeId={id!}
        onLeave={() => navigate('/')}
        onShowOfficeSelector={() => navigate('/')}
      />
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', background: '#0d0d1a',
      color: 'white', fontFamily: 'monospace', gap: '16px',
    }}>
      <h1 style={{ margin: 0 }}>{state === 'not-found' ? 'Room Not Found' : 'Access Denied'}</h1>
      <p style={{ margin: 0, color: '#9ca3af' }}>
        {state === 'denied'
          ? 'You do not have access to this room.'
          : 'This room does not exist or may have been deleted.'}
      </p>
      <button
        onClick={() => navigate('/')}
        style={{
          padding: '10px 24px', background: '#3b82f6', color: 'white',
          border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '15px',
        }}
      >
        Back to Lobby
      </button>
    </div>
  );
}
