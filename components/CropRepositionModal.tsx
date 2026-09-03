'use client';

import React, { useState, useRef, useCallback } from 'react';
import { PhotoboothSession, SlotCrop } from '@/lib/store';
import { mediaStorage } from '@/lib/mediaStorage';
import { RotateCcw, Check, X, ZoomIn, ZoomOut } from 'lucide-react';

interface CropRepositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: PhotoboothSession;
  onSaveCrops: (crops: Record<string, SlotCrop>) => Promise<void>;
}

export function CropRepositionModal({
  isOpen,
  onClose,
  session,
  onSaveCrops
}: CropRepositionModalProps) {
  const [crops, setCrops] = useState<Record<string, SlotCrop>>(() => {
    return session.crops ? { ...session.crops } : {};
  });
  
  const frame = session.frameSnapshot;
  const slots = frame.slots;
  const [activeSlotId, setActiveSlotId] = useState<string>(slots[0]?.id || '');
  const [isSaving, setIsSaving] = useState(false);

  // Drag interaction state
  const dragStartRef = useRef<{ startX: number; startY: number; initialPanX: number; initialPanY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (!isOpen) return null;

  const currentSlot = slots.find(s => s.id === activeSlotId) || slots[0];
  const currentCrop: SlotCrop = (currentSlot && crops[currentSlot.id]) || { panX: 0, panY: 0, zoom: 1 };

  // Find capture for current slot
  const currentParticipant = session.participantSnapshot.find(
    p => p.slotIndex === currentSlot?.participantIndex
  );

  let captureUrl = '';
  if (currentParticipant) {
    let captureRecord = session.captures[`${currentParticipant.uid}_r${currentSlot.roundIndex}_a${session.currentAttempt}`];
    if (!captureRecord) {
      const matchingKeys = Object.keys(session.captures).filter(k => k.startsWith(`${currentParticipant.uid}_r${currentSlot.roundIndex}_a`));
      if (matchingKeys.length > 0) {
        matchingKeys.sort();
        captureRecord = session.captures[matchingKeys[matchingKeys.length - 1]];
      }
    }
    if (captureRecord?.mediaUrl) {
      captureUrl = mediaStorage.resolveMediaUrl(captureRecord.mediaUrl);
    }
  }

  const updateCurrentCrop = (newCrop: Partial<SlotCrop>) => {
    if (!currentSlot) return;
    setCrops(prev => {
      const existing = prev[currentSlot.id] || { panX: 0, panY: 0, zoom: 1 };
      return {
        ...prev,
        [currentSlot.id]: {
          ...existing,
          ...newCrop
        }
      };
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialPanX: currentCrop.panX || 0,
      initialPanY: currentCrop.panY || 0,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = (e.clientX - dragStartRef.current.startX) / (rect.width || 1);
    const dy = (e.clientY - dragStartRef.current.startY) / (rect.height || 1);

    // Limit pan sensitivity and bounds (-0.5 to 0.5)
    const newPanX = Math.max(-0.5, Math.min(0.5, dragStartRef.current.initialPanX + dx));
    const newPanY = Math.max(-0.5, Math.min(0.5, dragStartRef.current.initialPanY + dy));

    updateCurrentCrop({ panX: newPanX, panY: newPanY });
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
  };

  const handleReset = () => {
    if (!currentSlot) return;
    updateCurrentCrop({ panX: 0, panY: 0, zoom: 1 });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveCrops(crops);
      onClose();
    } catch (err) {
      console.error('Failed to save crops:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-xl flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-100">
          <div>
            <h3 className="text-sm font-bold text-neutral-900">Atur Posisi Foto</h3>
            <p className="text-[11px] text-neutral-500">Geser atau zoom posisi foto agar pas</p>
          </div>
          <button 
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-700 rounded-lg transition-colors"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Slot selector tabs (if multiple slots) */}
        {slots.length > 1 && (
          <div className="flex gap-2 p-3 bg-neutral-50 border-b border-neutral-100 overflow-x-auto">
            {slots.map((s, idx) => {
              const isSelected = s.id === activeSlotId;
              const p = session.participantSnapshot.find(item => item.slotIndex === s.participantIndex);
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSlotId(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    isSelected
                      ? 'bg-neutral-900 text-white'
                      : 'bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-100'
                  }`}
                >
                  Foto {idx + 1} {p ? `(${p.name})` : ''}
                </button>
              );
            })}
          </div>
        )}

        {/* Interactive Viewport */}
        <div className="p-4 flex flex-col items-center justify-center bg-neutral-100/60 select-none">
          <div 
            ref={containerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="relative overflow-hidden bg-neutral-900 rounded-xl cursor-grab active:cursor-grabbing touch-none border border-neutral-200 shadow-inner"
            style={{
              width: '240px',
              height: '320px',
              maxWidth: '100%',
            }}
          >
            {captureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={captureUrl}
                alt="Crop preview"
                className="w-full h-full object-cover pointer-events-none transition-transform duration-75"
                style={{
                  transform: `scale(${currentCrop.zoom || 1}) translate(${(currentCrop.panX || 0) * 100}%, ${(currentCrop.panY || 0) * 100}%)`,
                  transformOrigin: 'center center'
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-neutral-400">
                Memuat foto...
              </div>
            )}

            <div className="absolute bottom-2 left-2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-md pointer-events-none">
              Geser untuk atur posisi
            </div>
          </div>
        </div>

        {/* Controls: Zoom & Reset */}
        <div className="p-4 space-y-3 bg-white border-t border-neutral-100">
          <div className="flex items-center justify-between gap-3 text-xs text-neutral-600">
            <span className="font-medium">Zoom</span>
            <div className="flex items-center gap-2 flex-1 max-w-[200px]">
              <ZoomOut className="w-3.5 h-3.5 text-neutral-400" />
              <input
                type="range"
                min="1.0"
                max="2.0"
                step="0.05"
                value={currentCrop.zoom || 1}
                onChange={(e) => updateCurrentCrop({ zoom: parseFloat(e.target.value) })}
                className="w-full accent-blue-600"
              />
              <ZoomIn className="w-3.5 h-3.5 text-neutral-400" />
            </div>
            <span className="w-9 text-right font-mono text-neutral-700">
              {(currentCrop.zoom || 1).toFixed(1)}x
            </span>
          </div>

          <div className="flex items-center justify-between pt-1 gap-2">
            <button
              onClick={handleReset}
              className="h-10 px-3 border border-neutral-200 text-neutral-600 hover:bg-neutral-50 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{isSaving ? 'Menyimpan...' : 'Selesai'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
