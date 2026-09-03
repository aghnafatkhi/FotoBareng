import { FrameConfig } from './frames';

export type RoomStatus = 'waiting' | 'in_session' | 'completed';

export type PresenceState = 'connected' | 'reconnecting' | 'disconnected' | 'left';

export interface Participant {
  id: string; // Auth UID or doc ID
  uid: string; // Auth UID
  name: string;
  participantIndex: number; // slot 0 or 1
  slotIndex: number; // slot 0 or 1
  isReady: boolean;
  readyConfigVersion?: number; // matched against room.configVersion
  isHost?: boolean; // Convenience flag, authoritative host is room.hostUid
  presence?: PresenceState;
  joinedAt: number;
  updatedAt: number;
  photos?: Record<number, string>; // Legacy photo map if needed
}

export interface Room {
  id: string; // 6-char Room Code
  hostUid: string; // Single Authoritative Source of Truth
  hostId?: string; // Legacy alias for backward compatibility
  status: RoomStatus;
  frameId: string;
  customFrame?: FrameConfig;
  configVersion: number; // Incremented whenever frame/settings change
  activeSessionId?: string | null;
  latestSessionId?: string | null;
  createdAt: number;
  expiresAt: number; // Configurable TTL (24h)
  maxParticipants: number;
  resultPath?: string | null;
  resultImage?: string | null;
  currentRound?: number;
  sessionCount?: number;
  captureAt?: number | null;
}

export type SessionStatus = 
  | 'preparing'       // Initializing session
  | 'scheduled'       // Countdown ticking down towards captureAt
  | 'capturing'       // Exact capture moment
  | 'waiting_capture' // Uploading capture blob and awaiting all participants
  | 'recovery'        // Timeout / missed capture, host can retry round
  | 'processing'      // Rendering final composite image
  | 'completed'       // Final image ready
  | 'abandoned';      // Cancelled by host

export interface SessionParticipantSnapshot {
  uid: string;
  name: string;
  slotIndex: number;
}

export interface CaptureRecord {
  participantUid: string;
  roundIndex: number;
  attemptId: number;
  mediaUrl: string;
  mediaPath?: string;
  uploadedAt: number;
}

export interface SlotCrop {
  panX: number; // Normalized offset (-0.5 to 0.5)
  panY: number; // Normalized offset (-0.5 to 0.5)
  zoom: number; // Scale factor (1.0 to 2.0)
}

export interface PhotoboothSession {
  id: string; // sess_...
  roomId: string;
  status: SessionStatus;
  frameSnapshot: FrameConfig;
  participantSnapshot: SessionParticipantSnapshot[];
  roundCount: number;
  currentRound: number; // 0-indexed
  currentAttempt: number; // 1-indexed
  scheduledAt: number; // shared timestamp
  captureAt: number; // authoritative target timestamp
  captures: Record<string, CaptureRecord>; // key: `${uid}_r${round}_a${attempt}`
  crops?: Record<string, SlotCrop>; // key: slot.id
  processingBy?: string | null; // UID of client processing the final result
  resultStatus?: 'pending' | 'processing' | 'ready' | 'failed';
  resultPath?: string | null;
  resultImage?: string | null;
  recoveryReason?: string | null;
  revision: number; // Monotonically increasing state version
  createdAt: number;
  updatedAt: number;
}

export const generateRoomCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Unambiguous chars
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const generateSessionId = (): string => {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
};

export const generateParticipantId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'p_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now().toString(36);
};
