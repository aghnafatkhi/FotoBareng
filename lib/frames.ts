export interface FrameSlot {
  id: string;
  participantIndex: number;
  roundIndex: number;
  x: number; // Normalized 0-1
  y: number; // Normalized 0-1
  width: number; // Normalized 0-1
  height: number; // Normalized 0-1
  borderRadius?: number; // Normalized 0-1 relative to canvas width
}

export interface FrameConfig {
  id: string;
  name: string;
  participantCount: number;
  roundCount: number;
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
  slots: FrameSlot[];
}

export const OFFICIAL_FRAMES: FrameConfig[] = [
  {
    id: 'frame-side-by-side',
    name: '2 Orang — 1 Foto',
    participantCount: 2,
    roundCount: 1,
    canvasWidth: 1200,
    canvasHeight: 800,
    backgroundColor: '#ffffff',
    slots: [
      { id: 's1', participantIndex: 0, roundIndex: 0, x: 0.05, y: 0.075, width: 0.425, height: 0.85 },
      { id: 's2', participantIndex: 1, roundIndex: 0, x: 0.525, y: 0.075, width: 0.425, height: 0.85 },
    ]
  },
  {
    id: 'frame-classic-strip',
    name: '2 Orang — 2 Foto Strip',
    participantCount: 2,
    roundCount: 2,
    canvasWidth: 600,
    canvasHeight: 1600,
    backgroundColor: '#ffffff',
    slots: [
      { id: 's1', participantIndex: 0, roundIndex: 0, x: 0.05, y: 0.03, width: 0.9, height: 0.22 },
      { id: 's2', participantIndex: 1, roundIndex: 0, x: 0.05, y: 0.27, width: 0.9, height: 0.22 },
      { id: 's3', participantIndex: 0, roundIndex: 1, x: 0.05, y: 0.51, width: 0.9, height: 0.22 },
      { id: 's4', participantIndex: 1, roundIndex: 1, x: 0.05, y: 0.75, width: 0.9, height: 0.22 },
    ]
  },
  {
    id: 'frame-grid-2x2',
    name: '2 Orang — 2 Foto Grid',
    participantCount: 2,
    roundCount: 2,
    canvasWidth: 1200,
    canvasHeight: 1200,
    backgroundColor: '#ffffff',
    slots: [
      { id: 's1', participantIndex: 0, roundIndex: 0, x: 0.05, y: 0.05, width: 0.425, height: 0.425, borderRadius: 0.02 },
      { id: 's2', participantIndex: 1, roundIndex: 0, x: 0.525, y: 0.05, width: 0.425, height: 0.425, borderRadius: 0.02 },
      { id: 's3', participantIndex: 0, roundIndex: 1, x: 0.05, y: 0.525, width: 0.425, height: 0.425, borderRadius: 0.02 },
      { id: 's4', participantIndex: 1, roundIndex: 1, x: 0.525, y: 0.525, width: 0.425, height: 0.425, borderRadius: 0.02 },
    ]
  }
];
