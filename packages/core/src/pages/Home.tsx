import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import UserLobby from '@/components/UserLobby';
import RoomScene from '@/components/RoomScene';

export default function Home() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) return null;

  // Anonymous users always see the hardcoded global scene.
  // They cannot change environments or switch rooms.
  if (!user) {
    return <RoomScene officeId="global" onLeave={() => {}} />;
  }

  // Authenticated user — show their personal 3D lobby.
  // Entering a room navigates to /room/:id so the URL updates.
  return <UserLobby onEnterRoom={id => navigate(`/room/${id}`)} />;
}
