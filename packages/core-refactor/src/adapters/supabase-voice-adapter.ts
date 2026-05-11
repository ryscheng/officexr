import type {
  VoiceAdapter,
  VoiceAdapterEventName,
  VoiceAdapterEvents,
  VoiceConnectionState,
} from '../communication/types.ts';

export class SupabaseVoiceAdapter implements VoiceAdapter {
  async joinRoom(_roomId: string | null): Promise<void> {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }

  async leaveRoom(): Promise<void> {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }

  setMuted(_muted: boolean): void {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }

  getCurrentRoom(): string | null {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }

  getConnectionState(): VoiceConnectionState {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }

  on<K extends VoiceAdapterEventName>(
    _name: K,
    _handler: (payload: VoiceAdapterEvents[K]) => void,
  ): () => void {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }

  dispose(): void {
    // no-op stub; safe to call without error so cleanup code doesn't throw
  }
}
