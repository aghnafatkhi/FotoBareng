const fs = require('fs');
const file = 'app/[roomCode]/page.tsx';
let code = fs.readFileSync(file, 'utf8');

const expiredCheck = `
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
`;

code = code.replace(/if \(!room \|\| !participants\.length\) {/, expiredCheck + '\n  if (!room || !participants.length) {');

fs.writeFileSync(file, code);
