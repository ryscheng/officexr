'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import OfficeSelector from '@/components/OfficeSelector';

const OfficeScene = dynamic(() => import('@/components/OfficeScene'), {
  ssr: false,
});

export default function Home() {
  const [selectedOfficeId, setSelectedOfficeId] = useState<string | null>(null);

  const handleSelectOffice = (officeId: string) => {
    setSelectedOfficeId(officeId);
  };

  const handleLeaveOffice = () => {
    setSelectedOfficeId(null);
  };

  if (!selectedOfficeId) {
    return <OfficeSelector onSelectOffice={handleSelectOffice} />;
  }

  return <OfficeScene officeId={selectedOfficeId} onLeave={handleLeaveOffice} />;
}
