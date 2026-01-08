'use client';

import dynamic from 'next/dynamic';

const OfficeScene = dynamic(() => import('@/components/OfficeScene'), {
  ssr: false,
});

export default function Home() {
  return <OfficeScene />;
}
