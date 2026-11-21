import { useSlowNotice, WorldLoadingScreen, type WorldLoadingScreenProps } from '@officexr/world/top-down';
import { BrandMark } from '../page/PageShell';
import { BACK_TO_OFFICES, enteringCopy, type EnteringStage } from './enteringStage';

export function enteringScreen(stage: EnteringStage, name?: string): Pick<WorldLoadingScreenProps, 'title' | 'step' | 'progress' | 'hint' | 'brand' | 'back'> {
  return { ...enteringCopy(stage, name), brand: <BrandMark />, back: BACK_TO_OFFICES };
}

export function EnteringOffice({ stage, name }: { stage: EnteringStage; name?: string }) {
  const slow = useSlowNotice(true, stage);
  return <WorldLoadingScreen {...enteringScreen(stage, name)} slow={slow} />;
}
