'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, setDoc, runTransaction } from 'firebase/firestore';
import { generateRoomCode } from '@/lib/store';
import { ensureAuthUser } from '@/lib/auth';
import { ROOM_TTL_MS, DEFAULT_MAX_PARTICIPANTS, MIN_NAME_LENGTH, MAX_NAME_LENGTH, sanitizeDisplayName } from '@/lib/constants';

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
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
      const roomCode = generateRoomCode();
      const now = Date.now();

      await setDoc(doc(db, 'rooms', roomCode), {
        id: roomCode,
        hostUid: authUid,
        hostId: authUid,
        status: 'waiting',
        frameId: 'frame-side-by-side',
        configVersion: 1,
        activeSessionId: null,
        latestSessionId: null,
        currentRound: 0,
        createdAt: now,
        expiresAt: now + ROOM_TTL_MS,
        captureAt: null,
        sessionCount: 0,
        maxParticipants: DEFAULT_MAX_PARTICIPANTS,
        slots: [authUid, null],
      });

      await setDoc(doc(db, 'rooms', roomCode, 'participants', authUid), {
        id: authUid,
        uid: authUid,
        name: cleanName,
        participantIndex: 0,
        slotIndex: 0,
        isReady: false,
        readyConfigVersion: 1,
        isHost: true,
        presence: 'connected',
        joinedAt: now,
        updatedAt: now,
        photos: {}
      });

      localStorage.setItem(`participant_${roomCode}`, authUid);
      router.push(`/${roomCode}`);
    } catch (err: any) {
      console.error('Create room error:', err);
      setError(err.message || 'Gagal membuat room.');
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = sanitizeDisplayName(name);
    const cleanCode = code.trim().toUpperCase();

    if (!cleanCode) {
      setError('Kode room belum diisi.');
      return;
    }

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
        const roomRef = doc(db, 'rooms', cleanCode);
        const roomSnap = await transaction.get(roomRef);
        
        if (!roomSnap.exists()) {
          throw new Error('Room tidak ditemukan.');
        }
        
        const roomData = roomSnap.data();
        if (roomData.expiresAt && now > roomData.expiresAt) {
          throw new Error('Room sudah berakhir.');
        }

        if (roomData.status !== 'waiting' && roomData.status !== 'ready') {
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

        const participantRef = doc(db, 'rooms', cleanCode, 'participants', authUid);
        transaction.set(participantRef, {
          id: authUid,
          uid: authUid,
          name: cleanName,
          participantIndex: allocatedSlot,
          slotIndex: allocatedSlot,
          isReady: false,
          isHost: roomData.hostUid === authUid || roomData.hostId === authUid,
          presence: 'connected',
          joinedAt: now,
          updatedAt: now,
          photos: {}
        }, { merge: true });
      });
      
      localStorage.setItem(`participant_${cleanCode}`, authUid);
      router.push(`/${cleanCode}`);
    } catch (err: any) {
      console.error('Join room error:', err);
      setError(err.message || 'Gagal masuk room.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-[100dvh] w-full bg-white text-neutral-900 selection:bg-blue-100">
      {/* Header */}
      <header className="flex justify-between items-center px-5 sm:px-8 md:px-12 py-5 border-b border-neutral-100">
        <span className="text-xl font-bold tracking-tight text-neutral-900">FotoBareng</span>
      </header>
      
      {/* Content */}
      <main className="flex-1 flex flex-col justify-center px-5 sm:px-8 md:px-12 py-8 md:py-12 max-w-5xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 items-center">
          
          <div className="col-span-1 md:col-span-7">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-neutral-900 mb-3 md:mb-4 leading-tight">
              Foto bareng dari tempat berbeda.
            </h1>
            <p className="text-base sm:text-lg text-neutral-600 mb-6 md:mb-8 leading-relaxed max-w-md">
              Buat room, kirim link ke teman, lalu foto bareng langsung dari browser tanpa perlu aplikasi tambahan.
            </p>
            
            <div className="max-w-sm w-full">
              {mode === 'home' && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    id="btn-create-room"
                    onClick={() => { setMode('create'); setError(''); }}
                    className="h-12 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center"
                  >
                    Buat Room
                  </button>
                  <button
                    id="btn-join-room"
                    onClick={() => { setMode('join'); setError(''); }}
                    className="h-12 border border-neutral-300 text-neutral-800 bg-white rounded-xl font-medium text-sm hover:bg-neutral-50 active:scale-[0.98] transition-all flex items-center justify-center"
                  >
                    Masuk Room
                  </button>
                </div>
              )}

              {mode === 'create' && (
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label htmlFor="create-name" className="block text-sm font-medium text-neutral-700 mb-1.5">
                      Nama kamu
                    </label>
                    <input
                      id="create-name"
                      type="text"
                      placeholder="Contoh: Aghna"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => { setName(e.target.value); setError(''); }}
                      disabled={loading}
                      maxLength={MAX_NAME_LENGTH}
                      className="w-full h-12 px-4 rounded-xl border border-neutral-300 bg-white text-base text-neutral-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-neutral-400"
                    />
                    {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={loading}
                      className="h-12 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center"
                    >
                      {loading ? 'Membuat...' : 'Buat Room'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMode('home'); setError(''); }}
                      disabled={loading}
                      className="h-12 border border-neutral-300 text-neutral-700 rounded-xl font-medium text-sm hover:bg-neutral-50 active:scale-[0.98] transition-all flex items-center justify-center"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              )}

              {mode === 'join' && (
                <form onSubmit={handleJoin} className="space-y-4">
                  <div>
                    <label htmlFor="join-code" className="block text-sm font-medium text-neutral-700 mb-1.5">
                      Kode room
                    </label>
                    <input
                      id="join-code"
                      type="text"
                      placeholder="ABC123"
                      autoComplete="off"
                      value={code}
                      onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
                      maxLength={6}
                      disabled={loading}
                      className="w-full h-12 px-4 rounded-xl border border-neutral-300 bg-white text-base text-neutral-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-neutral-400 uppercase tracking-wide"
                    />
                  </div>
                  <div>
                    <label htmlFor="join-name" className="block text-sm font-medium text-neutral-700 mb-1.5">
                      Nama kamu
                    </label>
                    <input
                      id="join-name"
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
                  
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={loading}
                      className="h-12 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center"
                    >
                      {loading ? 'Masuk...' : 'Masuk Room'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMode('home'); setError(''); }}
                      disabled={loading}
                      className="h-12 border border-neutral-300 text-neutral-700 rounded-xl font-medium text-sm hover:bg-neutral-50 active:scale-[0.98] transition-all flex items-center justify-center"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
          
          {/* Desktop Visual Preview - Clean and Straight */}
          <div className="col-span-1 md:col-span-5 hidden md:flex justify-center">
            <div className="w-full max-w-[280px] bg-neutral-50 p-4 border border-neutral-200 rounded-xl">
              <div className="space-y-3">
                <div className="aspect-[4/3] bg-neutral-200 rounded-lg flex items-center justify-center border border-neutral-200">
                  <span className="text-xs font-medium text-neutral-500">Posisi Kamu</span>
                </div>
                <div className="aspect-[4/3] bg-neutral-100 rounded-lg flex items-center justify-center border border-neutral-200">
                  <span className="text-xs font-medium text-neutral-500">Posisi Teman</span>
                </div>
                <div className="pt-2 text-center">
                  <span className="text-[11px] font-medium text-neutral-400">FotoBareng</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
      
      {/* Footer */}
      <footer className="px-5 sm:px-8 md:px-12 py-5 border-t border-neutral-100 text-center sm:text-left">
        <p className="text-xs text-neutral-500">
          Foto hanya digunakan di room ini dan disimpan sementara.
        </p>
      </footer>
    </div>
  );
}
