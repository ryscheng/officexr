'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import OfficeSelector from '@/components/OfficeSelector';

const OfficeScene = dynamic(() => import('@/components/OfficeScene'), {
  ssr: false,
});

export default function Home() {
  const { data: session } = useSession();
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
    if (session) {
      // Logged in users go back to office selector
      setShowOfficeSelector(true);
    } else {
      // Anonymous users go back to global office
      setSelectedOfficeId('global');
    }
  };

  if (showOfficeSelector && session) {
    return <OfficeSelector onSelectOffice={handleSelectOffice} />;
  }

  return (
    <OfficeScene
      officeId={selectedOfficeId || 'global'}
      onLeave={handleLeaveOffice}
      onShowOfficeSelector={session ? handleShowOfficeSelector : undefined}
    />
  );
}
