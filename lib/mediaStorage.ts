/**
 * Media Storage Abstraction
 * Handles photo capture uploads, custom frame assets, and composite results
 * without exposing underlying storage mechanisms to UI components.
 */

export interface MediaUploadResult {
  path: string;
  url: string;
  size?: number;
}

export interface MediaStorageInterface {
  uploadCapture(
    roomId: string,
    sessionId: string | number,
    participantUid: string,
    roundIndex: number,
    blob: Blob,
    attemptId?: number
  ): Promise<MediaUploadResult>;

  uploadCustomFrame(
    roomId: string,
    blob: Blob
  ): Promise<MediaUploadResult>;

  uploadResult(
    roomId: string,
    sessionId: string | number,
    blob: Blob
  ): Promise<MediaUploadResult>;

  resolveMediaUrl(pathOrUrl: string): string;
}

class MediaStorageService implements MediaStorageInterface {
  private async uploadBlob(targetPath: string, blob: Blob): Promise<MediaUploadResult> {
    const formData = new FormData();
    const filename = targetPath.split('/').pop() || 'media.jpg';
    formData.append('file', blob, filename);
    formData.append('path', targetPath);

    const res = await fetch('/api/media/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `Upload failed with status ${res.status}`);
    }

    const data = await res.json();
    return {
      path: data.path,
      url: data.url,
      size: data.size,
    };
  }

  async uploadCapture(
    roomId: string,
    sessionId: string | number,
    participantUid: string,
    roundIndex: number,
    blob: Blob,
    attemptId: number = 1
  ): Promise<MediaUploadResult> {
    const cleanRoom = encodeURIComponent(roomId);
    const cleanSession = encodeURIComponent(String(sessionId));
    const cleanUid = encodeURIComponent(participantUid);
    const path = `rooms/${cleanRoom}/sessions/${cleanSession}/participants/${cleanUid}/rounds/r${roundIndex}_a${attemptId}.jpg`;
    return this.uploadBlob(path, blob);
  }

  async uploadCustomFrame(
    roomId: string,
    blob: Blob
  ): Promise<MediaUploadResult> {
    const cleanRoom = encodeURIComponent(roomId);
    const ext = blob.type === 'image/webp' ? 'webp' : 'png';
    const path = `rooms/${cleanRoom}/frames/custom_${Date.now()}.${ext}`;
    return this.uploadBlob(path, blob);
  }

  async uploadResult(
    roomId: string,
    sessionId: string | number,
    blob: Blob
  ): Promise<MediaUploadResult> {
    const cleanRoom = encodeURIComponent(roomId);
    const cleanSession = encodeURIComponent(String(sessionId));
    const path = `rooms/${cleanRoom}/results/session_${cleanSession}_${Date.now()}.jpg`;
    return this.uploadBlob(path, blob);
  }

  resolveMediaUrl(pathOrUrl: string): string {
    if (!pathOrUrl) return '';
    if (pathOrUrl.startsWith('data:') || pathOrUrl.startsWith('blob:') || pathOrUrl.startsWith('http')) {
      return pathOrUrl;
    }
    if (pathOrUrl.startsWith('/api/media/')) {
      return pathOrUrl;
    }
    return `/api/media/${pathOrUrl}`;
  }
}

export const mediaStorage = new MediaStorageService();
