'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { generateRoomCode, generateParticipantId } from '@/lib/store';

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama belum diisi.');
      return;
    }
    setLoading(true);
    setError('');
    
    try {
      const participantId = generateParticipantId();
      const roomCode = generateRoomCode();
      const now = Date.now();

      await setDoc(doc(db, 'rooms', roomCode), {
        id: roomCode,
        hostId: participantId,
        status: 'waiting',
        frameId: 'frame-side-by-side', // Default frame
        currentRound: 0,
        createdAt: now,
        expiresAt: now + 1000 * 60 * 60 * 2, // 2 hours
        captureAt: null,
        sessionCount: 0
      });

      await setDoc(doc(db, 'rooms', roomCode, 'participants', participantId), {
        id: participantId,
        name: name.trim(),
        participantIndex: 0,
        isReady: false,
        isHost: true,
        joinedAt: now,
        updatedAt: now,
        photos: {}
      });

      localStorage.setItem(`participant_${roomCode}`, participantId);
      router.push(`/${roomCode}`);
    } catch (err: any) {
      setError(err.message || 'Gagal membuat room.');
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setError('Kode room dan nama belum diisi.');
      return;
    }
    setLoading(true);
    setError('');
    
    try {
      const cleanCode = code.trim().toUpperCase();
      const roomSnap = await getDoc(doc(db, 'rooms', cleanCode));
      
      if (!roomSnap.exists()) {
        throw new Error('Room tidak ditemukan.');
      }
      
      const roomData = roomSnap.data();
      if (roomData.status !== 'waiting' && roomData.status !== 'ready') {
        throw new Error('Sesi sedang berlangsung.');
      }

      // Get current participants to determine index
      const partsSnap = await getDocs(collection(db, 'rooms', cleanCode, 'participants'));
      const currentIndex = partsSnap.size;

      const participantId = generateParticipantId();
      const now = Date.now();

      await setDoc(doc(db, 'rooms', cleanCode, 'participants', participantId), {
        id: participantId,
        name: name.trim(),
        participantIndex: currentIndex,
        isReady: false,
        isHost: false,
        joinedAt: now,
        updatedAt: now,
        photos: {}
      });
      
      localStorage.setItem(`participant_${cleanCode}`, participantId);
      router.push(`/${cleanCode}`);
    } catch (err: any) {
      setError(err.message || 'Gagal masuk room.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-[#fdfdfd] text-neutral-900 font-sans selection:bg-blue-100 overflow-y-auto">
      <nav className="flex justify-between items-center px-6 md:px-12 py-6 md:py-10">
        <div className="text-xl md:text-2xl font-black tracking-tighter uppercase">FotoBareng</div>
        <div className="hidden md:flex gap-10 text-xs font-bold uppercase tracking-widest text-neutral-400">
          <span>Cara Kerja</span>
          <span>Bantuan</span>
        </div>
      </nav>
      
      <main className="flex-1 flex flex-col md:flex-row items-center px-6 md:px-12 pb-12 w-full">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 w-full items-center">
          <div className="col-span-1 md:col-span-7 md:pr-12">
            <h1 className="text-4xl md:text-[5.5rem] leading-[1] md:leading-[0.95] font-black tracking-tighter mb-6 md:mb-8 text-neutral-950 uppercase">
              Foto bareng dari tempat berbeda.
            </h1>
            <p className="text-lg md:text-xl text-neutral-600 mb-8 md:mb-12 max-w-lg leading-relaxed">
              Buat room, kirim link ke teman, lalu foto bareng langsung dari browser tanpa perlu aplikasi tambahan.
            </p>
            
            <div className="flex flex-col gap-10 max-w-sm w-full">
              {mode === 'home' && (
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setMode('create')}
                    className="h-14 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 active:scale-95 transition-all"
                  >
                    Buat Room
                  </button>
                  <button
                    onClick={() => setMode('join')}
                    className="h-14 border-2 border-neutral-200 text-neutral-800 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-neutral-50 active:scale-95 transition-all"
                  >
                    Masuk Room
                  </button>
                </div>
              )}

              {mode === 'create' && (
                <form onSubmit={handleCreate} className="space-y-6">
                  <div className="group">
                    <label htmlFor="name" className="block text-xs font-bold uppercase tracking-widest text-neutral-500 mb-3 group-focus-within:text-blue-600 transition-colors">
                      Nama kamu
                    </label>
                    <input
                      id="name"
                      type="text"
                      placeholder="Contoh: Aghna"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={loading}
                      className="w-full h-14 px-5 rounded-xl border border-neutral-200 bg-white text-lg font-medium outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-50/50 transition-all placeholder:text-neutral-300"
                    />
                  </div>
                  
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="submit"
                      disabled={loading}
                      className="h-14 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50"
                    >
                      {loading ? 'Membuat...' : 'Buat Room'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMode('home'); setError(''); }}
                      disabled={loading}
                      className="h-14 border-2 border-neutral-200 text-neutral-800 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-neutral-50 active:scale-95 transition-all"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              )}

              {mode === 'join' && (
                <form onSubmit={handleJoin} className="space-y-6">
                  <div className="group">
                    <label htmlFor="code" className="block text-xs font-bold uppercase tracking-widest text-neutral-500 mb-3 group-focus-within:text-blue-600 transition-colors">
                      Kode Room
                    </label>
                    <input
                      id="code"
                      type="text"
                      placeholder="ABC123"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      maxLength={6}
                      disabled={loading}
                      className="w-full h-14 px-5 rounded-xl border border-neutral-200 bg-white text-lg font-medium outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-50/50 transition-all placeholder:text-neutral-300 tracking-wider uppercase"
                    />
                  </div>
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
                  
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="submit"
                      disabled={loading}
                      className="h-14 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50"
                    >
                      {loading ? 'Masuk...' : 'Masuk Room'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMode('home'); setError(''); }}
                      disabled={loading}
                      className="h-14 border-2 border-neutral-200 text-neutral-800 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-neutral-50 active:scale-95 transition-all"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
          
          <div className="col-span-1 md:col-span-5 relative hidden md:block">
            <div className="absolute -top-20 -left-10 w-40 h-40 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-10"></div>
            <div className="relative rotate-3 bg-white p-5 shadow-[40px_40px_80px_-15px_rgba(0,0,0,0.1)] border border-neutral-100 max-w-sm mx-auto">
              <div className="space-y-4">
                <div className="aspect-[4/3] bg-neutral-100 grayscale flex items-center justify-center border border-neutral-100">
                  <div className="text-[10px] uppercase font-bold tracking-widest text-neutral-400">Posisi Kamu</div>
                </div>
                <div className="aspect-[4/3] bg-neutral-200 grayscale flex items-center justify-center border border-neutral-100">
                  <div className="text-[10px] uppercase font-bold tracking-widest text-neutral-400">Posisi Teman 1</div>
                </div>
                <div className="aspect-[4/3] bg-neutral-100 grayscale flex items-center justify-center border border-neutral-100">
                  <div className="text-[10px] uppercase font-bold tracking-widest text-neutral-400">Posisi Teman 2</div>
                </div>
                <div className="pt-4 pb-2 text-center">
                  <div className="text-[10px] font-black uppercase tracking-[0.4em] text-neutral-300">FOTOBARENG v1.0 • {new Date().getFullYear()}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      
      <footer className="px-6 md:px-12 py-6 md:py-10 flex flex-col md:flex-row justify-between items-start md:items-end border-t border-neutral-100 gap-6 md:gap-0 mt-8 md:mt-0">
        <div className="max-w-xs">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 mb-1">Privasi Dijamin</div>
          <p className="text-[11px] text-neutral-500 leading-normal">Foto disimpan sementara dan hanya bisa diakses oleh orang yang berada di dalam room yang sama.</p>
        </div>
        <div className="flex gap-8 md:gap-12 w-full md:w-auto justify-between md:justify-end">
          <div className="text-left md:text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 mb-1">Browser</div>
            <div className="text-[11px] font-bold text-neutral-900">Chrome, Safari, Firefox</div>
          </div>
          <div className="text-left md:text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 mb-1">Versi</div>
            <div className="text-[11px] font-bold text-neutral-900">Public Beta 0.8</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
