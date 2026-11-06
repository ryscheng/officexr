/** Whether a keydown belongs to an IME composition; Safari reports it as keyCode 229 with `isComposing` unset. */
export const isComposing = (e: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>) => e.isComposing || e.keyCode === 229;
