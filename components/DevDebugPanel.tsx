'use client';

import React, { useState } from 'react';
import { Room, PhotoboothSession, Participant } from '@/lib/store';
import { getServerOffset } from '@/lib/timeSync';

interface DevDebugPanelProps {
  room: Room | null;
  session: PhotoboothSession | null;
  participants: Participant[];
  participantId: string | null;
}

export function DevDebugPanel({ room, session, participants, participantId }: DevDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Strictly development only
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const offset = getServerOffset();

  return (
    <div className="fixed bottom-3 right-3 z-50 font-mono text-[11px] text-neutral-200">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-neutral-900/90 hover:bg-neutral-900 text-neutral-400 hover:text-white px-2.5 py-1.5 rounded-lg border border-neutral-700 shadow-lg backdrop-blur"
        >
          [DEV DEBUG]
        </button>
      ) : (
        <div className="bg-neutral-950/95 border border-neutral-800 rounded-xl p-3 shadow-2xl backdrop-blur max-w-xs w-80 space-y-2">
          <div className="flex justify-between items-center border-b border-neutral-800 pb-1.5">
            <span className="font-bold text-amber-400 uppercase tracking-wider text-[10px]">Multiplayer Debug</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-neutral-500 hover:text-white text-xs px-1"
            >
              ✕
            </button>
          </div>

          <div className="space-y-1 text-neutral-300">
            <div><span className="text-neutral-500">Room:</span> {room?.id || '-'} ({room?.status || '-'})</div>
            <div><span className="text-neutral-500">Host UID:</span> {room?.hostUid ? `${room.hostUid.slice(0, 8)}...` : '-'}</div>
            <div><span className="text-neutral-500">Config Ver:</span> {room?.configVersion ?? '-'}</div>
            <div><span className="text-neutral-500">Server Offset:</span> {offset > 0 ? `+${offset}` : offset} ms</div>
            <div><span className="text-neutral-500">My UID:</span> {participantId ? `${participantId.slice(0, 8)}...` : '-'}</div>
          </div>

          {session ? (
            <div className="border-t border-neutral-800 pt-1.5 space-y-1 text-neutral-300">
              <div className="text-blue-400 font-semibold">Active Session</div>
              <div><span className="text-neutral-500">Session ID:</span> {session.id.slice(0, 16)}...</div>
              <div><span className="text-neutral-500">Status:</span> <span className="text-emerald-400">{session.status}</span></div>
              <div><span className="text-neutral-500">Round:</span> {session.currentRound + 1} / {session.roundCount}</div>
              <div><span className="text-neutral-500">Attempt:</span> #{session.currentAttempt}</div>
              <div><span className="text-neutral-500">Revision:</span> r{session.revision}</div>
              <div><span className="text-neutral-500">Captures:</span> {Object.keys(session.captures || {}).length} record(s)</div>
            </div>
          ) : (
            <div className="border-t border-neutral-800 pt-1 text-neutral-500">No active session (Lobby)</div>
          )}

          <div className="border-t border-neutral-800 pt-1.5">
            <div className="text-neutral-500 mb-1">Participants ({participants.length}):</div>
            <div className="space-y-0.5">
              {participants.map((p) => (
                <div key={p.id} className="flex justify-between text-[10px]">
                  <span className={p.uid === participantId ? 'text-blue-400 font-bold' : 'text-neutral-300'}>
                    Slot {p.slotIndex ?? p.participantIndex}: {p.name}
                  </span>
                  <span className={p.presence === 'connected' ? 'text-emerald-400' : 'text-rose-400'}>
                    {p.presence || 'connected'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
