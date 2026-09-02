const fs = require('fs');
const file = 'app/[roomCode]/page.tsx';
let code = fs.readFileSync(file, 'utf8');

// Replace hasCamera and cameraError
code = code.replace(
  /const \[hasCamera, setHasCamera\] = useState\(false\);\n  const \[cameraError, setCameraError\] = useState\(false\);/,
  `const [cameraStatus, setCameraStatus] = useState<'loading'|'active'|'denied'|'not_found'|'busy'|'error'>('loading');
  const [isOffline, setIsOffline] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);`
);

// Replace flash state -> just insert offline listener after it
code = code.replace(
  /const \[flash, setFlash\] = useState\(false\);/,
  `const [flash, setFlash] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOffline(!navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);`
);

// Replace capturePhoto
const oldCapture = `async function capturePhoto() {
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
         
         await updateDoc(doc(db, 'rooms', roomCode, 'participants', participantId), {
           [\`photos.\${room.currentRound}\`]: base64,
           updatedAt: Date.now()
         });
      }
    } catch (e) {
      console.error('Failed to capture:', e);
    }
  };`;
  
const newCapture = `async function capturePhoto() {
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
                [\`photos.\${room.currentRound}\`]: base64,
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
  };`;
code = code.replace(oldCapture, newCapture);

// Add heartbeat & host transfer logic inside Participants subscription block or separate effect
const firebaseSubsOld = `    // Participants subscription
    const unsubParticipants = onSnapshot(collection(db, 'rooms', roomCode, 'participants'), (snap) => {
      const parts: Participant[] = [];
      snap.forEach(d => parts.push(d.data() as Participant));
      parts.sort((a, b) => a.joinedAt - b.joinedAt);
      setParticipants(parts);
    });

    return () => {
      unsubRoom();
      unsubParticipants();
    };
  }, [roomCode, participantId, error]);`;

const firebaseSubsNew = `    // Participants subscription
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
  }, [room, participants, participantId]);`;
code = code.replace(firebaseSubsOld, firebaseSubsNew);

// Replace camera setup
const cameraSetupOld = `  // Camera setup
  useEffect(() => {
    if (room?.status !== 'completed' && !hasCamera && !cameraError) {
      navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', aspectRatio: 3/4 } 
      })
      .then(stream => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setHasCamera(true);
        }
      })
      .catch(err => {
        console.error('Camera error', err);
        setCameraError(true);
      });
    }
  }, [room?.status, hasCamera, cameraError]);`;

const cameraSetupNew = `  // Camera setup
  const initCamera = () => {
    if (room?.status === 'completed') return;
    setCameraStatus('loading');
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
  }, [room?.status]);`;
code = code.replace(cameraSetupOld, cameraSetupNew);

// Replace UI usage
code = code.replace(/!hasCamera/g, "cameraStatus !== 'active'");
code = code.replace(/cameraError \? '[^']+' : '[^']+'/g, `
                  cameraStatus === 'denied' ? 'Kamera belum diizinkan. Buka izin kamera, lalu muat ulang.' : 
                  cameraStatus === 'not_found' ? 'Kamera tidak ditemukan di perangkat ini.' :
                  cameraStatus === 'busy' ? 'Kamera sedang dipakai aplikasi lain. Tutup lalu coba lagi.' :
                  'Kamera terputus. Menyiapkan ulang...'
`);

// Add offline banner and offline participant display
// Replace '<nav className="flex justify-between'
code = code.replace(/<nav className="flex justify-between items-center px-6 md:px-12 py-6 md:py-10 shrink-0">/,
`<nav className="flex justify-between items-center px-6 md:px-12 py-6 md:py-10 shrink-0">
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
        )}`
);

// Participant state visualization
code = code.replace(/<span className="font-bold text-neutral-900 uppercase text-sm tracking-widest">\{p.name\} \{p.id === me\?.id && <span className="text-neutral-400 font-normal tracking-normal normal-case">\(Kamu\)<\/span>\}<\/span>/,
`<span className="font-bold text-neutral-900 uppercase text-sm tracking-widest flex items-center gap-2">
                    {p.name} 
                    {p.id === me?.id && <span className="text-neutral-400 font-normal tracking-normal normal-case">(Kamu)</span>}
                    {(Date.now() - (p.updatedAt || 0) > 15000) && p.id !== me?.id && (
                      <span className="text-[9px] uppercase font-bold tracking-widest px-1.5 py-0.5 bg-red-50 text-red-500 border border-red-100 rounded">Terputus</span>
                    )}
                  </span>`
);

// Add result error state
code = code.replace(/const \[error, setError\] = useState\(''\);/, `const [error, setError] = useState('');
  const [resultError, setResultError] = useState(false);`);

const generateResultOld = `  async function generateResult(parts: Participant[]) {
    if (!room || room.status === 'completed') return;
    
    const canvas = document.createElement('canvas');`;
const generateResultNew = `  async function generateResult(parts: Participant[]) {
    if (!room || room.status === 'completed') return;
    
    setResultError(false);
    try {
      const canvas = document.createElement('canvas');`;

const endGenerateResultOld = `    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'completed',
      resultImage: finalBase64
    });
  };`;
const endGenerateResultNew = `      await updateDoc(doc(db, 'rooms', roomCode), {
        status: 'completed',
        resultImage: finalBase64
      });
    } catch (e) {
      console.error(e);
      setResultError(true);
    }
  };`;

code = code.replace(generateResultOld, generateResultNew);
code = code.replace(endGenerateResultOld, endGenerateResultNew);

// UI for result retry
code = code.replace(/<div className="animate-pulse text-xs font-bold uppercase tracking-widest text-neutral-400">Memproses komposisi foto...<\/div>/,
`{resultError ? (
                <div className="text-center space-y-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-red-500">Foto belum berhasil dibuat.</p>
                  <button onClick={() => generateResult(participants)} className="px-4 py-2 border border-neutral-200 rounded text-xs font-bold uppercase hover:bg-neutral-50 active:scale-95">Coba Lagi</button>
                </div>
              ) : (
                <div className="animate-pulse text-xs font-bold uppercase tracking-widest text-neutral-400">Memproses komposisi foto...</div>
              )}`
);

fs.writeFileSync(file, code);
