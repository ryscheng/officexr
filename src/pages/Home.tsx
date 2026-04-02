import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import OfficeSelector from '@/components/OfficeSelector';
import OfficeScene from '@/components/OfficeScene';

export default function Home() {
  const { user } = useAuth();
  const [selectedOfficeId, setSelectedOfficeId] = useState<string | null>('global');
  const [showOfficeSelector, setShowOfficeSelector] = useState(false);

  const handleSelectOffice = (officeId: string) => {
    setSelectedOfficeId(officeId);
    setShowOfficeSelector(false);
  };

  const handleShowOfficeSelector = () => {
    setShowOfficeSelector(true);
  };

  const handleLeaveOffice = () => {
    if (user) {
      setShowOfficeSelector(true);
    } else {
      setSelectedOfficeId('global');
    }
  };

  if (showOfficeSelector && user) {
    return <OfficeSelector onSelectOffice={handleSelectOffice} />;
  }

  return (
    <OfficeScene
      officeId={selectedOfficeId || 'global'}
      onLeave={handleLeaveOffice}
      onShowOfficeSelector={user ? handleShowOfficeSelector : undefined}
    />
  );
}
