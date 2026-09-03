import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Base directory for media storage
const MEDIA_DIR = path.join(process.cwd(), '.media-storage');

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const targetPath = formData.get('path') as string | null;

    if (!file || !targetPath) {
      return NextResponse.json({ error: 'File and target path are required' }, { status: 400 });
    }

    // Sanitize path to prevent directory traversal
    const safePath = targetPath.replace(/[^a-zA-Z0-9_\-\.\/]/g, '').replace(/\.\./g, '');
    if (!safePath.startsWith('rooms/')) {
      return NextResponse.json({ error: 'Invalid target path' }, { status: 403 });
    }

    // MIME type check
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMime.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported media type. Only JPEG, PNG, and WebP are allowed' }, { status: 415 });
    }

    // Max 10MB limit
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds maximum allowed (10MB)' }, { status: 413 });
    }

    const fullFilePath = path.join(MEDIA_DIR, safePath);
    ensureDir(path.dirname(fullFilePath));

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(fullFilePath, buffer);

    const publicUrl = `/api/media/${safePath}`;

    return NextResponse.json({
      success: true,
      path: safePath,
      url: publicUrl,
      size: file.size,
      mimeType: file.type
    });
  } catch (error: any) {
    console.error('Media upload error:', error);
    return NextResponse.json({ error: 'Failed to upload media: ' + (error?.message || 'Server error') }, { status: 500 });
  }
}
