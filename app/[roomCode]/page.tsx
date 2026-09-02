'use client';

import { useEffect, useState, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, CheckCircle2, Circle, Download, Share, LayoutTemplate, PenTool } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, getDoc, getDocs, setDoc, onSnapshot, collection, updateDoc, writeBatch } from 'firebase/firestore';
import { generateParticipantId } from '@/lib/store';
import { OFFICIAL_FRAMES, FrameConfig } from '@/lib/frames';
import CustomFrameEditor from './CustomFrameEditor';

type RoomStatus = 'waiting' | 'starting' | 'completed';

interface Room {
  id: string;
  hostId: string;
  status: RoomStatus;
  frameId: string;
  customFrame?: FrameConfig;
  currentRound: number;
  captureAt: number | null;
  sessionCount: number;
  createdAt: number;
  resultImage?: string | null;
}

interface Participant {
  id: string;
  name: string;
  participantIndex: number;
  isReady: boolean;
  isHost: boolean;
  joinedAt: number;
  photos: Record<number, string>;
  updatedAt?: number;
}

export default function RoomPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const router = useRouter();
  const { roomCode } = use(params);
  
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [resultError, setResultError] = useState(false);
  
  // Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStatus, setCameraStatus] = useState<'loading'|'active'|'denied'|'not_found'|'busy'|'error'>('loading');
  const [isOffline, setIsOffline] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [now, setNow] = useState<number>(0);
  useEffect(() => {
    setTimeout(() => setNow(Date.now()), 0);
    const int = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(int);
  }, []);
  
  // Frame state
  const [showFrameSelector, setShowFrameSelector] = useState(false);
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [customAssetUrl, setCustomAssetUrl] = useState<string | null>(null);
  
  const selectedFrame = room?.frameId === 'custom' && room.customFrame 
    ? room.customFrame 
    : (room ? OFFICIAL_FRAMES.find(f => f.id === room.frameId) || OFFICIAL_FRAMES[0] : OFFICIAL_FRAMES[0]);
  
  // Countdown state
  const [timeLeft, setTimeLeft] = useState(0);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setTimeout(() => setIsOffline(!navigator.onLine), 0);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function capturePhoto() {
    if (!room || !participantId || !videoRef.current) return;
    
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
    
    try {
      const canvas = document.createElement('canvas');
      const video = videoRef.current;
      
      const vRatio = video.videoWidth / video.videoHeight;
      const targetRatio = 3/4;
      
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
      
      canvas.width = 480;
      canvas.height = 640;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
         ctx.translate(canvas.width, 0);
         ctx.scale(-1, 1);
         ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
         const base64 = canvas.toDataURL('image/jpeg', 0.7);
         
         setUploading(true);
         setUploadError(false);
         let success = false;
         let attempts = 0;
         while (!success && attempts < 3) {
            try {
              await updateDoc(doc(db, 'rooms', roomCode, 'participants', participantId), {
                [`photos.${room.currentRound}`]: base64,
                updatedAt: Date.now()
              });
              success = true;
            } catch (err) {
              attempts++;
              await new Promise(r => setTimeout(r, 1000));
            }
         }
         if (!success) setUploadError(true);
         setUploading(false);
      }
    } catch (e) {
      console.error('Failed to capture:', e);
      setUploadError(true);
      setUploading(false);
    }
  };

  async function generateResult(parts: Participant[]) {
    if (!room || room.status === 'completed') return;
    
    
    try {
      const canvas = document.createElement('canvas');
    canvas.width = selectedFrame.canvasWidth;
    canvas.height = selectedFrame.canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.fillStyle = selectedFrame.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    for (const slot of selectedFrame.slots) {
      const p = parts.find(p => p.participantIndex === slot.participantIndex) || parts[0];
      if (p && p.photos && p.photos[slot.roundIndex]) {
        const img = new Image();
        await new Promise(resolve => {
          img.onload = resolve;
          img.src = p.photos[slot.roundIndex];
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
        let cWidth = img.width;
        let cHeight = img.height;
        let cX = 0;
        let cY = 0;
        
        if (imgRatio > targetRatio) {
          cWidth = img.height * targetRatio;
          cX = (img.width - cWidth) / 2;
        } else {
          cHeight = img.width / targetRatio;
          cY = (img.height - cHeight) / 2;
        }
        
        ctx.drawImage(img, cX, cY, cWidth, cHeight, sx, sy, sw, sh);
        ctx.restore();
      }
    }
    
    if (selectedFrame.id === 'custom' && customAssetUrl) {
      const frameImg = new Image();
      await new Promise(resolve => {
        frameImg.onload = resolve;
        frameImg.src = customAssetUrl;
      });
      ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
    }
    
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FotoBareng', canvas.width / 2, canvas.height - 40);
    
    const finalBase64 = canvas.toDataURL('image/jpeg', 0.9);
    
      await updateDoc(doc(db, 'rooms', roomCode), {
        status: 'completed',
        resultImage: finalBase64
      });
    } catch (e) {
      console.error(e);
      setResultError(true);
    }
  };
  const capturedSession = useRef(0); // Using this to prevent double captures per round
  
  // Initialize
  useEffect(() => {
    const pId = localStorage.getItem(`participant_${roomCode}`);
    if (pId) {
      setTimeout(() => setParticipantId(pId), 0);
    } else {
      setTimeout(() => setError("need_join"), 0);
    }
  }, [roomCode]);

  // Firebase Realtime Subscriptions
  useEffect(() => {
    if (!participantId || error === 'need_join') return;

    // Room subscription
    const unsubRoom = onSnapshot(doc(db, 'rooms', roomCode), (docSnap) => {
      if (docSnap.exists()) {
        setRoom(docSnap.data() as Room);
      } else {
        setError('not_found');
      }
    });

    // Participants subscription
    const unsubParticipants = onSnapshot(collection(db, 'rooms', roomCode, 'participants'), (snap) => {
      const parts: Participant[] = [];
      snap.forEach(d => parts.push(d.data() as Participant));
      parts.sort((a, b) => a.joinedAt - b.joinedAt);
      setParticipants(parts);
    });

    const interval = setInterval(() => {
      if (participantId) {
        updateDoc(doc(db, 'rooms', roomCode, 'participants', participantId), { updatedAt: Date.now() }).catch(()=>{});
      }
    }, 5000);

    return () => {
      unsubRoom();
      unsubParticipants();
      clearInterval(interval);
    };
  }, [roomCode, participantId, error]);
  
  // Host transfer logic
  useEffect(() => {
    if (!room || !participants.length || !participantId) return;
    const host = participants.find(p => p.id === room.hostId);
    const now = Date.now();
    const isHostDead = !host || (now - (host.updatedAt || 0) > 15000);
    const me = participants.find(p => p.id === participantId);
    
    if (isHostDead && !me?.isHost) {
      const activeParts = participants.filter(p => (now - (p.updatedAt || 0) <= 15000));
      activeParts.sort((a, b) => a.participantIndex - b.participantIndex);
      if (activeParts[0]?.id === participantId) {
        updateDoc(doc(db, 'rooms', roomCode), { hostId: participantId }).catch(()=>{});
      }
    }
  }, [room, participants, participantId]);

  // Fetch custom asset if needed
  useEffect(() => {
    if (room?.frameId === 'custom' && !customAssetUrl) {
      getDoc(doc(db, 'rooms', roomCode, 'assets', 'customFrame')).then(snap => {
        if (snap.exists()) {
          setCustomAssetUrl(snap.data().dataUrl);
        }
      });
    }
  }, [room?.frameId, customAssetUrl, roomCode]);

  // Camera setup
  const initCamera = () => {
    if (room?.status === 'completed') return;
    
    navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'user', aspectRatio: 3/4 } 
    })
    .then(stream => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraStatus('active');
        const track = stream.getVideoTracks()[0];
        if (track) {
          track.onended = () => {
            setCameraStatus('error');
          };
        }
      }
    })
    .catch((err: any) => {
      if (err.name === 'NotAllowedError') setCameraStatus('denied');
      else if (err.name === 'NotFoundError') setCameraStatus('not_found');
      else if (err.name === 'NotReadableError') setCameraStatus('busy');
      else setCameraStatus('error');
    });
  };

  useEffect(() => {
    if (room?.status !== 'completed' && cameraStatus !== 'active' && cameraStatus !== 'denied' && cameraStatus !== 'not_found' && cameraStatus !== 'busy') {
      initCamera();
    }
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && room?.status !== 'completed') {
         if (videoRef.current && videoRef.current.srcObject) {
           const stream = videoRef.current.srcObject as MediaStream;
           const track = stream.getVideoTracks()[0];
           if (!track || track.readyState === 'ended') {
             initCamera();
           }
         } else {
           initCamera();
         }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [room?.status]);

  // Countdown & Capture
  useEffect(() => {
    if (room?.status === 'starting' && room.captureAt) {
      const interval = setInterval(() => {
        const remaining = room.captureAt! - Date.now();
        setTimeLeft(Math.max(0, remaining));
        
        // Use combination of sessionCount and currentRound for tracking
        const roundSig = room.sessionCount * 100 + room.currentRound;
        if (remaining <= 0 && capturedSession.current !== roundSig) {
          capturedSession.current = roundSig;
          capturePhoto();
        }
      }, 50);
      return () => clearInterval(interval);
    }
  }, [room?.status, room?.captureAt, room?.sessionCount, room?.currentRound]);


  // Host: Progression & Aggregation logic
  useEffect(() => {
    if (!room || !participants.length || !participantId) return;
    const me = participants.find(p => p.id === participantId);
    if (!me?.isHost || room.status !== 'starting') return;

    // Check if everyone required by the frame for this round has captured
    // Wait for all connected participants to have photo for currentRound
    // Though frame might say participantCount=2, we just wait for everyone in the room.
    const allCaptured = participants.every(p => p.photos && p.photos[room.currentRound]);
    const timeoutReached = room.captureAt && Date.now() > room.captureAt + 10000;
    
    if (allCaptured || timeoutReached) {
      if (room.currentRound + 1 < selectedFrame.roundCount) {
        // Next round
        updateDoc(doc(db, 'rooms', roomCode), {
          currentRound: room.currentRound + 1,
          captureAt: Date.now() + 4000
        });
      } else {
        // All rounds complete, generate result
        setTimeout(() => generateResult(participants), 0);
      }
    }
  }, [room, participants, participantId, selectedFrame]);


  const setReady = async (isReady: boolean) => {
    if (!participantId) return;
    await updateDoc(doc(db, 'rooms', roomCode, 'participants', participantId), {
      isReady,
      photos: {} // clear previous photos when readying up
    });
  };

  const startSession = async () => {
    if (!room) return;
    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'starting',
      currentRound: 0,
      captureAt: Date.now() + 4000,
      sessionCount: room.sessionCount + 1
    });
  };

  const resetSession = async () => {
    if (!participantId) return;
    
    // Batch update to reset room and all participants ready state
    const batch = writeBatch(db);
    batch.update(doc(db, 'rooms', roomCode), {
      status: 'waiting',
      currentRound: 0,
      resultImage: null
    });
    
    participants.forEach(p => {
      batch.update(doc(db, 'rooms', roomCode, 'participants', p.id), {
        isReady: false,
        photos: {}
      });
    });
    
    await batch.commit();
  };
  
  const changeFrame = async (frameId: string) => {
    if (!room) return;
    const batch = writeBatch(db);
    batch.update(doc(db, 'rooms', roomCode), {
      frameId
    });
    // Reset ready states when frame changes
    participants.forEach(p => {
      batch.update(doc(db, 'rooms', roomCode, 'participants', p.id), {
        isReady: false
      });
    });
    await batch.commit();
    setShowFrameSelector(false);
  };

  const saveCustomFrame = async (config: FrameConfig, base64Image: string) => {
    if (!room) return;
    const batch = writeBatch(db);
    batch.update(doc(db, 'rooms', roomCode), {
      frameId: 'custom',
      customFrame: config
    });
    batch.set(doc(db, 'rooms', roomCode, 'assets', 'customFrame'), {
      dataUrl: base64Image
    });
    
    participants.forEach(p => {
      batch.update(doc(db, 'rooms', roomCode, 'participants', p.id), {
        isReady: false
      });
    });
    
    await batch.commit();
    setCustomAssetUrl(base64Image);
    setShowCustomEditor(false);
    setShowFrameSelector(false);
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({
        title: 'FotoBareng',
        text: 'Masuk room ini buat foto bareng!',
        url,
      });
    } else {
      await navigator.clipboard.writeText(url);
      alert('Link disalin!');
    }
  };

  const downloadResult = () => {
    if (room?.resultImage) {
      const a = document.createElement('a');
      a.href = room.resultImage;
      a.download = `fotobareng-${roomCode}.jpg`;
      a.click();
    }
  };

  if (error === 'need_join') {
    return <JoinForm roomCode={roomCode} onSuccess={(id) => {
      setParticipantId(id);
      setError('');
    }} />;
  }

  if (error === 'not_found') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#fdfdfd]">
        <div className="text-center max-w-sm w-full">
          <h2 className="text-4xl font-black tracking-tighter uppercase mb-2 text-neutral-950">Room tidak ditemukan</h2>
          <p className="text-sm font-bold tracking-widest uppercase text-neutral-500 mb-8">Cek kodenya lalu coba lagi.</p>
          <button onClick={() => router.push('/')} className="w-full h-14 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 active:scale-95 transition-all">Kembali ke Home</button>
        </div>
      </div>
    );
  }

  
  if (room && room.createdAt && now - room.createdAt > 24 * 60 * 60 * 1000) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#fdfdfd]">
        <div className="text-center max-w-sm w-full">
          <h2 className="text-4xl font-black tracking-tighter uppercase mb-2 text-neutral-950">Room Berakhir</h2>
          <p className="text-sm font-bold tracking-widest uppercase text-neutral-500 mb-8">Room ini sudah tidak aktif karena lewat dari 24 jam.</p>
          <button onClick={() => router.push('/')} className="w-full h-14 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 active:scale-95 transition-all">Buat Room Baru</button>
        </div>
      </div>
    );
  }

  if (!room || !participants.length) {
    return <div className="min-h-screen flex items-center justify-center text-xs font-bold uppercase tracking-widest text-neutral-400 bg-[#fdfdfd]">Memuat room...</div>;
  }

  const me = participants.find(p => p.id === participantId);
  const allReady = participants.every(p => p.isReady);
  const waitingForOthers = room.status === 'starting' && me?.photos && me.photos[room.currentRound];

  return (
    <div className="flex flex-col flex-1 w-full h-full min-h-screen bg-[#fdfdfd] text-neutral-900 font-sans overflow-hidden">
      <nav className="flex justify-between items-center px-6 md:px-12 py-6 md:py-10 shrink-0">
        {isOffline && (
          <div className="absolute top-0 left-0 right-0 bg-red-500 text-white text-xs font-bold uppercase tracking-widest text-center py-2 z-50">
            Kamu sedang offline. Photobooth akan lanjut setelah koneksi kembali.
          </div>
        )}
        {uploading && !uploadError && (
          <div className="absolute top-0 left-0 right-0 bg-blue-500 text-white text-xs font-bold uppercase tracking-widest text-center py-2 z-50">
            Mengirim foto...
          </div>
        )}
        {uploadError && (
          <div className="absolute top-0 left-0 right-0 bg-orange-500 text-white text-xs font-bold uppercase tracking-widest text-center py-2 z-50 flex justify-center items-center gap-4">
            <span>Foto belum berhasil dikirim.</span>
            <button onClick={capturePhoto} className="underline hover:text-orange-100">Coba Lagi</button>
          </div>
        )}
        <div className="text-xl md:text-2xl font-black tracking-tighter uppercase cursor-pointer" onClick={() => router.push('/')}>FotoBareng</div>
        {room.status === 'waiting' && (
          <div className="flex gap-4">
            <button onClick={handleShare} className="text-xs font-bold uppercase tracking-widest text-neutral-500 hover:text-blue-600 transition-colors flex items-center gap-2">
              <Share className="w-4 h-4" /> Share Link
            </button>
          </div>
        )}
      </nav>

      <main className="flex-1 flex flex-col items-center justify-center p-4 relative overflow-y-auto">
      
      {/* LOBBY VIEW */}
      {room.status === 'waiting' && !showFrameSelector && (
        <div className="w-full max-w-sm space-y-4 z-10 relative pb-10">
          <div className="flex justify-between items-center bg-white p-5 shadow-[20px_20px_40px_-10px_rgba(0,0,0,0.05)] border border-neutral-100 mb-8">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 mb-1">Kode Room</p>
              <p className="text-2xl font-black tracking-tighter uppercase text-neutral-950">{roomCode.toUpperCase()}</p>
            </div>
          </div>
          
          <div className="bg-white p-4 shadow-[20px_20px_40px_-10px_rgba(0,0,0,0.05)] border border-neutral-100 flex items-center justify-between">
             <div className="flex flex-col">
               <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Frame Aktif</span>
               <span className="font-bold uppercase tracking-widest text-sm">{selectedFrame.name}</span>
             </div>
             {me?.isHost && (
               <button onClick={() => setShowFrameSelector(true)} className="flex items-center gap-2 text-blue-600 text-xs font-bold uppercase tracking-widest hover:text-blue-700 p-2">
                 <LayoutTemplate className="w-4 h-4" /> Ganti
               </button>
             )}
          </div>

          <div className="bg-neutral-100 p-2 shadow-[20px_20px_40px_-10px_rgba(0,0,0,0.05)] border border-neutral-200 relative overflow-hidden" style={{ aspectRatio: selectedFrame.slots[0] ? `${selectedFrame.slots[0].width * selectedFrame.canvasWidth} / ${selectedFrame.slots[0].height * selectedFrame.canvasHeight}` : '3/4' }}>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" 
            />
            {cameraStatus !== 'active' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 p-6 text-center space-y-3 z-10">
                <Camera className="w-8 h-8 text-neutral-400" />
                <p className="text-sm font-medium text-neutral-600">
                  {
                  cameraStatus === 'denied' ? 'Kamera belum diizinkan. Buka izin kamera, lalu muat ulang.' : 
                  cameraStatus === 'not_found' ? 'Kamera tidak ditemukan di perangkat ini.' :
                  cameraStatus === 'busy' ? 'Kamera sedang dipakai aplikasi lain. Tutup lalu coba lagi.' :
                  'Kamera terputus. Menyiapkan ulang...'
}
                </p>
              </div>
            )}
            <div className="absolute top-2 left-2 bg-black/50 text-white px-2 py-1 text-[10px] uppercase font-bold tracking-widest rounded z-10">
               Pratinjau
            </div>
          </div>
          
          {participants.length < selectedFrame.participantCount && (
             <div className="bg-orange-50 border border-orange-200 text-orange-800 p-3 text-xs font-bold uppercase tracking-widest text-center rounded">
                Frame ini butuh {selectedFrame.participantCount} orang.
             </div>
          )}

          <div className="bg-white p-5 shadow-[20px_20px_40px_-10px_rgba(0,0,0,0.05)] border border-neutral-100 space-y-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Participants</h3>
            <div className="space-y-3">
            {participants.map(p => (
              <div key={p.id} className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-neutral-900 uppercase text-sm tracking-widest flex items-center gap-2">
                    {p.name} 
                    {p.id === me?.id && <span className="text-neutral-400 font-normal tracking-normal normal-case">(Kamu)</span>}
                    {(now - (p.updatedAt || 0) > 15000) && p.id !== me?.id && (
                      <span className="text-[9px] uppercase font-bold tracking-widest px-1.5 py-0.5 bg-red-50 text-red-500 border border-red-100 rounded">Terputus</span>
                    )}
                  </span>
                  {p.isHost && <span className="text-[9px] uppercase font-bold tracking-widest px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded">Host</span>}
                </div>
                {p.isReady ? (
                  <CheckCircle2 className="w-5 h-5 text-blue-600" />
                ) : (
                  <Circle className="w-5 h-5 text-neutral-300" />
                )}
              </div>
            ))}
            </div>
          </div>

          <div className="space-y-3 pt-4">
            {!me?.isReady ? (
              <button 
                onClick={() => setReady(true)}
                disabled={cameraStatus !== 'active' || participants.length < selectedFrame.participantCount}
                className="w-full h-14 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50"
              >
                Siap
              </button>
            ) : (
              <button 
                onClick={() => setReady(false)}
                className="w-full h-14 border-2 border-neutral-200 text-neutral-800 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-neutral-50 active:scale-95 transition-all"
              >
                Batal Siap
              </button>
            )}

            {me?.isHost && (
              <button 
                onClick={startSession}
                disabled={!allReady || participants.length < selectedFrame.participantCount}
                className="w-full h-14 bg-neutral-900 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-neutral-800 active:scale-95 transition-all disabled:opacity-50"
              >
                {allReady ? 'Mulai' : 'Menunggu teman siap...'}
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* FRAME SELECTION */}
      {room.status === 'waiting' && showFrameSelector && me?.isHost && !showCustomEditor && (
         <div className="w-full max-w-sm space-y-6 z-10 relative pb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black uppercase tracking-tighter">Pilih Frame</h2>
              <button onClick={() => setShowFrameSelector(false)} className="text-xs font-bold uppercase text-neutral-500 hover:text-neutral-900">Batal</button>
            </div>
            
            <button 
              onClick={() => setShowCustomEditor(true)}
              className="w-full h-14 border-2 border-dashed border-blue-200 text-blue-600 bg-blue-50/50 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-100 hover:border-blue-300 active:scale-95 transition-all flex items-center justify-center gap-2 mb-2"
            >
              <PenTool className="w-4 h-4" /> Pakai Frame Sendiri
            </button>
            
            <div className="grid grid-cols-1 gap-4">
               {OFFICIAL_FRAMES.map(f => (
                  <div key={f.id} onClick={() => changeFrame(f.id)} className={`p-4 cursor-pointer border-2 transition-all ${room.frameId === f.id ? 'border-blue-600 bg-blue-50/30' : 'border-neutral-100 hover:border-neutral-200 bg-white'}`}>
                     <div className="flex justify-between items-center">
                        <div>
                           <p className="font-bold uppercase tracking-widest text-sm text-neutral-900">{f.name}</p>
                           <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500 mt-1">{f.participantCount} Orang &bull; {f.roundCount} Foto</p>
                        </div>
                        {room.frameId === f.id && <CheckCircle2 className="text-blue-600 w-5 h-5" />}
                     </div>
                     <div className="mt-4 border border-neutral-200 bg-neutral-100 aspect-video relative flex items-center justify-center">
                        {/* Simple CSS preview of layout */}
                        <div 
                           className="relative bg-white" 
                           style={{
                              width: '100%', 
                              aspectRatio: `${f.canvasWidth}/${f.canvasHeight}`,
                              maxHeight: '120px'
                           }}
                        >
                           {f.slots.map(s => (
                              <div key={s.id} className="absolute bg-neutral-300 border border-white" style={{
                                 left: `${s.x * 100}%`,
                                 top: `${s.y * 100}%`,
                                 width: `${s.width * 100}%`,
                                 height: `${s.height * 100}%`,
                                 borderRadius: s.borderRadius ? `${s.borderRadius * 100}%` : '0'
                              }} />
                           ))}
                        </div>
                     </div>
                     <button className="w-full mt-4 h-10 border border-neutral-200 text-neutral-900 font-bold uppercase tracking-widest text-[10px] hover:bg-neutral-50">
                        Pakai Frame
                     </button>
                  </div>
               ))}
            </div>
         </div>
      )}

      {/* CUSTOM FRAME EDITOR */}
      {showCustomEditor && (
        <CustomFrameEditor 
          onSave={saveCustomFrame}
          onCancel={() => setShowCustomEditor(false)}
          availableParticipants={participants.map(p => ({ name: p.name, index: p.participantIndex }))}
        />
      )}

      {/* COUNTDOWN VIEW */}
      {room.status === 'starting' && (
        <div className="fixed inset-0 z-50 bg-neutral-950 flex flex-col items-center justify-center">
          {!waitingForOthers ? (
            <>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="absolute inset-0 w-full h-full object-cover scale-x-[-1] opacity-60" 
              />
              
              <div className="absolute top-10 text-white font-bold tracking-widest uppercase text-sm z-20">
                Foto {room.currentRound + 1} dari {selectedFrame.roundCount}
              </div>
              
              {timeLeft > 0 && (
                <div className="absolute inset-0 flex items-center justify-center z-10">
                  <span className="text-[12rem] leading-none font-black tracking-tighter text-white drop-shadow-2xl">
                    {Math.ceil(timeLeft / 1000)}
                  </span>
                </div>
              )}

              {flash && (
                <div className="absolute inset-0 bg-white z-50 animate-flash" />
              )}
            </>
          ) : (
            <div className="text-center space-y-4 z-10">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-full mb-4">
                <CheckCircle2 className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-3xl font-black tracking-tighter uppercase text-white">Bagus.</h2>
              <p className="text-sm font-bold tracking-widest uppercase text-neutral-400">Menunggu {participants.length - 1} orang lain...</p>
            </div>
          )}
        </div>
      )}

      {/* RESULT VIEW */}
      {room.status === 'completed' && (
        <div className="w-full max-w-sm space-y-6 z-10 relative flex flex-col h-full py-8">
          <div className="text-center space-y-2">
            <h2 className="text-4xl font-black tracking-tighter uppercase text-neutral-950">Foto selesai.</h2>
            <p className="text-sm font-bold tracking-widest uppercase text-neutral-500">Ini hasil foto bareng kalian.</p>
          </div>

          <div className="flex-1 min-h-0 flex items-center justify-center bg-white shadow-[20px_20px_40px_-10px_rgba(0,0,0,0.05)] border border-neutral-100 p-4 overflow-hidden relative">
            {room.resultImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={room.resultImage} alt="Result" className="w-full h-full object-contain" />
            ) : resultError ? (
                <div className="text-center space-y-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-red-500">Foto belum berhasil dibuat.</p>
                  <button onClick={() => generateResult(participants)} className="px-4 py-2 border border-neutral-200 rounded text-xs font-bold uppercase hover:bg-neutral-50 active:scale-95">Coba Lagi</button>
                </div>
            ) : (
                <div className="animate-pulse text-xs font-bold uppercase tracking-widest text-neutral-400">Memproses komposisi foto...</div>
            )}
          </div>

          <div className="space-y-4 pt-4">
            <button 
              onClick={downloadResult}
              disabled={!room.resultImage}
              className="w-full h-14 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
            
            {me?.isHost && (
              <button 
                onClick={resetSession}
                className="w-full h-14 border-2 border-neutral-200 text-neutral-800 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-neutral-50 active:scale-95 transition-all"
              >
                Foto Lagi
              </button>
            )}
          </div>
        </div>
      )}

      </main>
    </div>
  );
}

function JoinForm({ roomCode, onSuccess }: { roomCode: string, onSuccess: (id: string) => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama belum diisi.');
      return;
    }
    setLoading(true);
    
    try {
      const roomSnap = await getDoc(doc(db, 'rooms', roomCode));
      if (!roomSnap.exists()) {
        throw new Error('Room tidak ditemukan.');
      }
      
      const roomData = roomSnap.data();
      if (roomData.status !== 'waiting') {
        throw new Error('Sesi sedang berlangsung.');
      }

      // Get current participants to determine index
      const partsSnap = await getDocs(collection(db, 'rooms', roomCode, 'participants'));
      const currentIndex = partsSnap.size;
      if (currentIndex >= 12) throw new Error("Room sudah penuh.");

      const participantId = generateParticipantId();
      const now = Date.now();

      await setDoc(doc(db, 'rooms', roomCode, 'participants', participantId), {
        id: participantId,
        name: name.trim(),
        participantIndex: currentIndex,
        isReady: false,
        isHost: false,
        joinedAt: now,
        updatedAt: now,
        photos: {}
      });
      
      localStorage.setItem(`participant_${roomCode}`, participantId);
      onSuccess(participantId);
    } catch (err: any) {
      setError(err.message || 'Gagal masuk room.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full h-full min-h-screen bg-[#fdfdfd] text-neutral-900 font-sans overflow-y-auto">
      <nav className="flex justify-between items-center px-6 md:px-12 py-6 md:py-10">
        <div className="text-xl md:text-2xl font-black tracking-tighter uppercase">FotoBareng</div>
      </nav>
      
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-12 w-full">
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-black tracking-tighter uppercase mb-2 text-neutral-950">Masuk ke Room</h1>
            <p className="text-sm text-neutral-500 font-bold tracking-widest uppercase">Room: {roomCode.toUpperCase()}</p>
          </div>

          <form onSubmit={handleJoin} className="space-y-6">
            <div className="group">
              <label htmlFor="join-name" className="block text-xs font-bold uppercase tracking-widest text-neutral-500 mb-3 group-focus-within:text-blue-600 transition-colors">
                Nama kamu
              </label>
              <input
                id="join-name"
                type="text"
                placeholder="Contoh: Aghna"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                className="w-full h-14 px-5 rounded-xl border border-neutral-200 bg-white text-lg font-medium outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-50/50 transition-all placeholder:text-neutral-300"
              />
            </div>
            
            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
            
            <button
              type="submit"
              disabled={loading}
              className="w-full h-14 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 mt-4"
            >
              {loading ? 'Masuk...' : 'Masuk Room'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
