'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '@/lib/firebase';
import { 
  doc, 
  onSnapshot, 
  collection, 
  updateDoc, 
  writeBatch,
  deleteDoc,
  runTransaction
} from 'firebase/firestore';
import { Room, Participant, PresenceState } from '@/lib/store';
import { FrameConfig } from '@/lib/frames';
import { mediaStorage } from '@/lib/mediaStorage';
import { getSynchronizedNow } from '@/lib/timeSync';
import { electNewHost } from '@/lib/sessionService';

export function useRoom(roomCode: string, participantId: string | null) {
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [roomError, setRoomError] = useState<'not_found' | 'expired' | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const lastHostElectionCheck = useRef(0);

  // Monitor online / offline network state
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setTimeout(() => {
      setIsOffline(!navigator.onLine);
    }, 0);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Room & Participants Realtime Subscriptions
  useEffect(() => {
    if (!roomCode || !participantId) return;

    const unsubRoom = onSnapshot(
      doc(db, 'rooms', roomCode),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Room;
          const now = getSynchronizedNow();
          if (data.expiresAt && now > data.expiresAt) {
            setRoomError('expired');
          } else {
            setRoom(data);
            setRoomError(null);
          }
        } else {
          setRoomError('not_found');
        }
      },
      (err) => {
        console.warn('Room snapshot error:', err);
      }
    );

    const unsubParticipants = onSnapshot(
      collection(db, 'rooms', roomCode, 'participants'),
      (snap) => {
        const parts: Participant[] = [];
        snap.forEach((d) => {
          parts.push(d.data() as Participant);
        });
        parts.sort((a, b) => (a.slotIndex ?? a.participantIndex) - (b.slotIndex ?? b.participantIndex));
        setParticipants(parts);
      },
      (err) => {
        console.warn('Participants snapshot error:', err);
      }
    );

    // Heartbeat every 4 seconds
    const interval = setInterval(() => {
      if (participantId && navigator.onLine) {
        updateDoc(doc(db, 'rooms', roomCode, 'participants', participantId), {
          updatedAt: getSynchronizedNow(),
          presence: 'connected'
        }).catch(() => {});
      }
    }, 4000);

    return () => {
      unsubRoom();
      unsubParticipants();
      clearInterval(interval);
    };
  }, [roomCode, participantId]);

  // Host Election on Host Disconnect (> 15s grace period)
  useEffect(() => {
    if (!room || !participants.length || !participantId) return;

    const now = getSynchronizedNow();
    if (now - lastHostElectionCheck.current < 4000) return;
    lastHostElectionCheck.current = now;

    const currentHostUid = room.hostUid || room.hostId;
    const currentHost = participants.find(p => p.uid === currentHostUid || p.id === currentHostUid);

    // Host is considered disconnected if not in list, presence === 'left', or updatedAt > 15s ago
    const isHostDisconnected = !currentHost || 
      currentHost.presence === 'left' || 
      (now - (currentHost.updatedAt || 0) > 15000);

    if (isHostDisconnected && currentHostUid !== participantId) {
      // Find eligible active participants
      const activeParticipants = participants.filter(p => 
        p.presence !== 'left' && (now - (p.updatedAt || 0) <= 15000)
      );

      activeParticipants.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

      // Earliest active participant claims host role atomically
      if (activeParticipants.length > 0 && (activeParticipants[0].uid === participantId || activeParticipants[0].id === participantId)) {
        electNewHost(roomCode, participantId, currentHostUid).catch(err => {
          console.warn('Host election attempt failed:', err);
        });
      }
    }
  }, [room, participants, participantId, roomCode]);

  const isHost = Boolean(room && participantId && (room.hostUid === participantId || room.hostId === participantId));
  const me = participants.find(p => p.uid === participantId || p.id === participantId);

  // Check if participant is ready for current room.configVersion
  const isMeReady = Boolean(
    me?.isReady && 
    (me.readyConfigVersion === (room?.configVersion || 1) || me.readyConfigVersion === undefined)
  );

  const setReady = useCallback(async (ready: boolean) => {
    if (!participantId || !room) return;
    await updateDoc(doc(db, 'rooms', roomCode, 'participants', participantId), {
      isReady: ready,
      readyConfigVersion: room.configVersion || 1,
      updatedAt: getSynchronizedNow()
    });
  }, [participantId, room, roomCode]);

  const changeFrame = useCallback(async (frameId: string) => {
    if (!room || !isHost) return;
    const newVersion = (room.configVersion || 1) + 1;

    await updateDoc(doc(db, 'rooms', roomCode), {
      frameId,
      configVersion: newVersion,
      updatedAt: getSynchronizedNow()
    });
  }, [room, isHost, roomCode]);

  const saveCustomFrame = useCallback(async (config: FrameConfig, blob: Blob) => {
    if (!room || !isHost) return;

    const uploadRes = await mediaStorage.uploadCustomFrame(roomCode, blob);
    const newVersion = (room.configVersion || 1) + 1;

    const batch = writeBatch(db);
    batch.update(doc(db, 'rooms', roomCode), {
      frameId: 'custom',
      customFrame: config,
      configVersion: newVersion,
      updatedAt: getSynchronizedNow()
    });

    batch.set(doc(db, 'rooms', roomCode, 'assets', 'customFrame'), {
      assetPath: uploadRes.path,
      assetUrl: uploadRes.url,
      width: config.canvasWidth,
      height: config.canvasHeight,
      createdAt: getSynchronizedNow()
    });

    await batch.commit();
    return uploadRes.url;
  }, [room, isHost, roomCode]);

  const leaveRoom = useCallback(async () => {
    if (participantId) {
      try {
        await runTransaction(db, async (tx) => {
          const roomRef = doc(db, 'rooms', roomCode);
          const rSnap = await tx.get(roomRef);
          if (rSnap.exists()) {
            const rData = rSnap.data();
            if (Array.isArray(rData.slots)) {
              const updatedSlots = rData.slots.map((uid: string | null) => uid === participantId ? null : uid);
              tx.update(roomRef, {
                slots: updatedSlots,
                updatedAt: Date.now()
              });
            }
          }
          const partRef = doc(db, 'rooms', roomCode, 'participants', participantId);
          tx.delete(partRef);
        });
      } catch (err) {
        console.warn('Leave room error:', err);
      }
      localStorage.removeItem(`participant_${roomCode}`);
    }
  }, [participantId, roomCode]);

  return {
    room,
    participants,
    me,
    isHost,
    isMeReady,
    roomError,
    isOffline,
    setReady,
    changeFrame,
    saveCustomFrame,
    leaveRoom,
  };
}
