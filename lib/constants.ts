export const CAPTURE_WIDTH = 960;
export const CAPTURE_HEIGHT = 1280; // 3:4 aspect ratio
export const CAPTURE_QUALITY = 0.90;

export const ROOM_TTL_HOURS = 24;
export const ROOM_TTL_MS = ROOM_TTL_HOURS * 60 * 60 * 1000;

export const DEFAULT_MAX_PARTICIPANTS = 2; // V1 default
export const MIN_NAME_LENGTH = 1;
export const MAX_NAME_LENGTH = 24;

export const sanitizeDisplayName = (raw: string): string => {
  return raw.trim().slice(0, MAX_NAME_LENGTH);
};
