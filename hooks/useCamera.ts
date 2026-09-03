'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export type CameraStatus = 'loading' | 'active' | 'denied' | 'not_found' | 'busy' | 'error';

export function useCamera(enabled: boolean = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('loading');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [hasMultipleCameras, setHasMultipleCameras] = useState<boolean>(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isMirrored = facingMode === 'user';

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Check available cameras
  const checkMultipleCameras = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setHasMultipleCameras(videoDevices.length > 1);
    } catch {
      // Ignore enumeration errors
    }
  }, []);

  const initCamera = useCallback(async (targetFacingMode?: 'user' | 'environment') => {
    if (!enabled) return;
    const mode = targetFacingMode || facingMode;

    try {
      setCameraStatus('loading');
      stopStream();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          aspectRatio: 3 / 4,
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      setCameraStatus('active');
      setFacingMode(mode);
      checkMultipleCameras();

      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          setCameraStatus('error');
        };
      }
    } catch (err: any) {
      console.warn('Camera initialization error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraStatus('denied');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraStatus('not_found');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraStatus('busy');
      } else {
        setCameraStatus('error');
      }
    }
  }, [enabled, facingMode, stopStream, checkMultipleCameras]);

  const switchCamera = useCallback(async () => {
    if (!hasMultipleCameras && typeof navigator !== 'undefined' && !('mediaDevices' in navigator)) {
      return;
    }

    const nextMode: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user';
    setSwitchError(null);

    try {
      await initCamera(nextMode);
    } catch (err) {
      console.warn('Switch camera error:', err);
      setSwitchError('Kamera belum bisa diganti.');
      // Attempt fallback to previous mode
      try {
        await initCamera(facingMode);
      } catch {
        // Fallback also failed
      }
      setTimeout(() => setSwitchError(null), 3000);
    }
  }, [facingMode, hasMultipleCameras, initCamera]);

  useEffect(() => {
    if (enabled) {
      setTimeout(() => {
        initCamera('user');
      }, 0);
    } else {
      stopStream();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabled) {
        const stream = streamRef.current;
        const track = stream?.getVideoTracks()[0];
        if (!stream || !track || track.readyState === 'ended' || !track.enabled) {
          initCamera();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopStream();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, initCamera, stopStream]);

  return {
    videoRef,
    cameraStatus,
    facingMode,
    isMirrored,
    hasMultipleCameras,
    switchCamera,
    switchError,
    initCamera,
    stopStream,
  };
}
