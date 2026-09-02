'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FrameConfig, FrameSlot } from '@/lib/frames';
import { Plus, Trash2, Copy, Image as ImageIcon, CheckCircle2, Eye, EyeOff } from 'lucide-react';

export default function CustomFrameEditor({
  onSave,
  onCancel,
  availableParticipants
}: {
  onSave: (config: FrameConfig, base64: string) => void;
  onCancel: () => void;
  availableParticipants: { name: string, index: number }[];
}) {
  const [image, setImage] = useState<string | null>(null);
  const [imgWidth, setImgWidth] = useState(0);
  const [imgHeight, setImgHeight] = useState(0);
  const [slots, setSlots] = useState<FrameSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [error, setError] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current || !image) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setContainerSize({ w: rect.width, h: rect.height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [image]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/webp'].includes(file.type)) {
      setError('Gunakan PNG atau WebP dengan background transparan.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Ukuran file terlalu besar. Maksimal 5MB.');
      return;
    }

    setError('');
    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        // Downscale to max 1600px width/height for safety
        const MAX_DIM = 1600;
        let w = img.width;
        let h = img.height;
        if (w > MAX_DIM || h > MAX_DIM) {
          const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          // Compress to webp for transparency and smaller size
          const compressed = canvas.toDataURL('image/webp', 0.8);
          setImgWidth(w);
          setImgHeight(h);
          setImage(compressed);
        } else {
          setImgWidth(img.width);
          setImgHeight(img.height);
          setImage(img.src);
        }
      };
      img.src = evt.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleAddSlot = () => {
    if (slots.length >= 12) {
      setError('Maksimal 12 area foto.');
      return;
    }
    const currentCount = slots.length;
    const pCount = Math.max(1, availableParticipants.length);
    const pIndex = currentCount % pCount;
    const rIndex = Math.floor(currentCount / pCount);

    const newSlot: FrameSlot = {
      id: `slot-${Date.now()}`,
      participantIndex: pIndex,
      roundIndex: rIndex,
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.4,
      borderRadius: 0
    };
    setSlots([...slots, newSlot]);
    setSelectedSlotId(newSlot.id);
  };

  const handleDuplicate = () => {
    if (slots.length >= 12) {
      setError('Maksimal 12 area foto.');
      return;
    }
    if (!selectedSlotId) return;
    const slotToCopy = slots.find(s => s.id === selectedSlotId);
    if (!slotToCopy) return;

    const currentCount = slots.length;
    const pCount = Math.max(1, availableParticipants.length);
    const pIndex = currentCount % pCount;
    const rIndex = Math.floor(currentCount / pCount);

    const newSlot: FrameSlot = {
      ...slotToCopy,
      id: `slot-${Date.now()}`,
      participantIndex: pIndex,
      roundIndex: rIndex,
      x: Math.min(0.9 - slotToCopy.width, slotToCopy.x + 0.05),
      y: Math.min(0.9 - slotToCopy.height, slotToCopy.y + 0.05),
    };
    setSlots([...slots, newSlot]);
    setSelectedSlotId(newSlot.id);
  };

  const handleDelete = () => {
    if (!selectedSlotId) return;
    setSlots(slots.filter(s => s.id !== selectedSlotId));
    setSelectedSlotId(null);
  };

  const handleSave = () => {
    if (slots.length === 0) {
      setError('Tambahkan area foto dulu.');
      return;
    }
    
    // Auto infer counts
    let maxP = 0;
    let maxR = 0;
    slots.forEach(s => {
      if (s.participantIndex > maxP) maxP = s.participantIndex;
      if (s.roundIndex > maxR) maxR = s.roundIndex;
    });

    const config: FrameConfig = {
      id: 'custom',
      name: 'Custom Frame',
      participantCount: maxP + 1,
      roundCount: maxR + 1,
      canvasWidth: imgWidth,
      canvasHeight: imgHeight,
      backgroundColor: '#ffffff',
      slots: slots
    };

    onSave(config, image!);
  };

  const selectedSlot = slots.find(s => s.id === selectedSlotId);

  return (
    <div className="fixed inset-0 bg-[#fdfdfd] z-50 flex flex-col font-sans overflow-hidden">
      <div className="flex items-center justify-between p-6 shrink-0 border-b border-neutral-100">
        <h2 className="text-xl font-black uppercase tracking-tighter">Frame Kamu</h2>
        <button onClick={onCancel} className="text-xs font-bold uppercase text-neutral-500 hover:text-neutral-900">Batal</button>
      </div>

      {!image ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center space-y-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-neutral-100 rounded-full mb-2">
              <ImageIcon className="w-8 h-8 text-neutral-400" />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tighter uppercase mb-2">Upload Frame</h3>
              <p className="text-sm font-bold tracking-widest uppercase text-neutral-500">Gunakan PNG atau WebP dengan background transparan.</p>
            </div>
            
            {error && <p className="text-xs font-bold uppercase tracking-widest text-red-600">{error}</p>}
            
            <div className="relative">
              <input 
                type="file" 
                accept="image/png,image/webp" 
                onChange={handleUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="w-full h-14 flex items-center justify-center bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 active:scale-95 transition-all">
                Pilih File
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
          {/* Main preview area */}
          <div className="flex-1 bg-neutral-100 p-4 md:p-8 flex items-center justify-center overflow-hidden relative">
            
            <div className="absolute top-4 left-4 z-20 flex gap-2">
               <button 
                 onClick={() => setPreviewMode(!previewMode)}
                 className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm text-[10px] font-bold uppercase tracking-widest text-neutral-700 hover:bg-neutral-50"
               >
                 {previewMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                 {previewMode ? 'Edit Mode' : 'Preview'}
               </button>
            </div>

            <div 
              ref={containerRef}
              className="relative max-w-full max-h-full"
              style={{ aspectRatio: `${imgWidth}/${imgHeight}` }}
            >
              {/* The uploaded frame image, usually has transparent holes */}
              {/* We put slots BEHIND the frame image so the frame overlays them correctly, 
                  but for editing, we must put the interactive handlers in FRONT. */}
              
              {/* Slots rendering (behind frame for preview, but interactive layer is in front) */}
              {slots.map((slot, idx) => (
                <div 
                  key={slot.id}
                  className="absolute bg-neutral-300 flex items-center justify-center border-2 border-white/50"
                  style={{
                    left: `${slot.x * 100}%`,
                    top: `${slot.y * 100}%`,
                    width: `${slot.width * 100}%`,
                    height: `${slot.height * 100}%`,
                    zIndex: 1 // Behind frame image
                  }}
                >
                  <span className="text-xs font-bold text-white uppercase tracking-widest text-center opacity-50 px-2">
                    Area {idx + 1}<br/>(F{slot.roundIndex + 1})
                  </span>
                </div>
              ))}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={image} 
                className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10" 
                alt="Frame Template"
              />

              {/* Interactive slot handles (In front of frame image) */}
              {!previewMode && containerSize.w > 0 && slots.map((slot, idx) => (
                <DraggableSlot
                  key={`handle-${slot.id}`}
                  slot={slot}
                  containerSize={containerSize}
                  isSelected={selectedSlotId === slot.id}
                  onSelect={() => setSelectedSlotId(slot.id)}
                  onChange={(newSlot) => {
                    setSlots(slots.map(s => s.id === newSlot.id ? newSlot : s));
                  }}
                  index={idx + 1}
                />
              ))}
            </div>
          </div>

          {/* Controls Panel */}
          <div className="w-full md:w-80 bg-white border-t md:border-t-0 md:border-l border-neutral-100 flex flex-col shrink-0">
             <div className="p-4 border-b border-neutral-100 overflow-x-auto flex gap-2 md:grid md:grid-cols-2 md:gap-3 shrink-0">
               <button 
                 onClick={handleAddSlot}
                 disabled={slots.length >= 12}
                 className="flex-1 whitespace-nowrap h-10 border border-neutral-200 text-neutral-800 rounded-lg font-bold uppercase tracking-widest text-[10px] hover:bg-neutral-50 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
               >
                 <Plus className="w-3 h-3" /> Tambah Area Foto
               </button>
               <button 
                 onClick={() => {
                   if (window.confirm('Ganti file frame? Area foto akan direset.')) {
                     setImage(null);
                     setSlots([]);
                     setSelectedSlotId(null);
                   }
                 }}
                 className="flex-1 whitespace-nowrap h-10 border border-neutral-200 text-neutral-800 rounded-lg font-bold uppercase tracking-widest text-[10px] hover:bg-neutral-50 active:scale-95 transition-all flex items-center justify-center gap-2"
               >
                 Ganti File
               </button>
               {selectedSlot && (
                  <>
                     <button 
                       onClick={handleDuplicate}
                       className="flex-1 whitespace-nowrap h-10 border border-neutral-200 text-neutral-800 rounded-lg font-bold uppercase tracking-widest text-[10px] hover:bg-neutral-50 active:scale-95 transition-all flex items-center justify-center gap-2"
                     >
                       <Copy className="w-3 h-3" /> Duplikat
                     </button>
                     <button 
                       onClick={handleDelete}
                       className="flex-1 whitespace-nowrap h-10 bg-red-50 text-red-600 rounded-lg font-bold uppercase tracking-widest text-[10px] hover:bg-red-100 active:scale-95 transition-all flex items-center justify-center gap-2"
                     >
                       <Trash2 className="w-3 h-3" /> Hapus
                     </button>
                  </>
               )}
             </div>

             <div className="flex-1 p-6 overflow-y-auto">
               {selectedSlot ? (
                 <div className="space-y-6">
                   <div className="inline-flex items-center justify-center px-3 py-1 bg-blue-100 text-blue-700 rounded text-[10px] font-bold uppercase tracking-widest">
                     Area Terpilih
                   </div>
                   
                   <div className="space-y-4">
                     <div className="group">
                       <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500 mb-2">
                         Foto dari
                       </label>
                       <select 
                         value={selectedSlot.participantIndex}
                         onChange={(e) => {
                           const val = parseInt(e.target.value);
                           setSlots(slots.map(s => s.id === selectedSlot.id ? { ...s, participantIndex: val } : s));
                         }}
                         className="w-full h-12 px-4 rounded-xl border border-neutral-200 bg-white text-sm font-bold uppercase tracking-widest outline-none focus:border-blue-600"
                       >
                         {availableParticipants.length > 0 ? (
                           availableParticipants.map(p => (
                             <option key={p.index} value={p.index}>{p.name}</option>
                           ))
                         ) : (
                           <>
                             <option value={0}>Orang 1</option>
                             <option value={1}>Orang 2</option>
                             <option value={2}>Orang 3</option>
                             <option value={3}>Orang 4</option>
                           </>
                         )}
                       </select>
                     </div>

                     <div className="group">
                       <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500 mb-2">
                         Urutan foto
                       </label>
                       <select 
                         value={selectedSlot.roundIndex}
                         onChange={(e) => {
                           const val = parseInt(e.target.value);
                           setSlots(slots.map(s => s.id === selectedSlot.id ? { ...s, roundIndex: val } : s));
                         }}
                         className="w-full h-12 px-4 rounded-xl border border-neutral-200 bg-white text-sm font-bold uppercase tracking-widest outline-none focus:border-blue-600"
                       >
                         {[0,1,2,3,4,5,6,7].map(i => (
                           <option key={i} value={i}>Foto {i + 1}</option>
                         ))}
                       </select>
                     </div>
                   </div>
                 </div>
               ) : (
                 <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                   <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">Pilih area foto untuk mengatur.</p>
                 </div>
               )}
             </div>

             <div className="p-4 border-t border-neutral-100 shrink-0">
                {error && <p className="text-[10px] font-bold uppercase tracking-widest text-red-600 text-center mb-3">{error}</p>}
                <button 
                  onClick={handleSave}
                  className="w-full h-14 flex items-center justify-center bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 active:scale-95 transition-all"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Pakai Frame
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DraggableSlot({ 
  slot, 
  containerSize, 
  isSelected, 
  onSelect, 
  onChange,
  index
}: { 
  slot: FrameSlot, 
  containerSize: { w: number, h: number },
  isSelected: boolean,
  onSelect: () => void,
  onChange: (s: FrameSlot) => void,
  index: number
}) {
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSlot = useRef({ ...slot });

  const pxRect = {
    x: slot.x * containerSize.w,
    y: slot.y * containerSize.w * (containerSize.h / containerSize.w), // y is normalized to height! Wait.
  };
  
  // Correction: x, y, width, height are 0-1 relative to canvasWidth/canvasHeight.
  // containerSize.w corresponds to canvasWidth, containerSize.h corresponds to canvasHeight.
  const pX = slot.x * containerSize.w;
  const pY = slot.y * containerSize.w * (containerSize.h / containerSize.w); 
  // actually slot.y is 0-1 of height. So pY = slot.y * containerSize.h
  // Let's make it simpler.
  const absX = slot.x * containerSize.w;
  const absY = slot.y * containerSize.h;
  const absW = slot.width * containerSize.w;
  const absH = slot.height * containerSize.h;

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    isDragging.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
    startSlot.current = { ...slot };
    
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  };

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    isResizing.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
    startSlot.current = { ...slot };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (isDragging.current) {
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      
      let newX = startSlot.current.x + (dx / containerSize.w);
      let newY = startSlot.current.y + (dy / containerSize.h);
      
      // Basic bounds
      newX = Math.max(0, Math.min(1 - startSlot.current.width, newX));
      newY = Math.max(0, Math.min(1 - startSlot.current.height, newY));

      onChange({ ...startSlot.current, x: newX, y: newY });
    } else if (isResizing.current) {
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      
      let newW = startSlot.current.width + (dx / containerSize.w);
      let newH = startSlot.current.height + (dy / containerSize.h);

      // Min size
      newW = Math.max(0.05, newW);
      newH = Math.max(0.05, newH);
      
      // Max size (bounds)
      newW = Math.min(1 - startSlot.current.x, newW);
      newH = Math.min(1 - startSlot.current.y, newH);

      onChange({ ...startSlot.current, width: newW, height: newH });
    }
  };

  const onPointerUp = () => {
    isDragging.current = false;
    isResizing.current = false;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  };

  return (
    <div 
      className={`absolute z-20 flex items-center justify-center cursor-move touch-none border-2 transition-colors ${isSelected ? 'border-blue-500 bg-blue-500/10' : 'border-neutral-400 border-dashed hover:border-blue-400 bg-white/5'}`}
      style={{
        left: `${absX}px`,
        top: `${absY}px`,
        width: `${absW}px`,
        height: `${absH}px`,
      }}
      onPointerDown={onPointerDown}
    >
      <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-white rounded shadow-sm ${isSelected ? 'text-blue-600' : 'text-neutral-500'}`}>
        {index}
      </span>
      
      {isSelected && (
        <div 
          className="absolute -bottom-3 -right-3 w-6 h-6 bg-blue-600 border-2 border-white rounded-full cursor-nwse-resize shadow-sm flex items-center justify-center touch-none"
          onPointerDown={onResizePointerDown}
        />
      )}
    </div>
  );
}
