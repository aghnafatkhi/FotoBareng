import { db } from './firebase';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  runTransaction,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { 
  PhotoboothSession, 
  SessionParticipantSnapshot, 
  CaptureRecord, 
  generateSessionId,
  Participant,
  SlotCrop
} from './store';
import { FrameConfig } from './frames';
import { getSynchronizedNow } from './timeSync';

export const COUNTDOWN_DURATION_MS = 4500;
export const NEXT_ROUND_DELAY_MS = 5500;
export const CAPTURE_TIMEOUT_GRACE_MS = 9000;

export async function createPhotoboothSession(
  roomId: string,
  hostUid: string,
  frame: FrameConfig,
  participants: Participant[]
): Promise<string> {
  const sessionId = generateSessionId();
  const now = getSynchronizedNow();

  // Snapshot only the required number of participants matching the frame slots
  const activeParticipants = [...participants]
    .sort((a, b) => (a.slotIndex ?? a.participantIndex) - (b.slotIndex ?? b.participantIndex))
    .slice(0, frame.participantCount);

  const participantSnapshot: SessionParticipantSnapshot[] = activeParticipants.map(p => ({
    uid: p.uid || p.id,
    name: p.name,
    slotIndex: p.slotIndex ?? p.participantIndex
  }));

  const sessionDoc: PhotoboothSession = {
    id: sessionId,
    roomId,
    status: 'scheduled',
    frameSnapshot: frame,
    participantSnapshot,
    roundCount: frame.roundCount,
    currentRound: 0,
    currentAttempt: 1,
    scheduledAt: now,
    captureAt: now + COUNTDOWN_DURATION_MS,
    captures: {},
    processingBy: null,
    resultStatus: 'pending',
    resultPath: null,
    resultImage: null,
    recoveryReason: null,
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const sessionRef = doc(db, 'rooms', roomId, 'sessions', sessionId);
  const roomRef = doc(db, 'rooms', roomId);

  await runTransaction(db, async (tx) => {
    const rSnap = await tx.get(roomRef);
    if (!rSnap.exists()) throw new Error('Room tidak ditemukan.');
    const rData = rSnap.data();

    // Verify caller is authoritative host
    if (rData.hostUid !== hostUid && rData.hostId !== hostUid) {
      throw new Error('Hanya host yang dapat memulai sesi.');
    }

    // Double start protection: If already in_session with activeSessionId, return existing
    if (rData.status === 'in_session' && rData.activeSessionId) {
      return rData.activeSessionId;
    }

    tx.set(sessionRef, sessionDoc);
    tx.update(roomRef, {
      status: 'in_session',
      activeSessionId: sessionId,
      latestSessionId: sessionId,
      currentRound: 0,
      updatedAt: Date.now()
    });
  });

  return sessionId;
}

export async function recordSessionCapture(
  roomId: string,
  sessionId: string,
  participantUid: string,
  roundIndex: number,
  attemptId: number,
  mediaUrl: string,
  mediaPath?: string
): Promise<void> {
  const sessionRef = doc(db, 'rooms', roomId, 'sessions', sessionId);
  const captureKey = `${participantUid}_r${roundIndex}_a${attemptId}`;

  const captureRecord: CaptureRecord = {
    participantUid,
    roundIndex,
    attemptId,
    mediaUrl,
    mediaPath,
    uploadedAt: getSynchronizedNow()
  };

  await updateDoc(sessionRef, {
    [`captures.${captureKey}`]: captureRecord,
    updatedAt: Date.now()
  });
}

export async function evaluateAndAdvanceRound(
  roomId: string,
  sessionId: string
): Promise<{ advanced: boolean; completed: boolean; currentRound: number }> {
  const sessionRef = doc(db, 'rooms', roomId, 'sessions', sessionId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists()) return { advanced: false, completed: false, currentRound: 0 };

    const session = snap.data() as PhotoboothSession;

    // Only advance if session is actively in scheduled/capturing/waiting_capture state
    if (session.status !== 'scheduled' && session.status !== 'capturing' && session.status !== 'waiting_capture') {
      return { advanced: false, completed: session.status === 'completed', currentRound: session.currentRound };
    }

    const round = session.currentRound;
    const attempt = session.currentAttempt;
    const requiredUids = session.participantSnapshot.map(p => p.uid);

    // Verify all snapshot participants have an accepted capture for this round & attempt
    const allCaptured = requiredUids.every(uid => {
      const key = `${uid}_r${round}_a${attempt}`;
      return Boolean(session.captures && session.captures[key]);
    });

    if (!allCaptured) {
      return { advanced: false, completed: false, currentRound: round };
    }

    const now = getSynchronizedNow();

    if (round + 1 < session.roundCount) {
      // Advance to next round
      tx.update(sessionRef, {
        currentRound: round + 1,
        currentAttempt: 1,
        status: 'scheduled',
        scheduledAt: now,
        captureAt: now + NEXT_ROUND_DELAY_MS,
        revision: (session.revision || 0) + 1,
        updatedAt: Date.now()
      });

      return { advanced: true, completed: false, currentRound: round + 1 };
    } else {
      // All rounds completed -> move to processing
      tx.update(sessionRef, {
        status: 'processing',
        resultStatus: 'pending',
        revision: (session.revision || 0) + 1,
        updatedAt: Date.now()
      });

      return { advanced: true, completed: true, currentRound: round };
    }
  });
}

export async function triggerSessionRecovery(
  roomId: string,
  sessionId: string,
  reason: string = 'Foto belum berhasil dikirim dari semua teman.'
): Promise<boolean> {
  const sessionRef = doc(db, 'rooms', roomId, 'sessions', sessionId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists()) return false;

    const session = snap.data() as PhotoboothSession;
    if (session.status === 'completed' || session.status === 'processing' || session.status === 'recovery') {
      return false;
    }

    tx.update(sessionRef, {
      status: 'recovery',
      recoveryReason: reason,
      revision: (session.revision || 0) + 1,
      updatedAt: Date.now()
    });

    return true;
  });
}

export async function retakeSessionRound(
  roomId: string,
  sessionId: string
): Promise<void> {
  const sessionRef = doc(db, 'rooms', roomId, 'sessions', sessionId);
  const now = getSynchronizedNow();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists()) throw new Error('Sesi tidak ditemukan.');

    const session = snap.data() as PhotoboothSession;
    if (session.status === 'completed') throw new Error('Sesi sudah selesai.');
    // Double retake protection: Only allow retake if session is currently in recovery
    if (session.status !== 'recovery') {
      return;
    }

    tx.update(sessionRef, {
      currentAttempt: (session.currentAttempt || 1) + 1,
      status: 'scheduled',
      scheduledAt: now,
      captureAt: now + COUNTDOWN_DURATION_MS,
      recoveryReason: null,
      revision: (session.revision || 0) + 1,
      updatedAt: Date.now()
    });
  });
}

export async function abandonSession(
  roomId: string,
  sessionId: string
): Promise<void> {
  const sessionRef = doc(db, 'rooms', roomId, 'sessions', sessionId);
  const roomRef = doc(db, 'rooms', roomId);

  const batch = writeBatch(db);
  batch.update(sessionRef, {
    status: 'abandoned',
    updatedAt: Date.now()
  });
  batch.update(roomRef, {
    status: 'waiting',
    activeSessionId: null,
    updatedAt: Date.now()
  });
  await batch.commit();
}

export async function acquireResultProcessingLock(
  roomId: string,
  sessionId: string,
  uid: string
): Promise<boolean> {
  const sessionRef = doc(db, 'rooms', roomId, 'sessions', sessionId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists()) return false;

    const session = snap.data() as PhotoboothSession;
    if (session.status !== 'processing' || (session.resultStatus === 'ready' && session.resultImage)) {
      return false;
    }

    if (session.processingBy && session.processingBy !== uid) {
      // Check if current lock is stale (> 15 seconds)
      const isLockStale = (Date.now() - (session.updatedAt || 0)) > 15000;
      if (!isLockStale) {
        return false;
      }
    }

    tx.update(sessionRef, {
      processingBy: uid,
      resultStatus: 'processing',
      updatedAt: Date.now()
    });

    return true;
  });
}

export async function finalizeSessionResult(
  roomId: string,
  sessionId: string,
  resultUrl: string,
  resultPath?: string
): Promise<void> {
  const sessionRef = doc(db, 'rooms', roomId, 'sessions', sessionId);
  const roomRef = doc(db, 'rooms', roomId);

  const batch = writeBatch(db);
  batch.update(sessionRef, {
    status: 'completed',
    resultStatus: 'ready',
    resultImage: resultUrl,
    resultPath: resultPath || null,
    updatedAt: Date.now()
  });

  batch.update(roomRef, {
    status: 'completed',
    resultImage: resultUrl,
    resultPath: resultPath || null,
    updatedAt: Date.now()
  });

  await batch.commit();
}

export async function resetRoomForNewSession(
  roomId: string,
  hostUid: string
): Promise<void> {
  const roomRef = doc(db, 'rooms', roomId);

  await runTransaction(db, async (tx) => {
    const rSnap = await tx.get(roomRef);
    if (!rSnap.exists()) return;
    const rData = rSnap.data();

    if (rData.hostUid !== hostUid && rData.hostId !== hostUid) {
      throw new Error('Hanya host yang dapat mereset sesi.');
    }

    tx.update(roomRef, {
      status: 'waiting',
      activeSessionId: null,
      resultImage: null,
      resultPath: null,
      configVersion: (rData.configVersion || 1) + 1, // Increment config version to invalidate old ready states
      updatedAt: Date.now()
    });
  });
}

export async function updateSessionCrops(
  roomId: string,
  sessionId: string,
  crops: Record<string, SlotCrop>
): Promise<void> {
  const sessionRef = doc(db, 'rooms', roomId, 'sessions', sessionId);
  await updateDoc(sessionRef, {
    crops,
    resultStatus: 'processing',
    processingBy: null, // Allow recomposing
    updatedAt: Date.now()
  });
}

export async function electNewHost(
  roomId: string,
  candidateUid: string,
  expectedOldHostUid?: string
): Promise<boolean> {
  const roomRef = doc(db, 'rooms', roomId);

  return runTransaction(db, async (tx) => {
    const rSnap = await tx.get(roomRef);
    if (!rSnap.exists()) return false;
    const rData = rSnap.data();

    // If host has already been updated to someone else, cancel
    if (expectedOldHostUid && rData.hostUid !== expectedOldHostUid && rData.hostId !== expectedOldHostUid) {
      return false;
    }

    // If already candidate, return true
    if (rData.hostUid === candidateUid) {
      return true;
    }

    tx.update(roomRef, {
      hostUid: candidateUid,
      hostId: candidateUid,
      updatedAt: Date.now()
    });

    return true;
  });
}
