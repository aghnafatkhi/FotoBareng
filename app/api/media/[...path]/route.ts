import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const MEDIA_DIR = path.join(process.cwd(), '.media-storage');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await params;
    const pathSegments = resolvedParams.path || [];
    const safeSubPath = pathSegments.join('/').replace(/[^a-zA-Z0-9_\-\.\/]/g, '').replace(/\.\./g, '');
    
    const fullFilePath = path.join(MEDIA_DIR, safeSubPath);

    if (!fs.existsSync(fullFilePath)) {
      return new NextResponse('Media not found', { status: 404 });
    }

    const stat = fs.statSync(fullFilePath);
    if (!stat.isFile()) {
      return new NextResponse('Invalid media path', { status: 400 });
    }

    const ext = path.extname(fullFilePath).toLowerCase();
    let contentType = 'image/jpeg';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.webp') contentType = 'image/webp';

    const fileBuffer = fs.readFileSync(fullFilePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Cache-Control': 'private, max-age=86400, stale-while-revalidate=3600',
      },
    });
  } catch (error: any) {
    console.error('Media fetch error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
