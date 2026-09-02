export type Participant = {
  id: string;
  name: string;
  isReady: boolean;
  isHost: boolean;
  joinedAt: number;
  updatedAt: number;
  photoData?: string;
};

export type RoomStatus = 'waiting' | 'ready' | 'starting' | 'capturing' | 'waiting_capture' | 'processing' | 'completed';

export type Room = {
  id: string;
  hostId: string;
  status: RoomStatus;
  createdAt: number;
  expiresAt: number;
  captureAt: number | null;
  sessionCount: number;
  resultImage?: string;
};

export const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for(let i=0; i<6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

export const generateId = () => Math.random().toString(36).substring(2, 10);

export const generateParticipantId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'p_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now().toString(36);
};

