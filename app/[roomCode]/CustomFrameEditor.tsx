'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FrameConfig, FrameSlot } from '@/lib/frames';
import { Plus, Trash2, Copy, Image as ImageIcon, Check, Eye, EyeOff } from 'lucide-react';

export default function CustomFrameEditor({
  onSave,
  onCancel,
  availableParticipants
}: {
  onSave: (config: FrameConfig, blob: Blob, previewUrl: string) => Promise<void> | void;
  onCancel: () => void;
  availableParticipants: { name: string, index: number }[];
}) {
  const [image, setImage] = useState<string | null>(null);
  const [frameBlob, setFrameBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
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
      setError('Ukuran file maksimal 5MB.');
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
          setImgWidth(w);
          setImgHeight(h);
          const previewUrl = canvas.toDataURL('image/webp', 0.85);
          setImage(previewUrl);

          canvas.toBlob((blob) => {
            if (blob) {
              setFrameBlob(blob);
            }
          }, 'image/webp', 0.85);
        } else {
          setImgWidth(img.width);
          setImgHeight(img.height);
          setImage(img.src);
          setFrameBlob(file);
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

  const handleSave = async () => {
    if (slots.length === 0) {
      setError('Tambahkan area foto terlebih dahulu.');
      return;
    }
    
    if (!frameBlob && !image) {
      setError('Pilih frame gambar terlebih dahulu.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      let maxP = 0;
      let maxR = 0;
      slots.forEach(s => {
        if (s.participantIndex > maxP) maxP = s.participantIndex;
        if (s.roundIndex > maxR) maxR = s.roundIndex;
      });

      const config: FrameConfig = {
        id: 'custom',
        name: 'Frame Kustom',
        participantCount: maxP + 1,
        roundCount: maxR + 1,
        canvasWidth: imgWidth,
        canvasHeight: imgHeight,
        backgroundColor: '#ffffff',
        slots: slots
      };

      let blobToUpload = frameBlob;
      if (!blobToUpload && image) {
        const res = await fetch(image);
        blobToUpload = await res.blob();
      }

      if (blobToUpload) {
        await onSave(config, blobToUpload, image || '');
      }
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan frame kustom.');
    } finally {
      setSaving(false);
    }
  };

  const selectedSlot = slots.find(s => s.id === selectedSlotId);

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 shrink-0 border-b border-neutral-100">
        <h2 className="text-base font-bold text-neutral-900">Frame Sendiri</h2>
        <button 
          onClick={onCancel} 
          className="text-xs font-medium text-neutral-600 hover:text-neutral-900 px-2 py-1"
        >
          Batal
        </button>
      </div>

      {!image ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-neutral-100 rounded-full">
              <ImageIcon className="w-6 h-6 text-neutral-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-neutral-900 mb-1">Upload Frame</h3>
              <p className="text-xs text-neutral-500">
                Gunakan PNG atau WebP dengan background transparan.
              </p>
            </div>
            
            {error && <p className="text-xs text-red-600">{error}</p>}
            
            <div className="relative pt-2">
              <input 
                type="file" 
                accept="image/png,image/webp" 
                onChange={handleUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="w-full h-12 flex items-center justify-center bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition-all">
                Pilih File Gambar
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
          {/* Main preview area */}
          <div className="flex-1 bg-neutral-100 p-4 sm:p-6 flex items-center justify-center overflow-hidden relative">
            
            <div className="absolute top-4 left-4 z-20">
               <button 
                 onClick={() => setPreviewMode(!previewMode)}
                 className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg shadow-xs text-xs font-medium text-neutral-700 hover:bg-neutral-50"
               >
                 {previewMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                 <span>{previewMode ? 'Mode Edit' : 'Pratinjau'}</span>
               </button>
            </div>

            <div 
              ref={containerRef}
              className="relative max-w-full max-h-full"
              style={{ aspectRatio: `${imgWidth}/${imgHeight}` }}
            >
              {/* Slots rendering (behind frame for preview) */}
              {slots.map((slot, idx) => (
                <div 
                  key={slot.id}
                  className="absolute bg-neutral-300 flex items-center justify-center border border-white/60"
                  style={{
                    left: `${slot.x * 100}%`,
                    top: `${slot.y * 100}%`,
                    width: `${slot.width * 100}%`,
                    height: `${slot.height * 100}%`,
                    zIndex: 1
                  }}
                >
                  <span className="text-[11px] font-medium text-white/80 text-center px-1">
                    Area {idx + 1}
                  </span>
                </div>
              ))}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={image} 
                className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10" 
                alt="Frame Template"
              />

              {/* Interactive slot handles */}
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
          <div className="w-full md:w-80 bg-white border-t md:border-t-0 md:border-l border-neutral-200 flex flex-col shrink-0">
             <div className="p-3 border-b border-neutral-100 flex gap-2 overflow-x-auto shrink-0">
               <button 
                 onClick={handleAddSlot}
                 disabled={slots.length >= 12}
                 className="h-9 px-3 border border-neutral-200 text-neutral-700 rounded-lg text-xs font-medium hover:bg-neutral-50 active:scale-[0.98] transition-all flex items-center gap-1.5 disabled:opacity-50 shrink-0"
               >
                 <Plus className="w-3.5 h-3.5" /> Tambah Area
               </button>
               {selectedSlot && (
                  <>
                     <button 
                       onClick={handleDuplicate}
                       className="h-9 px-3 border border-neutral-200 text-neutral-700 rounded-lg text-xs font-medium hover:bg-neutral-50 active:scale-[0.98] transition-all flex items-center gap-1.5 shrink-0"
                     >
                       <Copy className="w-3.5 h-3.5" /> Duplikat
                     </button>
                     <button 
                       onClick={handleDelete}
                       className="h-9 px-3 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 active:scale-[0.98] transition-all flex items-center gap-1.5 shrink-0"
                     >
                       <Trash2 className="w-3.5 h-3.5" /> Hapus
                     </button>
                  </>
               )}
             </div>

             <div className="flex-1 p-4 overflow-y-auto">
               {selectedSlot ? (
                 <div className="space-y-4">
                   <div className="text-xs font-semibold text-neutral-900">
                     Pengaturan Area {slots.findIndex(s => s.id === selectedSlot.id) + 1}
                   </div>
                   
                   <div className="space-y-3">
                     <div>
                       <label className="block text-xs font-medium text-neutral-600 mb-1">
                         Foto dari
                       </label>
                       <select 
                         value={selectedSlot.participantIndex}
                         onChange={(e) => {
                           const val = parseInt(e.target.value);
                           setSlots(slots.map(s => s.id === selectedSlot.id ? { ...s, participantIndex: val } : s));
                         }}
                         className="w-full h-10 px-3 rounded-lg border border-neutral-300 bg-white text-sm outline-none focus:border-blue-600"
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

                     <div>
                       <label className="block text-xs font-medium text-neutral-600 mb-1">
                         Urutan foto
                       </label>
                       <select 
                         value={selectedSlot.roundIndex}
                         onChange={(e) => {
                           const val = parseInt(e.target.value);
                           setSlots(slots.map(s => s.id === selectedSlot.id ? { ...s, roundIndex: val } : s));
                         }}
                         className="w-full h-10 px-3 rounded-lg border border-neutral-300 bg-white text-sm outline-none focus:border-blue-600"
                       >
                         {[0,1,2,3,4,5,6,7].map(i => (
                           <option key={i} value={i}>Foto {i + 1}</option>
                         ))}
                       </select>
                     </div>
                   </div>
                 </div>
               ) : (
                 <div className="h-full flex flex-col items-center justify-center text-center py-6">
                   <p className="text-xs text-neutral-400">
                     Pilih salah satu area di layar untuk mengatur.
                   </p>
                 </div>
               )}
             </div>

             <div className="p-3 border-t border-neutral-100 shrink-0">
                {error && <p className="text-xs text-red-600 text-center mb-2">{error}</p>}
                <button 
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full h-11 flex items-center justify-center bg-blue-600 text-white rounded-xl font-medium text-xs hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5 mr-1.5" /> 
                  <span>{saving ? 'Menyimpan...' : 'Pakai Frame Ini'}</span>
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
      
      newX = Math.max(0, Math.min(1 - startSlot.current.width, newX));
      newY = Math.max(0, Math.min(1 - startSlot.current.height, newY));

      onChange({ ...startSlot.current, x: newX, y: newY });
    } else if (isResizing.current) {
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      
      let newW = startSlot.current.width + (dx / containerSize.w);
      let newH = startSlot.current.height + (dy / containerSize.h);

      newW = Math.max(0.05, newW);
      newH = Math.max(0.05, newH);
      
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
      className={`absolute z-20 flex items-center justify-center cursor-move touch-none border transition-colors ${isSelected ? 'border-blue-600 bg-blue-500/10' : 'border-neutral-400 border-dashed hover:border-blue-400 bg-white/5'}`}
      style={{
        left: `${absX}px`,
        top: `${absY}px`,
        width: `${absW}px`,
        height: `${absH}px`,
      }}
      onPointerDown={onPointerDown}
    >
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 bg-white rounded shadow-xs ${isSelected ? 'text-blue-600' : 'text-neutral-600'}`}>
        {index}
      </span>
      
      {isSelected && (
        <div 
          className="absolute -bottom-2.5 -right-2.5 w-5 h-5 bg-blue-600 border-2 border-white rounded-full cursor-nwse-resize shadow-xs flex items-center justify-center touch-none"
          onPointerDown={onResizePointerDown}
        />
      )}
    </div>
  );
}
