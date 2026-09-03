'use client';

import { useState, use, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, Download, Share2, LayoutTemplate, PenTool, AlertCircle, RefreshCw, Copy, LogOut, Move, RotateCcw } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { OFFICIAL_FRAMES, FrameConfig } from '@/lib/frames';
import { ensureAuthUser } from '@/lib/auth';
import { mediaStorage } from '@/lib/mediaStorage';
import { 
  DEFAULT_MAX_PARTICIPANTS, 
  MIN_NAME_LENGTH, 
  MAX_NAME_LENGTH, 
  sanitizeDisplayName 
} from '@/lib/constants';
import { useTimeSync } from '@/hooks/useTimeSync';
import { useCamera } from '@/hooks/useCamera';
import { useRoom } from '@/hooks/useRoom';
import { useSession } from '@/hooks/useSession';
import CustomFrameEditor from './CustomFrameEditor';
import { CropRepositionModal } from '@/components/CropRepositionModal';
import { DevDebugPanel } from '@/components/DevDebugPanel';

export default function RoomPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const router = useRouter();
  const { roomCode } = use(params);
  
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needJoin, setNeedJoin] = useState(false);
  const [showFrameSelector, setShowFrameSelector] = useState(false);
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showCancelSessionModal, setShowCancelSessionModal] = useState(false);
  const [showCropModal, setShowCropModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Time Synchronization
  const { getNow } = useTimeSync();

  // Camera Management
  const isCameraEnabled = !needJoin;
  const { 
    videoRef, 
    cameraStatus, 
    facingMode,
    isMirrored,
    hasMultipleCameras,
    switchCamera,
    switchError,
    initCamera 
  } = useCamera(isCameraEnabled);

  // Room & Presence Management
  const { 
    room, 
    participants, 
    isHost, 
    isMeReady, 
    roomError, 
    isOffline, 
    setReady, 
    changeFrame, 
    saveCustomFrame, 
    leaveRoom 
  } = useRoom(roomCode, participantId);

  // Session & Synchronization Management
  const {
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
    saveCrops
  } = useSession(roomCode, room, participants, participantId, videoRef, isMirrored);

  // Toast Helper
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 2000);
  }, []);

  // Initialize Auth & Check Membership
  useEffect(() => {
    let isMounted = true;
    async function initAuth() {
      try {
        const authUid = await ensureAuthUser();
        if (!isMounted) return;

        const storedId = localStorage.getItem(`participant_${roomCode}`);
        const effectiveId = storedId || authUid;

        const partDoc = await getDoc(doc(db, 'rooms', roomCode, 'participants', effectiveId));
        if (partDoc.exists()) {
          localStorage.setItem(`participant_${roomCode}`, effectiveId);
          setParticipantId(effectiveId);
          setNeedJoin(false);
        } else {
          setNeedJoin(true);
        }
      } catch (err) {
        console.warn('Auth init failed:', err);
        setNeedJoin(true);
      } finally {
        if (isMounted) setAuthChecked(true);
      }
    }
    initAuth();
    return () => { isMounted = false; };
  }, [roomCode]);

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'FotoBareng',
          text: 'Masuk room ini buat foto bareng!',
          url,
        });
      } catch {
        // User dismissed share dialog
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link disalin.');
      } catch {
        showToast('Gagal menyalin link.');
      }
    }
  }, [showToast]);

  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomCode.toUpperCase());
      showToast('Kode room disalin.');
    } catch {
      showToast('Gagal menyalin kode.');
    }
  }, [roomCode, showToast]);

  const downloadResult = useCallback(async () => {
    const targetUrl = session?.resultImage || room?.resultImage;
    if (targetUrl) {
      try {
        const resolvedUrl = mediaStorage.resolveMediaUrl(targetUrl);
        const res = await fetch(resolvedUrl);
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = `fotobareng-${roomCode.toLowerCase()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
      } catch {
        const a = document.createElement('a');
        a.href = mediaStorage.resolveMediaUrl(targetUrl);
        a.download = `fotobareng-${roomCode.toLowerCase()}.jpg`;
        a.click();
      }
    }
  }, [session?.resultImage, room?.resultImage, roomCode]);

  const handleConfirmLeave = useCallback(async () => {
    setShowLeaveModal(false);
    await leaveRoom();
    router.push('/');
  }, [leaveRoom, router]);

  const onCustomFrameSave = async (config: FrameConfig, blob: Blob) => {
    await saveCustomFrame(config, blob);
    setShowCustomEditor(false);
    setShowFrameSelector(false);
  };

  // Render Join Form if not yet a participant
  if (needJoin && authChecked) {
    return (
      <JoinForm 
        roomCode={roomCode} 
        onSuccess={(id) => {
          setParticipantId(id);
          setNeedJoin(false);
        }} 
      />
    );
  }

  // Not Found State
  if (roomError === 'not_found') {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-white">
        <div className="text-center max-w-sm w-full">
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">Room tidak ditemukan</h2>
          <p className="text-sm text-neutral-600 mb-6">Cek kodenya lalu coba lagi.</p>
          <button 
            onClick={() => router.push('/')} 
            className="w-full h-12 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center"
          >
            Kembali ke Home
          </button>
        </div>
      </div>
    );
  }

  // Expired State
  if (roomError === 'expired') {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-white">
        <div className="text-center max-w-sm w-full">
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">Room sudah berakhir</h2>
          <p className="text-sm text-neutral-600 mb-6">Room ini sudah tidak aktif karena lewat dari 24 jam.</p>
          <button 
            onClick={() => router.push('/')} 
            className="w-full h-12 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center"
          >
            Buat Room Baru
          </button>
        </div>
      </div>
    );
  }

  // Loading Room State
  if (!room || !participants.length || !authChecked) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center text-sm font-medium text-neutral-500 bg-white">
        Masuk ke room...
      </div>
    );
  }

  // Determine Active High-Level View
  const isLobby = room.status === 'waiting' && !session;
  const isInSession = room.status === 'in_session' || (session && session.status !== 'completed' && session.status !== 'abandoned');
  const isResult = (room.status === 'completed' || session?.status === 'completed') && !isLobby;

  const allReady = participants.length >= selectedFrame.participantCount && participants.every(p => {
    return p.isReady && (p.readyConfigVersion === (room.configVersion || 1) || p.readyConfigVersion === undefined);
  });

  const now = getNow();

  // Find other participant names for waiting state
  const otherParticipants = participants.filter(p => (p.uid || p.id) !== participantId);
  const otherNames = otherParticipants.map(p => p.name).join(', ') || 'teman';

  // Compute active slot and framing aspect ratio
  const myParticipant = participants.find(p => (p.uid || p.id) === participantId);
  const mySlotIndex = myParticipant?.slotIndex ?? 0;
  const currentRound = session?.currentRound ?? 0;
  const activeSlot = selectedFrame.slots.find(
    s => s.participantIndex === mySlotIndex && s.roundIndex === currentRound
  ) || selectedFrame.slots[0];
  const slotAspect = activeSlot 
    ? (activeSlot.width * selectedFrame.canvasWidth) / (activeSlot.height * selectedFrame.canvasHeight)
    : 3 / 4;

  return (
    <div className="flex flex-col min-h-[100dvh] w-full bg-white text-neutral-900 selection:bg-blue-100">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div 
          role="status"
          aria-live="polite"
          className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-neutral-900 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-md transition-all"
        >
          {toastMessage}
        </div>
      )}

      {/* Connection & Upload Status Banners */}
      {isOffline && (
        <div className="bg-red-600 text-white text-xs font-medium text-center py-2 px-4 z-40">
          Koneksi terputus. Menunggu tersambung kembali...
        </div>
      )}
      {uploading && (
        <div className="bg-blue-600 text-white text-xs font-medium text-center py-2 px-4 z-40">
          Menyimpan foto...
        </div>
      )}
      {uploadError && (
        <div className="bg-amber-600 text-white text-xs font-medium text-center py-2 px-4 z-40">
          {uploadError}
        </div>
      )}

      {/* Navbar (Visible in Lobby & Result) */}
      {!isInSession && (
        <header className="flex justify-between items-center px-5 sm:px-8 py-4 border-b border-neutral-100 shrink-0">
          <button 
            onClick={() => setShowLeaveModal(true)} 
            className="text-lg font-bold tracking-tight text-neutral-900 hover:text-neutral-700 transition-colors"
          >
            FotoBareng
          </button>

          {isLobby && (
            <div className="flex items-center gap-2 sm:gap-3">
              <button 
                onClick={handleShare} 
                className="h-9 px-3 border border-neutral-200 text-neutral-700 hover:bg-neutral-50 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                aria-label="Bagikan link room"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Bagikan</span>
              </button>
              <button 
                onClick={() => setShowLeaveModal(true)} 
                className="h-9 px-3 text-neutral-500 hover:text-red-600 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                aria-label="Keluar room"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Keluar</span>
              </button>
            </div>
          )}
        </header>
      )}

      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 w-full max-w-lg mx-auto">
        
        {/* ========================================================= */}
        {/* 1. LOBBY VIEW */}
        {/* ========================================================= */}
        {isLobby && !showFrameSelector && !showCustomEditor && (
          <div className="w-full space-y-4">
            
            {/* Room Code & Frame Bar */}
            <div className="flex items-center justify-between bg-neutral-50 p-3 rounded-xl border border-neutral-200">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">Room</span>
                <span className="font-bold text-sm tracking-wider text-neutral-900">{roomCode.toUpperCase()}</span>
                <button 
                  onClick={handleCopyCode} 
                  className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
                  title="Salin kode room"
                  aria-label="Salin kode room"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-600 hidden sm:inline">{selectedFrame.name}</span>
                {isHost ? (
                  <button 
                    onClick={() => setShowFrameSelector(true)} 
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 p-1"
                  >
                    <LayoutTemplate className="w-3.5 h-3.5" />
                    <span>Ganti Frame</span>
                  </button>
                ) : (
                  <span className="text-xs text-neutral-500">{selectedFrame.participantCount} Orang</span>
                )}
              </div>
            </div>

            {/* Camera Preview (Central & Largest Element) */}
            <div 
              className="relative w-full rounded-xl overflow-hidden bg-neutral-900 border border-neutral-200 flex items-center justify-center" 
              style={{ aspectRatio: '3/4', maxHeight: '400px' }}
            >
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className={`absolute inset-0 w-full h-full object-cover ${isMirrored ? 'scale-x-[-1]' : ''}`} 
              />
              
              {/* Subtle Framing Guide */}
              {cameraStatus === 'active' && (
                <div 
                  className="absolute pointer-events-none border border-white/40 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.25)] z-10 transition-all duration-300"
                  style={{
                    aspectRatio: `${slotAspect}`,
                    width: slotAspect < 1 ? `${Math.min(85, 85 * slotAspect)}%` : '85%',
                    maxHeight: '85%',
                  }}
                />
              )}

              {/* Switch Camera Button */}
              {hasMultipleCameras && cameraStatus === 'active' && (
                <button
                  type="button"
                  onClick={switchCamera}
                  className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-xs transition-transform active:scale-95"
                  aria-label="Ganti kamera"
                  title="Ganti kamera (depan/belakang)"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}

              {switchError && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 bg-black/70 text-white text-[11px] px-2.5 py-1 rounded-md backdrop-blur-xs">
                  {switchError}
                </div>
              )}

              {cameraStatus !== 'active' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-50 p-6 text-center space-y-3 z-10">
                  <Camera className="w-8 h-8 text-neutral-400" />
                  <p className="text-sm font-medium text-neutral-700">
                    {
                      cameraStatus === 'denied' ? 'Kamera belum diizinkan.' : 
                      cameraStatus === 'not_found' ? 'Kamera tidak ditemukan.' :
                      cameraStatus === 'busy' ? 'Kamera sedang dipakai aplikasi lain.' :
                      'Menyiapkan kamera...'
                    }
                  </p>
                  <p className="text-xs text-neutral-500">
                    {cameraStatus === 'denied' ? 'Coba aktifkan izin kamera di pengaturan browser.' : ''}
                  </p>
                  <button 
                    onClick={() => initCamera()} 
                    className="h-9 px-4 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                  >
                    Coba Lagi
                  </button>
                </div>
              )}
            </div>

            {/* Participant Requirement Warning */}
            {participants.length < selectedFrame.participantCount && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl text-center">
                Frame ini butuh {selectedFrame.participantCount} orang. Ajak teman bergabung dengan link.
              </div>
            )}

            {/* People in Room */}
            <div className="bg-neutral-50 p-3.5 rounded-xl border border-neutral-200 space-y-2.5">
              <div className="text-xs font-medium text-neutral-500">Orang di room</div>
              <div className="space-y-2">
                {participants.map(p => {
                  const isPartHost = (room.hostUid || room.hostId) === (p.uid || p.id);
                  const isSelf = (p.uid || p.id) === participantId;
                  const isDisconnected = (now - (p.updatedAt || 0) > 15000) || p.presence === 'left';
                  const isPartReady = p.isReady && (p.readyConfigVersion === (room.configVersion || 1) || p.readyConfigVersion === undefined);

                  return (
                    <div key={p.id || p.uid} className="flex justify-between items-center text-sm py-0.5">
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-medium text-neutral-900 truncate">
                          {p.name}
                        </span>
                        {isSelf && <span className="text-neutral-500 text-xs">(Kamu)</span>}
                        {isPartHost && (
                          <span className="text-[11px] font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                            Host
                          </span>
                        )}
                        {isDisconnected && !isSelf && (
                          <span className="text-xs text-red-600">Terputus</span>
                        )}
                      </div>

                      <div>
                        {isPartReady ? (
                          <span className="text-xs font-medium text-blue-600 flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> Siap
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">Belum siap</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              {!isMeReady ? (
                <button 
                  id="btn-ready"
                  onClick={() => setReady(true)}
                  disabled={cameraStatus !== 'active' || participants.length < selectedFrame.participantCount}
                  className="w-full h-12 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center"
                >
                  Siap
                </button>
              ) : (
                <button 
                  id="btn-unready"
                  onClick={() => setReady(false)}
                  className="w-full h-12 border border-neutral-300 text-neutral-700 bg-white rounded-xl font-medium text-sm hover:bg-neutral-50 active:scale-[0.98] transition-all flex items-center justify-center"
                >
                  Batal Siap
                </button>
              )}

              {isHost && (
                <div>
                  <button 
                    id="btn-start-session"
                    onClick={startSession}
                    disabled={!allReady || participants.length < selectedFrame.participantCount || isStarting}
                    className="w-full h-12 bg-neutral-900 text-white rounded-xl font-medium text-sm hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center"
                  >
                    {isStarting ? 'Memulai...' : 'Mulai'}
                  </button>
                  {!allReady && (
                    <p className="text-center text-xs text-neutral-500 mt-2">
                      {participants.length < selectedFrame.participantCount 
                        ? `Menunggu ${selectedFrame.participantCount - participants.length} orang lagi bergabung.` 
                        : 'Menunggu semua orang siap.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 2. FRAME SELECTION (HOST ONLY) */}
        {/* ========================================================= */}
        {isLobby && showFrameSelector && isHost && !showCustomEditor && (
          <div className="w-full space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <h2 className="text-lg font-bold text-neutral-900">Pilih Frame</h2>
              <button 
                onClick={() => setShowFrameSelector(false)} 
                className="text-xs font-medium text-neutral-600 hover:text-neutral-900"
              >
                Batal
              </button>
            </div>
            
            <button 
              onClick={() => setShowCustomEditor(true)}
              className="w-full h-11 border border-dashed border-blue-300 text-blue-600 bg-blue-50/40 rounded-xl font-medium text-xs hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
            >
              <PenTool className="w-3.5 h-3.5" /> Pakai Frame Sendiri
            </button>
            
            <div className="grid grid-cols-1 gap-3">
              {OFFICIAL_FRAMES.map(f => {
                const isSelected = room.frameId === f.id;
                return (
                  <div 
                    key={f.id} 
                    onClick={() => {
                      changeFrame(f.id);
                      setShowFrameSelector(false);
                    }} 
                    className={`p-3.5 rounded-xl cursor-pointer border transition-all ${
                      isSelected 
                        ? 'border-blue-600 bg-blue-50/20' 
                        : 'border-neutral-200 hover:border-neutral-300 bg-white'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <p className="font-semibold text-sm text-neutral-900">{f.name}</p>
                        <p className="text-xs text-neutral-500">{f.participantCount} Orang — {f.roundCount} Foto</p>
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                          <Check className="w-3 h-3" />
                        </div>
                      )}
                    </div>

                    {/* Frame Preview Blueprint */}
                    <div className="w-full bg-neutral-100 rounded-lg p-2 flex items-center justify-center border border-neutral-200">
                      <div 
                        className="relative bg-white shadow-xs rounded" 
                        style={{
                          width: '120px', 
                          aspectRatio: `${f.canvasWidth}/${f.canvasHeight}`,
                        }}
                      >
                        {f.slots.map(s => (
                          <div 
                            key={s.id} 
                            className="absolute bg-neutral-300 border border-white" 
                            style={{
                              left: `${s.x * 100}%`,
                              top: `${s.y * 100}%`,
                              width: `${s.width * 100}%`,
                              height: `${s.height * 100}%`,
                              borderRadius: s.borderRadius ? `${s.borderRadius * 100}%` : '2px'
                            }} 
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 3. CUSTOM FRAME EDITOR */}
        {/* ========================================================= */}
        {showCustomEditor && (
          <CustomFrameEditor 
            onSave={onCustomFrameSave}
            onCancel={() => setShowCustomEditor(false)}
            availableParticipants={participants.map(p => ({ name: p.name, index: p.slotIndex ?? p.participantIndex }))}
          />
        )}

        {/* ========================================================= */}
        {/* 4. ACTIVE PHOTOBOOTH SESSION (FULL-SCREEN MINIMALIST) */}
        {/* ========================================================= */}
        {isInSession && session && (
          <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center h-[100dvh] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            
            {/* RECOVERY VIEW */}
            {session.status === 'recovery' ? (
              <div className="text-center max-w-xs w-full p-6 space-y-4 z-20 bg-neutral-900 border border-neutral-800 rounded-2xl">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-500/20 text-amber-400 rounded-full">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-white">Foto belum berhasil</h2>
                <p className="text-xs text-neutral-400">
                  {session.recoveryReason || 'Foto teman belum terkirim.'}
                </p>

                {isHost ? (
                  <div className="space-y-2 pt-2">
                    <button 
                      onClick={retryRound}
                      disabled={isRetrying}
                      className="w-full h-11 bg-blue-600 text-white rounded-xl font-medium text-xs hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} /> 
                      <span>{isRetrying ? 'Mengulang...' : 'Ulang Foto'}</span>
                    </button>
                    <button 
                      onClick={() => setShowCancelSessionModal(true)}
                      className="w-full h-11 border border-neutral-700 text-neutral-300 rounded-xl font-medium text-xs hover:bg-neutral-800 transition-all"
                    >
                      Batalkan Sesi
                    </button>
                  </div>
                ) : (
                  <div className="p-3 text-neutral-400 text-xs">
                    Menunggu host...
                  </div>
                )}
              </div>
            ) : session.status === 'processing' ? (
              /* PROCESSING COMPOSITE VIEW */
              <div className="text-center space-y-3 z-20 p-6">
                <div className="animate-spin inline-block w-8 h-8 border-3 border-white/20 border-t-white rounded-full" />
                <h2 className="text-xl font-bold text-white">Menyusun foto...</h2>
                <p className="text-xs text-neutral-400">Tunggu sebentar</p>
                {resultError && (
                  <div className="pt-2 space-y-2">
                    <p className="text-xs text-red-400">{resultError}</p>
                    <button 
                      onClick={generateFinalResult} 
                      className="h-9 px-4 bg-blue-600 text-white rounded-lg text-xs font-medium"
                    >
                      Coba Lagi
                    </button>
                  </div>
                )}
              </div>
            ) : !isMyCaptureDone ? (
              /* LIVE COUNTDOWN & CAMERA VIEW */
              <>
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className={`absolute inset-0 w-full h-full object-cover ${isMirrored ? 'scale-x-[-1]' : ''}`} 
                />

                {/* Subtle Framing Guide */}
                <div 
                  className="absolute pointer-events-none border border-white/40 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.3)] z-10 transition-all duration-300"
                  style={{
                    aspectRatio: `${slotAspect}`,
                    width: slotAspect < 1 ? `${Math.min(85, 85 * slotAspect)}%` : '85%',
                    maxHeight: '80%',
                  }}
                />

                {/* Switch Camera Button (available before countdown fires) */}
                {hasMultipleCameras && timeLeft === 0 && (
                  <button
                    type="button"
                    onClick={switchCamera}
                    className="absolute top-5 right-5 z-30 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-xs transition-transform active:scale-95"
                    aria-label="Ganti kamera"
                    title="Ganti kamera"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
                
                {/* Round indicator */}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 text-white bg-black/50 backdrop-blur-xs px-3.5 py-1.5 rounded-full font-medium text-xs z-20">
                  Foto {session.currentRound + 1} dari {session.roundCount}
                  {session.currentAttempt > 1 && (
                    <span className="ml-2 text-neutral-300">#{session.currentAttempt}</span>
                  )}
                </div>
                
                {/* Lead-in ("Bersiap...") & Clean Countdown (3-2-1) */}
                {timeLeft > 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none">
                    {timeLeft > 3000 ? (
                      <div className="text-white text-xl sm:text-2xl font-bold bg-black/50 backdrop-blur-xs px-5 py-2.5 rounded-full animate-pulse tracking-wide">
                        {session.currentRound > 0 && session.currentAttempt === 1 ? 'Foto berikutnya...' : 'Bersiap...'}
                      </div>
                    ) : (
                      <span className="text-8xl sm:text-9xl font-bold text-white drop-shadow-xl transition-transform">
                        {Math.ceil(timeLeft / 1000)}
                      </span>
                    )}
                  </div>
                )}

                {/* Brief 120ms Capture Flash */}
                {flash && (
                  <div className="absolute inset-0 bg-white z-50 animate-flash" />
                )}

                {/* Immediate Capture Feedback Overlay */}
                {justCaptured && lastCapturePreview && (
                  <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/50 backdrop-blur-xs p-4">
                    <div className="w-44 h-56 rounded-xl overflow-hidden shadow-2xl border-2 border-white mb-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={lastCapturePreview} alt="Preview Foto" className="w-full h-full object-cover" />
                    </div>
                    <span className="text-white text-xs font-semibold bg-neutral-900/90 px-3.5 py-1.5 rounded-full border border-neutral-700">
                      Foto diambil!
                    </span>
                  </div>
                )}
              </>
            ) : (
              /* WAITING FOR OTHER PARTICIPANTS VIEW */
              <div className="text-center space-y-3 z-20 p-6 bg-black/60 backdrop-blur-sm rounded-2xl max-w-xs mx-auto border border-white/10">
                {lastCapturePreview ? (
                  <div className="w-24 h-32 mx-auto rounded-lg overflow-hidden border border-white/20 mb-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lastCapturePreview} alt="Preview Foto" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="inline-flex items-center justify-center w-10 h-10 bg-white/20 rounded-full mb-1">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                )}
                <h2 className="text-lg font-bold text-white">Foto sudah diambil.</h2>
                <p className="text-xs text-neutral-300">Menunggu {otherNames}...</p>
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* 5. FINAL RESULT VIEW */}
        {/* ========================================================= */}
        {isResult && (
          <div className="w-full space-y-4">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-neutral-900">Foto selesai</h2>
            </div>

            {/* Clean Result Image Container */}
            <div className="w-full bg-neutral-100 rounded-xl border border-neutral-200 p-2 overflow-hidden flex items-center justify-center min-h-[300px] max-h-[460px]">
              {(session?.resultImage || room?.resultImage) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img 
                  src={mediaStorage.resolveMediaUrl(session?.resultImage || room?.resultImage || '')} 
                  alt="Hasil Foto" 
                  className="w-full h-full max-h-[440px] object-contain rounded-lg" 
                />
              ) : (
                <div className="text-xs font-medium text-neutral-400">Menyiapkan foto...</div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-1">
              <button 
                id="btn-download"
                onClick={downloadResult}
                disabled={!session?.resultImage && !room?.resultImage}
                className="w-full h-12 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Download
              </button>

              {/* Crop & Reposition Button (Available for Host when session has result) */}
              {isHost && session && (session.resultImage || room?.resultImage) && (
                <button
                  onClick={() => setShowCropModal(true)}
                  className="w-full h-11 border border-neutral-300 text-neutral-700 bg-white hover:bg-neutral-50 rounded-xl font-medium text-xs flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98]"
                >
                  <Move className="w-3.5 h-3.5 text-neutral-500" />
                  <span>Atur Posisi Foto</span>
                </button>
              )}
              
              {isHost ? (
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    id="btn-retake"
                    onClick={startNewSession}
                    className="h-12 border border-neutral-300 text-neutral-800 bg-white rounded-xl font-medium text-sm hover:bg-neutral-50 active:scale-[0.98] transition-all flex items-center justify-center"
                  >
                    Foto Lagi
                  </button>
                  <button 
                    onClick={() => {
                      startNewSession();
                      setShowFrameSelector(true);
                    }}
                    className="h-12 border border-neutral-200 text-neutral-600 bg-white rounded-xl font-medium text-sm hover:bg-neutral-50 active:scale-[0.98] transition-all flex items-center justify-center"
                  >
                    Ganti Frame
                  </button>
                </div>
              ) : (
                <p className="text-center text-xs text-neutral-500 py-2">
                  Menunggu host untuk foto lagi.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Development Debug Panel */}
        <DevDebugPanel 
          room={room} 
          session={session} 
          participants={participants} 
          participantId={participantId} 
        />
      </main>

      {/* Crop & Reposition Modal */}
      {showCropModal && session && (
        <CropRepositionModal
          isOpen={showCropModal}
          onClose={() => setShowCropModal(false)}
          session={session}
          onSaveCrops={saveCrops}
        />
      )}

      {/* Cancel Session Confirmation Modal */}
      {showCancelSessionModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full shadow-lg space-y-4 text-center">
            <h3 className="text-base font-bold text-neutral-900">Batalkan sesi foto?</h3>
            <p className="text-xs text-neutral-600">Proses foto yang sedang berjalan akan dihentikan dan kembali ke room.</p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button 
                onClick={() => setShowCancelSessionModal(false)}
                className="h-10 border border-neutral-300 text-neutral-700 rounded-xl font-medium text-xs hover:bg-neutral-50"
              >
                Batal
              </button>
              <button 
                onClick={async () => {
                  setShowCancelSessionModal(false);
                  await cancelSession();
                }}
                className="h-10 bg-red-600 text-white rounded-xl font-medium text-xs hover:bg-red-700"
              >
                Batalkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Room Confirmation Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full shadow-lg space-y-4">
            <h3 className="text-base font-bold text-neutral-900">Keluar dari room?</h3>
            <p className="text-xs text-neutral-600">Kamu akan meninggalkan photobooth ini.</p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button 
                onClick={() => setShowLeaveModal(false)}
                className="h-10 border border-neutral-300 text-neutral-700 rounded-xl font-medium text-xs hover:bg-neutral-50"
              >
                Batal
              </button>
              <button 
                onClick={handleConfirmLeave}
                className="h-10 bg-red-600 text-white rounded-xl font-medium text-xs hover:bg-red-700"
              >
                Keluar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JoinForm({ roomCode, onSuccess }: { roomCode: string, onSuccess: (id: string) => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizeDisplayName(name);
    if (cleanName.length < MIN_NAME_LENGTH) {
      setError('Nama belum diisi.');
      return;
    }
    if (cleanName.length > MAX_NAME_LENGTH) {
      setError(`Nama maksimal ${MAX_NAME_LENGTH} karakter.`);
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const authUid = await ensureAuthUser();
      const now = Date.now();

      await runTransaction(db, async (transaction) => {
        const roomRef = doc(db, 'rooms', roomCode);
        const roomSnap = await transaction.get(roomRef);
        
        if (!roomSnap.exists()) {
          throw new Error('Room tidak ditemukan.');
        }
        
        const roomData = roomSnap.data();
        if (roomData.expiresAt && now > roomData.expiresAt) {
          throw new Error('Room sudah berakhir.');
        }

        if (roomData.status !== 'waiting') {
          throw new Error('Sesi sedang berlangsung.');
        }

        const maxAllowed = roomData.maxParticipants || DEFAULT_MAX_PARTICIPANTS;
        const currentSlots: (string | null)[] = Array.isArray(roomData.slots) 
          ? [...roomData.slots] 
          : [roomData.hostUid || roomData.hostId || null, null];

        while (currentSlots.length < maxAllowed) currentSlots.push(null);

        const existingSlotIdx = currentSlots.indexOf(authUid);
        let allocatedSlot = existingSlotIdx;

        if (allocatedSlot === -1) {
          const vacantIdx = currentSlots.findIndex(s => s === null || s === undefined);
          if (vacantIdx === -1) {
            throw new Error(`Room sudah penuh (maksimal ${maxAllowed} orang).`);
          }
          allocatedSlot = vacantIdx;
          currentSlots[allocatedSlot] = authUid;
        }

        transaction.update(roomRef, {
          slots: currentSlots,
          updatedAt: now
        });

        const participantRef = doc(db, 'rooms', roomCode, 'participants', authUid);
        transaction.set(participantRef, {
          id: authUid,
          uid: authUid,
          name: cleanName,
          participantIndex: allocatedSlot,
          slotIndex: allocatedSlot,
          isReady: false,
          readyConfigVersion: roomData.configVersion || 1,
          isHost: (roomData.hostUid || roomData.hostId) === authUid,
          presence: 'connected',
          joinedAt: now,
          updatedAt: now,
          photos: {}
        }, { merge: true });
      });
      
      localStorage.setItem(`participant_${roomCode}`, authUid);
      onSuccess(authUid);
    } catch (err: any) {
      setError(err.message || 'Gagal masuk room.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-[100dvh] w-full bg-white text-neutral-900 selection:bg-blue-100">
      <header className="px-5 sm:px-8 py-5 border-b border-neutral-100">
        <span className="text-xl font-bold tracking-tight text-neutral-900">FotoBareng</span>
      </header>
      
      <main className="flex-1 flex flex-col items-center justify-center px-5 py-8 w-full max-w-sm mx-auto">
        <div className="w-full">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-neutral-900 mb-1">Masuk ke Room</h1>
            <p className="text-xs text-neutral-500">Kode room: <span className="font-semibold text-neutral-800">{roomCode.toUpperCase()}</span></p>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label htmlFor="invite-join-name" className="block text-sm font-medium text-neutral-700 mb-1.5">
                Nama kamu
              </label>
              <input
                id="invite-join-name"
                type="text"
                placeholder="Contoh: Aghna"
                autoComplete="name"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(''); }}
                disabled={loading}
                maxLength={MAX_NAME_LENGTH}
                className="w-full h-12 px-4 rounded-xl border border-neutral-300 bg-white text-base text-neutral-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-neutral-400"
              />
            </div>
            
            {error && <p className="text-xs text-red-600">{error}</p>}
            
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 mt-2 flex items-center justify-center"
            >
              {loading ? 'Masuk...' : 'Masuk Room'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
