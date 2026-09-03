'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { 
  PhotoboothSession, 
  Participant,
  Room
} from '@/lib/store';
import { FrameConfig, OFFICIAL_FRAMES } from '@/lib/frames';
import { mediaStorage } from '@/lib/mediaStorage';
import { getSynchronizedNow } from '@/lib/timeSync';
import { 
  createPhotoboothSession,
  recordSessionCapture,
  evaluateAndAdvanceRound,
  triggerSessionRecovery,
  retakeSessionRound,
  abandonSession,
  acquireResultProcessingLock,
  finalizeSessionResult,
  resetRoomForNewSession,
  updateSessionCrops,
  CAPTURE_TIMEOUT_GRACE_MS
} from '@/lib/sessionService';
import { CAPTURE_WIDTH, CAPTURE_HEIGHT, CAPTURE_QUALITY } from '@/lib/constants';
import { SlotCrop } from '@/lib/store';

export function useSession(
  roomCode: string,
  room: Room | null,
  participants: Participant[],
  participantId: string | null,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  isMirrored: boolean = true
) {
  const [session, setSession] = useState<PhotoboothSession | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [flash, setFlash] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [isProcessingResult, setIsProcessingResult] = useState<boolean>(false);
  const [justCaptured, setJustCaptured] = useState<boolean>(false);
  const [lastCapturePreview, setLastCapturePreview] = useState<string | null>(null);

  const capturedAttemptsRef = useRef<Set<string>>(new Set());
  const activeSessionId = room?.activeSessionId;

  // Active Session Subscription
  useEffect(() => {
    if (!roomCode || !activeSessionId) {
      setTimeout(() => setSession(null), 0);
      return;
    }

    const unsub = onSnapshot(
      doc(db, 'rooms', roomCode, 'sessions', activeSessionId),
      (snap) => {
        if (snap.exists()) {
          setSession(snap.data() as PhotoboothSession);
        } else {
          setSession(null);
        }
      },
      (err) => {
        console.warn('Session subscription error:', err);
      }
    );

    return () => unsub();
  }, [roomCode, activeSessionId]);

  // Selected frame config
  const selectedFrame = room?.frameId === 'custom' && room.customFrame
    ? room.customFrame
    : (room ? OFFICIAL_FRAMES.find(f => f.id === room.frameId) || OFFICIAL_FRAMES[0] : OFFICIAL_FRAMES[0]);

  // Capture Photo implementation
  const performCapture = useCallback(async (
    targetSessionId: string,
    roundIndex: number,
    attemptId: number
  ) => {
    const video = videoRef.current;
    if (!video || !participantId) return;

    const lockKey = `${targetSessionId}_r${roundIndex}_a${attemptId}`;
    if (capturedAttemptsRef.current.has(lockKey)) return;
    capturedAttemptsRef.current.add(lockKey);

    // Validate video readiness to prevent blank capture
    const stream = video.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()?.[0];
    if (
      video.videoWidth === 0 || 
      video.videoHeight === 0 || 
      video.readyState < 2 || 
      !track || 
      track.readyState !== 'live'
    ) {
      console.warn('Camera not ready for capture');
      triggerSessionRecovery(roomCode, targetSessionId, 'Kamera terputus. Menyiapkan lagi...');
      capturedAttemptsRef.current.delete(lockKey);
      return;
    }

    // Trigger visual flash (brief 120ms)
    setFlash(true);
    setTimeout(() => setFlash(false), 120);

    // Optional haptic vibration
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(60); } catch {}
    }

    setUploading(true);
    setUploadError(null);

    try {
      const canvas = document.createElement('canvas');
      const vRatio = video.videoWidth / (video.videoHeight || 1);
      const targetRatio = 3 / 4;

      let sWidth = video.videoWidth;
      let sHeight = video.videoHeight;
      let sx = 0;
      let sy = 0;

      if (vRatio > targetRatio) {
        sWidth = video.videoHeight * targetRatio;
        sx = (video.videoWidth - sWidth) / 2;
      } else {
        sHeight = video.videoWidth / targetRatio;
        sy = (video.videoHeight - sHeight) / 2;
      }

      canvas.width = CAPTURE_WIDTH;
      canvas.height = CAPTURE_HEIGHT;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');

      if (isMirrored) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);

      // Provide immediate capture preview feedback
      const previewDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setLastCapturePreview(previewDataUrl);
      setJustCaptured(true);
      setTimeout(() => setJustCaptured(false), 2000);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', CAPTURE_QUALITY);
      });

      if (!blob) throw new Error('Gagal mengompresi foto');

      // Upload capture to media storage
      const uploadRes = await mediaStorage.uploadCapture(
        roomCode,
        targetSessionId,
        participantId,
        roundIndex,
        blob,
        attemptId
      );

      // Record capture in Firestore session document
      await recordSessionCapture(
        roomCode,
        targetSessionId,
        participantId,
        roundIndex,
        attemptId,
        uploadRes.url,
        uploadRes.path
      );

      // Attempt collaborative round advancement
      await evaluateAndAdvanceRound(roomCode, targetSessionId);
    } catch (err: any) {
      console.error('Capture upload error:', err);
      setUploadError(err.message || 'Gagal mengirim foto.');
      // Remove lock on failure to allow retry
      capturedAttemptsRef.current.delete(lockKey);
    } finally {
      setUploading(false);
    }
  }, [participantId, roomCode, videoRef, isMirrored]);

  // Synchronized Countdown Engine
  useEffect(() => {
    if (!session || session.status !== 'scheduled' || !session.captureAt) {
      setTimeout(() => setTimeLeft(0), 0);
      return;
    }

    const interval = setInterval(() => {
      const now = getSynchronizedNow();
      const remaining = session.captureAt - now;

      setTimeLeft(Math.max(0, remaining));

      // Reached or passed capture target timestamp
      if (remaining <= 0) {
        const lockKey = `${session.id}_r${session.currentRound}_a${session.currentAttempt}`;
        
        // Check if client is too late (> 2500ms past capture timestamp)
        if (remaining < -2500) {
          if (!capturedAttemptsRef.current.has(lockKey)) {
            console.warn('Capture timestamp missed by >2.5s, requesting recovery instead of stale snap');
            triggerSessionRecovery(roomCode, session.id, 'Waktu foto terlewat.');
          }
        } else {
          // Normal synchronized capture trigger
          if (!capturedAttemptsRef.current.has(lockKey)) {
            performCapture(session.id, session.currentRound, session.currentAttempt);
          }
        }
      }
    }, 40);

    return () => clearInterval(interval);
  }, [session, performCapture, roomCode]);

  // Timeout Watchdog: If captures don't arrive within grace period, trigger recovery
  useEffect(() => {
    if (!session || (session.status !== 'scheduled' && session.status !== 'capturing' && session.status !== 'waiting_capture')) {
      return;
    }

    const interval = setInterval(() => {
      const now = getSynchronizedNow();
      if (session.captureAt && now > session.captureAt + CAPTURE_TIMEOUT_GRACE_MS) {
        triggerSessionRecovery(roomCode, session.id, 'Foto belum berhasil dikirim dari semua teman.');
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [session, roomCode]);

  // Automatic Round Progression Check
  useEffect(() => {
    if (!session || (session.status !== 'scheduled' && session.status !== 'capturing' && session.status !== 'waiting_capture')) {
      return;
    }

    // If all participant captures exist, evaluate progression
    const round = session.currentRound;
    const attempt = session.currentAttempt;
    const allCaptured = session.participantSnapshot.every(p => {
      const key = `${p.uid}_r${round}_a${attempt}`;
      return Boolean(session.captures && session.captures[key]);
    });

    if (allCaptured) {
      evaluateAndAdvanceRound(roomCode, session.id);
    }
  }, [session, roomCode]);

  // Result Generator with Deterministic Slot Validation & Processing Lock
  const generateFinalResult = useCallback(async () => {
    if (!session || session.status !== 'processing' || !participantId) return;
    if (isProcessingResult) return;

    setIsProcessingResult(true);
    setResultError(null);

    try {
      // Try to acquire processing lock
      const acquired = await acquireResultProcessingLock(roomCode, session.id, participantId);
      if (!acquired) {
        setIsProcessingResult(false);
        return;
      }

      const frame = session.frameSnapshot;
      const canvas = document.createElement('canvas');
      canvas.width = frame.canvasWidth;
      canvas.height = frame.canvasHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');

      ctx.fillStyle = frame.backgroundColor || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Validate that every single slot has a verified capture from the assigned participant
      for (const slot of frame.slots) {
        const participant = session.participantSnapshot.find(
          p => p.slotIndex === slot.participantIndex
        );

        if (!participant) {
          throw new Error(`Data partisipan untuk posisi ${slot.participantIndex + 1} tidak ditemukan.`);
        }

        // Find capture matching slot.roundIndex
        let captureRecord = session.captures[`${participant.uid}_r${slot.roundIndex}_a${session.currentAttempt}`];
        if (!captureRecord) {
          // Fallback to highest attempt for that round of that participant
          const matchingKeys = Object.keys(session.captures).filter(k => k.startsWith(`${participant.uid}_r${slot.roundIndex}_a`));
          if (matchingKeys.length > 0) {
            matchingKeys.sort();
            captureRecord = session.captures[matchingKeys[matchingKeys.length - 1]];
          }
        }

        if (!captureRecord || !captureRecord.mediaUrl) {
          throw new Error(`Foto partisipan ${participant.name} foto ke-${slot.roundIndex + 1} belum tersedia.`);
        }

        const photoSrc = mediaStorage.resolveMediaUrl(captureRecord.mediaUrl);
        const img = new Image();
        img.crossOrigin = 'anonymous';

        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`Gagal memuat foto ${participant.name}`));
          img.src = photoSrc;
        });

        const sx = slot.x * canvas.width;
        const sy = slot.y * canvas.height;
        const sw = slot.width * canvas.width;
        const sh = slot.height * canvas.height;

        ctx.save();
        if (slot.borderRadius) {
          const radius = slot.borderRadius * canvas.width;
          ctx.beginPath();
          ctx.moveTo(sx + radius, sy);
          ctx.lineTo(sx + sw - radius, sy);
          ctx.quadraticCurveTo(sx + sw, sy, sx + sw, sy + radius);
          ctx.lineTo(sx + sw, sy + sh - radius);
          ctx.quadraticCurveTo(sx + sw, sy + sh, sx + sw - radius, sy + sh);
          ctx.lineTo(sx + radius, sy + sh);
          ctx.quadraticCurveTo(sx, sy + sh, sx, sy + sh - radius);
          ctx.lineTo(sx, sy + radius);
          ctx.quadraticCurveTo(sx, sy, sx + radius, sy);
          ctx.closePath();
          ctx.clip();
        }

        const targetRatio = sw / sh;
        const imgRatio = img.width / img.height;
        let baseW = img.width;
        let baseH = img.height;
        let baseCX = 0;
        let baseCY = 0;

        if (imgRatio > targetRatio) {
          baseW = img.height * targetRatio;
          baseCX = (img.width - baseW) / 2;
        } else {
          baseH = img.width / targetRatio;
          baseCY = (img.height - baseH) / 2;
        }

        // Apply crop adjustments if present
        const slotCrop = session.crops?.[slot.id] || { panX: 0, panY: 0, zoom: 1 };
        const zoom = Math.max(1, Math.min(2.5, slotCrop.zoom || 1));
        const cropW = baseW / zoom;
        const cropH = baseH / zoom;

        const maxPanX = img.width - cropW;
        const maxPanY = img.height - cropH;
        const centerX = baseCX + baseW / 2 + (slotCrop.panX || 0) * baseW;
        const centerY = baseCY + baseH / 2 + (slotCrop.panY || 0) * baseH;

        const finalCX = Math.max(0, Math.min(maxPanX, centerX - cropW / 2));
        const finalCY = Math.max(0, Math.min(maxPanY, centerY - cropH / 2));

        ctx.drawImage(img, finalCX, finalCY, cropW, cropH, sx, sy, sw, sh);
        ctx.restore();
      }

      // If custom frame overlay exists
      if (frame.id === 'custom') {
        const customDoc = await fetch(`/api/media/rooms/${encodeURIComponent(roomCode)}/frames/customFrame.png`).catch(() => null);
        if (customDoc && customDoc.ok) {
          const frameImg = new Image();
          frameImg.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            frameImg.onload = () => resolve();
            frameImg.onerror = reject;
            frameImg.src = customDoc.url;
          }).catch(() => {});
          ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
        }
      }

      // Watermark
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FotoBareng', canvas.width / 2, canvas.height - 40);

      // Compress and upload result
      const resultBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
      });

      if (!resultBlob) throw new Error('Gagal membuat gambar hasil.');

      const uploadRes = await mediaStorage.uploadResult(roomCode, session.id, resultBlob);
      await finalizeSessionResult(roomCode, session.id, uploadRes.url, uploadRes.path);
    } catch (err: any) {
      console.error('Final result generation error:', err);
      setResultError(err.message || 'Foto belum berhasil dibuat.');
    } finally {
      setIsProcessingResult(false);
    }
  }, [session, participantId, isProcessingResult, roomCode]);

  // Trigger result generation when status === 'processing'
  useEffect(() => {
    if (session?.status === 'processing' && session.resultStatus !== 'ready' && !isProcessingResult) {
      setTimeout(() => {
        generateFinalResult();
      }, 0);
    }
  }, [session?.status, session?.resultStatus, generateFinalResult, isProcessingResult]);

  const [isStarting, setIsStarting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const sessionId = session?.id;
  const sessionStatus = session?.status;
  const sessionRound = session?.currentRound;
  const sessionAttempt = session?.currentAttempt;
  const sessionRev = session?.revision;

  // Development State Change Logging (Item 77: roomId, sessionId, uid, round, attempt, state change, NO photos)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && sessionId) {
      console.log('[Dev Session State]', {
        roomId: roomCode,
        sessionId,
        uid: participantId,
        status: sessionStatus,
        round: sessionRound,
        attempt: sessionAttempt,
        revision: sessionRev
      });
    }
  }, [sessionId, sessionStatus, sessionRound, sessionAttempt, sessionRev, roomCode, participantId]);

  // Actions
  const startSession = useCallback(async () => {
    if (!room || !participantId || isStarting) return;
    setIsStarting(true);
    try {
      await createPhotoboothSession(roomCode, participantId, selectedFrame, participants);
    } catch (err: any) {
      console.error('Failed to start session:', err);
      setResultError(err.message || 'Gagal memulai sesi.');
    } finally {
      setIsStarting(false);
    }
  }, [room, participantId, selectedFrame, participants, roomCode, isStarting]);

  const retryRound = useCallback(async () => {
    if (!session || isRetrying) return;
    setIsRetrying(true);
    try {
      await retakeSessionRound(roomCode, session.id);
    } catch (err: any) {
      console.error('Failed to retake round:', err);
    } finally {
      setIsRetrying(false);
    }
  }, [session, roomCode, isRetrying]);

  const cancelSession = useCallback(async () => {
    if (!session) return;
    try {
      await abandonSession(roomCode, session.id);
    } catch (err: any) {
      console.error('Failed to cancel session:', err);
    }
  }, [session, roomCode]);

  const startNewSession = useCallback(async () => {
    if (!participantId) return;
    try {
      await resetRoomForNewSession(roomCode, participantId);
    } catch (err: any) {
      console.error('Failed to reset for new session:', err);
    }
  }, [participantId, roomCode]);

  const saveCrops = useCallback(async (newCrops: Record<string, SlotCrop>) => {
    if (!session) return;
    try {
      await updateSessionCrops(roomCode, session.id, newCrops);
    } catch (err: any) {
      console.error('Failed to save crops:', err);
    }
  }, [session, roomCode]);

  // Helper: check if my capture for current round & attempt is done
  const isMyCaptureDone = Boolean(
    session &&
    participantId &&
    session.captures &&
    session.captures[`${participantId}_r${session.currentRound}_a${session.currentAttempt}`]
  );

  return {
    session,
    selectedFrame,
    timeLeft,
    flash,
    uploading,
    uploadError,
    resultError,
    isMyCaptureDone,
    isStarting,
    isRetrying,
    justCaptured,
    lastCapturePreview,
    startSession,
    retryRound,
    cancelSession,
    startNewSession,
    generateFinalResult,
    saveCrops,
  };
}
