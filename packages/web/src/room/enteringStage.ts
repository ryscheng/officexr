export type EnteringStage = 1 | 2 | 3 | 4;

const STEPS = ['checking your sign-in', 'finding your office', 'joining the room', 'loading the 3D view'] as const;

export const BACK_TO_OFFICES = { label: 'Back to offices', href: '/' } as const;

export function enteringTitle(name?: string): string {
  return name ? `Opening ${name}` : 'Opening your office';
}

export function enteringCopy(stage: EnteringStage, name?: string) {
  return {
    title: enteringTitle(name),
    step: `Step ${stage} of 4: ${STEPS[stage - 1]}`,
    progress: (stage / 4) * 100,
    hint: stage === 4 ? undefined : `Then: ${STEPS[stage]}`,
  };
}
