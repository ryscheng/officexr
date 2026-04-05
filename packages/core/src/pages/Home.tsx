import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import UserLobby from '@/components/UserLobby';
import RoomScene from '@/components/RoomScene';

export default function Home() {
  const { user, loading } = useAuth();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  if (loading) return null;

  // Anonymous users always see the hardcoded global scene.
  // They cannot change environments or switch rooms.
  if (!user) {
    return <RoomScene officeId="global" onLeave={() => {}} />;
  }

  // Authenticated user inside a specific room
  if (selectedRoomId) {
    return (
      <RoomScene
        officeId={selectedRoomId}
        onLeave={() => setSelectedRoomId(null)}
        onShowOfficeSelector={() => setSelectedRoomId(null)}
      />
    );
  }

  // Authenticated user — show their personal 3D lobby
  return <UserLobby onEnterRoom={setSelectedRoomId} />;
}
